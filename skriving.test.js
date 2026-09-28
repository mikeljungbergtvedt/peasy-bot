'use strict';
// v20.168: A skriver alle scenarioene fra fossefallet; V3G skriver aldri; ingen gamle tall ved PRIS MANUELT; egenvekt.
process.env.FOSSEFALL_TABLES_LIVE = '1';
process.env.STATID_A_LIVE = '0';
const assert = require('assert');
const ab = require('./ab-arm');
const fc = require('./fossefall-card');
const ff = require('./fossefall');
const ev = require('./egenvekt');

// Hvem skriver
for (const [id, src] of [[5022, 'peasy'], [5023, 'peasy'], [4966, 'ordna'], [5031, 'autodb']]) {
  assert.strictEqual(ab.easyShouldSkipWrite(id, src), null, 'A skriver ' + id);
  assert.strictEqual(ab.v3gShouldWrite(id, src), false, 'V3G skriver aldri ' + id);
}
assert.strictEqual(ab.liveOwner(5023, 'peasy'), 'B', 'scenario-navnet er uendret');
assert.strictEqual(ab.liveOwner(4966, 'ordna'), 'ORDNA');

const satser = {
  version: 'test',
  axes: { price: [{ id: '250-400', min: 250000, max: 400000 }], km: [{ id: '200-300', min: 200000, max: 300000 }] },
  margin: { '250-400|200-300': 32500 }, takst: { '250-400|200-300': 30000 }, spenn: { '250-400|200-300': '28000|19000' },
  min: { '250-400': 18000 }, max: { '250-400': 54000 }, arSalaerPct: 2.7, arSalaerMin: 2200,
};
// BT51081: Finn 370 000, 274 000 km, 2016
const card = fc.cardFromBuilt(ff.buildFossefall({ finnUtpris: 370000, km: 274000, modelYear: 2016, bilInfo: { year: 2016, egenvekt: 2300 }, satser, soldDays: [] }));
const pA = fc.planErpWrite({ erpId: 5022, source: 'peasy', card });
const pB = fc.planErpWrite({ erpId: 5023, source: 'peasy', card });
const pO = fc.planErpWrite({ erpId: 4966, source: 'ordna', card });
assert.deepStrictEqual([pA.arm, pA.writeErp, pA.dLav, pA.dHoy], ['A', true, card.a.lav, card.a.hoy]);
assert.deepStrictEqual([pB.arm, pB.writeErp, pB.dLav, pB.dHoy], ['B', true, 226000, 273000], 'B = fossefallets B (A × 0,9)');
assert.deepStrictEqual([pO.arm, pO.writeErp, pO.dLav], ['O', true, card.ordna.lav]);

// PRIS MANUELT: ingen skriving, heller ikke gamle tall
const pm = fc.cardFromBuilt(ff.buildFossefall({ finnUtpris: 2399000, km: 3000, modelYear: 2026, bilInfo: { year: 2026 }, satser, soldDays: [] }));
for (const [id, src] of [[5035, 'peasy'], [5034, 'peasy'], [4966, 'ordna']]) {
  const p = fc.planErpWrite({ erpId: id, source: src, card: pm, legacyLav: 1946000, legacyHoy: 2151000 });
  assert.strictEqual(p.writeErp, false, 'PRIS MANUELT ' + id);
  assert.strictEqual(p.dLav, null);
}
// Uten live fossefall: gamle A-tall bare for A, aldri for B/Ordna
assert.strictEqual(fc.planErpWrite({ erpId: 5022, source: 'peasy', card: null, legacyLav: 100000, legacyHoy: 120000 }).writeErp, true);
assert.strictEqual(fc.planErpWrite({ erpId: 5023, source: 'peasy', card: null, legacyLav: 100000, legacyHoy: 120000 }).writeErp, false);
assert.strictEqual(fc.planErpWrite({ erpId: 4966, source: 'ordna', card: null, legacyLav: 100000, legacyHoy: 120000 }).writeErp, false);

// Egenvekt
assert.strictEqual(ev.tallKg('1 540 kg'), 1540);
assert.strictEqual(ev.tallKg(''), null);
const cv = { carinfo: { attributes: [{ name: 'Vektet, kombinert', values: [2, 2] }, { name: 'Egenvekt', values: [1757, 1814], unit: 'kg' }] } };
assert.strictEqual(ev.egenvektFraCv(cv), 1757);
assert.strictEqual(ev.egenvekt(null, cv), 1757);
assert.strictEqual(ev.egenvekt('1 540 kg', cv), 1540, 'elbil.no først');
assert.strictEqual(ev.egenvekt(null, null), null);
// Lett bil 2018: omreg 3 236 med ekte vekt, 4 532 med 1 500 kg-reserven
const lett = ff.buildFossefall({ finnUtpris: 300000, km: 250000, modelYear: 2018, bilInfo: { year: 2018, egenvekt: ev.egenvekt(null, { carinfo: { attributes: [{ name: 'Egenvekt', values: [1050] }] } }) }, satser, soldDays: [] });
const reserve = ff.buildFossefall({ finnUtpris: 300000, km: 250000, modelYear: 2018, bilInfo: { year: 2018 }, satser, soldDays: [] });
assert.strictEqual(lett.a.omregistrering, -3236);
assert.strictEqual(reserve.a.omregistrering, -4532);

console.log('skriving.test.js OK');
