'use strict';

/**
 * Peasy Jr — shared origin-CV (trinn 1).
 *
 * One function / one JSON for Easy, V3, V3G and Bot4. Same bytes for all chefs.
 * km is locked from ERP liste 3 nested drive_no_car_data.mileage only.
 * model_year is locked from ERP liste 3 nested drive_no_car_data.model_year
 * (førstegangsregistrering / årsmodell). Never Vegvesen year/aar, never
 * car.info identity.year, never chef-ident.
 * car.info plate identity may enrich make/model — it never writes origin.km
 * or origin.model_year.
 */

const WRITES_ERP = false;

const OWN_SOLD_SELLER_RE = /\b(peasy|autoringen|drive\.?no|driveno|ordna)\b/i;

function upperRegnr(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function asPositiveNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickNestedCarData(car) {
  if (!car || typeof car !== 'object') return null;
  return car.drive_no_car_data || car.driveNoCarData || null;
}

/**
 * Origin km from ERP liste 3 only.
 * Never XLSX km-cache, never list-mapping `mileage`, never car.info, never queue.
 */
function originKmFromListe3(car) {
  const nested = pickNestedCarData(car);
  if (!nested) return null;
  return asPositiveNumber(nested.mileage ?? nested.km ?? null);
}

/**
 * Origin model_year from ERP liste 3 only.
 * Locked field: drive_no_car_data.model_year (ERP førstegang).
 * Never top-level list-mapping model_year, never Vegvesen, never car.info.
 */
function originModelYearFromListe3(car) {
  const nested = pickNestedCarData(car);
  if (!nested) return null;
  return asPositiveNumber(nested.model_year ?? nested.modelYear ?? null);
}

function stripCompetingYear(identity) {
  if (!identity || typeof identity !== 'object') return identity || null;
  const next = { ...identity };
  delete next.year;
  delete next.aar;
  delete next.model_year;
  return next;
}

/**
 * origin_cv.model_year is the only year chefs may read.
 * Drop Vegvesen year/aar and car.info identity.year so they cannot compete.
 */
function lockOriginCvYears(originCv, lockedYear) {
  if (!originCv || typeof originCv !== 'object') return originCv;
  const year = asPositiveNumber(lockedYear);
  if (year) originCv.model_year = year;
  else delete originCv.model_year;
  delete originCv.year;
  delete originCv.aar;
  if (originCv.identity && typeof originCv.identity === 'object') {
    originCv.identity = stripCompetingYear(originCv.identity);
  }
  return originCv;
}

function detectSource(car, detail) {
  const raw = String(
    (car && (car.source || car.origin_source || car.channel)) ||
    (detail && (detail.source || detail.car && detail.car.source)) ||
    ''
  ).toLowerCase();
  if (raw.includes('driveno') || raw === 'drive') return 'driveno';
  if (raw.includes('ordna')) return 'ordna';
  if (raw.includes('peasy')) return 'peasy';
  return 'peasy';
}

function textOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function mergeSellerComment(detail, liste3Car) {
  const car = (detail && (detail.car || detail)) || {};
  const sdSelf = textOrNull(
    car.self_declaration && car.self_declaration.comment
  ) || textOrNull(detail && detail.self_declaration && detail.self_declaration.comment);
  const carDesc = textOrNull(car.description) || textOrNull(liste3Car && liste3Car.description);

  if (carDesc && sdSelf && carDesc === sdSelf) return sdSelf;
  if (carDesc && sdSelf) return sdSelf + '\n\nBILBESKRIVELSE: ' + carDesc;
  return sdSelf || carDesc || '';
}

function flagComment(comment) {
  const cmt = String(comment || '');
  const kjorbar = /reparasjonsobjekt|starter ikke|motor.*defekt|delebil|motorstopp|registerreim|totalskade/i.test(cmt)
    ? 'nei'
    : (cmt ? 'usikker' : 'ja');
  const signaler = /skade|lakk|rust|defekt|ulykke|hagl|soltak|taxi|naering/i.test(cmt);
  return { kjorbar, signaler };
}

function truthyFlag(value) {
  return value === true || value === 1 || value === '1';
}

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    out[k] = v;
  }
  return out;
}

function vegvesenLock(extras) {
  const veg = extras && extras.vegvesen;
  if (!veg || typeof veg !== 'object') return {};
  return omitEmpty({
    make: veg.make || undefined,
    model: veg.model || undefined,
    // year / aar / firstRegYear intentionally omitted — ERP model_year is the only origin year
    fuel: veg.fuel || undefined,
    hk: veg.hk || undefined,
    gearbox: veg.gearbox || undefined,
    drive: veg.drive || undefined,
    body: veg.body || veg.karosseri || undefined,
    firstReg: veg.firstReg || (veg.firstRegYear
      ? `${veg.firstRegYear}-${String(veg.firstRegMonth || 1).padStart(2, '0')}`
      : undefined),
    import: veg.import != null ? veg.import : (veg.bruktimport != null ? veg.bruktimport : undefined),
  });
}

/**
 * car.info plate identity — make/model only.
 * Year is not attached: identity.year must not compete with ERP model_year.
 * Explicitly refuses to copy any km field onto origin.
 */
function plateIdentityFromCarInfo(carInfo) {
  if (!carInfo || typeof carInfo !== 'object') return null;
  const result = carInfo.result || carInfo;
  const make = textOrNull(result.brand || result.make);
  const model = textOrNull(result.series || result.model || result.car_name);
  if (!make && !model) return null;
  return omitEmpty({
    source: 'car.info',
    make,
    model,
  });
}

function applyCarInfoIdentity(originCv, carInfo) {
  if (!originCv || typeof originCv !== 'object') {
    throw new Error('applyCarInfoIdentity: originCv required');
  }
  const lockedKm = originCv.km;
  const lockedYear = originCv.model_year;
  const identity = plateIdentityFromCarInfo(carInfo);
  const next = {
    ...originCv,
    identity: identity || stripCompetingYear(originCv.identity) || null,
  };
  if (identity) {
    if (!next.make && identity.make) next.make = identity.make;
    if (!next.model && identity.model) next.model = identity.model;
  }
  next.km = lockedKm;
  lockOriginCvYears(next, lockedYear);
  if (Object.prototype.hasOwnProperty.call(next, 'origin')) {
    next.origin = { ...next.origin, km: lockedKm };
    lockOriginCvYears(next.origin, lockedYear);
  }
  return next;
}

function buildOriginCv({ liste3Car, detail, extras } = {}) {
  const car = liste3Car || {};
  const nested = pickNestedCarData(car) || {};
  const erpId = car.id != null ? car.id : (car.erpId != null ? car.erpId : null);
  const km = originKmFromListe3(car);
  const modelYear = originModelYearFromListe3(car);
  const seller_comment = mergeSellerComment(detail, car);
  const flags = flagComment(seller_comment);
  const veg = vegvesenLock(extras || {});

  const cv = {
    regnr: upperRegnr(car.registration_number || car.regnr),
    erpId,
    source: detectSource(car, detail),
    km,
    seller_comment,
    has_sd_comment: truthyFlag(car.has_sd_comment) || !!textOrNull(
      (detail && detail.car && detail.car.self_declaration && detail.car.self_declaration.comment) ||
      (detail && detail.self_declaration && detail.self_declaration.comment)
    ),
    has_description: truthyFlag(car.has_description) || !!textOrNull(
      (detail && detail.car && detail.car.description) || (car.description)
    ),
    kjorbar: flags.kjorbar,
    signaler: flags.signaler,
    writes_erp: WRITES_ERP,
  };

  if (modelYear != null) cv.model_year = modelYear;
  if (nested.model_series) cv.model_series = String(nested.model_series);

  Object.assign(cv, veg);
  cv.km = km;
  lockOriginCvYears(cv, modelYear);

  if (extras && extras.eu_km != null) {
    const eu = asPositiveNumber(extras.eu_km);
    if (eu) cv.eu_km = eu;
  }
  if (extras && extras.eu_km_date) cv.eu_km_date = extras.eu_km_date;

  return cv;
}

function lockedKm(originCv, fallback) {
  if (originCv && originCv.km != null) {
    const n = Number(originCv.km);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : null;
}

function lockedModelYear(originCv, fallback) {
  if (originCv && originCv.model_year != null) {
    const n = Number(originCv.model_year);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : null;
}

function sameOriginCv(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isOwnSoldComp(comp) {
  if (!comp || typeof comp !== 'object') return false;
  if (comp.own_sold === true || comp.ownSold === true) return true;
  const seller = String(comp.seller || comp.company || comp.dealer || comp.seller_name || '');
  return OWN_SOLD_SELLER_RE.test(seller);
}

function dropOwnSold(comps) {
  return (comps || []).filter(c => !isOwnSoldComp(c));
}

async function originCv(erpId, opts = {}) {
  if (!opts.fetchListe3Car) {
    throw new Error('originCv: pass { liste3Car } or { fetchListe3Car } — Jr does not invent ERP rows');
  }
  const liste3Car = opts.liste3Car || await opts.fetchListe3Car(erpId);
  if (!liste3Car) throw new Error('originCv: no liste 3 car for erpId ' + erpId);
  const detail = opts.detail !== undefined
    ? opts.detail
    : (opts.fetchDetail ? await opts.fetchDetail(erpId) : null);
  return buildOriginCv({ liste3Car, detail, extras: opts.extras });
}

const api = {
  WRITES_ERP,
  originKmFromListe3,
  originModelYearFromListe3,
  mergeSellerComment,
  detectSource,
  plateIdentityFromCarInfo,
  applyCarInfoIdentity,
  buildOriginCv,
  originCv,
  lockedKm,
  lockedModelYear,
  lockOriginCvYears,
  sameOriginCv,
  isOwnSoldComp,
  dropOwnSold,
  flagComment,
  upperRegnr,
};

module.exports = api;
