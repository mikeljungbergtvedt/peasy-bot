'use strict';
// ab-kontroll.js — daglig kontroll av at ERP har riktig lav for bilens scenario.
// Scenario: Ordna hvis kilde er ordna, ellers internnr partall = A, oddetall = B (ab-arm.js).
// Fasit: fossefallets lav for scenarioet i siste gyldige måling (tabellene live, ikke PRIS MANUELT).
// Sjekkes mot lav i ERP (kolonne D «lav-høy»). Avvik over 100 kr → Telegram.
// Leser bare ERP-eksporten og lokale målinger. Skriver ingenting til ERP.

const fs = require('fs');
const { liveOwner } = require('./ab-arm.js');

const MAALING_FIL = '/Users/bot/peasy-auto/v2/logs.nosync/measurements.jsonl';
const TOLERANSE = 100;
const K = { internnr: 0, regnr: 1, estimat: 3, kilde: 11 };

function lesJsonl(fil) {
  let t;
  try { t = fs.readFileSync(fil, 'utf8'); } catch (e) { return []; }
  const ut = [];
  for (const l of t.split('\n')) {
    if (!l.trim()) continue;
    try { ut.push(JSON.parse(l)); } catch (e) { /* hopp over */ }
  }
  return ut;
}
const plate = (v) => (String(v == null ? '' : v).trim().toUpperCase().split(/\s+/)[0] || '').replace(/-/g, '');
const tid = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : null; };
const kr = (n) => Math.round(Number(n)).toLocaleString('nb-NO');
function positiv(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function lavFraEstimat(v) {
  const m = String(v == null ? '' : v).replace(/[\s ]/g, '').match(/^(\d+)(?:[-–]\d+)?$/);
  return m ? Number(m[1]) : null;
}
const NOKKEL = { A: 'a', B: 'b', ORDNA: 'ordna' };
const NAVN = { A: 'A', B: 'B', ORDNA: 'Ordna' };

/** Siste gyldige fossefall-måling per regnr. */
function sisteMaaling(linjer) {
  const per = new Map();
  for (const r of linjer) {
    const ff = r && r.fossefall;
    if (!ff || typeof ff !== 'object' || ff.tables_live !== true || ff.pris_manuelt) continue;
    if (ff.engine && ff.engine !== 'fossefallSatser') continue;
    const t = tid(r.timestamp);
    const reg = plate(r.regnr);
    if (!t || !reg) continue;
    const f = per.get(reg);
    if (!f || t >= f.t) per.set(reg, { t, ff });
  }
  return per;
}

/**
 * rows: ERP-rader uten header. maalinger: målingslinjer. fra: ms — bare biler målt fra og med da.
 */
function kontrollerAB({ rows, maalinger, fra, toleranse = TOLERANSE } = {}) {
  const siste = sisteMaaling(maalinger || []);
  const avvik = [];
  const ikkeSkrevet = [];
  const per = { A: 0, B: 0, ORDNA: 0 };
  let sjekket = 0;
  for (const r of rows || []) {
    if (!Array.isArray(r)) continue;
    const reg = plate(r[K.regnr]);
    const m = reg && siste.get(reg);
    if (!m || (fra && m.t < fra)) continue;
    const scen = liveOwner(r[K.internnr], r[K.kilde]);
    const arm = m.ff[NOKKEL[scen]];
    const fasit = positiv(arm && arm.lav);
    if (!fasit) continue;
    const erpLav = lavFraEstimat(r[K.estimat]);
    if (!erpLav) { ikkeSkrevet.push(reg); continue; }
    sjekket++;
    per[scen]++;
    const diff = erpLav - fasit;
    if (Math.abs(diff) > toleranse) {
      avvik.push({ regnr: reg, internnr: r[K.internnr] != null ? String(r[K.internnr]) : null, scenario: NAVN[scen], erp: erpLav, fossefall: fasit, diff, maalt: new Date(m.t).toISOString() });
    }
  }
  return { sjekket, per_scenario: per, avvik, ikke_skrevet: ikkeSkrevet };
}

function tekst(res, timer) {
  const p = res.per_scenario;
  const hode = `Scenario-kontroll siste ${timer} t: ${res.sjekket} biler (A ${p.A}, B ${p.B}, Ordna ${p.ORDNA}), ${res.avvik.length} med annen lav i ERP enn fossefallet`;
  if (!res.avvik.length) return hode + '.';
  const linjer = res.avvik.slice(0, 15).map((x) =>
    `${x.regnr} (${x.internnr || '?'}) ${x.scenario}: ERP ${kr(x.erp)}, fossefallet ${kr(x.fossefall)} (${x.diff > 0 ? '+' : ''}${kr(x.diff)})`);
  return hode + ':\n' + linjer.join('\n') + (res.avvik.length > 15 ? `\n… og ${res.avvik.length - 15} til` : '');
}

/** Nattjobb. Telegram bare ved avvik. Kaster aldri. */
async function kjorABKontroll({ rows, log, logErr, sendTelegram, timer = 24, fil } = {}) {
  const L = log || console.log;
  try {
    const erpRader = rows || await require('./takst-celler.js').hentErpRader();
    const res = kontrollerAB({ rows: erpRader, maalinger: lesJsonl(fil || MAALING_FIL), fra: Date.now() - timer * 3600 * 1000 });
    const t = tekst(res, timer);
    L(t.split('\n')[0] + (res.ikke_skrevet.length ? ` (${res.ikke_skrevet.length} uten lav i ERP)` : ''));
    if (res.avvik.length && sendTelegram) await sendTelegram('⚠️ ' + t);
    return res;
  } catch (e) {
    if (logErr) logErr('ab-kontroll', e);
    return null;
  }
}

module.exports = { kontrollerAB, kjorABKontroll, tekst };

// For hånd på Mini:  node ab-kontroll.js [timer]   (viser bare, sender ikke Telegram)
if (require.main === module) {
  const timer = Number(process.argv[2]) || 24;
  kjorABKontroll({ timer, log: () => {} }).then((res) => {
    if (!res) { console.error('Kontrollen feilet'); process.exit(1); }
    console.log(tekst(res, timer));
    if (res.ikke_skrevet.length) console.log(`Uten lav i ERP: ${res.ikke_skrevet.join(', ')}`);
  });
}
