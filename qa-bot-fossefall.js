'use strict';
/**
 * QA-bot for liste 3 → Pulse QA-kort.
 * Kjører bilene gjennom samme kort/cache/A-B-sti som peasy-auto, uten ERP og uten nett.
 * Et grønt løp betyr: hver bil får et komplett fossefall-kort (midt, lav, høy, celle-id, tables path),
 * odd erpId skriver ikke A-bud men kortet lander likevel, og et gammelt cache-tidsstempel hopper ikke over.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ff = require('./fossefall');
const card = require('./fossefall-card');
const { formatEvalCardHybrid } = require('./eval-card-hybrid');

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

// Skilt/erpId fra liste 3. Finn/km er fastsatt så cellen er kjent uten ERP.
const LISTE3 = [
  { regnr: 'EE85894', erpId: 4815, model: 'ID.Buzz', finn: 180000, km: 80000, year: 2023 },
  { regnr: 'VH14780', erpId: 4960, model: 'liste3', finn: 180000, km: 80000, year: 2019 },
  { regnr: 'EH28283', erpId: 4961, model: 'liste3', finn: 40000, km: 80000, year: 2016 },
  { regnr: 'RH51344', erpId: 4962, model: 'liste3', finn: 180000, km: 20000, year: 2021 },
  { regnr: 'DR47543', erpId: 4963, model: 'liste3', finn: 180000, km: 200000, year: 2014 },
];

function buildCard(car) {
  process.env.FOSSEFALL_TABLES_LIVE = '1';
  delete process.env.FOSSEFALL_HARDCODED_FALLBACK;
  const built = ff.buildFossefall({
    finnUtpris: car.finn,
    km: car.km,
    modelYear: car.year,
    bilInfo: { year: car.year, egenvekt: 1500 },
    satser: satser,
    statidLive: false,
  });
  return card.cardFromBuilt(built);
}

function assertBlock(text, car, qaCard) {
  assert.ok(text.indexOf('FOSSEFALL') === 0, car.regnr + ' mangler FOSSEFALL-blokk');
  assert.ok(/Midt:/.test(text), car.regnr + ' mangler midt');
  assert.ok(/Lav:/.test(text), car.regnr + ' mangler lav');
  assert.ok(/Høy:/.test(text), car.regnr + ' mangler høy');
  assert.ok(/Celle-id:/.test(text), car.regnr + ' mangler celle-id');
  assert.ok(/Tables path:/.test(text), car.regnr + ' mangler tables path');
  assert.ok(text.indexOf('fossefallSatser:') !== -1, car.regnr + ' tables path er ikke fossefallSatser');
  assert.ok(!/klargjoring:\s*-?5000|Klargjøring:\s*-?5\s*000|Klargjøring:\s*-5000/.test(text), car.regnr + ' primær klarg er easy-cost 5000');
  if (!qaCard.pris_manuelt) {
    assert.ok(text.indexOf('Klargjøring:') !== -1, car.regnr + ' mangler klargjøring');
    assert.strictEqual(Math.abs(qaCard.a.klargjoring), 1000);
    assert.ok(text.indexOf(String(qaCard.celleId)) !== -1, car.regnr + ' celle-id ikke i teksten');
  } else {
    assert.ok(/PRIS MANUELT/.test(text), car.regnr + ' tom celle uten PRIS MANUELT');
  }
}

function pulseSeesBlock(record) {
  const ffBlock = record.fossefall || (record.easy && record.easy.fossefall) || null;
  if (!ffBlock || typeof ffBlock !== 'object') return { ok: false, why: 'Fossefall mangler i measurements' };
  if (!ffBlock.a || !ffBlock.b || !ffBlock.ordna) return { ok: false, why: 'mangler A/B/Ordna-armer' };
  if (!ffBlock.celleId && !(ffBlock.a && ffBlock.a.celleId) && !ffBlock.pris_manuelt) {
    return { ok: false, why: 'mangler celle-id' };
  }
  if (!ffBlock.tables_path || ffBlock.tables_path.indexOf('fossefallSatser:') !== 0) {
    return { ok: false, why: 'mangler tables path' };
  }
  if (!ffBlock.pris_manuelt) {
    if (ffBlock.peasy_bud_mid == null) return { ok: false, why: 'mangler midt' };
    if (ffBlock.lav == null || ffBlock.hoy == null) return { ok: false, why: 'mangler lav/høy' };
  }
  return { ok: true, why: 'Pulse QA leser fossefall.a/b/ordna + midt/lav/høy/celle/tables path' };
}

const cache = {};
const lines = [];
let priced = 0;
const measFile = path.join(os.tmpdir(), 'peasy-qa-fossefall-' + process.pid + '.jsonl');

LISTE3.forEach(function (car) {
  const qaCard = buildCard(car);
  const text = card.formatFossefallBlock(qaCard);
  assertBlock(text, car, qaCard);
  assert.strictEqual(card.isCompleteCard(qaCard), true, car.regnr + ' ufullstendig kort ' + text);

  const arm = card.abArm(car.erpId);
  const expectArm = car.erpId % 2 === 0 ? 'A' : 'B';
  assert.strictEqual(arm, expectArm, car.regnr);

  const legacyStamp = '2026-09-22T12:00:00.000Z';
  assert.strictEqual(card.cacheSkipsReprice(legacyStamp), false, car.regnr + ' gammelt tidsstempel hoppet over');
  cache[String(car.erpId)] = legacyStamp;

  const plan = card.planErpWrite({
    erpId: car.erpId,
    source: 'peasy',
    card: qaCard,
    legacyLav: 111000,
    legacyHoy: 122000,
  });
  if (qaCard.pris_manuelt) {
    assert.strictEqual(plan.writeErp, false, car.regnr + ' tom celle skrev bud');
    assert.strictEqual(plan.publishCard, true, car.regnr + ' tom celle uten kort');
    assert.strictEqual(plan.reason, 'PRIS MANUELT');
  } else if (arm === 'B') {
    assert.strictEqual(plan.writeErp, false, car.regnr + ' odd skrev A-bud');
    assert.strictEqual(plan.reason, 'ERP: skrives av B');
    assert.strictEqual(plan.publishCard, true, car.regnr + ' B hoppet over kortet');
  } else {
    assert.strictEqual(plan.writeErp, true, car.regnr + ' partall skrev ikke');
    assert.strictEqual(plan.reason, 'ERP: skrives av A');
    assert.strictEqual(plan.dLav, qaCard.lav);
    assert.strictEqual(plan.dHoy, qaCard.hoy);
    assert.notStrictEqual(plan.dLav, 111000, car.regnr + ' brukte easy-cost-bud');
  }

  const record = card.measurementFromPass({
    regnr: car.regnr,
    erpId: car.erpId,
    km: car.km,
    anker: car.finn,
    card: qaCard,
    dLav: plan.dLav,
    dHoy: plan.dHoy,
  });
  const seen = pulseSeesBlock(record);
  assert.strictEqual(seen.ok, true, car.regnr + ' ' + seen.why);
  const appended = card.appendMeasurement(record, measFile);
  assert.strictEqual(appended.ok, true, appended.error);

  const stamp = card.cacheStamp(qaCard);
  assert.strictEqual(card.cacheSkipsReprice(stamp), true, car.regnr + ' komplett stempel hoppet ikke');
  cache[String(car.erpId)] = stamp;

  const second = card.cacheSkipsReprice(cache[String(car.erpId)]);
  assert.strictEqual(second, true, car.regnr + ' ble priset om igjen etter komplett kort');

  if (!qaCard.pris_manuelt) {
    assert.strictEqual(qaCard.a.peasy_bud_mid, qaCard.b.peasy_bud_mid);
    assert.strictEqual(qaCard.b.peasy_bud_mid, qaCard.ordna.peasy_bud_mid);
    assert.strictEqual(qaCard.a.lav, qaCard.b.lav);
    assert.strictEqual(qaCard.b.hoy, qaCard.ordna.hoy);
    assert.strictEqual(ff.verifyLag(qaCard.a).ok, true);
    assert.strictEqual(ff.verifyLag(qaCard.b).ok, true);
    assert.strictEqual(ff.verifyLag(qaCard.ordna).ok, true);
  }

  const evalText = formatEvalCardHybrid({
    bil: { registration_number: car.regnr, id: car.erpId, model_year: car.year, mileage: car.km, source: 'peasy' },
    vegData: { make: 'Test', model: car.model, fuel: 'Bensin' },
    seg: { segment: 'normal' },
    valuation: { fossefall: qaCard, dLav: qaCard.lav, dHoy: qaCard.hoy, bracket: 'Mid' },
    anchor: { anker_beregning: { anker: car.finn }, confidence: 80 },
    brreg: { anyDebts: false },
    fossefall: qaCard,
    erpWritten: plan.writeErp,
  }, true);
  assert.ok(evalText.indexOf('FOSSEFALL') !== -1, car.regnr + ' eval-kort uten fossefall');
  assert.ok(evalText.indexOf('Celle-id:') !== -1, car.regnr + ' eval-kort uten celle-id');
  assert.ok(evalText.indexOf('Tables path:') !== -1, car.regnr + ' eval-kort uten tables path');
  assert.ok(evalText.indexOf('KALKYLE (easy-shadow)') !== -1, car.regnr + ' easy-cost er fortsatt primær');
  if (!qaCard.pris_manuelt) assert.ok(evalText.indexOf('Midt:') !== -1, car.regnr + ' eval-kort uten midt');

  priced += 1;
  lines.push(
    car.regnr + '/' + car.erpId + ' arm=' + arm
    + ' erp=' + (plan.writeErp ? 'skriv ' + plan.dLav + '-' + plan.dHoy : plan.reason)
    + ' | ' + text.split('\n').slice(1, 6).join(' · ')
  );
});

const raw = fs.readFileSync(measFile, 'utf8').trim().split('\n');
assert.strictEqual(raw.length, LISTE3.length);
raw.forEach(function (line) {
  const rec = JSON.parse(line);
  assert.strictEqual(pulseSeesBlock(rec).ok, true, rec.regnr);
  assert.strictEqual(card.measurementHasCompleteFossefall(rec), true, rec.regnr);
});
fs.unlinkSync(measFile);

const down = card.cacheStamp({
  a: { skip: true, grunn: 'satser ikke lastet' },
  b: { skip: true },
  ordna: { skip: true },
  pris_manuelt: true,
  grunn: 'satser ikke lastet',
  engine: 'fossefallSatser',
  tables_path: 'fossefallSatser:—',
  celleId: null,
});
assert.strictEqual(card.cacheSkipsReprice(down), false, 'satser nede skal ikke cache-hoppe');

const onListe = LISTE3.length;
const withCard = priced;
const pulseWouldShow = raw.length;
assert.strictEqual(withCard, onListe);
assert.strictEqual(pulseWouldShow, onListe);

console.log('QA-bot fossefall — liste 3 uten ERP');
console.log('liste3=' + onListe + ' kort=' + withCard + ' measurements=' + pulseWouldShow);
lines.forEach(function (line) { console.log('  ' + line); });
console.log('Cache: tidsstempel uten fossefall repriser. Komplett stempel hopper over.');
console.log('Pulse-tall: pulse-status.liste3 er ERP-antall. Pulse QA viser kort som har measurement.fossefall.');
console.log('qa-bot-fossefall.js ok');
