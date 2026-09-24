'use strict';
// Røyk/enhet: delt fossefall fra fossefallSatser.
// Celleverdiene er kopiert fra Pulse peasy-config.json (satser-utkast-v0.1), ikke nye tall.

const assert = require('assert');
const ff = require('./fossefall');

assert.strictEqual(ff.FOSSEFALL_VERSION, 'v20.152');
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
assert.strictEqual(a.peasy_bud_mid, b.peasy_bud_mid);
assert.strictEqual(b.peasy_bud_mid, o.peasy_bud_mid);
assert.strictEqual(a.estimertPeasyBud, a.peasy_bud_mid);
assert.strictEqual(b.estimertPeasyBud, a.estimertPeasyBud);
assert.strictEqual(o.estimertPeasyBud, a.estimertPeasyBud);
assert.strictEqual(a.profile, 'a');
assert.strictEqual(b.profile, 'b');
assert.strictEqual(o.profile, 'ordna');
assert.strictEqual(a.profil_mult, undefined);
// 180k×80k: rå midt 113568 rundes til 114000, deretter spenn 20000|13000.
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

// v20.151: tabeller av => PRIS MANUELT. Legacy arkiveres, prises ikke.
delete process.env.FOSSEFALL_TABLES_LIVE;
delete process.env.FOSSEFALL_HARDCODED_FALLBACK;
const shadow = ff.buildFossefall(ctx());
assert.strictEqual(shadow.tables_live, false);
assert.strictEqual(shadow.engine, 'fossefallSatser');
assert.strictEqual(shadow.pris_manuelt, true);
assert.strictEqual(shadow.signal, 'PRIS MANUELT');
assert.strictEqual(shadow.grunn, 'fossefall-tabeller av');
assert.strictEqual(shadow.a.signal, 'PRIS MANUELT');
assert.strictEqual(shadow.b.signal, 'PRIS MANUELT');
assert.strictEqual(shadow.ordna.signal, 'PRIS MANUELT');
// Ingen arm far presentere et bud nar tabellene er av.
for (const arm of ['a', 'b', 'ordna']) {
  assert.strictEqual(shadow[arm].skip, true, arm + ' skal vaere skip');
  assert.ok(shadow[arm].peasy_bud_mid == null, arm + ' skal ikke ha bud');
}
// Legacy er arkivert og lesbar, men brukes ikke som bud.
assert.ok(shadow.fossefall_legacy && shadow.fossefall_legacy.a);
assert.strictEqual(shadow.fossefall_legacy.a.klargjoring, -5000);
assert.strictEqual(shadow.fossefall_v2.a.klargjoring, -1000);
assert.strictEqual(shadow.fossefall_v2.b.peasy_bud_mid, ff._internal.roundKr(shadow.fossefall_v2.a.peasy_bud_mid * 0.9));
assert.strictEqual(shadow.fossefall_v2.ordna.peasy_bud_mid, ff._internal.roundKr(shadow.fossefall_v2.a.peasy_bud_mid * 0.75));
assert.strictEqual(shadow.fossefall_v2.estimertPeasyBud, shadow.fossefall_v2.a.peasy_bud_mid);
assert.notStrictEqual(shadow.fossefall_v2.a.peasy_bud_mid, shadow.fossefall_v2.b.peasy_bud_mid);
assert.notStrictEqual(shadow.fossefall_v2.a.peasy_bud_mid, shadow.fossefall_v2.ordna.peasy_bud_mid);
assert.strictEqual(shadow.fossefall_v2.b.lav, shadow.fossefall_v2.b.peasy_bud_mid - 20000);
assert.strictEqual(shadow.fossefall_v2.ordna.hoy, shadow.fossefall_v2.ordna.peasy_bud_mid + 13000);
assert.strictEqual(ff.verifyLag(shadow.fossefall_v2.a).ok, true, JSON.stringify(ff.verifyLag(shadow.fossefall_v2.a)));
// B/Ordna are midt-scaled copies; layer sum is A's — verifyLag only for A.

// Live: a/b/ordna er tabellmotoren, klarg 1000
process.env.FOSSEFALL_TABLES_LIVE = '1';
const live = ff.buildFossefall(ctx());
assert.strictEqual(live.tables_live, true);
assert.strictEqual(live.engine, 'fossefallSatser');
assert.strictEqual(live.a.klargjoring, -1000);
assert.strictEqual(live.b.klargjoring, -1000);
assert.strictEqual(live.ordna.klargjoring, -1000);
assert.strictEqual(live.b.peasy_bud_mid, ff._internal.roundKr(live.a.peasy_bud_mid * 0.9));
assert.strictEqual(live.ordna.peasy_bud_mid, ff._internal.roundKr(live.a.peasy_bud_mid * 0.75));
assert.strictEqual(live.estimertPeasyBud, live.a.peasy_bud_mid);
assert.notStrictEqual(live.a.peasy_bud_mid, live.b.peasy_bud_mid);
assert.notStrictEqual(live.a.peasy_bud_mid, live.ordna.peasy_bud_mid);
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
assert.ok(live.b.lav < live.a.lav);
assert.ok(live.ordna.lav < live.b.lav);

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
assert.strictEqual(low.b.peasy_bud_mid, Math.max(3000, ff._internal.roundKr(low.a.peasy_bud_mid * 0.9)));
assert.strictEqual(low.ordna.peasy_bud_mid, Math.max(3000, ff._internal.roundKr(low.a.peasy_bud_mid * 0.75)));
assert.ok(low.a.lav >= 3000, 'lav ' + low.a.lav);
assert.ok(low.a.hoy >= 5000, 'hoy ' + low.a.hoy);
assert.ok(low.b.lav >= 3000 && low.ordna.lav >= 3000);
assert.ok(low.b.hoy >= 5000 && low.ordna.hoy >= 5000);
assert.notStrictEqual(low.a.lav, 0);
assert.notStrictEqual(low.b.lav, 0);
assert.notStrictEqual(low.ordna.lav, 0);
assert.strictEqual(low.celleId, '10-30|o300');
assert.strictEqual(ff.verifyLag(low.a).ok, true, JSON.stringify(ff.verifyLag(low.a)));

// Ståtid inngår i det ene estimatet (alle armer like). Den klemmes ikke inn i margin-maks.
const stood = ff.buildFossefall(Object.assign(ctx(), {
  statidLive: true,
  soldDays: [40, 40, 40, 40, 40, 40],
}));
assert.ok(stood.a.statid < 0, 'statid ' + stood.a.statid);
assert.strictEqual(stood.b.statid, stood.a.statid);
assert.strictEqual(stood.ordna.statid, stood.a.statid);
assert.strictEqual(stood.b.peasy_bud_mid, ff._internal.roundKr(stood.a.peasy_bud_mid * 0.9));
assert.strictEqual(stood.ordna.peasy_bud_mid, ff._internal.roundKr(stood.a.peasy_bud_mid * 0.75));
assert.strictEqual(stood.estimertPeasyBud, stood.a.peasy_bud_mid);
assert.notStrictEqual(stood.a.peasy_bud_mid, live.a.peasy_bud_mid);
// v20.152: staatid ligger inne i ar_bud, ikke lagt pa etter avgiften.
assert.strictEqual(
  stood.a.peasy_bud_mid,
  ff._internal.roundKr(stood.a.ar_bud + stood.a.peasy_avgift.lav)
);
assert.strictEqual(stood.a.lav, stood.a.peasy_bud_mid - 20000);
assert.strictEqual(stood.a.hoy, stood.a.peasy_bud_mid + 13000);
assert.strictEqual(stood.b.lav, stood.b.peasy_bud_mid - 20000);
assert.strictEqual(stood.ordna.hoy, stood.ordna.peasy_bud_mid + 13000);
assert.strictEqual(stood.a.peasy_avgift.lav, live.a.peasy_avgift.lav);
assert.strictEqual(stood.a.forhandlermargin, -38000);
assert.strictEqual(ff.verifyLag(stood.a).ok, true, JSON.stringify(ff.verifyLag(stood.a)));
assert.ok(stood.a.lav < live.a.lav);
assert.ok(stood.b.lav < stood.a.lav);

// Spenn som ikke er hele tusen: lav/høy følger avrundet midt, de rundes ikke hver for seg.
const oddSpenn = JSON.parse(JSON.stringify(satser));
oddSpenn.spenn['150-250|50-120'] = '2500|1300';
const odd = ff.computeSharedFossefall(Object.assign(ctx(), { satser: oddSpenn, profile: 'a' }));
const oddRaw = odd.ar_bud + odd.peasy_avgift.lav;
assert.strictEqual(odd.peasy_bud_mid, ff._internal.roundKr(oddRaw));
assert.strictEqual(odd.lav, odd.peasy_bud_mid - 2500);
assert.strictEqual(odd.hoy, odd.peasy_bud_mid + 1300);
assert.notStrictEqual(odd.lav, ff._internal.roundKr(oddRaw - 2500));

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
  // --- v20.151 regresjon: B kan aldri bli hoyere enn A ---
// BS61175 fikk A 21 000 / B 29 000 fra legacy-stien 23.09. Skal vaere umulig.
process.env.FOSSEFALL_TABLES_LIVE = '1';
delete process.env.FOSSEFALL_HARDCODED_FALLBACK;
for (const finn of [20000, 48000, 90000, 170000, 350000, 900000]) {
  for (const km of [30000, 90000, 150000, 250000]) {
    const r = ff.buildFossefall({ finnUtpris: finn, km, modelYear: 2018,
      bilInfo: { year: 2018, egenvekt: 1500 }, satser });
    if (r.pris_manuelt) continue;
    const A = r.a.peasy_bud_mid, B = r.b.peasy_bud_mid, O = r.ordna.peasy_bud_mid;
    const tag = finn + '/' + km;
    assert.ok(B <= A, 'B over A for ' + tag + ': A=' + A + ' B=' + B);
    assert.ok(O <= B, 'Ordna over B for ' + tag + ': B=' + B + ' O=' + O);
    // Motoren skalerer den URUNDEDE midten, sa B kan avvike inntil 1000 fra
    // rund(A*0.9). Sjekk forholdet, ikke eksakt likhet.
    assert.ok(Math.abs(B - A * 0.9) <= 1000, 'B/A ikke 0.9 for ' + tag + ': A=' + A + ' B=' + B);
    assert.ok(Math.abs(O - A * 0.75) <= 1000, 'Ordna/A ikke 0.75 for ' + tag + ': A=' + A + ' O=' + O);
    for (const arm of ['a', 'b', 'ordna']) {
      assert.ok(r[arm].lav >= 3000, 'lav under vrakpantgulv for ' + tag + ' ' + arm);
      assert.strictEqual(r[arm].avsetning_takst, r.a.avsetning_takst, 'takst avviker for ' + tag + ' ' + arm);
      assert.strictEqual(r[arm].klargjoring, -1000, 'klargjoring != 1000 for ' + tag + ' ' + arm);
      assert.deepStrictEqual(r[arm].spenn, r.a.spenn, 'spenn avviker for ' + tag + ' ' + arm);
    }
  }
}
delete process.env.FOSSEFALL_TABLES_LIVE;

// --- v20.152: staatid ligger OVER Peasy-avgiften ---
// Avgiften er en trapp slatt opp pa AR-bud. La staatid under, kunne en bil
// med staatidskostnad havne i for hoyt avgiftstrinn.
{
  const base = Object.assign(ctx(), { profile: 'a' });
  const uten = ff.computeSharedFossefall(Object.assign({}, base, { statidKr: 0 }));
  const med  = ff.computeSharedFossefall(Object.assign({}, base, { statidKr: -12000 }));

  // Staatid er inne i AR-bud, ikke lagt pa etterpa.
  assert.strictEqual(med.ar_bud, uten.ar_bud - 12000, 'staatid ikke i AR-bud');
  assert.strictEqual(med.statid, -12000);
  assert.strictEqual(uten.statid, 0);

  // Avgiften kan bare falle eller sta stille nar AR-bud faller.
  const avgUten = -uten.peasy_avgift.lav, avgMed = -med.peasy_avgift.lav;
  assert.ok(avgMed <= avgUten, 'avgift steg av staatidskostnad: ' + avgUten + ' -> ' + avgMed);

  // Midten faller med minst staatiden (mer hvis avgiften ogsa falt et trinn).
  assert.ok(med.peasy_bud_mid <= uten.peasy_bud_mid - 11000,
    'midt falt ikke med staatiden: ' + uten.peasy_bud_mid + ' -> ' + med.peasy_bud_mid);

  // Null staatid skal ikke endre noe i det hele tatt.
  const null0 = ff.computeSharedFossefall(Object.assign({}, base, { statidKr: 0 }));
  assert.strictEqual(null0.ar_bud, uten.ar_bud);
  assert.strictEqual(null0.peasy_bud_mid, uten.peasy_bud_mid);
  assert.deepStrictEqual(null0.peasy_avgift, uten.peasy_avgift);
}

// Avgiftstrinn skal faktisk kunne falle: finn en bil rett over en trinngrense.
{
  let kryssetTrinn = false;
  for (const finn of [60000, 80000, 110000, 140000, 175000, 210000, 260000]) {
    for (const km of [30000, 90000, 150000]) {
      const b = { finnUtpris: finn, km, modelYear: 2018,
        bilInfo: { year: 2018, egenvekt: 1500 }, satser, profile: 'a' };
      const u = ff.computeSharedFossefall(Object.assign({}, b, { statidKr: 0 }));
      const m = ff.computeSharedFossefall(Object.assign({}, b, { statidKr: -20000 }));
      if (u.skip || m.skip) continue;
      if (-m.peasy_avgift.lav < -u.peasy_avgift.lav) kryssetTrinn = true;
    }
  }
  assert.ok(kryssetTrinn, 'fant ingen bil der staatid senket avgiftstrinnet - er trappen koblet til AR-bud?');
}

console.log('fossefall.test.js ok');
  console.log('  celle', a.celleId, 'midt', a.peasy_bud_mid, 'lav/hoy', a.lav, a.hoy);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
