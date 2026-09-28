'use strict';
// auto-score.js — kvalitet på QA-kortet, 0–100, for auto-send. SKYGGE: sender ingenting, skriver aldri ERP.
//
//   Finn-utpris sikker   40  (AI enige 15, nære solgte 15, ikke ekstrapolert 10)
//   Cellen testet        30  (ekte bud i cellen 20, treff over lav 10)
//   Data komplett        20  (km stemmer 8, år/egenvekt 4, bilder 5, kommentar 3)
//   ERP = QA-kort        10
// Stopp (aldri auto): vrak, km-feil, PRIS MANUELT, AI svært uenige, always_qa/low_confidence, 0 eksterne comps.
// Heftelser stopper IKKE (alle biler har heftelser når estimatet sendes).
//
// Leser: ERP liste 3 (GET), jr/dossiers, v2 målinger, signaler-data.json, peasy-cells.json.
// Skriver: auto-score.json på Pages (Pulse-fanen «Auto») og logs.nosync/auto-score-skygge.jsonl
// (første poengsum per bil, til sammenligning med budet senere).
//
//   node auto-score.js          vis
//   node auto-score.js --push   vis + skriv auto-score.json og skyggelogg

const fs = require('fs');
const path = require('path');

const VERSJON = 'auto-score v1';
const GRENSE = 80;
const ERP = 'https://api.biladministrasjon.no';
const GH_REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const GH_FILE = 'auto-score.json';
const DOSSIER_DIR = path.join(__dirname, 'jr', 'dossiers');
const MAALINGER = path.join(__dirname, 'v2', 'logs.nosync', 'measurements.jsonl');
const SIGNALER = path.join(__dirname, 'signaler-data.json');
const CELLER_LOKAL = '/Users/bot/mikeljungbergtvedt.github.io/peasy-cells.json';
const SKYGGE = path.join(__dirname, 'logs.nosync', 'auto-score-skygge.jsonl');

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const plate = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function lesJson(fil) { try { return JSON.parse(fs.readFileSync(fil, 'utf8')); } catch (_) { return null; } }

// Samme bil kan ligge flere ganger i ERP med ulike internnr — hver lever sitt eget liv.
// Nyeste måling med samme erpId; bare hvis ingen har erpId, nyeste med samme regnr.
function sisteMaaling(regnr, erpId) {
  let rows;
  try { rows = fs.readFileSync(MAALINGER, 'utf8').split('\n'); } catch (_) { return null; }
  let reserve = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!rows[i] || rows[i].indexOf(regnr) === -1) continue;
    try {
      const r = JSON.parse(rows[i]);
      if (plate(r.regnr) !== regnr || !r.fossefall) continue;
      if (erpId != null && r.erpId != null && String(r.erpId) === String(erpId)) return r;
      if (!reserve && r.erpId == null) reserve = r;
    } catch (_) {}
  }
  return reserve;
}

function lesDossier(id, regnr) {
  return lesJson(path.join(DOSSIER_DIR, `${id}-${regnr}.json`));
}

function armKey(erpId, source) {
  const { liveOwner } = require('./ab-arm.js');
  const o = liveOwner(erpId, source);
  return o === 'ORDNA' ? 'ordna' : o.toLowerCase();
}

/** Ren poengfunksjon. Alle inn-felt kan mangle; mangler gir 0 på den delen, ikke krasj. */
function scoreKort({ erp, dossier, maaling, signal, celler }) {
  const deler = {};
  const grunner = [];
  const stopp = [];
  const oc = (dossier && dossier.origin_comps) || {};
  const chefs = oc.chefs || {};
  const ff = (maaling && maaling.fossefall) || {};
  const easy = (maaling && maaling.easy) || {};
  const key = armKey(erp.id, erp.source);
  const arm = ff[key] || {};
  const originKm = num(oc.km) != null ? num(oc.km) : num(erp.km);
  const originYear = num(dossier && dossier.identity && dossier.identity.year)
    || num(oc.ident && oc.ident.year) || num(erp.aar);

  // 1. Finn-utpris sikker (40)
  const cl = num(chefs.claude && chefs.claude.finn_utpris);
  const gr = num(chefs.grok && chefs.grok.finn_utpris);
  let enig = 0;
  if (cl && gr) {
    const diff = Math.abs(cl - gr) / ((cl + gr) / 2);
    enig = diff <= 0.03 ? 15 : Math.round(15 * clamp01((0.08 - diff) / 0.05));
    if (diff > 0.15) stopp.push(`AI svært uenige (Claude ${cl / 1000}k, Grok ${gr / 1000}k)`);
    else if (diff > 0.03) grunner.push(`AI uenige ${Math.round(diff * 100)} %`);
  } else grunner.push('mangler AI-vurdering');
  const solgte = ((oc.listings && oc.listings.sold_under_3m) || []).filter((c) => num(c.price) && num(c.km) != null);
  const naere = solgte.filter((c) => originKm != null && Math.abs(num(c.km) - originKm) <= 30000
    && (!originYear || !num(c.year) || Math.abs(num(c.year) - originYear) <= 1));
  const naerP = naere.length >= 3 ? 15 : naere.length === 2 ? 10 : naere.length === 1 ? 5 : 0;
  if (naere.length < 3) grunner.push(`${naere.length} solgte med ±30k km`);
  let ekstraP = 0;
  if (solgte.length && originKm != null) {
    const kms = solgte.map((c) => num(c.km));
    const utenfor = Math.max(0, originKm - Math.max(...kms), Math.min(...kms) - originKm);
    ekstraP = Math.round(10 * clamp01((40000 - utenfor) / 40000));
    if (utenfor > 10000) grunner.push(`km ${Math.round(utenfor / 1000)}k utenfor solgte`);
  } else grunner.push('ingen solgte å sammenligne');
  deler.finn = enig + naerP + ekstraP;

  // 2. Cellen testet (30)
  const celle = (celler && celler.celler && ff.celleId && celler.celler[ff.celleId]) || null;
  // Alle ekte auksjonsbud i cellen teller for dekning (n_bud, også før fossefallet); fullt ved 10.
  // Treff over lav kan bare måles på bud etter fossefallet (n), krever minst 5.
  const nBud = celle ? (num(celle.n_bud) || 0) : 0;
  const nNy = celle ? (num(celle.n) || 0) : 0;
  const budP = Math.round(20 * clamp01(nBud / 10));
  const andel = celle && celle.spenn ? num(celle.spenn.over_lav_andel) : null;
  const treffP = nNy >= 5 && andel != null ? Math.round(10 * clamp01(andel / 0.8)) : 0;
  if (nBud < 10) grunner.push(`celle ${ff.celleId || '?'}: ${nBud} bud`);
  if (nNy < 5) grunner.push(`treff ikke målbart (${nNy} nye bud)`);
  deler.celle = budP + treffP;

  // 3. Data komplett (20)
  const erpKm = num(erp.km);
  let kmP = 8;
  if (erpKm != null && originKm != null && originKm > 0) {
    const r = Math.abs(erpKm - originKm) / Math.max(erpKm, originKm);
    if (r > 0.2) { kmP = 0; stopp.push(`km-feil (ERP ${erpKm}, annonse ${originKm})`); }
  }
  const aarP = (originYear ? 2 : 0) + (arm.omregistrering_note && /fallback/i.test(arm.omregistrering_note) ? 0 : 2);
  const bilder = num(signal && signal.imageCount) || 0;
  const bildeP = bilder > 0 ? 5 : 0;
  if (!bilder) grunner.push('ingen bilder');
  const kommP = signal && signal.hasComment ? 3 : 0;
  deler.data = kmP + aarP + bildeP + kommP;

  // 4. ERP = QA-kort (10)
  const lik = num(arm.lav) != null && num(arm.lav) === num(erp.lav) && num(arm.hoy) === num(erp.hoy);
  deler.erp = lik ? 10 : 0;
  if (!lik) grunner.push('ERP ≠ QA-kort');

  // Stopp
  if (ff.pris_manuelt) stopp.push('PRIS MANUELT');
  if (easy.wrecker || (signal && signal.kjorbar === 'nei')) stopp.push('vrak / ikke kjørbar');
  if (oc.always_qa || easy.always_qa) stopp.push('always_qa');
  if (oc.low_confidence || easy.low_confidence) stopp.push('lav sikkerhet');
  if (oc.skip_put || num(oc.n_external) === 0) stopp.push('0 eksterne comps');
  if (!maaling) stopp.push('ingen QA-måling');

  const score = deler.finn + deler.celle + deler.data + deler.erp;
  return { score, deler, grunner, stopp, ville_sendt: score >= GRENSE && stopp.length === 0 };
}

const VURDER_MAKS_MIN = 10;
const SETT_FIL = path.join(__dirname, 'logs.nosync', 'auto-score-sett.json');
function lesSettFoerst() { return lesJson(SETT_FIL) || {}; }
function skrivSettFoerst(sett, aktive) {
  const ut = {};
  for (const id of Object.keys(sett)) if (aktive.has(Number(id)) || aktive.has(id)) ut[id] = sett[id];
  try { fs.mkdirSync(path.dirname(SETT_FIL), { recursive: true }); fs.writeFileSync(SETT_FIL, JSON.stringify(ut)); } catch (_) {}
}

async function hentListe3() {
  const tok = (await (await fetch(ERP + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS }) })).json()).data.token.token;
  const d = await (await fetch(ERP + '/c2b_module/peasy/processing/final_estimate?per_page=100', { headers: { Authorization: 'Bearer ' + tok } })).json();
  return (d.data && d.data.data && d.data.data.data) || [];
}

async function byggAutoScore() {
  const liste = await hentListe3();
  const signaler = lesJson(SIGNALER) || {};
  const celler = lesJson(CELLER_LOKAL);
  const sigByReg = {};
  for (const k in signaler) { const s = signaler[k]; if (s && s.regnr) sigByReg[plate(s.regnr)] = s; }
  const biler = liste.map((b) => {
    const regnr = plate(b.registration_number);
    const dnc = b.drive_no_car_data || {};
    const erp = { id: b.id, source: b.source, km: b.mileage != null ? b.mileage : dnc.mileage, aar: dnc.model_year,
      lav: b.price_final_min, hoy: b.price_final_max };
    const maaling = sisteMaaling(regnr, b.id);
    const r = scoreKort({ erp, dossier: lesDossier(b.id, regnr), maaling, signal: sigByReg[regnr], celler });
    return Object.assign({ regnr, id: b.id, kilde: b.source || null,
      bil: [dnc.manufacturer_name || b.manufacturer, dnc.model_series, dnc.model_year].filter(Boolean).join(' '),
      km: erp.km, erp_lav: erp.lav, erp_hoy: erp.hoy, arm: armKey(b.id, b.source).toUpperCase(),
      finn_utpris: maaling && maaling.fossefall && maaling.fossefall.a ? maaling.fossefall.a.finn_utpris : null }, r);
  }).sort((x, y) => y.score - x.score);
  // Rute: vurderes (ikke ferdig priset, maks VURDER_MAKS_MIN), auto (sendes nå), qa (QA send).
  const sett = lesSettFoerst();
  const naa = Date.now();
  for (const b of biler) {
    if (!sett[b.id]) sett[b.id] = new Date(naa).toISOString();
    const minutter = (naa - Date.parse(sett[b.id])) / 60000;
    const ferdig = b.erp_lav != null && !b.stopp.includes('ingen QA-måling');
    if (!ferdig && minutter < VURDER_MAKS_MIN) b.rute = 'vurderes';
    else if (b.ville_sendt && process.env.AUTO_SEND === '1') b.rute = 'auto';
    else b.rute = 'qa';
  }
  skrivSettFoerst(sett, new Set(biler.map((b) => b.id)));
  return { versjon: VERSJON, bygget: new Date().toISOString(), grense: GRENSE, skygge: true,
    antall: biler.length, ville_sendt: biler.filter((b) => b.ville_sendt).length, biler };
}

function skrivSkygge(data) {
  const sett = new Set();
  try { for (const l of fs.readFileSync(SKYGGE, 'utf8').split('\n')) { if (!l) continue; try { sett.add(JSON.parse(l).id); } catch (_) {} } } catch (_) {}
  fs.mkdirSync(path.dirname(SKYGGE), { recursive: true });
  let nye = 0;
  for (const b of data.biler) {
    if (sett.has(b.id) || b.erp_lav == null || b.stopp.includes('ingen QA-måling')) continue; // ikke ferdig priset ennå
    fs.appendFileSync(SKYGGE, JSON.stringify(Object.assign({ tid: data.bygget, versjon: data.versjon }, b)) + '\n');
    nye++;
  }
  return nye;
}

/** Siste n biler fra skyggeloggen (første poengsum per bil), nyeste først. */
function lesHistorikk(n) {
  let rows = [];
  try { rows = fs.readFileSync(SKYGGE, 'utf8').split('\n').filter(Boolean); } catch (_) { return []; }
  return rows.slice(-n).reverse().map((l) => {
    try {
      const b = JSON.parse(l);
      return { tid: b.tid, etterpaa: !!b.etterpaa, regnr: b.regnr, id: b.id, bil: b.bil, arm: b.arm, score: b.score, ville_sendt: b.ville_sendt,
        erp_lav: b.erp_lav, erp_hoy: b.erp_hoy, stopp: b.stopp, grunner: b.grunner };
    } catch (_) { return null; }
  }).filter(Boolean);
}

async function pushTilPages(data, token) {
  // Andre jobber skriver til samme repo; ved sha-kollisjon prøv igjen med fersk sha.
  for (let forsok = 1; ; forsok++) {
    try { return await pushEnGang(data, token); } catch (e) {
      if (forsok >= 4 || !/expected|sha|409|conflict/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * forsok));
    }
  }
}

async function pushEnGang(data, token) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
  const h = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  const shaRes = await fetch(url, { headers: h });
  const shaData = shaRes.ok ? await shaRes.json() : {};
  const body = { message: `auto-score ${data.bygget.slice(0, 16)}`, content: Buffer.from(JSON.stringify(data, null, 1)).toString('base64') };
  if (shaData && shaData.sha) body.sha = shaData.sha;
  const put = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(body) });
  const pd = await put.json();
  if (!pd || !pd.content) throw new Error('push feilet: ' + ((pd && pd.message) || put.status));
}

// ── Auto-send ────────────────────────────────────────────────────────────
// AUTO_SEND=1 i .env: biler med ville_sendt sendes via samme /trigger-eval som Send-knappen i Pulse
// (km-sperre og confirmFinalEstimate som før). Maks AUTO_SEND_MAKS_DAG per døgn (default 10).
// Uten AUTO_SEND=1: skygge, ingenting sendes.
const SENDT = path.join(__dirname, 'logs.nosync', 'auto-sendt.jsonl');

function lesSendt() {
  try { return fs.readFileSync(SENDT, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; }
}

// Varsel på e-post til post@peasy.no (AUTO_SEND_VARSEL overstyrer), samme SMTP som boten.
async function varsle(emne, tekst) {
  const user = process.env.IMAP_USER || process.env.EMAIL_USER;
  if (!user || !process.env.IMAP_PASS) return;
  try {
    const t = require('nodemailer').createTransport({ host: 'exchange.tornado.email', port: 587, secure: false,
      auth: { user, pass: process.env.IMAP_PASS }, connectionTimeout: 10000, greetingTimeout: 10000 });
    await t.sendMail({ from: 'Peasy Bot <' + user + '>', to: process.env.AUTO_SEND_VARSEL || 'post@peasy.no', subject: emne, text: tekst });
  } catch (e) { console.error('varsel feilet:', e.message); }
}

async function autoSend(data, log) {
  const L = log || console.log;
  if (process.env.AUTO_SEND !== '1') return { paa: false, sendt: [] };
  const maks = Number(process.env.AUTO_SEND_MAKS_DAG) || 10;
  const tidligere = lesSendt();
  const idag = new Date().toISOString().slice(0, 10);
  let igjen = maks - tidligere.filter((x) => x.ok && String(x.tid).slice(0, 10) === idag).length;
  const allerede = new Set(tidligere.filter((x) => x.ok).map((x) => x.id));
  let laas = () => false;
  try { const q = require('./qa-clear-cache.js'); if (typeof q.hasReevalLock === 'function') laas = (r) => q.hasReevalLock(r); } catch (_) {}
  const port = process.env.EASY_WEBHOOK_PORT || '7780';
  const sendt = [];
  for (const b of data.biler) {
    if (!b.ville_sendt || allerede.has(b.id)) continue;
    if (b.rute !== 'auto') continue;
    if (igjen <= 0) { L(`auto-send: dagstak ${maks} nådd — ${b.regnr} går til QA`); b.auto_grunn = 'dagstak nådd'; b.rute = 'qa'; continue; }
    if (laas(b.regnr)) { L(`auto-send: ${b.regnr} regnes på nytt i QA — hopper over`); continue; }
    const rec = { tid: new Date().toISOString(), regnr: b.regnr, id: b.id, bil: b.bil, arm: b.arm, score: b.score, erp_lav: b.erp_lav, erp_hoy: b.erp_hoy, ok: false };
    try {
      const r = await fetch(`http://127.0.0.1:${port}/trigger-eval`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.EASY_WEBHOOK_TOKEN },
        body: JSON.stringify({ regnr: b.regnr, km: b.km }) });
      if (!r.ok) throw new Error('webhook ' + r.status + ' ' + (await r.text()).slice(0, 120));
      // Bekreftet når bilen har gått av liste 3.
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const l3 = await hentListe3();
        if (!l3.some((x) => x.id === b.id)) { rec.ok = true; break; }
      }
      if (!rec.ok) rec.feil = 'fortsatt på liste 3 etter 60 s';
    } catch (e) { rec.feil = e.message; }
    fs.mkdirSync(path.dirname(SENDT), { recursive: true });
    fs.appendFileSync(SENDT, JSON.stringify(rec) + '\n');
    sendt.push(rec);
    if (rec.ok) {
      igjen--; b.auto_sendt = rec.tid;
      L(`auto-send: ${b.regnr} sendt (${b.score} poeng, ${b.erp_lav}–${b.erp_hoy})`);
      await varsle(`Auto-sendt ${b.regnr} ${b.bil}`, `${b.regnr} ${b.bil}\nEstimat sendt til kunde: ${b.erp_lav.toLocaleString('nb-NO')} – ${b.erp_hoy.toLocaleString('nb-NO')} kr (${b.arm})\nPoeng: ${b.score}/100 (finn ${b.deler.finn}/40, celle ${b.deler.celle}/30, data ${b.deler.data}/20, erp ${b.deler.erp}/10)\n\nSe Pulse → Mer → Auto.`);
    } else {
      b.rute = 'qa';
      L(`auto-send: ${b.regnr} FEILET: ${rec.feil}`);
      await varsle(`Auto-send feilet ${b.regnr}`, `${b.regnr} ${b.bil}\n${rec.feil}\n\nBilen ligger på QA send.`);
    }
  }
  return { paa: true, sendt };
}

module.exports = { VERSJON, GRENSE, scoreKort, byggAutoScore, autoSend };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), override: true, quiet: true });
  (async () => {
    const data = await byggAutoScore();
    for (const b of data.biler) {
      console.log(`${(b.rute || '').padEnd(9)}${b.ville_sendt ? 'AUTO ' : 'QA   '} ${String(b.score).padStart(3)}  ${b.regnr.padEnd(8)} ${b.arm.padEnd(5)} ERP ${b.erp_lav}–${b.erp_hoy}  [finn ${b.deler.finn} celle ${b.deler.celle} data ${b.deler.data} erp ${b.deler.erp}]` +
        (b.stopp.length ? '  STOPP: ' + b.stopp.join('; ') : '') + (b.grunner.length ? '  | ' + b.grunner.join('; ') : ''));
    }
    console.log(`${data.ville_sendt} av ${data.antall} ville blitt sendt automatisk (grense ${data.grense})`);
    if (process.argv.includes('--push')) {
      const nye = skrivSkygge(data);
      const as = await autoSend(data);
      data.auto_send_paa = as.paa;
      data.auto_sendt = lesSendt().slice(-200).reverse();
      data.historikk = lesHistorikk(200);
      // Pulse (QA send) leser ruter: id → vurderes | auto | qa. Bilen vises på QA send bare når rute = qa.
      data.ruter = {};
      for (const b of data.biler) data.ruter[b.id] = b.auto_sendt ? 'sendt' : b.rute;
      // Push bare ved endring, ellers hvert 10. min som livstegn (Pulse viser alt hvis fila er > 15 min gammel).
      const PUSHFIL = path.join(__dirname, 'logs.nosync', 'auto-score-push.json');
      const sig = JSON.stringify([data.ruter, data.biler.map((b) => [b.id, b.score]), data.auto_sendt.length, data.historikk.length]);
      const forrige = lesJson(PUSHFIL) || {};
      if (sig === forrige.sig && Date.now() - (forrige.t || 0) < 10 * 60000) { console.log('uendret — ingen push'); return; }
      if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN mangler i .env');
      await pushTilPages(data, process.env.GITHUB_TOKEN);
      fs.writeFileSync(PUSHFIL, JSON.stringify({ sig, t: Date.now() }));
      console.log(`auto-score.json skrevet, ${nye} nye i skyggeloggen, ruter ${JSON.stringify(data.ruter)}`);
    }
  })().catch((e) => { console.error('Feil:', e.message); process.exit(1); });
}
