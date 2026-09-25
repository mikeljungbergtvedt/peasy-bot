'use strict';
// eval-kortet viser fossefallet som skrives til ERP, ikke easy-cost-v7.
process.env.FOSSEFALL_TABLES_LIVE = '1';
const assert = require('assert');
const fs = require('fs');
const ff = require('./fossefall');
const fc = require('./fossefall-card');
const h = require('./eval-card-hybrid');
const satser = {
  version: 'test',
  axes: { price: [{ id: '10-30', min: 10000, max: 30000 }, { id: '60-100', min: 60000, max: 100000 }], km: [{ id: '120-200', min: 120000, max: 200000 }, { id: '200-300', min: 200000, max: 300000 }] },
  margin: { '60-100|120-200': 8000, '10-30|200-300': 4000 }, takst: { '60-100|120-200': 12000, '10-30|200-300': 5000 },
  spenn: { '60-100|120-200': '7000|4000', '10-30|200-300': '5000|3000' },
  min: { '60-100': 8000, '10-30': 4000 }, max: { '60-100': 24000, '10-30': 14000 }, arSalaerPct: 2.7, arSalaerMin: 2200,
};
function kort(id, finn, km, year, src) {
  const card = fc.cardFromBuilt(ff.buildFossefall({ finnUtpris: finn, km, modelYear: year, bilInfo: { year }, satser, soldDays: [] }));
  const arm = fc.abArm(id, src);
  const k = arm === 'O' ? 'ordna' : arm.toLowerCase();
  return { card, arm, txt: h.formatEvalCardHybrid({ bil: { id }, vegData: {}, valuation: { dLav: card[k].lav }, fossefall: card, writeArm: arm }, true) };
}
// RK51977: B = A × 0,9 → 19 000 – 30 000
const b = kort(4987, 63000, 135000, 2012, 'peasy');
assert.ok(/FOSSEFALL \(scenario B\)/.test(b.txt));
assert.ok(/Klargjøring:\s+1.000 kr/.test(b.txt), 'klargjøring 1 000, ikke 5 000');
assert.ok(/AR-salær:\s+2.200 kr/.test(b.txt));
assert.ok(/Lav – høy B: 19.000 – 30.000 kr/.test(b.txt), b.txt);
assert.ok(!/KALKYLE|Bracket|D mid/.test(b.txt), 'ingen easy-cost-v7');
// Ordna
const o = kort(4966, 63000, 135000, 2012, 'ordna');
assert.ok(/scenario Ordna/.test(o.txt) && /Ordna = A × 0,75/.test(o.txt));
// Vrakpant
const v = kort(4986, 10000, 239000, 2008, 'peasy');
assert.ok(/\(vrakpant-gulv\)/.test(v.txt), v.txt);
assert.ok(/Lav – høy A: 3.000 – 5.000 kr/.test(v.txt));
// PRIS MANUELT
assert.deepStrictEqual(h.fossefallLines({ a: {}, tables_live: true, pris_manuelt: true, grunn: 'tom celle' }, 'A'), ['PRIS MANUELT — tom celle']);
// Uten fossefall: gammel KALKYLE som før
assert.ok(/KALKYLE/.test(h.formatEvalCardHybrid({ bil: {}, vegData: {}, valuation: {}, fossefall: null }, true)));
// Telegram (HTML) har også fossefallet
assert.ok(/<b>FOSSEFALL \(scenario B\)<\/b>/.test(h.formatEvalCardHybrid({ bil: { id: 4987 }, vegData: {}, valuation: {}, fossefall: b.card, writeArm: 'B' }, false)));
console.log('eval-card-hybrid.test.js OK');
