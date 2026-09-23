'use strict';
// Røyk/enhet: delt fossefall fra fossefallSatser.
// Celleverdiene er kopiert fra Pulse peasy-config.json (satser-utkast-v0.1), ikke nye tall.

const assert = require('assert');
const ff = require('./fossefall');

assert.strictEqual(ff.FOSSEFALL_VERSION, 'v20.147');
assert.deepStrictEqual(ff.ARM_SCALE, { a: 1, b: 0.9, ordna: 0.75 });
assert.strictEqual(ff.KLARGJORING_KR, 1000);

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
assert.strictEqual(a.estimertPeasyBud, a.peasy_bud_mid);
assert.strictEqual(b.estimertPeasyBud, b.peasy_bud_mid);
assert.strictEqual(o.estimertPeasyBud, o.peasy_bud_mid);
assert.strictEqual(a.profile, 'a');
assert.strictEqual(b.profile, 'b');
assert.strictEqual(o.profile, 'ordna');
assert.strictEqual(a.profil_mult, 1);
assert.strictEqual(b.profil_mult, 0.9);
assert.strictEqual(o.profil_mult, 0.75);
assert.strictEqual(b.peasy_bud_mid, ff._internal.roundKr(a.peasy_bud_mid * ff.ARM_SCALE.b));
assert.strictEqual(o.peasy_bud_mid, ff._internal.roundKr(a.peasy_bud_mid * ff.ARM_SCALE.ordna));
assert.notStrictEqual(a.peasy_bud_mid, b.peasy_bud_mid);
assert.notStrictEqual(b.peasy_bud_mid, o.peasy_bud_mid);
// 180k×80k: rå midt 113568 rundes til 114000, deretter ARM_SCALE og spenn 20000|13000.
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
assert.strictEqual(b.lav, b.peasy_bud_mid - 20000);
assert.strictEqual(o.lav, o.peasy_bud_mid - 20000);
assert.strictEqual(b.hoy, b.peasy_bud_mid + 13000);
assert.strictEqual(o.hoy, o.peasy_bud_mid + 13000);
assert.deepStrictEqual(a.spenn, { lav: -20000, hoy: 13000 });
assert.deepStrictEqual(a.usikkerhet_takst, { lav: -20000, hoy: 13000 });
assert.strictEqual(typeof a.spenn.lav, 'number');
assert.strictEqual(typeof a.spenn.hoy, 'number');
assert.deepStrictEqual(b.forhandlermargin_tillegg_bud, { lav: b.peasy_bud_mid - a.peasy_bud_mid, hoy: b.peasy_bud_mid - a.peasy_bud_mid });
assert.deepStrictEqual(o.ordna_trekk, { lav: o.peasy_bud_mid - a.peasy_bud_mid, hoy: o.peasy_bud_mid - a.peasy_bud_mid });
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
assert.strictEqual(shadow.fossefall_v2.b.peasy_bud_mid, ff._internal.roundKr(shadow.fossefall_v2.a.peasy_bud_mid * 0.9));
assert.strictEqual(shadow.fossefall_v2.ordna.peasy_bud_mid, ff._internal.roundKr(shadow.fossefall_v2.a.peasy_bud_mid * 0.75));
assert.strictEqual(shadow.fossefall_v2.estimertPeasyBud, shadow.fossefall_v2.a.peasy_bud_mid);
assert.strictEqual(shadow.fossefall_v2.a.avsetning_takst, -13000);
assert.strictEqual(shadow.fossefall_v2.b.avsetning_takst, shadow.fossefall_v2.a.avsetning_takst);
assert.deepStrictEqual(shadow.fossefall_v2.a.spenn, { lav: -20000, hoy: 13000 });
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
assert.strictEqual(live.b.peasy_bud_mid, ff._internal.roundKr(live.a.peasy_bud_mid * ff.ARM_SCALE.b));
assert.strictEqual(live.ordna.peasy_bud_mid, ff._internal.roundKr(live.a.peasy_bud_mid * ff.ARM_SCALE.ordna));
assert.strictEqual(live.estimertPeasyBud, live.a.peasy_bud_mid);
assert.strictEqual(live.b.lav, live.b.peasy_bud_mid - 20000);
assert.strictEqual(live.ordna.hoy, live.ordna.peasy_bud_mid + 13000);
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

// Lavt anker: fossen går under null (AR-bud ≤ 0). Ikke PRIS MANUELT.
// Midt, lav og høy løftes til vrakpant. Negativ midt med gulvet bare på lav/høy er feil.
const low = ff.buildFossefall({
  finnUtpris: 12000,
  km: 400000,
  modelYear: 2012,
  bilInfo: { year: 2012, egenvekt: 1500 },
  satser,
  statidLive: false,
});
assert.ok(low.a.ar_bud <= 0, 'ar ' + low.a.ar_bud);
assert.strictEqual(low.pris_manuelt, false);
assert.strictEqual(low.signal, null);
assert.strictEqual(low.a.skip, false);
assert.ok(low.a.peasy_bud_mid >= 3000, 'midt ' + low.a.peasy_bud_mid);
assert.ok(low.a.peasy_bud_mid >= 0, 'midt negativ ' + low.a.peasy_bud_mid);
assert.ok(low.b.peasy_bud_mid >= 3000, 'b midt ' + low.b.peasy_bud_mid);
assert.ok(low.ordna.peasy_bud_mid >= 3000, 'ordna midt ' + low.ordna.peasy_bud_mid);
assert.strictEqual(low.estimertPeasyBud, low.a.peasy_bud_mid);
assert.strictEqual(typeof low.a.avsetning_takst, 'number');
assert.strictEqual(low.b.avsetning_takst, low.a.avsetning_takst);
assert.ok(low.a.lav >= 3000, 'lav ' + low.a.lav);
assert.ok(low.a.hoy >= 5000, 'hoy ' + low.a.hoy);
assert.ok(low.b.lav >= 3000 && low.ordna.lav >= 3000);
assert.ok(low.b.hoy >= 5000 && low.ordna.hoy >= 5000);
assert.notStrictEqual(low.a.lav, 0);
assert.notStrictEqual(low.b.lav, 0);
assert.notStrictEqual(low.ordna.lav, 0);
assert.strictEqual(low.celleId, '10-30|o300');
assert.strictEqual(ff.verifyLag(low.a).ok, true, JSON.stringify(ff.verifyLag(low.a)));
assert.strictEqual(ff.verifyLag(low.b).ok, true, JSON.stringify(ff.verifyLag(low.b)));
assert.strictEqual(ff.verifyLag(low.ordna).ok, true, JSON.stringify(ff.verifyLag(low.ordna)));

// Ståtid inngår i det ene estimatet (alle armer like). Den klemmes ikke inn i margin-maks.
const stood = ff.buildFossefall(Object.assign(ctx(), {
  statidLive: true,
  soldDays: [40, 40, 40, 40, 40, 40],
}));
assert.ok(stood.a.statid < 0, 'statid ' + stood.a.statid);
assert.strictEqual(stood.b.statid, stood.a.statid);
assert.strictEqual(stood.ordna.statid, stood.a.statid);
assert.strictEqual(stood.b.peasy_bud_mid, ff._internal.roundKr(stood.a.peasy_bud_mid * ff.ARM_SCALE.b));
assert.strictEqual(stood.ordna.peasy_bud_mid, ff._internal.roundKr(stood.a.peasy_bud_mid * ff.ARM_SCALE.ordna));
assert.strictEqual(stood.estimertPeasyBud, stood.a.peasy_bud_mid);
assert.notStrictEqual(stood.a.peasy_bud_mid, live.a.peasy_bud_mid);
assert.strictEqual(
  stood.a.peasy_bud_mid,
  ff._internal.roundKr(stood.a.ar_bud + stood.a.peasy_avgift.lav + stood.a.statid)
);
assert.strictEqual(stood.a.lav, stood.a.peasy_bud_mid - 20000);
assert.strictEqual(stood.a.hoy, stood.a.peasy_bud_mid + 13000);
assert.strictEqual(stood.b.lav, stood.b.peasy_bud_mid - 20000);
assert.strictEqual(stood.ordna.hoy, stood.ordna.peasy_bud_mid + 13000);
assert.strictEqual(stood.a.peasy_avgift.lav, live.a.peasy_avgift.lav);
assert.strictEqual(stood.a.forhandlermargin, -38000);
assert.strictEqual(ff.verifyLag(stood.a).ok, true, JSON.stringify(ff.verifyLag(stood.a)));
assert.strictEqual(ff.verifyLag(stood.b).ok, true, JSON.stringify(ff.verifyLag(stood.b)));
assert.ok(stood.a.lav < live.a.lav);

// Spenn som ikke er hele tusen: lav/høy følger avrundet midt, de rundes ikke hver for seg.
const oddSpenn = JSON.parse(JSON.stringify(satser));
oddSpenn.spenn['150-250|50-120'] = '2500|1300';
const odd = ff.computeSharedFossefall(Object.assign(ctx(), { satser: oddSpenn, profile: 'a' }));
const oddRaw = odd.ar_bud + odd.peasy_avgift.lav;
assert.strictEqual(odd.peasy_bud_mid, ff._internal.roundKr(oddRaw));
assert.strictEqual(odd.lav, odd.peasy_bud_mid - 2500);
assert.strictEqual(odd.hoy, odd.peasy_bud_mid + 1300);
assert.notStrictEqual(odd.lav, ff._internal.roundKr(oddRaw - 2500));

// QA-kort / measurement-sample: avsetning_takst er eget felt, spenn er lav og høy, midter skiller armene.
const card = ff.fossefallQaCard(live);
assert.ok(card && card.a && card.b && card.ordna);
for (const arm of [card.a, card.b, card.ordna]) {
  assert.strictEqual(typeof arm.avsetning_takst, 'number');
  assert.strictEqual(arm.avsetning_takst, -13000);
  assert.notStrictEqual(arm.avsetning_takst, arm.peasy_bud_mid);
  assert.strictEqual(typeof arm.forhandlermargin, 'number');
  assert.strictEqual(typeof arm.statid, 'number');
  assert.strictEqual(typeof arm.omregistrering, 'number');
  assert.strictEqual(typeof arm.klargjoring, 'number');
  assert.strictEqual(typeof arm.peasy_avgift.lav, 'number');
  assert.strictEqual(typeof arm.peasy_avgift.hoy, 'number');
  assert.strictEqual(typeof arm.peasy_bud_mid, 'number');
  assert.ok(arm.spenn && typeof arm.spenn === 'object');
  assert.strictEqual(typeof arm.spenn.lav, 'number');
  assert.strictEqual(typeof arm.spenn.hoy, 'number');
  assert.deepStrictEqual(arm.usikkerhet_takst, arm.spenn);
}
assert.strictEqual(card.a.peasy_bud_mid, 114000);
assert.strictEqual(card.b.peasy_bud_mid, ff._internal.roundKr(114000 * 0.9));
assert.strictEqual(card.ordna.peasy_bud_mid, ff._internal.roundKr(114000 * 0.75));
assert.deepStrictEqual(card.arm_scale, { a: 1, b: 0.9, ordna: 0.75 });
const sample = JSON.parse(JSON.stringify({ fossefall: card }));
assert.strictEqual(sample.fossefall.a.avsetning_takst, -13000);
assert.strictEqual(sample.fossefall.a.spenn.lav, -20000);
assert.strictEqual(sample.fossefall.a.spenn.hoy, 13000);
assert.notStrictEqual(sample.fossefall.a.peasy_bud_mid, sample.fossefall.b.peasy_bud_mid);

// En sammenslått spenn-streng på vei inn splittes før publisering.
const split = ff.fossefallQaCard({
  a: {
    avsetning_takst: -13000,
    peasy_bud_mid: 114000,
    forhandlermargin: -38000,
    statid: 0,
    omregistrering: -4532,
    klargjoring: -1000,
    peasy_avgift: { lav: -9900, hoy: -9900 },
    spenn: '20000|13000',
  },
  b: { peasy_bud_mid: 103000, avsetning_takst: -13000, spenn: { lav: -20000, hoy: 13000 } },
  ordna: { peasy_bud_mid: 86000, avsetning_takst: -13000, usikkerhet_takst: { lav: -20000, hoy: 13000 } },
});
assert.deepStrictEqual(split.a.spenn, { lav: -20000, hoy: 13000 });
assert.strictEqual(typeof split.a.spenn, 'object');
assert.strictEqual(split.a.avsetning_takst, -13000);
assert.strictEqual(split.b.peasy_bud_mid, 103000);
assert.strictEqual(split.ordna.peasy_bud_mid, 86000);

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
