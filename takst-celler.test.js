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
  r[11] = o.kilde || 'peasy'; r[12] = o.status || 'sold_and_paid'; r[13] = o.reg_dato || '20.09.2026'; r[19] = o.bud; r[21] = o.retur || null; r[22] = o.km;
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
  { navn: 'kommentar', linjer: [
    { regnr: 'KK66666', anker: 70000, felt: 'Anker', dato: '2026-04-20' },
    { regnr: 'KK77777', ingen: true },
  ] },
];
kilder[1].linjer.push({ regnr: 'BB22222', timestamp: '2026-09-01T10:00:00Z', finn_utpris: 105000 });
// Ordna-bil: V3G først selv om Easy har nyere måling
kilder[0].linjer.push({ regnr: 'OO99999', timestamp: '2026-09-23T10:00:00Z', fossefall: { a: { finn_utpris: 99000, omregistrering: -4532, statid: 0 } } });

const rows = [
  rad({ inr: 1, reg: 'AA11111', bud: 60000, km: 100000, est: '55000-61000', pb: 50100 }),
  rad({ inr: 2, reg: 'bb22222 ', bud: 80000, km: 130000, est: '70000-77000', pb: 70100 }),
  rad({ inr: 3, reg: 'CC33333', bud: 90000, km: 100000 }),                       // bare anker → uten Finn-utpris
  rad({ inr: 4, reg: 'DD44444', bud: 20000, km: 150000, est: '80000-88000', pb: 10100 }), // råtten: −87 % mot lav
  rad({ inr: 5, reg: 'OO99999', bud: 50000, km: 60000, kilde: 'ordna', retur: '01.10.2026' }),
  rad({ inr: 6, reg: 'EE55555', bud: null, km: 60000 }),                          // ikke på auksjon
  rad({ inr: 7, reg: 'KK66666', bud: 40000, km: 150000, est: '20000-26000', pb: 3000 }), // eldre, ville vært «råtten»
  rad({ inr: 8, reg: 'KK77777', bud: 40000, km: 150000 }),                        // ingen Finn-pris noe sted
  rad({ inr: 9, reg: 'AA11111', bud: 40000, km: 150000, reg_dato: '15.10.2025' }), // før 01.11.2025
];

const d = tc.byggTakstCeller({ rows, kilder, satser, naa: new Date('2026-09-25T21:30:00Z') });

// AA11111: 95 000 − 60 000 − 8 000 + 0 − 4 532 − 1 000 − 2 200 = 19 268
const aa = d.biler.find((b) => b.internnr === '1');
assert.strictEqual(aa.finn, 95000, 'nyeste Easy-måling vinner');
assert.strictEqual(aa.celle, '60-100|50-120');
assert.strictEqual(aa.salaer, 2200);
assert.strictEqual(aa.paakost, 19268);
assert.strictEqual(aa.raatten, false);

// BB22222: V3G 105 000. 100-150|120-200, margin 12 500.
// salær 2,7 % av 80 000 = 2 160 → min 2 200. 105 000 − 80 000 − 12 500 − 4 532 − 1 000 − 2 200 = 4 768
const bb = d.biler.find((b) => b.internnr === '2');
assert.strictEqual(bb.finn, 105000);
assert.strictEqual(bb.celle, '100-150|120-200');
assert.strictEqual(bb.paakost, 4768);

// CC33333 har bare gammelt anker: i heatmapet, ikke i medianen
const cc = d.biler.find((b) => b.internnr === '3');
assert.strictEqual(cc.gammel, true);
assert.strictEqual(cc.kilde, 'anker');
assert.strictEqual(cc.celle, '100-150|50-120');
assert.strictEqual(d.celler['100-150|50-120'].n_bud, 1);
assert.strictEqual(d.celler['100-150|50-120'].n_gammel, 1);
assert.strictEqual(d.celler['100-150|50-120'].n, 0);
assert.strictEqual(d.celler['100-150|50-120'].median_paakost, null);
// KK66666: Finn-pris fra ERP-kommentaren, også bare heatmap. KK77777 hadde ikke kort.
const kk = d.biler.find((b) => b.internnr === '7');
assert.strictEqual(kk.kilde, 'kommentar');
assert.strictEqual(kk.gammel, true);
assert.strictEqual(kk.raatten, false, 'eldre biler merkes ikke råtne');
assert.strictEqual(d.totalt.gammel, 2);
assert.strictEqual(d.totalt.uten_finn, 1);
// Registrert før 01.11.2025 → ikke med
assert.ok(!d.biler.find((b) => b.internnr === '9'));

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
assert.strictEqual(d.totalt.med_bud, 7);
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

// Kommentar-parser: Finn-pris > Anker: > (Anker = snitt …) > (anker 97k).
const ka = require('./kommentar-anker');
assert.deepStrictEqual(ka.ankerFraKort('PEASY BIL TIL ESTIMERING\nKALKYLE\n   Anker:   123 000 kr\n'), { anker: 123000, felt: 'Anker' });
assert.deepStrictEqual(ka.ankerFraKort('PEASY BIL TIL ESTIMERING\n   (Anker = snitt 5 valgte: 99 000 kr | snitt 80 000 km)\nKALKYLE\n   Finn-pris:       87\u00a0500 kr\n'), { anker: 87500, felt: 'Finn-pris' });
assert.strictEqual(ka.ankerFraKort('Kunden ringte. Anker: 50 000 kr'), null, 'bare eval-kort');
assert.deepStrictEqual(ka.ankerFraKort('<b>DRIVE BIL TIL ESTIMERING</b>\n(Anker = snitt 5 valgte: 99 000 kr)'), { anker: 99000, felt: 'Anker snitt' });
// Ekte kort fra mai 2026 (LY74673)
assert.deepStrictEqual(ka.ankerFraKort('PEASY BIL TIL ESTIMERING\nLY74673 | CITROEN C4 AIRCROSS 1.6 M\nPrisklasse: Lav (anker 97k)\n   (Anker = snitt 4 valgte: 96 725 kr | snitt 132 775 km)'), { anker: 96725, felt: 'Anker snitt' });
assert.deepStrictEqual(ka.ankerFraKort('PEASY BIL TIL ESTIMERING\nPrisklasse: Mid (anker 142,5k)'), { anker: 142500, felt: 'anker k' });
assert.strictEqual(ka.ankerFraKort('DRIVE BIL TIL ESTIMERING\nNF78119 | PORSCHE Panamera PDK 2013'), null);
// ERP-svaret: { data: { comments: [...] } }
assert.strictEqual(ka.kommentarListe({ success: true, data: { comments: [{ id: 1 }] } }).length, 1);
assert.strictEqual(ka.kommentarListe({ data: [{ id: 1 }, { id: 2 }] }).length, 2);
assert.strictEqual(ka.kommentarListe({ data: {} }).length, 0);
const siste = ka.ankerFraKommentarer([
  { created_at: '2026-05-02T10:00:00Z', comment: 'PEASY BIL TIL ESTIMERING\n   Anker:   150 000 kr' },
  { created_at: '2026-05-01T10:00:00Z', comment: 'PEASY BIL TIL ESTIMERING\n   Anker:   140 000 kr' },
  { created_at: '2026-05-03T10:00:00Z', comment: 'Takst ferdig' },
]);
assert.strictEqual(siste.anker, 150000);
assert.strictEqual(siste.dato, '2026-05-02');
assert.strictEqual(ka.ankerFraKommentarer([]), null);

// Henting: bare GET mot comments/all, hopper over biler i målingene og i cachen, lagrer også «ingen kort».
(async () => {
  const os = require('os'), fs = require('fs'), path = require('path');
  const fil = path.join(os.tmpdir(), 'kommentar-anker-test.json');
  fs.writeFileSync(fil, JSON.stringify({ CACHED1: { internnr: '50', anker: 1000 } }));
  const kall = [];
  const ekteFetch = global.fetch;
  global.fetch = async (url, opt) => {
    kall.push({ url, metode: (opt && opt.method) || 'GET' });
    const inr = url.match(/driveno\/(\d+)\/comments/)[1];
    const data = inr === '51' ? [{ created_at: '2026-04-20T09:00:00Z', comment: 'PEASY BIL TIL ESTIMERING\n   Anker:   64 000 kr' }] : [{ comment: 'hei' }];
    return { ok: true, status: 200, json: async () => ({ success: true, data: { comments: data } }) };
  };
  try {
    const rr = [
      rad({ inr: 50, reg: 'CACHED1', bud: 1 }),
      rad({ inr: 51, reg: 'NY11111', bud: 1 }),
      rad({ inr: 52, reg: 'NY22222', bud: 1 }),
      rad({ inr: 53, reg: 'MAALT11', bud: 1 }),
      rad({ inr: 54, reg: 'GML1111', bud: 1, reg_dato: '01.10.2025' }),
      rad({ inr: 55, reg: 'UTENBUD', bud: null }),
    ];
    const r = await ka.oppdaterKommentarAnker({ rows: rr, hopp: (reg) => reg === 'MAALT11', getToken: async () => 'tok', pauseMs: 0, fil, log: () => {} });
    assert.deepStrictEqual(r, { hentet: 2, funnet: 1, igjen: 0 });
    assert.ok(kall.every((k) => k.metode === 'GET' && /\/comments\/all$/.test(k.url)), 'bare GET');
    assert.deepStrictEqual(kall.map((k) => k.url.match(/driveno\/(\d+)/)[1]), ['51', '52']);
    const c = JSON.parse(fs.readFileSync(fil, 'utf8'));
    assert.strictEqual(c.NY11111.anker, 64000);
    assert.strictEqual(c.NY22222.ingen, true);
    assert.strictEqual(c.CACHED1.anker, 1000);
    const r2 = await ka.oppdaterKommentarAnker({ rows: rr, hopp: (reg) => reg === 'MAALT11', getToken: async () => 'tok', pauseMs: 0, fil, log: () => {} });
    assert.strictEqual(r2.hentet, 0, 'andre kjøring henter ingenting');
  } finally {
    global.fetch = ekteFetch;
    try { fs.unlinkSync(fil); } catch (_) {}
  }
  console.log('takst-celler.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
