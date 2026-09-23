'use strict';
// Røyk/enhet: delt fossefall fra fossefallSatser.
// Celleverdiene er kopiert fra Pulse peasy-config.json (satser-utkast-v0.1), ikke nye tall.

const assert = require('assert');
const ff = require('./fossefall');

const satser = {
  version: 'satser-utkast-v0.1',
  status: 'DRAFT',
  axes: {
    price: [
      { id: '10-30', label: '10–30k', min: 10000, max: 30000 },
      { id: '30-60', label: '30–60k', min: 30000, max: 60000 },
      { id: '150-250', label: '150–250k', min: 150000, max: 250000 },
    ],
    km: [
      { id: 'u50', label: 'under 50k', min: 0, max: 50000 },
      { id: '50-120', label: '50–120k', min: 50000, max: 120000 },
      { id: 'o300', label: 'over 300k', min: 300000, max: 1000000000000 },
    ],
  },
  margin: {
    '10-30|o300': 8000,
    '30-60|50-120': 10000,
    '150-250|u50': 24000,
    '150-250|50-120': 38000,
  },
  takst: {
    '10-30|o300': 27000,
    '30-60|50-120': 7000,
    '150-250|u50': 4000,
    '150-250|50-120': 13000,
  },
  spenn: {
    '10-30|o300': '4000|3000',
    '30-60|50-120': '5000|4000',
    '150-250|u50': '10000|7000',
    '150-250|50-120': '20000|13000',
  },
  min: { '10-30': 4000, '30-60': 6000, '150-250': 13000 },
  max: { '10-30': 14000, '30-60': 17000, '150-250': 41000 },
};

function ctx(extra) {
  return Object.assign({
    finnUtpris: 180000,
    km: 80000,
    modelYear: 2018,
    bilInfo: { year: 2018, egenvekt: 1500 },
    satser,
    statidLive: false,
  }, extra || {});
}

function arm(profile) {
  return ff.computeSharedFossefall(Object.assign(ctx(), { profile }));
}

// Kjent celle: 180k × 80k km → 150-250 | 50-120
const cell = ff.lookupFossefallCell(satser, 180000, 80000);
assert.strictEqual(cell.ok, true);
assert.strictEqual(cell.priceId, '150-250');
assert.strictEqual(cell.kmId, '50-120');
assert.strictEqual(cell.margin, 38000);
assert.strictEqual(cell.marginRaw, 38000);
assert.strictEqual(cell.takst, 13000);
assert.deepStrictEqual(cell.spenn, { ned: 20000, opp: 13000 });
assert.strictEqual(cell.marginMin, 13000);
assert.strictEqual(cell.marginMax, 41000);

// Båndkant: 30 000 kr og 50 000 km treffer neste bånd (inkl min, ekskl maks)
const edge = ff.lookupFossefallCell(satser, 30000, 50000);
assert.strictEqual(edge.priceId, '30-60');
assert.strictEqual(edge.kmId, '50-120');
assert.strictEqual(edge.margin, 10000);
assert.strictEqual(edge.takst, 7000);

// Nestet priceId→kmId leses også (Pulse kan ligge flatt eller nestet)
const nested = {
  axes: satser.axes,
  margin: { '150-250': { '50-120': 38000 } },
  takst: { '150-250': { '50-120': 13000 } },
  spenn: { '150-250': { '50-120': { ned: 20000, opp: 13000 } } },
  min: satser.min,
  max: satser.max,
};
const nestedCell = ff.lookupFossefallCell(nested, 180000, 80000);
assert.strictEqual(nestedCell.margin, 38000);
assert.strictEqual(nestedCell.takst, 13000);
assert.deepStrictEqual(nestedCell.spenn, { ned: 20000, opp: 13000 });

// Klemme: celle over rad-maks blir maks, ikke et nytt tall
const clampSat = JSON.parse(JSON.stringify(satser));
clampSat.margin['150-250|50-120'] = 999999;
const clamped = ff.lookupFossefallCell(clampSat, 180000, 80000);
assert.strictEqual(clamped.marginRaw, 999999);
assert.strictEqual(clamped.margin, 41000);

const a = arm('a');
const b = arm('b');
const o = arm('ordna');
assert.strictEqual(a.skip, false);
assert.strictEqual(a.forhandlermargin, -38000);
assert.strictEqual(a.avsetning_takst, -13000);
assert.strictEqual(a.klargjoring, -1000);
assert.strictEqual(b.klargjoring, -1000);
assert.strictEqual(o.klargjoring, -1000);
assert.strictEqual(a.forhandlermargin, b.forhandlermargin);
assert.strictEqual(a.avsetning_takst, o.avsetning_takst);
assert.strictEqual(a.omregistrering, b.omregistrering);
assert.strictEqual(a.peasy_avgift.lav, b.peasy_avgift.lav);
assert.strictEqual(a.peasy_avgift.lav, o.peasy_avgift.lav);
assert.strictEqual(a.peasy_bud_mid, b.peasy_bud_mid);
assert.strictEqual(b.peasy_bud_mid, o.peasy_bud_mid);
assert.strictEqual(a.estimertPeasyBud, a.peasy_bud_mid);
assert.strictEqual(b.estimertPeasyBud, a.estimertPeasyBud);
assert.strictEqual(o.estimertPeasyBud, a.estimertPeasyBud);
assert.strictEqual(a.profile, 'a');
assert.strictEqual(b.profile, 'b');
assert.strictEqual(o.profile, 'ordna');
assert.strictEqual(a.profil_mult, undefined);
// 180k×80k: rå midt 113568, lav 93568, høy 126568 → half up til hele tusen.
assert.strictEqual(ff._internal.roundKr(113500), 114000);
assert.strictEqual(ff._internal.roundKr(113499), 113000);
assert.strictEqual(a.peasy_bud_mid, ff._internal.roundKr(a.ar_bud + a.peasy_avgift.lav));
assert.strictEqual(a.celleId, '150-250|50-120');
assert.strictEqual(b.celleId, '150-250|50-120');
assert.strictEqual(o.celleId, '150-250|50-120');
assert.strictEqual(a.peasy_bud_mid, 114000);
assert.strictEqual(a.estimertPeasyBud, 114000);
assert.strictEqual(a.lav, 94000);
assert.strictEqual(a.hoy, 127000);
assert.strictEqual(a.lav, a.peasy_bud_mid - 20000);
assert.strictEqual(a.hoy, a.peasy_bud_mid + 13000);
assert.strictEqual(b.lav, a.lav);
assert.strictEqual(o.lav, a.lav);
assert.strictEqual(b.hoy, a.hoy);
assert.strictEqual(o.hoy, a.hoy);
assert.deepStrictEqual(b.forhandlermargin_tillegg_bud, { lav: 0, hoy: 0 });
assert.deepStrictEqual(o.ordna_trekk, { lav: 0, hoy: 0 });
const notAScale = ff.computeSharedFossefall(Object.assign(ctx(), { profile: 0.75 }));
assert.strictEqual(notAScale.skip, true);

// Tom celle: ingen nabo, ingen autoflyt
const empty = JSON.parse(JSON.stringify(satser));
empty.margin['150-250|50-120'] = null;
const skip = ff.computeSharedFossefall(Object.assign(ctx(), { satser: empty, profile: 'a' }));
assert.strictEqual(skip.skip, true);
assert.strictEqual(skip.signal, 'PRIS MANUELT');
assert.strictEqual(skip.celleId, '150-250|50-120');
assert.ok(/tom celle margin/.test(skip.grunn));
assert.notStrictEqual(skip.forhandlermargin, -24000);

const blank = JSON.parse(JSON.stringify(satser));
blank.spenn['150-250|50-120'] = '';
const skipSpenn = ff.computeSharedFossefall(Object.assign(ctx(), { satser: blank, profile: 'b' }));
assert.strictEqual(skipSpenn.skip, true);
assert.strictEqual(skipSpenn.signal, 'PRIS MANUELT');

const outside = ff.computeSharedFossefall(Object.assign(ctx(), { finnUtpris: 5000, profile: 'a' }));
assert.strictEqual(outside.skip, true);
assert.strictEqual(outside.signal, 'PRIS MANUELT');

// Default: gammel motor på a/b/ordna (Easy-klarg 5000), ny motor i fossefall_v2
delete process.env.FOSSEFALL_TABLES_LIVE;
delete process.env.FOSSEFALL_HARDCODED_FALLBACK;
const shadow = ff.buildFossefall(ctx());
assert.strictEqual(shadow.tables_live, false);
assert.strictEqual(shadow.engine, 'hardcoded');
assert.strictEqual(shadow.a.klargjoring, -5000);
assert.strictEqual(shadow.fossefall_v2.a.klargjoring, -1000);
assert.strictEqual(shadow.fossefall_v2.a.peasy_bud_mid, shadow.fossefall_v2.b.peasy_bud_mid);
assert.strictEqual(shadow.fossefall_v2.b.peasy_bud_mid, shadow.fossefall_v2.ordna.peasy_bud_mid);
assert.strictEqual(shadow.fossefall_v2.estimertPeasyBud, shadow.fossefall_v2.a.peasy_bud_mid);
assert.strictEqual(shadow.fossefall_v2.a.lav, shadow.fossefall_v2.b.lav);
assert.strictEqual(shadow.fossefall_v2.b.hoy, shadow.fossefall_v2.ordna.hoy);
assert.strictEqual(ff.verifyLag(shadow.a).ok, true, JSON.stringify(ff.verifyLag(shadow.a)));
assert.strictEqual(ff.verifyLag(shadow.fossefall_v2.a).ok, true, JSON.stringify(ff.verifyLag(shadow.fossefall_v2.a)));
assert.strictEqual(ff.verifyLag(shadow.fossefall_v2.b).ok, true, JSON.stringify(ff.verifyLag(shadow.fossefall_v2.b)));
assert.strictEqual(ff.verifyLag(shadow.fossefall_v2.ordna).ok, true, JSON.stringify(ff.verifyLag(shadow.fossefall_v2.ordna)));

// Live: a/b/ordna er tabellmotoren, klarg 1000
process.env.FOSSEFALL_TABLES_LIVE = '1';
const live = ff.buildFossefall(ctx());
assert.strictEqual(live.tables_live, true);
assert.strictEqual(live.engine, 'fossefallSatser');
assert.strictEqual(live.a.klargjoring, -1000);
assert.strictEqual(live.b.klargjoring, -1000);
assert.strictEqual(live.ordna.klargjoring, -1000);
assert.strictEqual(live.a.peasy_bud_mid, live.b.peasy_bud_mid);
assert.strictEqual(live.b.peasy_bud_mid, live.ordna.peasy_bud_mid);
assert.strictEqual(live.estimertPeasyBud, live.a.peasy_bud_mid);
assert.strictEqual(live.a.lav, live.b.lav);
assert.strictEqual(live.a.hoy, live.ordna.hoy);
assert.strictEqual(live.lav, live.a.lav);
assert.strictEqual(live.hoy, live.a.hoy);
assert.strictEqual(live.celleId, '150-250|50-120');
assert.strictEqual(live.a.celleId, '150-250|50-120');
assert.strictEqual(live.b.celleId, live.a.celleId);
assert.strictEqual(live.ordna.celleId, live.a.celleId);
assert.strictEqual(live.estimertPeasyBud, 114000);
assert.strictEqual(live.a.peasy_bud_mid, 114000);
assert.strictEqual(live.lav, 94000);
assert.strictEqual(live.hoy, 127000);
assert.strictEqual(live.a.lav % 1000, 0);
assert.strictEqual(live.a.hoy % 1000, 0);
assert.strictEqual(ff.verifyLag(live.a).ok, true, JSON.stringify(ff.verifyLag(live.a)));
assert.ok(live.a.lav >= 3000 && live.a.hoy >= 5000);
assert.notStrictEqual(live.a.lav, 0);

// Tom celle mens live: ikke gammel motor, selv med hardcoded fallback
const liveEmpty = ff.buildFossefall(Object.assign(ctx(), { satser: empty }));
assert.strictEqual(liveEmpty.pris_manuelt, true);
assert.strictEqual(liveEmpty.a.signal, 'PRIS MANUELT');
assert.strictEqual(liveEmpty.celleId, '150-250|50-120');
assert.strictEqual(liveEmpty.a.celleId, '150-250|50-120');
assert.notStrictEqual(liveEmpty.a.klargjoring, -5000);
process.env.FOSSEFALL_HARDCODED_FALLBACK = '1';
const liveEmptyFb = ff.buildFossefall(Object.assign(ctx(), { satser: empty }));
assert.strictEqual(liveEmptyFb.pris_manuelt, true);
assert.strictEqual(liveEmptyFb.a.signal, 'PRIS MANUELT');

// Satser mangler + live: feil lukket. Fallback-flagg alene får bruke gammel motor.
delete process.env.FOSSEFALL_HARDCODED_FALLBACK;
const closed = ff.buildFossefall({ finnUtpris: 180000, km: 80000, modelYear: 2018, bilInfo: { year: 2018, egenvekt: 1500 } });
assert.strictEqual(closed.pris_manuelt, true);
assert.strictEqual(closed.a.signal, 'PRIS MANUELT');
assert.ok(/satser ikke lastet/.test(closed.grunn));
process.env.FOSSEFALL_HARDCODED_FALLBACK = '1';
const fb = ff.buildFossefall({ finnUtpris: 180000, km: 80000, modelYear: 2018, bilInfo: { year: 2018, egenvekt: 1500 } });
assert.strictEqual(fb.tables_live, false);
assert.strictEqual(fb.engine, 'hardcoded-fallback');
assert.strictEqual(fb.a.klargjoring, -5000);
assert.strictEqual(fb.pris_manuelt, false);

// Lavt anker der fossen går under gulvet: løft, aldri 0
const low = ff.buildFossefall({
  finnUtpris: 12000,
  km: 400000,
  modelYear: 2012,
  bilInfo: { year: 2012, egenvekt: 1500 },
  satser,
  statidLive: false,
});
assert.ok(low.a.lav >= 3000, 'lav ' + low.a.lav);
assert.ok(low.a.hoy >= 5000, 'hoy ' + low.a.hoy);
assert.notStrictEqual(low.a.lav, 0);
assert.notStrictEqual(low.b.lav, 0);
assert.notStrictEqual(low.ordna.lav, 0);
assert.strictEqual(ff.verifyLag(low.a).ok, true, JSON.stringify(ff.verifyLag(low.a)));

// Ståtid inngår i det ene estimatet (alle armer like). Den klemmes ikke inn i margin-maks.
const stood = ff.buildFossefall(Object.assign(ctx(), {
  statidLive: true,
  soldDays: [40, 40, 40, 40, 40, 40],
}));
assert.ok(stood.a.statid < 0, 'statid ' + stood.a.statid);
assert.strictEqual(stood.b.statid, stood.a.statid);
assert.strictEqual(stood.ordna.statid, stood.a.statid);
assert.strictEqual(stood.a.peasy_bud_mid, stood.b.peasy_bud_mid);
assert.strictEqual(stood.b.peasy_bud_mid, stood.ordna.peasy_bud_mid);
assert.strictEqual(stood.a.lav, stood.b.lav);
assert.strictEqual(stood.a.hoy, stood.ordna.hoy);
assert.strictEqual(stood.a.forhandlermargin, -38000);
assert.strictEqual(ff.verifyLag(stood.a).ok, true, JSON.stringify(ff.verifyLag(stood.a)));
assert.strictEqual(ff.verifyLag(stood.b).ok, true, JSON.stringify(ff.verifyLag(stood.b)));
assert.ok(stood.a.lav < live.a.lav);

delete process.env.FOSSEFALL_TABLES_LIVE;
delete process.env.FOSSEFALL_HARDCODED_FALLBACK;

(async () => {
  ff._internal.resetSatserCache();
  let calls = 0;
  const loaded = await ff.loadFossefallSatser({
    force: true,
    fetch: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ fossefallSatser: satser }) };
    },
  });
  assert.strictEqual(loaded.status, 'DRAFT');
  assert.strictEqual(loaded.margin['150-250|50-120'], 38000);
  await ff.loadFossefallSatser({
    fetch: async () => { calls += 1; throw new Error('skal ikke hentes på nytt'); },
  });
  assert.strictEqual(calls, 1);
  ff._internal.resetSatserCache();
  console.log('fossefall.test.js ok');
  console.log('  celle', a.celleId, 'midt', a.peasy_bud_mid, 'lav/hoy', a.lav, a.hoy);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
