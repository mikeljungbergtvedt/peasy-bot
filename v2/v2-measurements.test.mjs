import assert from 'assert';
import { measurementFromRun } from './v2-measurements.js';

const card = {
  a: {
    avsetning_takst: -13000,
    forhandlermargin: -38000,
    statid: -2400,
    omregistrering: -4532,
    klargjoring: -1000,
    peasy_avgift: { lav: -9900, hoy: -9900 },
    peasy_bud_mid: 114000,
    spenn: '20000|13000',
  },
  b: {
    avsetning_takst: -13000,
    forhandlermargin: -38000,
    statid: -2400,
    omregistrering: -4532,
    klargjoring: -1000,
    peasy_avgift: { lav: -9900, hoy: -9900 },
    peasy_bud_mid: 103000,
    usikkerhet_takst: { lav: -20000, hoy: 13000 },
  },
  ordna: {
    avsetning_takst: -13000,
    forhandlermargin: -38000,
    statid: -2400,
    omregistrering: -4532,
    klargjoring: -1000,
    peasy_avgift: { lav: -9900, hoy: -9900 },
    peasy_bud_mid: 86000,
    spenn: { lav: -20000, hoy: 13000 },
  },
};

const record = measurementFromRun(
  { regnr: 'AB12345', started_at: '2026-09-23T12:00:00.000Z', km: 80000, erpId: 1, steps: {} },
  { anker: 180000, dLav: 94000, dHoy: 127000, fossefall: card }
);

const line = JSON.parse(JSON.stringify(record));
for (const armName of ['a', 'b', 'ordna']) {
  const arm = line.fossefall[armName];
  assert.strictEqual(typeof arm.avsetning_takst, 'number', armName);
  assert.strictEqual(arm.avsetning_takst, -13000);
  assert.strictEqual(typeof arm.statid, 'number');
  assert.strictEqual(typeof arm.omregistrering, 'number');
  assert.strictEqual(typeof arm.klargjoring, 'number');
  assert.strictEqual(typeof arm.forhandlermargin, 'number');
  assert.strictEqual(typeof arm.peasy_bud_mid, 'number');
  assert.strictEqual(typeof arm.peasy_avgift.lav, 'number');
  assert.deepStrictEqual(arm.spenn, { lav: -20000, hoy: 13000 });
  assert.deepStrictEqual(arm.usikkerhet_takst, { lav: -20000, hoy: 13000 });
  assert.ok(typeof arm.spenn !== 'string');
}
assert.strictEqual(line.fossefall.a.peasy_bud_mid, 114000);
assert.strictEqual(line.fossefall.b.peasy_bud_mid, 103000);
assert.strictEqual(line.fossefall.ordna.peasy_bud_mid, 86000);
assert.strictEqual(line.easy.fossefall.a.avsetning_takst, -13000);
assert.strictEqual(line.easy.fossefall.b.spenn.lav, -20000);
assert.strictEqual(line.easy.fossefall.ordna.spenn.hoy, 13000);

console.log('v2-measurements.test.mjs ok');
