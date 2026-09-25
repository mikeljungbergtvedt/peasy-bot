'use strict';
// ab-kontroll: lav i ERP mot fossefallets lav for bilens scenario (A partall, B oddetall, Ordna kilde).
const assert = require('assert');
const k = require('./ab-kontroll');

function rad(inr, reg, est, kilde) { const r = new Array(32).fill(null); r[0] = inr; r[1] = reg; r[3] = est; r[11] = kilde || 'peasy'; return r; }
function m(reg, ts, a, b, o, extra) {
  return Object.assign({ regnr: reg, timestamp: ts, fossefall: Object.assign({ tables_live: true, engine: 'fossefallSatser', a: { lav: a }, b: { lav: b }, ordna: { lav: o } }, extra || {}) });
}
const fra = Date.parse('2026-09-25T00:00:00Z');
const maalinger = [
  m('AA10000', '2026-09-25T08:00:00Z', 100000, 90000, 75000),                           // A-bil, riktig
  m('BB10001', '2026-09-25T08:00:00Z', 100000, 90000, 75000),                           // B-bil, riktig
  m('CC10003', '2026-09-25T08:00:00Z', 100000, 90000, 75000),                           // B-bil, ERP har A-tallet → avvik
  m('OO10005', '2026-09-25T08:00:00Z', 200000, 180000, 150000),                         // Ordna, riktig
  m('QA10006', '2026-09-25T08:00:00Z', 80000, 72000, 60000),                            // QA satte ny Finn-pris senere:
  m('QA10006', '2026-09-25T09:00:00Z', 90000, 81000, 67500),                            //   siste måling er fasit
  m('LG10008', '2026-09-25T08:00:00Z', 50000, 45000, 37500, { tables_live: false, engine: 'hardcoded' }), // gammel motor → hoppes over
  m('PM10010', '2026-09-25T08:00:00Z', 50000, 45000, 37500, { pris_manuelt: true }),     // PRIS MANUELT → hoppes over
  m('OL10012', '2026-09-20T08:00:00Z', 50000, 45000, 37500),                            // eldre enn vinduet
  m('NY10014', '2026-09-25T08:00:00Z', 50000, 45000, 37500),                            // ikke skrevet i ERP ennå
];
const rows = [
  rad(10000, 'AA10000', '100000-110000'),
  rad(10001, 'bb10001 ', '90050-99000'),        // 50 kr unna: innenfor toleransen
  rad(10003, 'CC10003', '100000-110000'),
  rad(10005, 'OO10005', '150000-160000', 'ordna'),
  rad(10006, 'QA10006', '90000-99000'),
  rad(10008, 'LG10008', '1-2'),
  rad(10010, 'PM10010', '1-2'),
  rad(10012, 'OL10012', '1-2'),
  rad(10014, 'NY10014', null),
  rad(10016, 'UM10016', '1-2'),                 // ingen måling
];
const res = k.kontrollerAB({ rows, maalinger, fra });
assert.strictEqual(res.sjekket, 5);
assert.deepStrictEqual(res.per_scenario, { A: 2, B: 2, ORDNA: 1 });
assert.strictEqual(res.avvik.length, 1);
assert.deepStrictEqual(
  { regnr: res.avvik[0].regnr, scenario: res.avvik[0].scenario, erp: res.avvik[0].erp, fossefall: res.avvik[0].fossefall, diff: res.avvik[0].diff },
  { regnr: 'CC10003', scenario: 'B', erp: 100000, fossefall: 90000, diff: 10000 });
assert.deepStrictEqual(res.ikke_skrevet, ['NY10014']);
const t = k.tekst(res, 24);
assert.ok(/A 2, B 2, Ordna 1/.test(t));
assert.ok(/CC10003 \(10003\) B: ERP 100.000, fossefallet 90.000 \(\+10.000\)/.test(t), t);
assert.ok(/0 med annen lav/.test(k.tekst(k.kontrollerAB({ rows: [], maalinger, fra }), 24)));

// Nattjobben: Telegram bare ved avvik, og den kaster aldri
(async () => {
  const os = require('os'), fs = require('fs'), path = require('path');
  const fil = path.join(os.tmpdir(), 'ab-kontroll-test.jsonl');
  const naa = new Date().toISOString();
  fs.writeFileSync(fil, [m('CC10003', naa, 100000, 90000, 75000)].map((x) => JSON.stringify(x)).join('\n'));
  const sendt = [];
  const r1 = await k.kjorABKontroll({ rows: [rad(10003, 'CC10003', '100000-110000')], fil, log: () => {}, sendTelegram: async (s) => sendt.push(s) });
  assert.strictEqual(r1.avvik.length, 1);
  assert.strictEqual(sendt.length, 1);
  const r2 = await k.kjorABKontroll({ rows: [rad(10003, 'CC10003', '90000-99000')], fil, log: () => {}, sendTelegram: async (s) => sendt.push(s) });
  assert.strictEqual(r2.avvik.length, 0);
  assert.strictEqual(sendt.length, 1, 'ingen Telegram uten avvik');
  const r3 = await k.kjorABKontroll({ rows: 'tull', fil: '/finnes/ikke', log: () => {}, logErr: () => {} });
  assert.ok(r3 && r3.sjekket === 0);
  fs.unlinkSync(fil);
  console.log('ab-kontroll.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
