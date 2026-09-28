'use strict';

/**
 * Origin-identitet = Vegvesen/ERP + car.info.
 * Vegvesen/ERP låser førstegangsår og modellserie.
 * car.info fyller det de to ikke har: hybrid vs bensin, hk, gir, generasjon, motor, karosseri.
 */

function numYear(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 1980 && n < 2100 ? n : null;
}

function yearFromFirstReg(v) {
  const s = String(v || '');
  const m = s.match(/(19|20)\d{2}/);
  return m ? numYear(m[0]) : null;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function first(obj, keys) {
  const o = obj || {};
  for (let i = 0; i < keys.length; i++) {
    const v = o[keys[i]];
    if (v != null && v !== '') return v;
  }
  return null;
}

function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[æä]/g, 'ae')
    .replace(/[øö]/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function attrVal(attrs, re) {
  if (!Array.isArray(attrs)) return null;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i] || {};
    if (re.test(String(a.name || ''))) {
      const vals = a.values || [];
      const v0 = vals[0];
      const v = v0 && typeof v0 === 'object' ? v0.value : v0;
      if (v != null && v !== '' && String(v).toLowerCase() !== 'n/a' && String(v).toLowerCase() !== 'none') {
        return v;
      }
    }
    const child = attrVal(a.children, re);
    if (child != null) return child;
  }
  return null;
}

function girFromBlob(blob) {
  const t = fold(blob);
  if (/cvt/.test(t)) return 'CVT';
  if (/7g tronic|9g tronic|geartronic|dsg|tiptronic|s tronic|dct/.test(t)) return 'auto';
  if (/automat|auto\b/.test(t)) return 'auto';
  if (/manuell|manual|\bman\b/.test(t)) return 'manuell';
  return null;
}

function driveFromBlob(blob) {
  const t = fold(blob);
  if (/\b4matic\b|\bxdrive\b|\bquattro\b|\bawd\b|\b4wd\b|\bfirehjul|\ball wheel/.test(t)) return 'AWD';
  if (/\brwd\b|\bbakhjul|\brear wheel/.test(t)) return 'RWD';
  if (/\bfwd\b|\bforhjuls|\b2wd\b|\bfront wheel/.test(t)) return 'FWD';
  return null;
}

function fuelMoreSpecific(a, b) {
  const A = fold(a);
  const B = fold(b);
  if (!B) return a || null;
  if (!A) return b;
  const aHyb = /hybrid|phev|plugin|plug in/.test(A);
  const bHyb = /hybrid|phev|plugin|plug in/.test(B);
  const aEv = /elektr|\bev\b/.test(A) && !aHyb;
  const bEv = /elektr|\bev\b/.test(B) && !bHyb;
  if (bHyb && !aHyb) return b;
  if (bEv && !aEv) return b;
  if (/diesel/.test(B) && /bensin/.test(A) && !aHyb) return b;
  if (B.length > A.length && (B.indexOf(A) >= 0 || aHyb === bHyb)) return b;
  return a;
}

/**
 * Trekk ident-felt ut av car.info plate-API, V3G-wrapper eller result-objekt.
 */
function pickCarInfoIdent(carInfo) {
  if (!carInfo || typeof carInfo !== 'object') return {};
  const r = carInfo.result || (carInfo.raw && carInfo.raw.result) || carInfo;
  const car = r.car || r.vehicle || r;
  const val = car.valuation || r.valuation || carInfo.valuation || {};
  const cv = val.company_valuation || {};
  const fullName = car.car_name
    || (carInfo.summary && carInfo.summary.full_name)
    || cv.full_name
    || null;
  const blob = [
    fullName,
    car.sales_name,
    car.engine_name,
    car.model_gen_engine,
    car.engine_type,
    car.chassis,
  ].filter(Boolean).join(' ');
  const hk = numOrNull(car.horsepower)
    || numOrNull(carInfo.horsepower)
    || numOrNull(attrVal(car.attributes, /hestekrefter|horsepower|^hk$/i));
  const hkFromName = fullName && fullName.match(/(\d{2,3})\s*hk/i);
  return {
    make: car.brand || car.make || carInfo.make || carInfo.brand || null,
    // sales_name / RS 5 — not series (A5). Same rule as Jr plateIdentityFromCarInfo.
    model: car.sales_name || car.model || carInfo.sales_name || carInfo.model || car.series || car.model_series || carInfo.series || null,
    car_name: fullName,
    sales_name: car.sales_name || carInfo.sales_name || null,
    generation: car.generation || carInfo.generation || null,
    engine: car.engine_name || car.model_gen_engine || carInfo.engine_name || null,
    engine_type: car.engine_type || carInfo.engine_type || attrVal(car.attributes, /^drivstoff$/i) || null,
    hk: hk || (hkFromName ? Number(hkFromName[1]) : null),
    chassis: car.chassis || carInfo.chassis || car.body_type || null,
    gir: girFromBlob(blob) || girFromBlob(attrVal(car.attributes, /girkasse|gearbox/i) || ''),
    drivlinje: driveFromBlob(blob) || driveFromBlob(attrVal(car.attributes, /drivlinje|driven wheels|wheel drive/i) || ''),
    year: numYear(car.model_year || carInfo.model_year),
    vin: car.vin || carInfo.vin || null,
  };
}

function identForComps(locked, fallback) {
  const L = locked || {};
  const F = fallback || {};
  return {
    make: L.make || F.make || '',
    model: L.model || F.model || '',
    year: L.year || F.year || null,
    fuel: L.fuel || F.fuel || '',
    karosseri: L.karosseri || F.karosseri || '',
    drive: L.drivlinje || F.drive || '',
    gir: L.gir || F.gir || '',
    hk: L.hk || F.hk || null,
    range: L.range || F.range || null, // el/hybrid: rekkevidde er tvilling-proxy, ikke hk
    generation: L.generation || F.generation || null,
    engine: L.engine || F.engine || null,
    variant: L.variant || F.variant || null,
    car_name: L.car_name || F.car_name || null,
  };
}

function fuelKind(fuel, extra) {
  const t = fold([fuel, extra].filter(Boolean).join(' '));
  if (/plugin|plug in|phev|ladbar/.test(t)) return 'phev';
  if (/hybrid/.test(t)) return 'hybrid';
  if (/elektr|\bev\b/.test(t) && !/hybrid/.test(t)) return 'ev';
  if (/diesel/.test(t)) return 'diesel';
  if (/bensin|petrol/.test(t)) return 'petrol';
  return null;
}

function finnFuelCodesFromKind(kind) {
  if (kind === 'ev') return [4];
  if (kind === 'phev') return [6, 3];
  if (kind === 'hybrid') return [3];
  if (kind === 'diesel') return [2];
  if (kind === 'petrol') return [1];
  return [];
}

function modelQueryFromIdent(locked) {
  const L = locked || {};
  const model = String(L.model || '').trim();
  const variant = String(L.variant || L.sales_name || '').trim();
  const kind = fuelKind(L.fuel, [L.car_name, L.engine, variant].filter(Boolean).join(' '));
  let md = model;
  if (variant && model) {
    const vFold = fold(variant);
    const mTok = fold(model).split(/\s+/).filter(Boolean)[0];
    if (mTok && vFold.indexOf(mTok) >= 0) md = variant;
  }
  if ((kind === 'hybrid' || kind === 'phev') && !/hybrid|phev|plugin|plug.in|ladbar/i.test(md)) {
    md = (md + ' Hybrid').trim();
  }
  return md;
}

/**
 * Finn-søk fra låst ID. Samme q + filtre i Easy og V3G.
 * Hybrid får q «C-HR Hybrid», fuel=3, hk ±15 %, CVT → auto.
 */
function finnSearchFromIdent(locked) {
  const L = locked || {};
  const blob = [L.fuel, L.car_name, L.engine, L.variant].filter(Boolean).join(' ');
  const kind = fuelKind(L.fuel, blob);
  const modelQ = modelQueryFromIdent(L);
  const make = String(L.make || '')
    .replace(/\s*MOTORS\s*/i, '')
    .replace(/JAGUAR LAND ROVER LIMITED/i, 'Land Rover')
    .trim();
  const q = [make, modelQ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const hk = numOrNull(L.hk);
  const hkFrom = hk ? Math.max(1, Math.floor((hk * 0.85) / 10) * 10) : null;
  const hkTo = hk ? Math.ceil((hk * 1.15) / 10) * 10 : null;
  const gir = fold(L.gir);
  let transmission = null;
  if (/cvt|automat|auto\b|dsg|tiptronic|tronic|dct|geartronic/.test(gir)) transmission = '2';
  else if (/manuell|manual|\bman\b/.test(gir)) transmission = '1';
  const drive = fold(L.drivlinje || L.drive);
  const awd = /awd|4wd|4matic|xdrive|quattro|firehjul|all wheel/.test(drive);
  const knownDrive = awd || /fwd|rwd|2wd|forhjuls|bakhjul/.test(drive);
  return {
    make,
    modelQ,
    q,
    year: L.year || null,
    fuel: L.fuel || null,
    fuelKind: kind,
    fuelCodes: finnFuelCodesFromKind(kind),
    hk,
    hkFrom,
    hkTo,
    transmission,
    wheelDrive: awd ? ['2'] : (knownDrive ? ['1', '3'] : []),
    isHybrid: kind === 'hybrid' || kind === 'phev',
    isPhev: kind === 'phev',
    isEv: kind === 'ev',
    isFossil: kind === 'diesel' || kind === 'petrol',
  };
}

function lockOriginIdentity({ vegvesen, origin_cv, carInfo } = {}) {
  const cv = origin_cv || {};
  const vegCv = cv.vegvesen || {};
  const veg = Object.assign({}, vegCv, vegvesen || {});
  const ci = pickCarInfoIdent(carInfo);
  const jrIdent = (cv.identity && typeof cv.identity === 'object') ? cv.identity : {};

  const vegYear = numYear(veg.modelYear || veg.model_year || veg.year || veg.aar)
    || yearFromFirstReg(veg.firstReg || veg.first_reg || veg.forstegangsregistrert || veg.forstegang_reg);
  const cvYear = numYear(cv.model_year || cv.year || cv.aar);
  const year = vegYear || cvYear || jrIdent.year || ci.year || null;

  const make = jrIdent.make || first(veg, ['manufacturer', 'make', 'merke']) || cv.make || ci.make || null;
  const series = first(veg, ['modelSeries', 'model_series', 'modell', 'model'])
    || cv.model_series || cv.model || null;
  // Jr/sales_name (RS 5 Coupé, B 180) over Vegvesen-serie (A5, B-Klasse).
  const modelFilled = jrIdent.model || ci.model || series || null;

  const vegFuel = first(veg, ['drivstoff', 'fuel', 'fuelType', 'propulsion']) || cv.fuel || null;
  const fuel = fuelMoreSpecific(vegFuel, ci.engine_type);

  const vegHk = veg.hk != null ? numOrNull(veg.hk) : null;
  const hk = ci.hk || vegHk || null;

  const karosseri = first(veg, ['karosseri', 'body', 'body_type']) || ci.chassis || null;
  const gir = first(veg, ['gir', 'gearbox', 'gearbox_type', 'gearboxType']) || ci.gir || null;
  const drivlinje = first(veg, ['drivlinje', 'drive']) || ci.drivlinje || null;

  const usedCi = !!(ci.engine_type || ci.hk || ci.chassis || ci.gir || ci.generation || ci.engine);
  const vegLocked = !!(veg.modelSeries || veg.model_series || veg.modell || veg.model || cv.model_series || cv.model);

  return {
    make,
    model: modelFilled,
    year,
    fuel: fuel || null,
    drivlinje: drivlinje || null,
    karosseri: karosseri || null,
    gir: gir || null,
    hk: hk || null,
    generation: ci.generation || null,
    engine: ci.engine || null,
    variant: jrIdent.model || ci.sales_name || null,
    car_name: jrIdent.car_name || ci.car_name || [make, modelFilled].filter(Boolean).join(' ') || null,
    vin: ci.vin || null,
    locked_model: !!modelFilled,
    locked_year: !!(vegYear || cvYear),
    source: usedCi && vegLocked ? 'vegvesen/erp+car.info'
      : usedCi ? 'car.info'
        : vegLocked ? 'vegvesen/erp'
          : 'fallback',
  };
}

/** Overlay lock on car.info identity fields. Valuation/comps are kept. */
function applyOriginLock(carInfo, locked) {
  const base = carInfo && typeof carInfo === 'object' ? Object.assign({}, carInfo) : {
    valuation: {},
    source: 'origin-lock',
  };
  if (!carInfo) base.source = 'origin-lock';
  if (!locked) return base;
  if (locked.make) base.make = locked.make;
  if (locked.locked_model && locked.model) {
    base.model = locked.model;
    base.series = locked.model;
    base.car_name = locked.car_name || [locked.make, locked.model].filter(Boolean).join(' ');
  } else if (locked.model && !base.model) {
    base.model = locked.model;
  }
  if (locked.locked_year && locked.year) {
    base.model_year = locked.year;
    base.year = locked.year;
  } else if (locked.year && base.model_year == null && base.year == null) {
    base.model_year = locked.year;
    base.year = locked.year;
  }
  if (!base.car_name && locked.car_name) base.car_name = locked.car_name;
  if (locked.fuel) base.fuel = locked.fuel;
  if (locked.drivlinje && !base.drive) base.drive = locked.drivlinje;
  if (locked.karosseri && !base.body_type) base.body_type = locked.karosseri;
  if (locked.karosseri && !base.chassis) base.chassis = locked.karosseri;
  if (locked.hk && base.horsepower == null) base.horsepower = locked.hk;
  if (locked.gir && !base.gearbox) base.gearbox = locked.gir;
  if (locked.generation && !base.generation) base.generation = locked.generation;
  if (locked.engine && !base.engine_name) base.engine_name = locked.engine;
  return base;
}

module.exports = {
  lockOriginIdentity,
  applyOriginLock,
  pickCarInfoIdent,
  identForComps,
  finnSearchFromIdent,
  modelQueryFromIdent,
  fuelKind,
  yearFromFirstReg,
  numYear,
};

if (require.main === module) {
  const kj = lockOriginIdentity({
    vegvesen: { make: 'TOYOTA', model: 'C-HR', modelYear: 2017, fuel: 'Bensin', drive: 'FWD' },
    origin_cv: {
      model_series: 'C-HR',
      model_year: 2017,
      vegvesen: { merke: 'TOYOTA', modell: 'C-HR', aar: 2017, drivstoff: 'Bensin', drivlinje: 'FWD' },
    },
    carInfo: {
      brand: 'Toyota',
      series: 'C-HR',
      car_name: 'Toyota C-HR Hybrid CVT, 122hk, 2017',
      engine_type: 'Hybrid bensin',
      horsepower: 122,
      chassis: 'SUV',
      generation: 'AX10/AX50',
      engine_name: '1.8 VVT-i 2ZR-FXE (90 kW)',
      sales_name: 'C-HR Hybrid',
      model_year: 2016,
    },
  });
  const glk = lockOriginIdentity({
    vegvesen: { make: 'MERCEDES-BENZ', model: 'GLK-Klasse', modelYear: 2013, fuel: 'Diesel', drive: 'AWD' },
    carInfo: {
      brand: 'Mercedes-Benz',
      series: 'GLK-Klasse',
      car_name: 'Mercedes-Benz GLK 220 CDI 4MATIC 7G-Tronic Plus, 170hk, 2013',
      engine_type: 'Diesel',
      horsepower: 170,
      chassis: 'SUV',
      generation: 'X204 Facelift',
      engine_name: '2.2 OM651DE22LA 651921 4MATIC (125 kW)',
      sales_name: 'GLK 220 CDI 4MATIC',
    },
  });
  const kjQ = finnSearchFromIdent(kj);
  const glkQ = finnSearchFromIdent(glk);
  const ok = /hybrid/.test(fold(kj.fuel))
    && kj.hk === 122
    && kj.year === 2017
    && /c-?hr/i.test(kj.model)
    && /cvt|auto/i.test(String(kj.gir))
    && /suv/i.test(String(kj.karosseri))
    && kj.source === 'vegvesen/erp+car.info'
    && glk.hk === 170
    && glk.year === 2013
    && /diesel/.test(fold(glk.fuel))
    && glk.generation === 'X204 Facelift'
    && /hybrid/i.test(kjQ.modelQ)
    && kjQ.fuelCodes.indexOf(3) >= 0
    && kjQ.hkFrom === 100
    && kjQ.hkTo === 150
    && kjQ.transmission === '2'
    && glkQ.fuelCodes.indexOf(2) >= 0
    && glkQ.wheelDrive.indexOf('2') >= 0;
  const rs = lockOriginIdentity({
    vegvesen: { make: 'AUDI', model: 'A5', modelYear: 2011, fuel: 'Bensin', drive: 'AWD' },
    origin_cv: {
      model_series: 'A5',
      identity: { make: 'Audi', model: 'RS 5 Coupé', year: 2011, car_name: 'Audi RS 5 Coupé 4.2 FSI V8 quattro S Tronic, 7-trinn, 450hk, 2011' },
    },
    carInfo: {
      brand: 'Audi',
      series: 'A5',
      sales_name: 'RS 5 Coupé',
      car_name: 'Audi RS 5 Coupé 4.2 FSI V8 quattro S Tronic, 7-trinn, 450hk, 2011',
      horsepower: 450,
      chassis: 'Coupé',
    },
  });
  const rsQ = finnSearchFromIdent(rs);
  const rsOk = /rs\s*5/i.test(String(rs.model)) && /rs\s*5/i.test(String(rsQ.q || rsQ.modelQ));
  console.log(JSON.stringify({ kj, glk, kjQ, glkQ, rs, rsQ, ok: ok && rsOk }, null, 2));
  if (!ok || !rsOk) process.exit(1);
}
