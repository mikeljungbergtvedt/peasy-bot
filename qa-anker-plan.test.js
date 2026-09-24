'use strict';
// v20.154: QA «Sett Finn-pris» → fossefall → ERP-tall = målingens tall, og Pulse sin SEND-sperre slipper.
// Laster satser fra PEASY_CONFIG_URL (standard: Pages). Skriver måling til tmp, ikke til ekte measurements.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.FOSSEFALL_TABLES_LIVE = '1';
process.env.PEASY_EASY_MEAS_FILE = path.join(os.tmpdir(), 'qa-anker-plan-test.jsonl');
try { fs.unlinkSync(process.env.PEASY_EASY_MEAS_FILE); } catch (_) {}
const { planQaAnker } = require('./qa-anker-plan');
const { appendEasyMeasurement } = require('./easy-measurements');
const armKey = (a) => (a === 'O' ? 'ordna' : (a === 'B' ? 'b' : 'a'));
const sendOk = (ff, arm) => { const a = ff && ff[armKey(arm)]; return !!(a && Number(a.lav) > 0); }; // = Pulse qaWritingLavOk

(async () => {
  const base = { anker: 170000, km: 90000, year: 2017, egenvekt: 1400 };
  const A = await planQaAnker(Object.assign({}, base, { erpId: 5000, source: null }));
  const B = await planQaAnker(Object.assign({}, base, { erpId: 5001, source: null }));
  const O = await planQaAnker(Object.assign({}, base, { erpId: 5000, source: 'ordna' }));
  const D = await planQaAnker(Object.assign({}, base, { erpId: 5000, source: 'autodb' }));
  assert.strictEqual(D.arm, 'O', 'AutoDB skal følge fossefall og Pulse (Ordna)');
  assert.strictEqual(D.dLav, O.dLav);
  for (const [p, arm, erpId, src] of [[A, 'A', 5000, null], [B, 'B', 5001, null], [O, 'O', 5000, 'ordna']]) {
    assert.strictEqual(p.ok, true, arm + ': ' + p.grunn);
    assert.strictEqual(p.arm, arm);
    appendEasyMeasurement({ regnr: 'TEST' + erpId, erpId, km: base.km,
      easyEval: { anker: base.anker, finn_utpris: base.anker, dLav: p.dLav, dHoy: p.dHoy, model_year: base.year, egenvekt: base.egenvekt, source: src } });
    const rows = fs.readFileSync(process.env.PEASY_EASY_MEAS_FILE, 'utf8').trim().split('\n').map(JSON.parse);
    const ff = rows[rows.length - 1].fossefall;
    assert.strictEqual(ff[armKey(arm)].lav, p.dLav, arm + ': måling lav ≠ ERP lav');
    assert.strictEqual(ff[armKey(arm)].hoy, p.dHoy, arm + ': måling høy ≠ ERP høy');
    assert.ok(sendOk(ff, arm), arm + ': Pulse ville holdt SEND av');
  }
  assert.ok(B.dLav < A.dLav && O.dLav < B.dLav, 'B og Ordna skal ligge under A');
  // Absurd midt/Finn gir PRIS MANUELT med grunn, ingen reservekalkyle.
  const absurd = await planQaAnker({ anker: 22000, km: 180000, year: 0, egenvekt: null, erpId: 4972, source: null });
  if (!absurd.ok) assert.ok(/PRIS MANUELT|absurd/i.test(absurd.grunn), absurd.grunn);
  fs.unlinkSync(process.env.PEASY_EASY_MEAS_FILE);
  console.log('qa-anker-plan.test.js ok');
  console.log('  A ' + A.dLav + '–' + A.dHoy + '  B ' + B.dLav + '–' + B.dHoy + '  O ' + O.dLav + '–' + O.dHoy);
})().catch((e) => { console.error(e); process.exit(1); });
