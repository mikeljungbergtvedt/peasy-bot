'use strict';
// Ståtid: forslag fra carinfo (aldri automatisk), lagt på bare når QA huker av.
process.env.FOSSEFALL_TABLES_LIVE = '1';
process.env.STATID_A_LIVE = '0';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const Module = require('module');
// shared/easy-meas-field.js ligger bare på Mini: stubb den i test hvis den mangler.
const _resolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  try { return _resolve.call(this, req, parent, ...rest); }
  catch (e) { if (/easy-meas-field/.test(req)) return path.join(__dirname, 'statid-forslag.test.js'); throw e; }
};
module.exports.easyField = (e) => (e && typeof e === 'object' ? Object.assign({}, e) : null);

const { statidForslag } = require('./statid-forslag');
const ff = require('./fossefall');

function ad(o) { return Object.assign({ same_car: 1, licence_plate: 'XX' + Math.random().toString().slice(2, 7), classified_price: '100000', mileage_km: '120000', classified_url: 'https://finn.no/x' }, o); }
const cv = (ads) => ({ carinfo: { valuation: { company_classifieds: ads, private_classifieds: [] } } });
const maalt = '2026-09-25T10:00:00Z';

// Samme sats som fossefall.computeStatid når bare solgte teller
const solgte = [20, 30, 40, 50, 60].map((d) => ad({ ca_sold_date: '2026-09-01', days: d }));
const f1 = statidForslag({ originCv: cv(solgte), regnr: 'AB12345', finn: 200000, maalt });
assert.strictEqual(f1.kr, ff.computeStatid(200000, [20, 30, 40, 50, 60]).kr);
assert.strictEqual(f1.kr, -16500); // median 40 → 25 dager × 660 kr
assert.strictEqual(f1.median_dager, 40);
assert.strictEqual(f1.n_solgt, 5);
assert.strictEqual(f1.kilder[0].dager, 60, 'lengst liggetid først');

// Aktive annonser teller med alder; egen bil og annen modell utelates; 3 comps holder
const blandet = [
  ad({ ca_sold_date: '2026-08-01', days: 10 }),
  ad({ classified_published_date: '2026-08-10', classified_removed_date: null }),   // aktiv i 46 d
  ad({ classified_published_date: '2026-08-20', classified_removed_date: null }),   // aktiv i 36 d
  ad({ licence_plate: 'AB 12345', ca_sold_date: '2026-08-01', days: 200 }),        // bilen selv
  ad({ same_car: 0, ca_sold_date: '2026-08-01', days: 300 }),                      // annen modell
  ad({ classified_published_date: '2026-06-01', classified_removed_date: '2026-07-01' }), // fjernet, ikke solgt
];
const f2 = statidForslag({ originCv: cv(blandet), regnr: 'AB12345', finn: 100000, maalt });
assert.strictEqual(f2.n_solgt, 1);
assert.strictEqual(f2.n_aktive, 2);
assert.strictEqual(f2.median_dager, 36);
assert.strictEqual(f2.kr, -6900); // 21 dager × 330 kr = 6 930 → 6 900

// For få comps eller rask omsetning: 0 med grunn
assert.strictEqual(statidForslag({ originCv: cv(solgte.slice(0, 2)), finn: 1e5, maalt }).kr, 0);
assert.ok(/for få comps/.test(statidForslag({ originCv: cv(solgte.slice(0, 2)), finn: 1e5, maalt }).grunn));
const raske = [5, 8, 9, 12].map((d) => ad({ ca_sold_date: '2026-09-01', days: d }));
const f3 = statidForslag({ originCv: cv(raske), finn: 1e5, maalt });
assert.strictEqual(f3.kr, 0);
assert.ok(/selges raskt/.test(f3.grunn));
assert.strictEqual(statidForslag({ originCv: null, finn: 1e5 }).kr, 0);

(async () => {
  const satser = {
    version: 'test',
    axes: { price: [{ id: '60-100', min: 60000, max: 100000 }], km: [{ id: '120-200', min: 120000, max: 200000 }] },
    margin: { '60-100|120-200': 8000 }, takst: { '60-100|120-200': 12000 }, spenn: { '60-100|120-200': '7000|4000' },
    min: { '60-100': 8000 }, max: { '60-100': 24000 }, arSalaerPct: 2.7, arSalaerMin: 2200,
  };
  const { planQaAnker } = require('./qa-anker-plan');
  const uten = await planQaAnker({ anker: 90000, km: 150000, year: 2016, egenvekt: 1400, erpId: 5000, source: 'peasy', satser });
  const med = await planQaAnker({ anker: 90000, km: 150000, year: 2016, egenvekt: 1400, erpId: 5000, source: 'peasy', satser, statidKr: -6000 });
  assert.ok(uten.ok && med.ok);
  assert.strictEqual(uten.statidKr, 0);
  assert.strictEqual(med.statidKr, -6000);
  assert.strictEqual(med.card.a.statid, -6000);
  assert.strictEqual(uten.dLav - med.dLav, 6000, 'ståtid trekker lav med samme beløp');
  // positivt tall eller tull → ingen ståtid
  assert.strictEqual((await planQaAnker({ anker: 90000, km: 150000, year: 2016, erpId: 5000, satser, statidKr: 3000 })).statidKr, 0);

  // Målingen etter QA får samme ståtid og lav som ERP, og forslaget lagres
  const fil = path.join(os.tmpdir(), 'statid-meas-test.jsonl');
  try { fs.unlinkSync(fil); } catch (_) {}
  process.env.PEASY_EASY_MEAS_FILE = fil;
  delete require.cache[require.resolve('./easy-measurements')];
  ff._internal.resetSatserCache();
  await ff.loadFossefallSatser({ force: true, fetch: async () => ({ ok: true, json: async () => ({ fossefallSatser: satser }) }) });
  const em = require('./easy-measurements');
  em.appendEasyMeasurement({ regnr: 'QA11111', km: 150000, erpId: 5000, origin_cv: cv(solgte), timestamp: maalt,
    easyEval: { finn_utpris: 90000, model_year: 2016, egenvekt: 1400, statid_qa_kr: -6000, statid_qa_kilde: { median_dager: 40, n: 5 } } });
  ff._internal.resetSatserCache();
  const rec = JSON.parse(fs.readFileSync(fil, 'utf8').trim().split('\n').pop());
  {
    assert.strictEqual(rec.fossefall.a.statid, -6000);
    assert.strictEqual(rec.fossefall.a.lav, med.card.a.lav, 'måling = ERP');
    assert.deepStrictEqual(rec.fossefall.statid_qa, { kr: -6000, kilde: { median_dager: 40, n: 5 } });
    assert.ok(rec.fossefall.statid_forslag && rec.fossefall.statid_forslag.kr < 0);
  }
  fs.unlinkSync(fil);
  console.log('statid-forslag.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
