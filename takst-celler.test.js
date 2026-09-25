'use strict';
// takst-celler: implisitt påkost per celle fra faktiske AR-bud. Ingen nett, ingen filer.
const assert = require('assert');
const tc = require('./takst-celler');

const satser = {
  version: 'test',
  axes: {
    price: [{ id: '60-100', min: 60000, max: 100000 }, { id: '100-150', min: 100000, max: 150000 }],
    km: [{ id: '50-120', min: 50000, max: 120000 }, { id: '120-200', min: 120000, max: 200000 }],
  },
  margin: { '60-100|50-120': 8000, '60-100|120-200': 8000, '100-150|50-120': 12500, '100-150|120-200': 12500 },
  takst: { '60-100|50-120': 5500, '60-100|120-200': 12000, '100-150|50-120': 6600, '100-150|120-200': 15600 },
  spenn: { '60-100|50-120': '6000|4000', '60-100|120-200': '7000|4000', '100-150|50-120': '8000|5000', '100-150|120-200': '8000|5000' },
  min: { '60-100': 8000, '100-150': 10000 },
  max: { '60-100': 24000, '100-150': 31000 },
  arSalaerPct: 2.7,
  arSalaerMin: 2200,
};

// ERP-rad: 0 internnr, 1 regnr, 3 estimat, 4 Peasy-bud, 8 år, 11 kilde, 12 status, 19 bud, 21 retur, 22 km
function rad(o) {
  const r = new Array(32).fill(null);
  r[0] = o.inr; r[1] = o.reg; r[3] = o.est || null; r[4] = o.pb != null ? o.pb : null; r[8] = o.aar || 2016;
  r[11] = o.kilde || 'peasy'; r[12] = o.status || 'sold_and_paid'; r[19] = o.bud; r[21] = o.retur || null; r[22] = o.km;
  return r;
}

// Salær på faktisk bud: 2,7 %, minst 2 200.
assert.strictEqual(tc.salaerPaaBud(100000, 2.7, 2200), 2700);
assert.strictEqual(tc.salaerPaaBud(50000, 2.7, 2200), 2200);
assert.strictEqual(tc.salaerPaaBud(50000, 0, 0), 0);

const kilder = [
  { navn: 'easy', linjer: [
    // Easy med fossefall: omreg og ståtid fra armen
    { regnr: 'AA11111', timestamp: '2026-09-20T10:00:00Z', fossefall: { a: { finn_utpris: 90000, omregistrering: -4532, statid: 0 } } },
    // QA satte ny Finn-pris senere → nyeste vinner
    { regnr: 'AA11111', timestamp: '2026-09-21T10:00:00Z', fossefall: { a: { finn_utpris: 95000, omregistrering: -4532, statid: 0 } } },
    // Gammelt anker brukes ikke
    { regnr: 'CC33333', timestamp: '2026-07-01T10:00:00Z', easy: { anker: 120000 } },
    // Ståtid trekkes med
    { regnr: 'DD44444', timestamp: '2026-09-22T10:00:00Z', fossefall: { a: { finn_utpris: 120000, omregistrering: -4532, statid: -3000 } } },
  ] },
  { navn: 'v3g', linjer: [
    { regnr: 'AA11111', timestamp: '2026-09-25T10:00:00Z', finn_utpris: 70000 }, // Easy slår V3G for A/B-bil
    { regnr: 'OO99999', timestamp: '2026-09-22T10:00:00Z', finn_utpris: 80000 },
  ] },
  { navn: 'easy2', linjer: [] },
  { navn: 'loop2', linjer: [
    { regnr: 'BB22222', timestamp: '2026-09-01T10:00:00Z', evaluator: 'claude', ok: true, finn_utpris: 100000 },
    { regnr: 'BB22222', timestamp: '2026-09-01T10:00:01Z', evaluator: 'grok', ok: true, finn_utpris: 110000 },
    { regnr: 'BB22222', timestamp: '2026-09-01T10:00:02Z', evaluator: 'gemini', ok: true, finn_utpris: 999999 },
  ] },
];
// Ordna-bil: V3G først selv om Easy har nyere måling
kilder[0].linjer.push({ regnr: 'OO99999', timestamp: '2026-09-23T10:00:00Z', fossefall: { a: { finn_utpris: 99000, omregistrering: -4532, statid: 0 } } });

const rows = [
  rad({ inr: 1, reg: 'AA11111', bud: 60000, km: 100000, est: '55000-61000', pb: 50100 }),
  rad({ inr: 2, reg: 'bb22222 ', bud: 80000, km: 130000, est: '70000-77000', pb: 70100 }),
  rad({ inr: 3, reg: 'CC33333', bud: 90000, km: 100000 }),                       // bare anker → uten Finn-utpris
  rad({ inr: 4, reg: 'DD44444', bud: 20000, km: 150000, est: '80000-88000', pb: 10100 }), // råtten: −87 % mot lav
  rad({ inr: 5, reg: 'OO99999', bud: 50000, km: 60000, kilde: 'ordna', retur: '01.10.2026' }),
  rad({ inr: 6, reg: 'EE55555', bud: null, km: 60000 }),                          // ikke på auksjon
];

const d = tc.byggTakstCeller({ rows, kilder, satser, naa: new Date('2026-09-25T21:30:00Z') });

// AA11111: 95 000 − 60 000 − 8 000 + 0 − 4 532 − 1 000 − 2 200 = 19 268
const aa = d.biler.find((b) => b.internnr === '1');
assert.strictEqual(aa.finn, 95000, 'nyeste Easy-måling vinner');
assert.strictEqual(aa.celle, '60-100|50-120');
assert.strictEqual(aa.salaer, 2200);
assert.strictEqual(aa.paakost, 19268);
assert.strictEqual(aa.raatten, false);

// BB22222: loop2 = snitt av Claude og Grok (105 000), Gemini teller ikke. 100-150|120-200, margin 12 500.
// salær 2,7 % av 80 000 = 2 160 → min 2 200. 105 000 − 80 000 − 12 500 − 4 532 − 1 000 − 2 200 = 4 768
const bb = d.biler.find((b) => b.internnr === '2');
assert.strictEqual(bb.finn, 105000);
assert.strictEqual(bb.celle, '100-150|120-200');
assert.strictEqual(bb.paakost, 4768);

// CC33333 har bare gammelt anker
assert.ok(!d.biler.find((b) => b.internnr === '3'));
assert.strictEqual(d.totalt.uten_finn, 1);

// DD44444: råtten, telles i n_bud men ikke i medianen. Ståtid −3 000 trekkes med.
const dd = d.biler.find((b) => b.internnr === '4');
assert.strictEqual(dd.raatten, true);
assert.strictEqual(dd.paakost, 120000 - 20000 - 12500 - 3000 - 4532 - 1000 - 2200);
assert.strictEqual(d.celler['100-150|120-200'].n_bud, 2);
assert.strictEqual(d.celler['100-150|120-200'].n, 1);
assert.strictEqual(d.celler['100-150|120-200'].utelatt_raatne, 1);
assert.strictEqual(d.celler['100-150|120-200'].median_paakost, 4800);
assert.strictEqual(d.celler['100-150|120-200'].tabell, 15600);
assert.strictEqual(d.celler['100-150|120-200'].avvik, -10800);

// Ordna: V3G-tallet
const oo = d.biler.find((b) => b.internnr === '5');
assert.strictEqual(oo.finn, 80000);
assert.strictEqual(oo.retur, true);
assert.strictEqual(d.celler['60-100|50-120'].n_retur, 1);

// Ikke på auksjon → ikke med
assert.strictEqual(d.totalt.med_bud, 5);
assert.ok(!d.biler.find((b) => b.internnr === '6'));

// Forslag først ved 20 bud i cellen
assert.strictEqual(d.celler['60-100|50-120'].forslag, null);
const mange = [];
const mangeKilder = [{ navn: 'easy', linjer: [] }];
for (let i = 0; i < 20; i++) {
  const reg = 'ZZ' + String(10000 + i);
  mange.push(rad({ inr: 100 + i, reg, bud: 60000, km: 100000 }));
  mangeKilder[0].linjer.push({ regnr: reg, timestamp: '2026-09-20T10:00:00Z', fossefall: { a: { finn_utpris: 90000 + i * 100, omregistrering: -4532, statid: 0 } } });
}
const d20 = tc.byggTakstCeller({ rows: mange, kilder: mangeKilder, satser });
assert.strictEqual(d20.celler['60-100|50-120'].n, 20);
assert.ok(d20.celler['60-100|50-120'].forslag > 0, 'forslag ved 20 bud');

// Ingen regnr i ut-filen (Pages er offentlig)
assert.ok(!JSON.stringify(d).includes('AA11111'));

// Uten satser: kaster (nattjobben fanger det)
assert.throws(() => tc.byggTakstCeller({ rows, kilder, satser: null }));

console.log('takst-celler.test.js OK');
