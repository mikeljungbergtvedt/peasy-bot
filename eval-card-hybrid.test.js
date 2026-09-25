'use strict';
// eval-kortets KALKYLE (fossefallet som skrives til ERP): alle lag med, B/Ordna-skala vist.
process.env.FOSSEFALL_TABLES_LIVE = '1';
const assert = require('assert');
const path = require('path');
const Module = require('module');
// biltype-gate.js ligger bare på Mini: stubb den hvis den mangler (kun i test).
const _resolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (req === './biltype-gate') { try { return _resolve.call(this, req, parent, ...rest); } catch (e) { return path.join(__dirname, 'eval-card-hybrid.test.js'); } }
  return _resolve.call(this, req, parent, ...rest);
};
module.exports.scopeHeadline = () => '';
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
  const t = h.formatEvalCardHybrid({ bil: { id, source: src }, vegData: {}, valuation: {}, fossefall: card, writeArm: fc.abArm(id, src) }, true);
  return t.slice(t.indexOf('KALKYLE'), t.indexOf('Confidence'));
}
const b = kort(4987, 63000, 135000, 2012, 'peasy');
assert.ok(/Arm:\s+B/.test(b));
assert.ok(/Avsetning takst:\s+−12.000/.test(b), b);
assert.ok(/AR-salær:\s+−2.200/.test(b), b);
assert.ok(/Klargjøring:\s+−1.000/.test(b), 'klargjøring 1 000, ikke 5 000');
assert.ok(/B = A × 0,9:\s+29.000 → 26.000/.test(b), b);
assert.ok(/Lav – høy:\s+19.000 – 30.000/.test(b), b);
const o = kort(4966, 63000, 135000, 2012, 'ordna');
assert.ok(/Ordna = A × 0,75:\s*29.000 → 22.000/.test(o), o);
const a = kort(4986, 10000, 239000, 2008, 'peasy');
assert.ok(/Arm:\s+A/.test(a) && !/A = A ×/.test(a), 'A har ingen skala-linje');
assert.ok(/Vrakpant-gulv/.test(a) && /Lav – høy:\s+3.000 – 5.000/.test(a), a);
console.log('eval-card-hybrid.test.js OK');
