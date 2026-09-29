'use strict';
// bud-fossefall.js — «Bud mot fossefall» i Scoreboard: kjeden Finn-utpris → fossefall → estimert AR-bud → faktisk AR-bud.
//
// Per bil med faktisk AR-bud (ERP-eksporten, kolonne «Bud»):
//   live           priset av fossefallet (måling med fossefall-kort): estimert AR-bud fra kortet
//   tilbakeregnet  eldre bil: Finn-utprisen den hadde, kjørt gjennom dagens fossefall-tabeller
// Finn-kilde grupperes (sterk / middels / svak) for å se om avviket kommer fra Finn-utprisen eller tabellen.
// GB-ML tas med når GB-fanen har regnet på bilen (cache), som uavhengig Finn-utpris.
//
// Leser bare: ERP-eksporten (GET), målingene, Jr-dossierene, GB-cache, bot-loggen ([finn-felt]).
// Skriver bare bud-fossefall.json på Pages. Rører ikke ERP, satser, fossefall eller prisingen.
//
//   node bud-fossefall.js          vis
//   node bud-fossefall.js --push   skriv bud-fossefall.json

const fs = require('fs');
const os = require('os');
const path = require('path');
const fossefall = require('./fossefall');
const tc = require('./takst-celler');
const { liveOwner } = require('./ab-arm.js');

const VERSJON = 'bud-fossefall v1';
const FRA_DATO = '2025-11-01';
const GH_REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const GH_FILE = 'bud-fossefall.json';
const MAALINGER = path.join(__dirname, 'v2', 'logs.nosync', 'measurements.jsonl');
const DOSSIER_DIR = path.join(__dirname, 'jr', 'dossiers');
const GB_CACHE = process.env.GB_ML_CACHE || path.join(os.tmpdir(), 'gb-ml');
const BOTLOGG = path.join(__dirname, 'logs', 'out.log');
// ERP-eksporten (samme kolonner som takst-celler og Pulse)
const K = { internnr: 0, regnr: 1, estimat: 3, peasyBud: 4, merke: 6, modell: 7, aar: 8, kilde: 11, status: 12, registrert: 13, solgt: 18, bud: 19, retur: 21, km: 22 };

const plate = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');
const tall = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[\s ]/g, '')); return Number.isFinite(n) ? n : null; };
const positiv = (v) => { const n = tall(v); return n != null && n > 0 ? n : null; };
const isoDato = (v) => { const m = String(v == null ? '' : v).match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
function estimat(v) {
  const m = String(v == null ? '' : v).replace(/[\s ]/g, '').match(/^(\d+)[-–](\d+)/);
  return m ? { lav: Number(m[1]), hoy: Number(m[2]) } : null;
}
function median(a) { const s = a.filter((x) => x != null).slice().sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function kvantil(a, q) { const s = a.filter((x) => x != null).slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; }
function lesJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }

/** Siste fossefall-måling per erpId (ekskl. rettede QA-rader). */
function fossefallMaalinger() {
  const m = new Map();
  let tekst = ''; try { tekst = fs.readFileSync(MAALINGER, 'utf8'); } catch (_) {}
  for (const l of tekst.split('\n')) {
    if (!l) continue;
    try { const r = JSON.parse(l); if (r.erpId != null && r.fossefall && r.fossefall.a && r.writer !== 'rettet-28.09') m.set(String(r.erpId), r); } catch (_) {}
  }
  return m;
}

/** Finn-utprisen skrevet til ERP-feltet (fra bot-loggen). */
function finnFeltLogg() {
  const m = new Map();
  let tekst = ''; try { tekst = fs.readFileSync(BOTLOGG, 'utf8'); } catch (_) {}
  const re = /\[finn-felt\] (\d+) (\d+|null) (\d{3})/;
  for (const l of tekst.split('\n')) { const x = l.match(re); if (x) m.set(x[1], { kr: x[2] === 'null' ? null : Number(x[2]), status: Number(x[3]) }); }
  return m;
}

/** Hvor sikker Finn-utprisen var: sterk / middels / svak + grunn. */
function finnKvalitet(dossier, grunn) {
  const oc = (dossier && dossier.origin_comps) || {};
  const ch = oc.chefs || {};
  const cl = tall(ch.claude && ch.claude.finn_utpris), gr = tall(ch.grok && ch.grok.finn_utpris);
  const uenig = cl && gr ? Math.abs(cl - gr) / ((cl + gr) / 2) : null;
  const n = tall(oc.n_external);
  const g = String(grunn || oc.finn_utpris_grunn || oc.finn_utpris_kilde || '');
  if (/kun.kundens/.test(g)) return { gruppe: 'svak', grunn: 'kundens egen annonse', n_comps: n, ai_uenig: uenig };
  if (n != null && n <= 2) return { gruppe: 'svak', grunn: n + ' sammenlignbare', n_comps: n, ai_uenig: uenig };
  if (uenig != null && uenig > 0.08) return { gruppe: 'svak', grunn: 'AI ' + Math.round(uenig * 100) + ' % uenige', n_comps: n, ai_uenig: uenig };
  if (n != null && n >= 5 && (uenig == null || uenig <= 0.03)) return { gruppe: 'sterk', grunn: n + ' sammenlignbare' + (uenig != null ? ', AI enige' : ''), n_comps: n, ai_uenig: uenig };
  if (n == null && uenig == null) return { gruppe: 'ukjent', grunn: 'ingen dossier', n_comps: null, ai_uenig: null };
  return { gruppe: 'middels', grunn: (n != null ? n + ' sammenlignbare' : '') + (uenig != null ? (n != null ? ', ' : '') + 'AI ' + Math.round(uenig * 100) + ' % uenige' : ''), n_comps: n, ai_uenig: uenig };
}

function gbFor(regnr) {
  const r = lesJson(path.join(GB_CACHE, 'result-' + regnr + '.json'));
  return r && r.ok !== false && positiv(r.pred_base) ? { pred: positiv(r.pred_base), intervall: r.interval_80_base || null } : null;
}

async function byggBudFossefall() {
  const satser = await fossefall.loadFossefallSatser({ force: true });
  if (!satser) throw new Error('fossefallSatser ikke lastet');
  const rader = await tc.hentErpRader();
  const live = fossefallMaalinger();
  const idx = tc.indekserMaalinger(tc.lesKilder());
  const felt = finnFeltLogg();
  const biler = [];
  for (const r of rader) {
    const arBud = positiv(r[K.bud]);
    if (!arBud) continue;
    const reg = plate(r[K.regnr]);
    if (!reg || (isoDato(r[K.registrert]) && isoDato(r[K.registrert]) < FRA_DATO)) continue;
    const id = String(r[K.internnr]);
    const kilde = String(r[K.kilde] || '').toLowerCase();
    const km = positiv(r[K.km]);
    const aar = positiv(r[K.aar]) || 2020;
    let modus, finn, arEst, celle, grunn, arm;
    const m = live.get(id);
    if (m) {
      const eier = liveOwner(id, kilde);
      const k = eier === 'ORDNA' ? 'ordna' : eier.toLowerCase();
      arm = m.fossefall[k] || m.fossefall.a;
      finn = positiv(arm.finn_utpris) || positiv(m.fossefall.a.finn_utpris);
      arEst = positiv(arm.ar_bud_est || arm.ar_bid_est || m.fossefall.a.ar_bud_est);
      celle = m.fossefall.celleId || arm.celleId || null;
      grunn = arm.finn_utpris_grunn || null;
      modus = 'live';
    } else {
      const liste = (idx.get(reg) || []).slice().sort((a, b) => a.nivaa - b.nivaa || (b.ts > a.ts ? 1 : -1));
      const mm = liste[0];
      if (!mm) continue;
      finn = mm.finn;
      const looked = fossefall.lookupFossefallCell(satser, finn, km || mm.km || 0);
      if (!looked || !looked.ok) continue;
      const a = fossefall.computeSharedFossefall({ finnUtpris: finn, km: km || mm.km || 0, modelYear: aar, satser, looked, statidKr: mm.statid || 0,
        bilInfo: mm.egenvekt ? { year: aar, egenvekt: mm.egenvekt } : { year: aar } });
      arEst = positiv(a && (a.ar_bud_est || a.ar_bid_est));
      celle = looked.cell;
      grunn = mm.kilde === 'kommentar' ? 'fra ERP-kommentar' : null;
      modus = 'tilbakeregnet';
    }
    if (!finn || !arEst) continue;
    const est = estimat(r[K.estimat]);
    const peasyBud = positiv(r[K.peasyBud]);
    const dossier = lesJson(path.join(DOSSIER_DIR, id + '-' + reg + '.json'));
    const kv = finnKvalitet(dossier, grunn);
    const gb = gbFor(reg);
    const status = String(r[K.status] || '').toLowerCase();
    biler.push({
      id, regnr: reg, bil: [r[K.merke], r[K.modell], r[K.aar]].filter(Boolean).join(' '), km, kilde,
      modus, celle, finn_utpris: finn, finn_felt: felt.get(id) || null,
      ar_bud_est: arEst, ar_bud: arBud, avvik: Math.round((arBud / arEst - 1) * 1000) / 1000,
      estimat_lav: est && est.lav, estimat_hoy: est && est.hoy, peasy_bud: peasyBud,
      over_lav: est && peasyBud != null ? peasyBud >= est.lav : null,
      i_spenn: est && peasyBud != null ? (peasyBud >= est.lav && peasyBud <= est.hoy) : null,
      finn_gruppe: kv.gruppe, finn_grunn: kv.grunn, n_comps: kv.n_comps,
      gb: gb ? gb.pred : null, gb_avvik: gb ? Math.round((gb.pred / finn - 1) * 1000) / 1000 : null,
      solgt: isoDato(r[K.solgt]) || null, retur: !!String(r[K.retur] || '').trim() || status.indexOf('return') >= 0,
      dato: isoDato(r[K.solgt]) || isoDato(r[K.registrert]) || null,
    });
  }
  biler.sort((a, b) => String(b.dato).localeCompare(String(a.dato)));
  const oppsum = (liste) => ({
    n: liste.length,
    median_avvik: median(liste.map((b) => b.avvik)),
    p25: kvantil(liste.map((b) => b.avvik), 0.25), p75: kvantil(liste.map((b) => b.avvik), 0.75),
    over_lav: liste.filter((b) => b.over_lav === true).length, n_estimat: liste.filter((b) => b.over_lav != null).length,
  });
  const grupper = {};
  for (const g of ['sterk', 'middels', 'svak', 'ukjent']) grupper[g] = oppsum(biler.filter((b) => b.finn_gruppe === g));
  const celler = {};
  for (const b of biler) (celler[b.celle] = celler[b.celle] || []).push(b);
  const celleOppsum = Object.keys(celler).map((c) => Object.assign({ celle: c }, oppsum(celler[c]))).filter((c) => c.n >= 3).sort((a, b) => b.n - a.n);
  return {
    versjon: VERSJON, bygget: new Date().toISOString(), fra: FRA_DATO,
    totalt: Object.assign(oppsum(biler), { live: biler.filter((b) => b.modus === 'live').length, tilbakeregnet: biler.filter((b) => b.modus === 'tilbakeregnet').length }),
    grupper, celler: celleOppsum, biler,
  };
}

async function pushTilPages(data, token) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
  const h = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  for (let forsok = 1; ; forsok++) {
    const shaRes = await fetch(url, { headers: h });
    const shaData = shaRes.ok ? await shaRes.json() : {};
    const body = { message: `bud-fossefall ${data.bygget.slice(0, 16)}`, content: Buffer.from(JSON.stringify(data)).toString('base64') };
    if (shaData && shaData.sha) body.sha = shaData.sha;
    const put = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(body) });
    const pd = await put.json();
    if (pd && pd.content) return;
    if (forsok >= 4) throw new Error('push feilet: ' + ((pd && pd.message) || put.status));
    await new Promise((r) => setTimeout(r, 1500 * forsok));
  }
}

module.exports = { VERSJON, byggBudFossefall, finnKvalitet };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), override: true, quiet: true });
  (async () => {
    const d = await byggBudFossefall();
    const pst = (x) => x == null ? '–' : (x > 0 ? '+' : '') + Math.round(x * 100) + ' %';
    console.log(`${d.totalt.n} biler med AR-bud (live ${d.totalt.live}, tilbakeregnet ${d.totalt.tilbakeregnet}) · median avvik ${pst(d.totalt.median_avvik)} · over lav ${d.totalt.over_lav}/${d.totalt.n_estimat}`);
    for (const [g, o] of Object.entries(d.grupper)) if (o.n) console.log(`  Finn ${g.padEnd(8)} n ${String(o.n).padStart(3)}  median ${pst(o.median_avvik).padStart(6)}  spredning ${pst(o.p25)} – ${pst(o.p75)}`);
    d.celler.slice(0, 6).forEach((c) => console.log(`  celle ${c.celle.padEnd(16)} n ${String(c.n).padStart(3)}  median ${pst(c.median_avvik)}`));
    if (process.argv.includes('--push')) {
      if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN mangler i .env');
      await pushTilPages(d, process.env.GITHUB_TOKEN);
      console.log('bud-fossefall.json skrevet');
    }
  })().catch((e) => { console.error('Feil:', e.message); process.exit(1); });
}
