#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  originKmFromListe3,
  mergeSellerComment,
  buildOriginCv,
  applyCarInfoIdentity,
  plateIdentityFromCarInfo,
  lockedKm,
  sameOriginCv,
  dropOwnSold,
  isOwnSoldComp,
  originCv,
  WRITES_ERP,
} = require('./jr/origin-cv');
const { buildFinnQuery, buildFinnUrl, assertJrFinnUrl } = require('./jr/finn-query');
const { buildDossier, dossiersForChefs } = require('./jr/dossier');
const { installErpReadonly } = require('./jr/erp-readonly');

const liste3Car = {
  id: 4202,
  registration_number: 'el 54991',
  source: 'peasy',
  has_sd_comment: 1,
  has_description: 0,
  mileage: 104450, // poisoned list-mapping / XLSX cache — MUST be ignored
  drive_no_car_data: {
    mileage: 11820,
    model_series: 'Model 3',
    model_year: 2021,
  },
};

const detail = {
  car: {
    self_declaration: { comment: ' pent holdt ' },
    description: 'nyrekk',
  },
};

function chefCaller(name, car, det) {
  return buildOriginCv({ liste3Car: car, detail: det });
}

async function main() {
  assert.strictEqual(WRITES_ERP, false, 'writes_erp must be false');

  // km from liste 3 nested only
  assert.strictEqual(originKmFromListe3(liste3Car), 11820);
  assert.strictEqual(originKmFromListe3({ mileage: 104450 }), null);
  assert.strictEqual(originKmFromListe3({ driveNoCarData: { mileage: '9000' } }), 9000);

  const easy = chefCaller('easy', liste3Car, detail);
  const v3 = chefCaller('v3', liste3Car, detail);
  const v3g = chefCaller('v3g', liste3Car, detail);

  assert.strictEqual(easy.regnr, 'EL54991');
  assert.strictEqual(easy.erpId, 4202);
  assert.strictEqual(easy.km, 11820);
  assert.strictEqual(easy.source, 'peasy');
  assert.strictEqual(easy.model_series, 'Model 3');
  assert.strictEqual(easy.model_year, 2021);
  assert.strictEqual(easy.writes_erp, false);
  assert.ok(easy.has_sd_comment);
  assert.ok(easy.seller_comment.includes('pent holdt'));
  assert.ok(easy.seller_comment.includes('BILBESKRIVELSE:'));
  assert.ok(sameOriginCv(easy, v3));
  assert.ok(sameOriginCv(v3, v3g));
  assert.strictEqual(JSON.stringify(easy), JSON.stringify(v3));
  assert.strictEqual(JSON.stringify(v3), JSON.stringify(v3g));

  const identical = mergeSellerComment({
    car: { self_declaration: { comment: 'samme' }, description: 'samme' },
  });
  assert.strictEqual(identical, 'samme');
  assert.strictEqual(mergeSellerComment({}), '');

  // car.info identity never overwrites origin.km
  const ci = {
    result: {
      brand: 'Tesla',
      series: 'Model 3',
      model_year: 2021,
      mileage: 999999,
      km: 42,
    },
  };
  const ident = plateIdentityFromCarInfo(ci);
  assert.strictEqual(ident.make, 'Tesla');
  assert.ok(!Object.prototype.hasOwnProperty.call(ident, 'km'));
  const enriched = applyCarInfoIdentity(easy, ci);
  assert.strictEqual(enriched.km, 11820);
  assert.strictEqual(enriched.identity.make, 'Tesla');
  assert.notStrictEqual(enriched.km, ci.result.mileage);

  const locked = lockedKm(enriched, 104450);
  assert.strictEqual(locked, 11820);

  // Finn q = merke + modell, no year/km/kW
  const q = buildFinnQuery('Tesla 2021 150kW 20000 km', 'Model 3');
  assert.strictEqual(q, 'Tesla Model 3');
  const url = buildFinnUrl('Tesla', 'Model 3');
  assert.ok(url.includes('q=Tesla+Model+3') || url.includes('q=Tesla%20Model%203'));
  assert.ok(!/year_from|year_to|mileage_|engine_effect/.test(url));
  assertJrFinnUrl(url);
  assert.throws(() => assertJrFinnUrl('https://www.finn.no/mobility/search/car?q=Tesla&year_from=2020'));

  // no own_sold
  const comps = dropOwnSold([
    { licence_plate: 'AB12345', seller: 'Privat Bil AS', price: 100 },
    { licence_plate: 'PEASY1', seller: 'Peasy Oslo', price: 1, own_sold: false },
    { licence_plate: 'PEASY2', seller: 'Autoringen', price: 2 },
    { licence_plate: 'PEASY3', own_sold: true, seller: 'Random' },
  ]);
  assert.strictEqual(comps.length, 1);
  assert.strictEqual(comps[0].licence_plate, 'AB12345');
  assert.ok(isOwnSoldComp({ seller: 'Drive.no' }));

  const { shared, byChef } = dossiersForChefs({ originCv: easy, carInfo: ci });
  assert.strictEqual(shared.writes_erp, false);
  assert.strictEqual(shared.own_sold, false);
  assert.strictEqual(shared.trinn, 1);
  assert.strictEqual(shared.finn.year, null);
  assert.strictEqual(shared.finn.km, null);
  assert.strictEqual(shared.finn.kW, null);
  assert.strictEqual(shared.origin_cv.km, 11820);
  const bytes = ['easy', 'v3', 'v3g'].map(c => JSON.stringify(byChef[c].origin_cv));
  assert.strictEqual(bytes[0], bytes[1]);
  assert.strictEqual(bytes[1], bytes[2]);

  const dossier = buildDossier({
    originCv: easy,
    comps: [{ seller: 'Peasy', price: 9 }, { seller: 'Follo Auto', price: 8 }],
  });
  assert.strictEqual(dossier.comps.length, 1);
  assert.strictEqual(dossier.comps[0].seller, 'Follo Auto');

  const fetched = await originCv(4202, {
    fetchListe3Car: async () => liste3Car,
    fetchDetail: async () => detail,
  });
  assert.strictEqual(JSON.stringify(fetched), JSON.stringify(easy));

  // ERP write guard
  const blocked = [];
  const fakeFetch = async (url, opts = {}) => {
    blocked.push({ url, method: (opts.method || 'GET').toUpperCase() });
    return { ok: true, json: async () => ({ success: true }) };
  };
  const guarded = installErpReadonly(fakeFetch);
  const writeRes = await guarded('https://api.biladministrasjon.no/c2b_module/peasy/processing/update/1/final_estimate', {
    method: 'PUT',
    body: '{}',
  });
  assert.strictEqual(writeRes.ok, false);
  const body = await writeRes.json();
  assert.strictEqual(body.writes_erp, false);
  assert.strictEqual(blocked.length, 0);
  await guarded('https://api.biladministrasjon.no/c2b_module/peasy/processing/final_estimate?per_page=1', { method: 'GET' });
  assert.strictEqual(blocked.length, 1);

  console.log('ok — origin-CV identical for easy/v3/v3g, km=11820 (liste 3), writes_erp=false');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
