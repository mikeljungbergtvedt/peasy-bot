'use strict';
// takst-celler.js — lærer takst-tabellen av faktiske auksjonsbud.
//
// Per bil med faktisk AR-bud (ERP kol. T):
//   implisitt påkost = Finn-utpris − faktisk AR-bud − margin (tabell) + ståtid
//                      − omregistrering − klargjøring − AR-salær (på faktisk AR-bud)
// Per celle (prisbånd × km-bånd): antall bud (heatmap), median påkost, forslag ved 20 bud.
// Råtne biler (Peasy-bud mer enn 40 % under estimat lav) holdes utenfor medianen.
//
// Leser bare: ERP-eksporten (GET) og målingene på Mini. Skriver bare peasy-cells.json på Pages.
// Rører ikke satsene i peasy-config.json. Et menneske godkjenner forslag i Pulse.

const fs = require('fs');
const path = require('path');
const fossefall = require('./fossefall');

const VERSJON = 'takst-celler v1';
const FORSLAG_VED_N = 20;
const RAATTEN_GRENSE = -0.40;
const GH_REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const GH_FILE = 'peasy-cells.json';
const ERP_XLSX_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';

const MAALINGER = [
  { fil: '/Users/bot/peasy-auto/v2/logs.nosync/measurements.jsonl', navn: 'easy' },
  { fil: '/Users/bot/peasy-auto/v3g/logs.nosync/v3g-measurements.jsonl', navn: 'v3g' },
  { fil: '/Users/bot/peasy-auto/bot4/logs.nosync/bot4-measurements.jsonl', navn: 'bot4' },
  { fil: '/Users/bot/peasy-auto/loop2/logs.nosync/loop2-measurements.jsonl', navn: 'loop2' },
];

// ERP-kolonner (0-basert), samme eksport som Pulse.
const K = { internnr: 0, regnr: 1, estimat: 3, peasyBud: 4, aar: 8, kilde: 11, status: 12, solgt: 18, bud: 19, retur: 21, km: 22 };

function plate(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase().split(/\s+/)[0] || '';
  return s.replace(/-/g, '');
}
function tall(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v == null ? '' : v).replace(/[\s ]/g, '').replace(',', '.');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function positiv(v) { const n = tall(v); return n != null && n > 0 ? n : null; }
function lavFraEstimat(v) {
  const m = String(v == null ? '' : v).replace(/[\s ]/g, '').match(/^(\d+(?:\.\d+)?)[-–]/);
  return m ? Number(m[1]) : null;
}
function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function kvantil(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const r100 = (n) => (n == null ? null : Math.round(n / 100) * 100);

/** AR-salær på faktisk AR-bud: pct av budet, minst min. */
function salaerPaaBud(bud, pct, min) {
  const p = Number(pct) || 0;
  const m = Number(min) || 0;
  if (p <= 0 && m <= 0) return 0;
  return Math.round(Math.max(bud * p / 100, m));
}

/** Omregistrering slik fossefallet regner den (år og egenvekt), uten å kopiere satsene. */
function omregFor(finn, km, aar, egenvekt, satser, looked) {
  const arm = fossefall.computeSharedFossefall({
    finnUtpris: finn, km, modelYear: aar, satser, looked,
    bilInfo: egenvekt ? { year: aar, egenvekt } : { year: aar },
  });
  const kr = arm && arm._meta && Number(arm._meta.omregKr);
  return Number.isFinite(kr) ? kr : 4532;
}

/**
 * Finn-utpris per regnr fra målingene. Nivå: 1 Easy (fossefall/easy.finn_utpris),
 * 2 V3G, 3 bot4, 4 loop2 (snitt av Claude og Grok). Ordna-biler: V3G først, den skriver dem.
 * Innen samme nivå vinner nyeste måling (QA «Sett Finn-pris» gir ny måling).
 * Gammelt Easy-anker brukes ikke.
 */
function lesMaaling(rec, kilde) {
  if (!rec || typeof rec !== 'object') return null;
  const reg = plate(rec.regnr);
  if (!reg) return null;
  const ts = String(rec.timestamp || '');
  const ff = rec.fossefall && typeof rec.fossefall === 'object' ? rec.fossefall : null;
  const arm = ff && ff.a && typeof ff.a === 'object' ? ff.a : null;
  let finn = null, nivaa = null, ev = kilde;
  if (kilde === 'easy') {
    const easy = rec.easy && typeof rec.easy === 'object' ? rec.easy : {};
    finn = positiv(arm && arm.finn_utpris) || positiv(easy.finn_utpris);
    nivaa = 1;
  } else if (kilde === 'v3g') {
    finn = positiv(rec.finn_utpris) || positiv(arm && arm.finn_utpris);
    nivaa = 2;
  } else if (kilde === 'bot4') {
    if (rec.ok === false) return null;
    finn = positiv(rec.finn_utpris);
    nivaa = 3;
  } else if (kilde === 'loop2') {
    if (rec.ok === false) return null;
    finn = positiv(rec.finn_utpris);
    nivaa = 4;
    ev = 'loop2:' + String(rec.evaluator || '');
  }
  if (!finn) return null;
  const cv = rec.origin_cv && typeof rec.origin_cv === 'object' ? rec.origin_cv : {};
  return {
    reg, ts, finn, nivaa, kilde: ev,
    statid: arm ? tall(arm.statid) || 0 : 0,
    omreg: arm && tall(arm.omregistrering) != null ? Math.abs(tall(arm.omregistrering)) : null,
    egenvekt: positiv(cv.egenvekt || cv.weight || (rec.carinfo && rec.carinfo.egenvekt)),
    km: positiv(rec.km),
  };
}

function indekserMaalinger(kilder) {
  // kilder: [{ navn, linjer: [obj...] }]
  const per = new Map();
  for (const k of kilder) {
    const loop2 = new Map(); // reg → { claude, grok, ts }
    for (const rec of k.linjer || []) {
      const m = lesMaaling(rec, k.navn);
      if (!m) continue;
      if (k.navn === 'loop2') {
        const ev = String(rec.evaluator || '');
        if (ev !== 'claude' && ev !== 'grok') continue;
        const cur = loop2.get(m.reg) || { m };
        cur[ev] = m.finn;
        if (m.ts >= (cur.m.ts || '')) cur.m = m;
        loop2.set(m.reg, cur);
        continue;
      }
      leggTil(per, m);
    }
    for (const [, v] of loop2) {
      const vals = [v.claude, v.grok].filter((x) => x);
      if (!vals.length) continue;
      leggTil(per, Object.assign({}, v.m, { finn: Math.round(vals.reduce((s, x) => s + x, 0) / vals.length), kilde: 'loop2' }));
    }
  }
  return per;
}
function leggTil(per, m) {
  const liste = per.get(m.reg) || [];
  liste.push(m);
  per.set(m.reg, liste);
}
function velgFinn(liste, erOrdna) {
  if (!liste || !liste.length) return null;
  const rang = (m) => (erOrdna && m.nivaa === 2 ? 0 : m.nivaa);
  return liste.slice().sort((a, b) => rang(a) - rang(b) || (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0))[0];
}

function lesJsonl(fil) {
  let tekst;
  try { tekst = fs.readFileSync(fil, 'utf8'); } catch (e) { return null; }
  const ut = [];
  for (const linje of tekst.split('\n')) {
    if (!linje.trim()) continue;
    try { ut.push(JSON.parse(linje)); } catch (e) { /* hopp over ødelagt linje */ }
  }
  return ut;
}

/**
 * Bygg peasy-cells.json-innholdet.
 * rows: ERP-rader (arrays, uten header). kilder: [{ navn, linjer }]. satser: fossefallSatser.
 */
function byggTakstCeller({ rows, kilder, satser, naa } = {}) {
  if (!satser || !satser.axes) throw new Error('fossefallSatser mangler');
  const idx = indekserMaalinger(kilder || []);
  const celler = {};
  const biler = [];
  const telle = { med_bud: 0, uten_finn: 0, utenfor_tabell: 0, med: 0, raatne: 0, kilde: {} };

  for (const r of rows || []) {
    if (!Array.isArray(r)) continue;
    const bud = positiv(r[K.bud]);
    if (!bud) continue;
    const reg = plate(r[K.regnr]);
    if (!reg) continue;
    telle.med_bud++;
    const kildeErp = String(r[K.kilde] || '').toLowerCase();
    const m = velgFinn(idx.get(reg), kildeErp.indexOf('ordna') === 0);
    if (!m) { telle.uten_finn++; continue; }
    const km = positiv(r[K.km]) || m.km;
    const looked = fossefall.lookupFossefallCell(satser, m.finn, km);
    if (!looked || !looked.ok) { telle.utenfor_tabell++; continue; }

    const aar = positiv(r[K.aar]) || 2020;
    const omreg = m.omreg != null ? m.omreg : omregFor(m.finn, km, aar, m.egenvekt, satser, looked);
    const salaer = salaerPaaBud(bud, looked.salaerPct, looked.salaerMin);
    const paakost = Math.round(m.finn - bud - looked.margin + m.statid - omreg - fossefall.KLARGJORING_KR - salaer);

    const lav = lavFraEstimat(r[K.estimat]);
    const peasyBud = tall(r[K.peasyBud]);
    const motLav = lav && peasyBud != null ? (peasyBud - lav) / lav : null;
    const raatten = motLav != null && motLav < RAATTEN_GRENSE;
    const status = String(r[K.status] || '').toLowerCase();
    const retur = !!String(r[K.retur] || '').trim() || status.indexOf('return') >= 0;

    const c = celler[looked.cell] || (celler[looked.cell] = { verdier: [], n_bud: 0, n_retur: 0, utelatt_raatne: 0, tabell: looked.takst });
    c.n_bud++;
    if (retur) c.n_retur++;
    if (raatten) { c.utelatt_raatne++; telle.raatne++; }
    else { c.verdier.push(paakost); telle.med++; }
    telle.kilde[m.kilde] = (telle.kilde[m.kilde] || 0) + 1;

    biler.push({
      internnr: r[K.internnr] != null ? String(r[K.internnr]) : null,
      celle: looked.cell,
      finn: m.finn,
      bud,
      margin: looked.margin,
      omreg,
      salaer,
      statid: m.statid,
      paakost,
      mot_lav: motLav != null ? Math.round(motLav * 1000) / 1000 : null,
      raatten,
      retur,
      kilde: m.kilde,
    });
  }

  const ut = {};
  Object.keys(celler).sort().forEach((id) => {
    const c = celler[id];
    const med = median(c.verdier);
    const n = c.verdier.length;
    ut[id] = {
      n_bud: c.n_bud,
      n: n,
      n_retur: c.n_retur,
      utelatt_raatne: c.utelatt_raatne,
      median_paakost: r100(med),
      p25: r100(kvantil(c.verdier, 0.25)),
      p75: r100(kvantil(c.verdier, 0.75)),
      tabell: c.tabell,
      avvik: med == null || c.tabell == null ? null : r100(med - c.tabell),
      forslag: n >= FORSLAG_VED_N ? Math.max(0, r100(med)) : null,
    };
  });

  return {
    versjon: VERSJON,
    bygget: (naa || new Date()).toISOString(),
    satser_versjon: satser.version || null,
    formel: 'implisitt påkost = Finn-utpris − faktisk AR-bud − margin + ståtid − omreg − klargjøring − AR-salær (på faktisk AR-bud)',
    regler: { forslag_ved_n: FORSLAG_VED_N, raatten: 'Peasy-bud mer enn 40 % under estimat lav holdes utenfor medianen' },
    totalt: telle,
    celler: ut,
    biler,
  };
}

async function hentErpRader() {
  const XLSX = require('xlsx');
  const res = await fetch(ERP_XLSX_URL);
  if (!res.ok) throw new Error('ERP-eksport HTTP ' + res.status);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  return rows.slice(1).filter((r) => r && r[1]);
}

function lesKilder(maalinger) {
  return (maalinger || MAALINGER).map((k) => ({ navn: k.navn, linjer: lesJsonl(k.fil) || [] }));
}

async function pushTilPages(data, token) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
  const h = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  const shaRes = await fetch(url, { headers: h });
  const shaData = shaRes.ok ? await shaRes.json() : {};
  const body = {
    message: `takst-celler ${data.bygget.slice(0, 10)}`,
    content: Buffer.from(JSON.stringify(data, null, 1)).toString('base64'),
  };
  if (shaData && shaData.sha) body.sha = shaData.sha;
  const put = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(body) });
  const pd = await put.json();
  if (!pd || !pd.content) throw new Error('push feilet: ' + ((pd && pd.message) || put.status));
  return true;
}

/** Nattjobb: kalles fra refreshBracketsNightly. Kaster aldri. */
async function oppdaterTakstCeller({ rows, log, logErr } = {}) {
  const L = log || console.log;
  const E = logErr || ((w, e) => console.error(w, e));
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) { L('Takst-celler: GITHUB_TOKEN mangler i .env — hopper over'); return null; }
    const satser = await fossefall.loadFossefallSatser({ force: true });
    if (!satser) { L('Takst-celler: fossefallSatser ikke lastet — hopper over'); return null; }
    const data = byggTakstCeller({ rows: rows || await hentErpRader(), kilder: lesKilder(), satser });
    await pushTilPages(data, token);
    const t = data.totalt;
    L(`Takst-celler: ${Object.keys(data.celler).length} celler, ${t.med} biler med (${t.raatne} råtne utenfor, ${t.uten_finn} uten Finn-utpris) → peasy-cells.json`);
    return data;
  } catch (e) {
    E('oppdaterTakstCeller', e);
    return null;
  }
}

module.exports = { VERSJON, byggTakstCeller, oppdaterTakstCeller, indekserMaalinger, salaerPaaBud, lesKilder, hentErpRader, MAALINGER };

// Kjør for hånd på Mini:  node takst-celler.js        (viser bare)
//                         node takst-celler.js --push (skriver peasy-cells.json)
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  (async () => {
    const satser = await fossefall.loadFossefallSatser({ force: true });
    if (!satser) throw new Error('fossefallSatser ikke lastet');
    const kilder = lesKilder();
    kilder.forEach((k) => console.log(`målinger ${k.navn}: ${k.linjer.length}`));
    const data = byggTakstCeller({ rows: await hentErpRader(), kilder, satser });
    const t = data.totalt;
    console.log(`biler med bud: ${t.med_bud} | med: ${t.med} | råtne utenfor: ${t.raatne} | uten Finn-utpris: ${t.uten_finn} | utenfor tabell: ${t.utenfor_tabell}`);
    console.log('Finn-utpris fra:', JSON.stringify(t.kilde));
    for (const [id, c] of Object.entries(data.celler)) {
      console.log(`${id.padEnd(16)} n ${String(c.n).padStart(3)}  median ${String(c.median_paakost).padStart(7)}  tabell ${String(c.tabell).padStart(6)}  avvik ${String(c.avvik).padStart(7)}${c.forslag != null ? '  FORSLAG ' + c.forslag : ''}`);
    }
    if (process.argv.includes('--push')) {
      if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN mangler i .env');
      await pushTilPages(data, process.env.GITHUB_TOKEN);
      console.log('peasy-cells.json skrevet');
    }
  })().catch((e) => { console.error('Feil:', e.message); process.exit(1); });
}
