'use strict';
/**
 * Origin comps.
 * Trinn 2: ett felles marked. Mappa = solgte fra car.info (samme kall som trinn 1) + aktive fra Finn.
 * Bygges én gang i ensure(). Easy og V3G henter ikke hvert sitt marked — de jobber i mappa.
 * Sjefer (origin-chefs) plukker ikke biler. De setter Finn-utpris mot mappa.
 * 0 eksterne comps + kundens annonse → Finn-utpris = annonse×0.95 (kun_kundens_annonse).
 * 0 comps uten annonse → skip_put. QA Send /qa/anker urørt.
 * Easy V7-stakk røres ikke her.
 */

const fs = require('fs');
const path = require('path');

const FRESH_MS = 90 * 86400000;
const ASK_CAP = 0.95;
const DOSSIER_DEFAULT = '/Users/bot/peasy-auto/jr/dossiers';

function dossierDir() {
  return process.env.JR_DOSSIER_DIR || DOSSIER_DEFAULT;
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] [origin-comps] ${msg}`);
}

function plate(p) {
  return String(p || '').toUpperCase().replace(/[\s-]/g, '');
}

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object') {
    if (v.amount != null) return num(v.amount);
    if (v.value != null) return num(v.value);
    if (v.price != null) return num(v.price);
    return null;
  }
  const n = Number(String(v).replace(/[\s\u00a0krKR]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round1000(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.round(x / 1000) * 1000;
}

function median(nums) {
  const a = nums.filter(n => Number.isFinite(n) && n > 0).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function parseDay(s) {
  if (!s) return null;
  const t = String(s).trim().slice(0, 10);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const no = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (no) return new Date(+no[3], +no[2] - 1, +no[1]);
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

function isFreshSold(d) {
  if (!d) return false;
  return (Date.now() - d.getTime()) <= FRESH_MS;
}

function isAuction(ad) {
  const blob = [ad && ad.title, ad && ad.status, ad && ad.sales_form, ad && ad.url, ad && ad.link].join(' ');
  return /auksjon|\bauction\b/i.test(blob);
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

function driveClass(s) {
  const t = fold(s);
  if (/\bxdrive\b|\b4matic\b|\bquattro\b|\bawd\b|\b4wd\b|\bfirehjul|\ball wheel/.test(t)) return 'awd';
  if (/\brwd\b|\bbakhjul|\brear wheel/.test(t)) return 'rwd';
  if (/\bfwd\b|\bforhjuls|\b2wd\b|\bfront wheel/.test(t)) return 'fwd';
  return null;
}

function girClass(s) {
  const t = fold(s);
  if (/automat|auto\b|geartronic|dsg|tiptronic|cvt|dct|s tronic/.test(t)) return 'auto';
  if (/manuell|manual|\bman\b/.test(t)) return 'man';
  return null;
}

function originSpec(o) {
  const ident = (o && (o.ident || o.veg || o.locked)) || {};
  const cv = (o && o.origin_cv && o.origin_cv.vegvesen) || {};
  const driveRaw = ident.drive || ident.drivlinje || cv.drivlinje || '';
  const hk = Number(ident.hk || ident.horsepower);
  return {
    make: fold(ident.make || ident.merke || cv.merke || ''),
    model: fold(ident.model || ident.model_series || ident.modell || cv.modell || ''),
    year: Number(ident.year || ident.model_year || ident.aar || cv.aar) || null,
    fuel: fold(ident.fuel || ident.drivstoff || ident.propulsion || cv.drivstoff || ''),
    body: fold(ident.karosseri || ident.body || ident.body_type || cv.karosseri || ''),
    drive: driveClass(driveRaw + ' ' + (ident.model || '')) || fold(driveRaw),
    gir: girClass(ident.gir || ident.gearbox || cv.gir || '') || fold(ident.gir || ident.gearbox || cv.gir || ''),
    hk: Number.isFinite(hk) && hk > 0 ? hk : null,
    // El og hybrid: rekkevidde (WLTP, elbilradar/Vegvesen) er proxy, aldri hk/kW.
    range: (function () { const r = parseInt(String(ident.range || ident.rekkevidde || ident.rekkevidde_wltp || ident.elbRekkevidde || cv.rekkevidde || '').replace(/[^0-9]/g, ''), 10); return Number.isFinite(r) && r > 0 ? r : null; })(),
    generation: ident.generation || null,
    engine: ident.engine || ident.engine_name || null,
    variant: ident.variant || ident.sales_name || null,
    car_name: ident.car_name || null,
  };
}

// El og hybrid: hk/kW er feil proxy (systemeffekt, overboost, Vegvesen = ofte bare forbrenningsmotor).
function elEllerHybrid(spec) {
  const t = ((spec && spec.fuel) || '') + ' ' + ((spec && spec.model) || '');
  return /elektr|\bev\b|hybrid|phev|plugin|plug in/.test(t);
}

function adRekkevidde(ad, blob) {
  const direkte = num(ad && (ad.range || ad.rekkevidde || ad.range_wltp));
  if (direkte) return direkte;
  const m = String(blob || '').match(/(\d{2,3})\s*km\s*(?:rekkevidde|wltp)|rekkevidde[^\d]{0,15}(\d{2,3})\s*km/);
  return m ? Number(m[1] || m[2]) : null;
}

function identLabel(spec) {
  if (!spec || !spec.model) return '';
  const elHyb = elEllerHybrid(spec);
  const hk = !elHyb && spec.hk ? spec.hk + 'hk' : '';
  const rk = elHyb && spec.range ? spec.range + 'km rekkevidde' : '';
  return [spec.make, spec.model, spec.year, spec.body, spec.fuel, spec.drive, spec.gir, hk, rk].filter(Boolean).join(' · ');
}

function lineFamily(modelFold) {
  const t = fold(modelFold);
  if (/\bglc\b/.test(t)) return 'glc';
  if (/\bgle\b/.test(t)) return 'gle';
  if (/\bgla\b/.test(t)) return 'gla';
  if (/\bglb\b/.test(t)) return 'glb';
  if (/\beqc\b/.test(t)) return 'eqc';
  if (/\beqe\b|\beq e\b/.test(t)) return 'eqe';
  if (/\bcla\b/.test(t)) return 'cla';
  if (/\bcls\b/.test(t)) return 'cls';
  if (/\bb[\s]?klasse|\bb250|\bb 250|\bb200/.test(t)) return 'b';
  if (/\bc[\s]?klasse|\bc300|\bc 300|\bc200|\bc 200/.test(t)) return 'c';
  if (/\ba[\s]?klasse|\ba250|\ba 250/.test(t)) return 'a';
  if (/\be[\s]?klasse|\be300|\be 300|\be200|\be 220|\be350|\be 350/.test(t)) return 'e';
  if (/\bniro\b/.test(t)) return 'niro';
  if (/\ba4\b/.test(t)) return 'a4';
  if (/\ba6\b/.test(t)) return 'a6';
  return null;
}

const FAMILY_RE = {
  glc: /\bglc\b/,
  gle: /\bgle\b/,
  gla: /\bgla\b/,
  glb: /\bglb\b/,
  eqc: /\beqc\b/,
  eqe: /\beqe\b|\beq e\b/,
  cla: /\bcla\b/,
  cls: /\bcls\b/,
  b: /\bb[\s]?klasse|\bb250|\bb 250|\bb200/,
  c: /\bc[\s]?klasse|\bc300|\bc 300|\bc200|\bc 200/,
  a: /\ba[\s]?klasse|\ba250|\ba 250/,
  e: /\be[\s]?klasse|\be300|\be 300|\be200|\be 220|\be350/,
  niro: /\bniro\b/,
  a4: /\ba4\b/,
  a6: /\ba6\b/,
};

function parseTitleSignals(title) {
  const t = String(title || '');
  const hkM = t.match(/(\d{2,3})\s*hk/i);
  const yM = t.match(/\b((?:19|20)\d{2})\b/);
  let fuel = null;
  if (/hybrid|phev|plugin|plug-?in|ladbar/i.test(t)) fuel = 'hybrid';
  else if (/diesel/i.test(t)) fuel = 'diesel';
  else if (/\bbensin\b/i.test(t)) fuel = 'bensin';
  else if (/elektr|\bev\b/i.test(t)) fuel = 'el';
  return {
    hk: hkM ? Number(hkM[1]) : null,
    year: yM ? Number(yM[1]) : null,
    fuel,
    gir: girClass(t),
    drive: driveClass(t),
  };
}

function adBlob(ad) {
  return fold([
    ad && ad.title,
    ad && ad.model,
    ad && ad.brand,
    ad && ad.heading,
    ad && ad.tittel,
    ad && ad.body_type,
    ad && ad.karosseri,
    ad && ad.fuel,
    ad && ad.drivstoff,
    ad && ad.drive,
    ad && ad.drivlinje,
    ad && ad.gearbox,
    ad && ad.gir,
    ad && ad.hk ? (ad.hk + ' hk') : '',
    ad && ad.horsepower ? (ad.horsepower + ' hk') : '',
  ].join(' '));
}

function rejectGrunn(ad, spec) {
  const blob = adBlob(ad);
  const named = blob.length > 2;
  const src = String((ad && ad.source) || '');
  if (!spec || !spec.model) return null;
  if (!named) {
    if (/carinfo/.test(src)) return null;
    return 'ingen tittel';
  }
  const fam = lineFamily(spec.model);
  if (fam) {
    for (const k of Object.keys(FAMILY_RE)) {
      if (k === fam) continue;
      if (FAMILY_RE[k].test(blob) && !FAMILY_RE[k].test(spec.model)) return 'annen linje (' + k + ')';
    }
  }
  if (fam && FAMILY_RE[fam] && !FAMILY_RE[fam].test(blob)) {
    const y = spec.year;
    const ym = blob.match(/\b(20\d{2})\b/);
    const adY = num(ad && ad.year) || (ym ? Number(ym[1]) : null);
    const yearOk = !y || !adY || Math.abs(adY - y) <= 2;
    const originSedan = /sedan/.test(spec.body) || fam === 'e';
    const originSuv = /suv|offroad/.test(spec.body) || /glc|gle|gla|eqc/.test(spec.model);
    const bodyOk = originSuv ? /suv|offroad|glc|gle/.test(blob) : (!originSedan || /sedan/.test(blob) || /carinfo/.test(src));
    const makeTok = spec.make.split(/\s+/)[0];
    const makeOk = !makeTok || blob.indexOf(makeTok) >= 0 || /carinfo/.test(src);
    if (!(/carinfo/.test(src) || (yearOk && bodyOk && makeOk))) return 'ikke ' + fam;
  } else if (!fam) {
    const toks = spec.model.split(/\s+/).filter(function (t) {
      return t.length >= 2 && !/^(4matic|amg|line|quattro|xdrive|hybrid|phev|4wd|awd)$/.test(t);
    });
    if (toks.length && !toks.some(function (t) { return blob.indexOf(t) >= 0; })) return 'modell matcher ikke';
  }
  const originSuv = /suv|offroad|crossover/.test(spec.body) || /glc|gle|gla|eqc/.test(spec.model);
  const originStv = /stasjonsvogn|touring|avant|t modell/.test(spec.body + ' ' + spec.model);
  const originSedan = /sedan/.test(spec.body) || (!originSuv && !originStv && fam === 'e');
  if (originSedan && /\bsuv\b|offroad|\bglc\b|\bgle\b|\beqc\b/.test(blob)) return 'ikke sedan';
  if (originSedan && /stasjonsvogn|touring|t modell|t-modell/.test(blob)) return 'stasjonsvogn';
  const originDiesel = /diesel/.test(spec.fuel);
  const originPhev = /hybrid|phev|plugin|plug in/.test(spec.fuel + ' ' + spec.model);
  const originEv = /elektr|\bev\b/.test(spec.fuel) && !originPhev;
  if (originPhev && !originDiesel && /diesel|300 de|300de/.test(blob)) return 'diesel';
  if (originEv && /hybrid|diesel|bensin|phev/.test(blob)) return 'ikke el';
  if (originPhev && /\beqc\b|\beqe\b/.test(blob)) return 'el-suv';
  const adHybrid = /hybrid|phev|plugin|plug in/.test(blob);
  const adSaysPetrol = /\bbensin\b/.test(blob) && !adHybrid;
  if (originPhev && adSaysPetrol) return 'ikke hybrid';
  if (!originPhev && !originDiesel && !originEv && /bensin/.test(spec.fuel || '') && adHybrid) return 'hybrid';
  if (originEv || originPhev) {
    // El/hybrid: aldri hk/kW. Rekkevidde når begge er kjent (el 15 %, hybrid 30 % og minst 15 km).
    const oR = Number(spec.range);
    const aR = adRekkevidde(ad, blob);
    if (oR && aR) {
      const grense = originEv ? oR * 0.15 : Math.max(15, oR * 0.30);
      if (Math.abs(oR - aR) > grense) return 'rekkevidde ' + aR + ' km';
    }
  } else {
    const originHk = Number(spec.hk);
    const adHkM = blob.match(/(\d{2,3})\s*hk/);
    const adHk = num(ad && (ad.horsepower || ad.hk)) || (adHkM ? Number(adHkM[1]) : null);
    if (originHk && adHk && Math.abs(originHk - adHk) > Math.max(20, originHk * 0.15)) return 'hk ' + adHk;
  }
  const y = spec.year;
  const ym = blob.match(/\b(20\d{2})\b/);
  const adY = num(ad && ad.year) || (ym ? Number(ym[1]) : null);
  if (y && adY && Math.abs(adY - y) > 2) return 'år ' + adY;
  const od = driveClass((spec.drive || '') + ' ' + (spec.model || ''));
  const adDrive = driveClass(blob);
  if (od && adDrive && od !== adDrive) return 'drivlinje ' + adDrive;
  const og = girClass(spec.gir || '');
  const ag = girClass(blob);
  if (og && ag && og !== ag) return 'gir ' + ag;
  return null;
}

function keepTwin(ad, spec) {
  return rejectGrunn(ad, spec) == null;
}

function collectClassifieds(carInfo) {
  if (!carInfo) return [];
  const val = carInfo.valuation || carInfo;
  const cv = val.company_valuation || {};
  const lists = []
    .concat(val.company_classifieds || [])
    .concat(val.private_classifieds || [])
    .concat(cv.classifieds || [])
    .concat((cv.result && cv.result.classifieds) || [])
    .concat(carInfo.company_classifieds || [])
    .concat(carInfo.private_classifieds || [])
    .concat(carInfo.comps || []);
  return lists.filter(a => a && typeof a === 'object');
}

function normAd(ad, source) {
  const price = num(ad.price) || num(ad.classified_price) || num(ad.ask) || num(ad.finn_price) || num(ad.pris);
  const km = num(ad.km) || num(ad.mileage_km) || num(ad.mileage);
  const sold = parseDay(ad.ca_sold_date || ad.sold_date || ad.sold || ad.solgt);
  const removed = parseDay(ad.classified_removed_date || ad.removed_date);
  const published = parseDay(ad.classified_published_date || ad.published_date);
  const days = ad.days != null ? Number(ad.days) : (sold && published ? Math.round((sold - published) / 86400000) : null);
  const url = ad.url || ad.classified_url || ad.finn_url || ad.link || null;
  const title = ad.title || ad.classified_title || ad.heading || ad.tittel || null;
  const parsed = parseTitleSignals(title);
  const pl = plate(ad.licence_plate || ad.regnr || ad.plate);
  const seller = ad.type || ad.seller || (source === 'carinfo-private' ? 'privat' : (source === 'carinfo-company' || source === 'finn' ? 'forhandler' : null));
  return {
    price, km, sold_date: sold ? sold.toISOString().slice(0, 10) : null,
    removed: !!removed, published: published ? published.toISOString().slice(0, 10) : null,
    days: Number.isFinite(days) ? days : null,
    url, title, plate: pl, seller, source, raw_status: ad.status || null,
    auction: isAuction(ad),
    model: ad.model || ad.modell || null,
    year: num(ad.year) || num(ad.model_year) || num(ad.aar) || parsed.year,
    brand: ad.brand || ad.make || ad.merke || null,
    body_type: ad.body_type || ad.karosseri || ad.chassis || null,
    fuel: ad.fuel || ad.drivstoff || parsed.fuel,
    hk: num(ad.horsepower || ad.hk) || parsed.hk,
    gir: ad.gir || ad.gearbox || ad.trans || parsed.gir,
    drive: ad.drive || ad.drivlinje || parsed.drive,
  };
}

function splitCarinfo(carInfo, originPlate) {
  const orig = plate(originPlate);
  const all = collectClassifieds(carInfo).map(function (a) {
    const src = (a.type === 'privat' || a.seller === 'privat' || a.source === 'carinfo-private')
      ? 'carinfo-private'
      : (a.source === 'finn' ? 'finn' : 'carinfo-company');
    return normAd(a, src);
  }).filter(a => a.price);
  const own_sold = [];
  const sold = [];
  const asking = [];
  for (const a of all) {
    if (a.plate && orig && a.plate === orig) {
      own_sold.push(a);
      continue;
    }
    if (a.sold_date && isFreshSold(parseDay(a.sold_date))) sold.push(a);
    else if (!a.sold_date && !a.removed) asking.push(a);
  }
  return { own_sold, sold, asking };
}

function fromFinnPool(pool, originPlate) {
  const orig = plate(originPlate);
  const out = [];
  (pool || []).forEach(function (c) {
    const a = normAd(c, 'finn');
    if (!a.price) return;
    if (a.plate && orig && a.plate === orig) return;
    const st = String(c.status || a.raw_status || '').toLowerCase();
    if (a.sold_date && isFreshSold(parseDay(a.sold_date))) {
      a.status = 'solgt';
      out.push(a);
    } else if (/solgt/.test(st)) {
      a.status = 'solgt';
      out.push(a);
    } else if (/aktiv/.test(st) || (!st && !a.sold_date && !a.removed)) {
      a.status = 'aktiv';
      out.push(a);
    }
  });
  return out;
}

function originActiveSales(originFinn) {
  if (!originFinn) return null;
  const sold = originFinn.sold || originFinn.ca_sold_date || originFinn.sold_date;
  if (sold) return null;
  const st = String(originFinn.status || '').toLowerCase();
  if (/solgt|fjernet|removed/.test(st)) return null;
  const price = num(originFinn.price) || num(originFinn.ask);
  if (!price) return null;
  const ad = {
    price,
    km: num(originFinn.km),
    url: originFinn.link || originFinn.url || originFinn.classified_url,
    title: originFinn.title || originFinn.status,
    auction: isAuction(originFinn),
    status: 'aktiv',
  };
  return ad;
}

function computeUtpris(lib) {
  const sold = (lib.sold_under_3m || []).filter(a => a.price && !a.auction);
  const ask = (lib.finn_now || []).filter(a => a.price && !a.auction);
  const n_external = sold.length + ask.length;
  if (n_external === 0) {
    const origin0 = lib.origin_on_finn;
    if (origin0 && origin0.price && !origin0.auction) {
      const ap = Number(origin0.price);
      return {
        finn_utpris: round1000(ap * ASK_CAP),
        kilde: 'kun_kundens_annonse',
        finn_utpris_grunn: 'kun kundens annonse',
        annonsepris: ap,
        skip_put: false,
        n_external: 0,
        n_sold: 0,
        n_ask: 0,
        low_confidence: true,
      };
    }
    return { finn_utpris: null, kilde: null, skip_put: true, n_external: 0, n_sold: 0, n_ask: 0 };
  }
  let raw = null;
  let kilde = null;
  const soldPrices = sold.map(a => a.price);
  const askSorted = ask.slice().sort((a, b) => a.price - b.price);
  const cheap3 = askSorted.slice(0, 3).map(a => a.price);
  if (soldPrices.length >= 3) {
    raw = median(soldPrices);
    kilde = 'median_sold';
  } else if (soldPrices.length >= 1 && cheap3.length >= 1) {
    raw = median(soldPrices.concat(cheap3));
    kilde = 'sold+ask';
  } else if (cheap3.length >= 3) {
    raw = median(cheap3);
    kilde = 'median_now_3cheap';
  } else if (soldPrices.length >= 1) {
    raw = median(soldPrices);
    kilde = 'sold_thin';
  } else {
    raw = median(cheap3);
    kilde = 'ask_thin';
  }
  const origin = lib.origin_on_finn;
  // Tak: 0.95 × live origin-ask, også når comps = ask (70k ask → 67k, ikke 70k).
  if (origin && origin.price && !origin.auction) {
    const cap = origin.price * ASK_CAP;
    if (raw > cap) {
      raw = cap;
      kilde += '+origin95';
    }
  }
  return {
    finn_utpris: round1000(raw),
    kilde,
    skip_put: false,
    n_external,
    n_sold: sold.length,
    n_ask: ask.length,
  };
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const a of list || []) {
    const k = (a.url || '') + '|' + a.price + '|' + a.km;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

function build(opts) {
  const o = opts || {};
  const originPlate = o.regnr;
  const spec = originSpec(o);
  const ci = splitCarinfo(o.carInfo, originPlate);
  const finnAds = fromFinnPool(o.finnPool, originPlate);
  const rejected = [];
  function gate(list) {
    const keep = [];
    (list || []).forEach(function (a) {
      const why = rejectGrunn(a, spec);
      if (why) {
        rejected.push({
          licence_plate: a.plate || null,
          price: a.price,
          title: a.title || null,
          grunn: 'ikke tvilling: ' + why,
          finn_url: a.url || null,
        });
        return;
      }
      keep.push(a);
    });
    return keep;
  }
  const finnNow = dedupe(gate(finnAds.filter(a => a.status === 'aktiv' || (!a.sold_date && !a.removed)).concat(ci.asking)));
  const sold = dedupe(gate(finnAds.filter(a => a.status === 'solgt' && a.sold_date && isFreshSold(parseDay(a.sold_date))).concat(ci.sold)));
  const originAd = originActiveSales(o.originFinn);
  const lib = {
    finn_now: finnNow,
    sold_under_3m: sold,
    origin_on_finn: originAd,
    own_sold: ci.own_sold,
  };
  const ut = computeUtpris(lib);
  const rec = {
    schema: 'peasy-origin-comps/v3',
    built_at: new Date().toISOString(),
    internnr: o.erpId != null ? o.erpId : null,
    regnr: plate(originPlate),
    km: o.km != null ? Number(o.km) : null,
    ident_label: identLabel(spec),
    ident: {
      make: spec.make,
      model: spec.model,
      year: spec.year,
      fuel: spec.fuel,
      body: spec.body,
      drive: spec.drive,
      gir: spec.gir,
      hk: spec.hk,
      generation: spec.generation,
      engine: spec.engine,
      variant: spec.variant,
      car_name: spec.car_name,
    },
    listings: lib,
    n_external: ut.n_external,
    n_sold: ut.n_sold,
    n_ask: ut.n_ask,
    n_rejected: rejected.length,
    n_own_sold: (ci.own_sold || []).length,
    finn_utpris: ut.finn_utpris,
    finn_utpris_kilde: ut.kilde,
    finn_utpris_grunn: ut.finn_utpris_grunn || (ut.kilde === 'kun_kundens_annonse' ? 'kun kundens annonse' : null),
    annonsepris: ut.annonsepris != null ? ut.annonsepris : null,
    low_confidence: !!ut.low_confidence || ut.kilde === 'kun_kundens_annonse',
    always_qa: !!ut.always_qa || ut.kilde === 'kun_kundens_annonse',
    skip_put: !!ut.skip_put,
    rejected: rejected.slice(0, 40),
  };
  return rec;
}

function recPriced(rec) {
  if (!rec) return false;
  if (rec.chefs && rec.chefs.merge && rec.chefs.merge.finn_utpris > 0) return true;
  return rec.finn_utpris > 0 && !rec.skip_put;
}

function recHasMarket(rec) {
  if (!rec || rec.skip_put) return false;
  const n = (Number(rec.n_sold) || 0) + (Number(rec.n_ask) || 0);
  if (n > 0) return true;
  const lib = rec.listings || {};
  return ((lib.sold_under_3m || []).length + (lib.finn_now || []).length) > 0;
}

function plateCarInfo(opts) {
  try {
    const cache = require('./carinfo-plate-cache');
    const hit = cache.readCache(opts && opts.regnr);
    if (hit && hit.raw) return hit.raw.result || hit.raw;
  } catch (e) {}
  return (opts && opts.carInfo) || null;
}

async function fetchFinnMarket(opts) {
  const o = opts || {};
  const { buildSisterSearch } = require('./finn-origin');
  const { finnSearchFromIdent } = require('./origin-lock');
  const ident = o.ident || {};
  const locked = o.locked || ident;
  const search = o.finnSearch || finnSearchFromIdent(locked);
  const sister = await buildSisterSearch({
    make: ident.make || locked.make,
    model: ident.model || locked.model,
    year: ident.year || locked.year,
    km: o.km,
    klasse: o.klasse || 'personbil',
    fuel: ident.fuel || locked.fuel,
    gearbox: ident.gir || locked.gir,
    hk: ident.hk || locked.hk,
    drive: ident.drive || locked.drivlinje || locked.drive,
    variant: ident.variant || locked.variant,
    car_name: ident.car_name || locked.car_name,
    engine: ident.engine || locked.engine,
    originLink: o.originFinn && (o.originFinn.link || o.originFinn.url),
    search: search,
  });
  const n = (sister && sister.comps && sister.comps.length) || 0;
  log((o.regnr || '?') + ' finn-marked ' + n + ' aktive' + (sister && sister.url ? ' ' + sister.url : ''));
  return (sister && sister.comps) || [];
}

function persist(rec, opts) {
  if (!rec || rec.internnr == null || !rec.regnr) return null;
  const replaceUtpris = !!(opts && opts.replaceUtpris);
  try {
    if (!fs.existsSync(dossierDir())) fs.mkdirSync(dossierDir(), { recursive: true });
    const fp = path.join(dossierDir(), rec.internnr + '-' + rec.regnr + '.json');
    let prev = {};
    if (fs.existsSync(fp)) {
      try { prev = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { prev = {}; }
    }
    const prevRec = prev.origin_comps || {};
    if (recPriced(prevRec) && !replaceUtpris) {
      if (rec.skip_put || !recPriced(rec)) {
        log((rec.regnr || '?') + ' persist hopper skip_put/tom — første merge står');
        return fp;
      }
      if (prevRec.chefs && prevRec.chefs.merge && prevRec.chefs.merge.finn_utpris > 0) {
        rec.chefs = prevRec.chefs;
        rec.finn_utpris = prevRec.finn_utpris;
        rec.finn_utpris_kilde = prevRec.finn_utpris_kilde;
        rec.skip_put = false;
        rec.listings = prevRec.listings;
        rec.n_sold = prevRec.n_sold;
        rec.n_ask = prevRec.n_ask;
        rec.n_external = prevRec.n_external;
        rec.n_rejected = prevRec.n_rejected;
        rec.rejected = prevRec.rejected;
        rec.ident = prevRec.ident || rec.ident;
        rec.ident_label = prevRec.ident_label || rec.ident_label;
      }
    }
    if (rec.skip_put && !recPriced(prevRec)) {
      log((rec.regnr || '?') + ' persist skip_put ikke delt');
      return null;
    }
    const out = Object.assign({}, prev, {
      origin_comps: rec,
      finn_utpris: rec.finn_utpris,
      finn_utpris_kilde: rec.finn_utpris_kilde,
      finn_utpris_grunn: rec.finn_utpris_grunn || null,
      annonsepris: rec.annonsepris != null ? rec.annonsepris : null,
      skip_put: rec.skip_put,
      origin_comps_at: rec.built_at,
    });
    fs.writeFileSync(fp, JSON.stringify(out, null, 2));
    return fp;
  } catch (e) {
    log('persist: ' + (e && e.message));
    return null;
  }
}

function readOriginRec(fp) {
  try {
    const prev = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rec = prev && prev.origin_comps;
    if (!rec || (rec.schema !== 'peasy-origin-comps/v2' && rec.schema !== 'peasy-origin-comps/v3')) return null;
    return rec;
  } catch (e) {
    return null;
  }
}

function plateDossierFiles(regnr) {
  const p = plate(regnr);
  const out = [];
  try {
    const files = fs.readdirSync(dossierDir());
    for (const f of files) {
      if (f.endsWith('-' + p + '.json')) out.push(path.join(dossierDir(), f));
    }
  } catch (e) {}
  return out;
}

function loadShared(opts) {
  if (!opts || !opts.regnr) return null;
  const p = plate(opts.regnr);
  const primary = opts.erpId != null ? path.join(dossierDir(), opts.erpId + '-' + p + '.json') : null;
  const files = plateDossierFiles(p);
  if (primary && fs.existsSync(primary) && files.indexOf(primary) < 0) files.unshift(primary);
  let firstChefs = null;
  let firstBuilt = null;
  let mech = null;
  for (const fp of files) {
    const rec = readOriginRec(fp);
    if (!rec) continue;
    if (rec.chefs && rec.chefs.merge && rec.chefs.merge.finn_utpris > 0) {
      const built = rec.built_at || rec.origin_comps_at || '';
      if (!firstChefs || built < firstBuilt) {
        firstChefs = rec;
        firstBuilt = built;
      }
    } else if (!mech && rec.finn_utpris > 0 && !rec.skip_put) {
      mech = rec;
    }
  }
  if (firstChefs) return firstChefs;
  if (!mech) return null;
  if (opts.erpId == null) return mech;
  const label = identLabel(originSpec(opts));
  if (label && mech.ident_label && mech.ident_label !== label) return null;
  return mech;
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function withLock(opts, fn) {
  if (!opts || opts.erpId == null || !opts.regnr) return fn();
  if (!fs.existsSync(dossierDir())) fs.mkdirSync(dossierDir(), { recursive: true });
  const dir = path.join(dossierDir(), '.lock-' + opts.erpId + '-' + plate(opts.regnr));
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const st = fs.statSync(dir);
        if (Date.now() - st.mtimeMs > 180000) fs.rmdirSync(dir);
      } catch (e2) {}
      if (Date.now() - start > 120000) {
        log('lock timeout ' + (opts.regnr || ''));
        break;
      }
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.rmdirSync(dir); } catch (eU) {}
  }
}

function apply(opts) {
  const shared = loadShared(opts);
  if (shared) {
    log((opts.regnr || '?') + ' SHARED utpris=' + (shared.finn_utpris || '—') + ' kilde=' + (shared.finn_utpris_kilde || 'tom') + ' sold=' + shared.n_sold + ' ask=' + shared.n_ask);
    return shared;
  }
  const rec = build(opts);
  const fp = rec.skip_put ? null : persist(rec);
  log(
    (opts.regnr || '?') +
    ' n_ext=' + rec.n_external +
    ' sold=' + rec.n_sold +
    ' ask=' + rec.n_ask +
    ' kastet=' + rec.n_rejected +
    ' own=' + rec.n_own_sold +
    ' utpris=' + (rec.finn_utpris || '—') +
    ' kilde=' + (rec.finn_utpris_kilde || 'tom') +
    (rec.skip_put ? ' SKIP_PUT' : '') +
    (fp ? ' file=' + fp : '')
  );
  return rec;
}

async function ensure(opts) {
  const o = opts || {};
  return withLock(o, async function () {
    const shared = loadShared(o);
    if (shared && recHasMarket(shared)) {
      log((o.regnr || '?') + ' SHARED mappe sold=' + shared.n_sold + ' ask=' + shared.n_ask + ' utpris=' + (shared.finn_utpris || '—'));
      return shared;
    }
    const carInfo = plateCarInfo(o) || o.carInfo;
    let finnPool = Array.isArray(o.finnPool) && o.finnPool.length ? o.finnPool : null;
    if (finnPool) {
      log((o.regnr || '?') + ' finn-pool gitt (' + finnPool.length + ') — hopper eget Finn-sok');
    } else {
      try {
        finnPool = await fetchFinnMarket(o);
      } catch (e) {
        log((o.regnr || '?') + ' finn-marked: ' + (e && e.message));
        finnPool = [];
      }
    }
    const rec = build(Object.assign({}, o, { carInfo: carInfo, finnPool: finnPool }));
    const fp = rec.skip_put ? null : persist(rec);
    log(
      (o.regnr || '?') +
      ' mappe n_ext=' + rec.n_external +
      ' sold=' + rec.n_sold +
      ' ask=' + rec.n_ask +
      ' kastet=' + rec.n_rejected +
      ' own=' + rec.n_own_sold +
      ' utpris=' + (rec.finn_utpris || '—') +
      ' kilde=' + (rec.finn_utpris_kilde || 'tom') +
      (rec.skip_put ? ' SKIP_PUT' : '') +
      (fp ? ' file=' + fp : '')
    );
    return rec;
  });
}

function toValgte(rec) {
  const out = [];
  for (const a of (rec && rec.listings && rec.listings.sold_under_3m) || []) {
    out.push({
      licence_plate: a.plate || null,
      price: a.price,
      km: a.km,
      status: 'solgt',
      finn_url: a.url || null,
      title: a.title || null,
      source: a.source,
      sold_date: a.sold_date || null,
      days: a.days,
    });
  }
  for (const a of (rec && rec.listings && rec.listings.finn_now) || []) {
    out.push({
      licence_plate: a.plate || null,
      price: a.price,
      km: a.km,
      status: 'aktiv',
      finn_url: a.url || null,
      title: a.title || null,
      source: a.source,
    });
  }
  return out;
}

function toOwnExcluded(rec) {
  return ((rec && rec.listings && rec.listings.own_sold) || []).map(function (a) {
    return {
      licence_plate: a.plate || null,
      price: a.price,
      km: a.km,
      grunn: 'origin/eget skilt',
      sold_date: a.sold_date || null,
      finn_url: a.url || null,
    };
  });
}

function toRejected(rec) {
  return (rec && rec.rejected) || [];
}

function persistQaUtpris(opts) {
  const o = opts || {};
  const internnr = o.internnr != null ? o.internnr : o.erpId;
  const n = round1000(o.anker != null ? o.anker : o.finn_utpris);
  const p = plate(o.regnr);
  if (internnr == null || internnr === '' || !p || !(n > 0)) return null;
  const rec = {
    schema: 'peasy-origin-comps/v3',
    internnr: internnr,
    erpId: internnr,
    regnr: p,
    built_at: new Date().toISOString(),
    finn_utpris: n,
    finn_utpris_kilde: 'qa',
    skip_put: false,
    n_external: 0,
    n_sold: 0,
    n_ask: 0,
    n_own_sold: 0,
    n_rejected: 0,
    chefs: {
      merge: {
        finn_utpris: n,
        method: 'qa',
        begrunnelse: 'QA manuell Finn-utpris',
      },
    },
  };
  const fp = persist(rec, { replaceUtpris: true });
  if (fp) log(p + ' QA utpris=' + n + ' file=' + fp);
  return rec;
}

module.exports = { build, apply, ensure, persist, persistQaUtpris, loadShared, withLock, recPriced, recHasMarket, toValgte, toOwnExcluded, toRejected, keepTwin, rejectGrunn, FRESH_MS, ASK_CAP };

if (require.main === module) {
  const iso = function (daysAgo) {
    return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  };
  const rec = build({
    erpId: 1,
    regnr: 'BT28045',
    km: 100000,
    originFinn: { price: 189000, status: 'aktiv', title: 'BMW' },
    finnPool: [
      { price: 199000, km: 90000, status: 'aktiv', url: 'https://finn.no/1', licence_plate: 'XX1' },
      { price: 195000, km: 110000, status: 'aktiv', url: 'https://finn.no/2', licence_plate: 'XX2' },
      { price: 185000, km: 120000, status: 'aktiv', url: 'https://finn.no/3', licence_plate: 'XX3' },
    ],
    carInfo: {
      valuation: {
        company_classifieds: [
          { classified_price: 180000, mileage_km: 100000, ca_sold_date: iso(10), licence_plate: 'AA11111', url: 'https://finn.no/s1' },
          { classified_price: 175000, mileage_km: 105000, ca_sold_date: iso(20), licence_plate: 'BB22222', url: 'https://finn.no/s2' },
          { classified_price: 190000, mileage_km: 80000, ca_sold_date: iso(5), licence_plate: 'CC33333', url: 'https://finn.no/s3' },
          { classified_price: 189000, mileage_km: 100000, licence_plate: 'BT28045', url: 'https://finn.no/origin' },
        ],
      },
    },
  });
  const empty = build({ erpId: 2, regnr: 'AA00000', km: 1, finnPool: [], carInfo: {} });
  const cheapOrigin = build({
    erpId: 3,
    regnr: 'CC11111',
    km: 1,
    originFinn: { price: 170000, status: 'aktiv', title: 'x' },
    finnPool: [],
    carInfo: {
      valuation: {
        company_classifieds: [
          { classified_price: 180000, ca_sold_date: iso(8), licence_plate: 'ZZ1' },
          { classified_price: 175000, ca_sold_date: iso(9), licence_plate: 'ZZ2' },
          { classified_price: 190000, ca_sold_date: iso(7), licence_plate: 'ZZ3' },
        ],
      },
    },
  });
  const twins = build({
    erpId: 4,
    regnr: 'DR90876',
    km: 69500,
    ident: { make: 'MERCEDES-BENZ', model: 'E 300 e 4MATIC', year: 2021, fuel: 'Hybrid bensin', karosseri: 'Sedan', drive: '4WD' },
    finnPool: [
      { price: 259000, km: 54000, status: 'aktiv', title: 'Mercedes-Benz B250 e', url: 'https://finn.no/b' },
      { price: 318000, km: 76600, status: 'aktiv', title: 'Mercedes-Benz EQC400', url: 'https://finn.no/eqc' },
      { price: 319900, km: 68000, status: 'aktiv', title: 'Mercedes-Benz CLA250 e', url: 'https://finn.no/cla' },
      { price: 385000, km: 91000, status: 'aktiv', title: 'Mercedes-Benz GLC300 e', url: 'https://finn.no/glc' },
      { price: 499900, km: 58000, status: 'aktiv', title: 'Mercedes-Benz - 2021 - Hvit - 333 hk - Sedan', url: 'https://finn.no/e', licence_plate: 'XV72153' },
      { price: 525000, km: 70000, status: 'solgt', sold_date: iso(20), title: 'Mercedes-Benz E 300 e 4MATIC 2021 sedan', url: 'https://finn.no/es' },
    ],
    carInfo: {},
  });
  const equalAsk = build({
    erpId: 5,
    regnr: 'DD00000',
    km: 100000,
    originFinn: { price: 70000, status: 'aktiv', title: 'x' },
    finnPool: [],
    carInfo: {
      valuation: {
        company_classifieds: [
          { classified_price: 70000, ca_sold_date: iso(8), licence_plate: 'QQ1' },
          { classified_price: 71000, ca_sold_date: iso(9), licence_plate: 'QQ2' },
          { classified_price: 69000, ca_sold_date: iso(7), licence_plate: 'QQ3' },
        ],
      },
    },
  });
  const driveGate = build({
    erpId: 6,
    regnr: 'BS93448',
    km: 100000,
    ident: { make: 'BMW', model: '520d xDRIVE', year: 2018, fuel: 'Diesel', karosseri: 'Stasjonsvogn', drive: '4WD' },
    finnPool: [
      { price: 140000, km: 100000, status: 'aktiv', title: 'BMW 520d xDrive 2018 Touring', url: 'https://finn.no/xd' },
      { price: 110000, km: 100000, status: 'aktiv', title: 'BMW 520d 2018 RWD Touring', url: 'https://finn.no/rwd' },
      { price: 135000, km: 100000, status: 'aktiv', title: 'BMW 520d 2018 Touring', url: 'https://finn.no/plain' },
    ],
    carInfo: {},
  });
  const hyb = build({
    erpId: 7,
    regnr: 'KJ27577',
    km: 140000,
    ident: { make: 'Toyota', model: 'C-HR', year: 2017, fuel: 'Hybrid bensin', karosseri: 'SUV', drive: 'FWD', gir: 'CVT', hk: 122 },
    finnPool: [
      { price: 174900, km: 145600, status: 'solgt', sold_date: iso(20), title: 'Toyota C-HR - 2017 - Blå - 170 hk - SUVOffroad', url: 'https://finn.no/p' },
      { price: 169000, km: 140000, status: 'solgt', sold_date: iso(10), title: 'Toyota C-HR Hybrid CVT 122hk 2017 SUV', url: 'https://finn.no/h' },
    ],
    carInfo: {},
  });
  const ciTitle = build({
    erpId: 8,
    regnr: 'KJ27577',
    km: 140000,
    ident: { make: 'Toyota', model: 'C-HR', year: 2017, fuel: 'Hybrid bensin', karosseri: 'SUV', drive: 'FWD', gir: 'CVT', hk: 122 },
    finnPool: [],
    carInfo: {
      valuation: {
        company_classifieds: [
          { classified_price: 174900, mileage_km: 145600, ca_sold_date: iso(20), licence_plate: 'VH93377', classified_title: 'Toyota C-HR - 2017 - Blå - 170 hk - SUVOffroad', classified_url: 'https://finn.no/p' },
          { classified_price: 169000, mileage_km: 140000, ca_sold_date: iso(10), licence_plate: 'UN36998', classified_title: 'Toyota C-HR - 2017 - Grå - 122 hk - Kombi 5-dørs', classified_url: 'https://finn.no/h' },
          { classified_price: 159000, mileage_km: 138000, licence_plate: 'AA1', classified_title: 'Toyota C-HR - 2017 - Grå - 122 hk - SUVOffroad', classified_url: 'https://finn.no/a' },
        ],
      },
    },
  });
  const sisterFmt = build({
    erpId: 9,
    regnr: 'KJ27577',
    km: 140000,
    ident: { make: 'Toyota', model: 'C-HR', year: 2017, fuel: 'Hybrid bensin', karosseri: 'SUV', drive: 'FWD', gir: 'CVT', hk: 122 },
    finnPool: [
      { pris: 169000, km: 140000, status: 'aktiv', tittel: 'Toyota C-HR Hybrid 122 hk 2017', finn_url: 'https://finn.no/s1' },
      { pris: 174900, km: 145000, status: 'aktiv', tittel: 'Toyota C-HR - 2017 - Blå - 170 hk - SUVOffroad', finn_url: 'https://finn.no/s2' },
    ],
    carInfo: {},
  });
  // El: hk/kW brukes aldri (Taycan GTS 517 hk hos Vegvesen, 598/693 hk på Finn). Rekkevidde kaster når begge er kjent.
  const ev = build({
    erpId: 10,
    regnr: 'EE92399',
    km: 33500,
    ident: { make: 'Porsche', model: 'Taycan GTS Sport Turismo', year: 2022, fuel: 'Elektrisk', karosseri: 'Stasjonsvogn', drive: 'AWD', gir: 'Automat', hk: 517, range: 490 },
    finnPool: [
      { price: 869000, km: 30000, status: 'aktiv', title: 'Porsche Taycan GTS - 2023 - Svart - 598 hk - Stasjonsvogn', url: 'https://finn.no/ev1' },
      { price: 879000, km: 35000, status: 'aktiv', title: 'Porsche Taycan GTS - 2023 - Svart - 693 hk - Stasjonsvogn', url: 'https://finn.no/ev2' },
      { price: 600000, km: 30000, status: 'aktiv', title: 'Porsche Taycan GTS - 2022 - 598 hk - Stasjonsvogn - 300 km rekkevidde', url: 'https://finn.no/ev3' },
    ],
    carInfo: {},
  });
  const ok = rec.finn_utpris === 180000 && rec.n_own_sold === 1 && rec.n_sold === 3 && rec.n_ask === 3
    && empty.skip_put === true && empty.finn_utpris == null
    && cheapOrigin.finn_utpris === 162000 && /origin95/.test(cheapOrigin.finn_utpris_kilde)
    && equalAsk.finn_utpris === 67000 && /origin95/.test(equalAsk.finn_utpris_kilde)
    && twins.n_ask === 1 && twins.n_sold === 1 && twins.n_rejected >= 4
    && twins.finn_utpris >= 490000 && twins.finn_utpris <= 530000
    && driveGate.n_ask === 2 && driveGate.n_rejected >= 1
    && /awd/.test(driveGate.ident_label)
    // Hybrid: hk er ikke grunn til å kaste (Vegvesen-hk er ofte bare forbrenningsmotoren).
    && hyb.n_sold === 2 && hyb.n_rejected === 0
    && /hybrid/.test(hyb.ident_label) && !/hk/.test(hyb.ident_label)
    && ciTitle.n_sold === 2 && ciTitle.n_ask === 1 && ciTitle.n_rejected === 0
    && sisterFmt.n_ask === 2 && sisterFmt.n_rejected === 0
    && ev.n_ask === 2 && ev.n_rejected === 1 && /rekkevidde 300/.test(((ev.rejected || [])[0] || {}).grunn || '')
    && /490km rekkevidde/.test(ev.ident_label) && !/517hk/.test(ev.ident_label)
    && recHasMarket(rec) === true && recHasMarket(empty) === false;
  console.log(JSON.stringify({
    rec: { utpris: rec.finn_utpris, kilde: rec.finn_utpris_kilde, n_ext: rec.n_external, own: rec.n_own_sold, skip: rec.skip_put },
    empty: { skip: empty.skip_put, utpris: empty.finn_utpris },
    cheapOrigin: { utpris: cheapOrigin.finn_utpris, kilde: cheapOrigin.finn_utpris_kilde },
    equalAsk: { utpris: equalAsk.finn_utpris, kilde: equalAsk.finn_utpris_kilde },
    twins: { utpris: twins.finn_utpris, ask: twins.n_ask, sold: twins.n_sold, kastet: twins.n_rejected, kilde: twins.finn_utpris_kilde },
    driveGate: { ask: driveGate.n_ask, kastet: driveGate.n_rejected, label: driveGate.ident_label, rejected: (driveGate.rejected || []).map(function (r) { return r.grunn; }) },
    ev: { ask: ev.n_ask, kastet: ev.n_rejected, label: ev.ident_label, rejected: (ev.rejected || []).map(function (r) { return r.grunn; }) },
    hyb: { sold: hyb.n_sold, kastet: hyb.n_rejected, label: hyb.ident_label, rejected: (hyb.rejected || []).map(function (r) { return r.grunn; }) },
    ciTitle: { sold: ciTitle.n_sold, ask: ciTitle.n_ask, kastet: ciTitle.n_rejected, rejected: (ciTitle.rejected || []).map(function (r) { return r.grunn; }) },
    sisterFmt: { ask: sisterFmt.n_ask, kastet: sisterFmt.n_rejected, rejected: (sisterFmt.rejected || []).map(function (r) { return r.grunn; }) },
    hasMarket: recHasMarket(rec),
    emptyMarket: recHasMarket(empty),
    ok: ok,
  }, null, 2));
  if (!ok) process.exit(1);
  (async function () {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oc-ensure-'));
    process.env.JR_DOSSIER_DIR = dir;
    const pool = [
      { price: 199000, km: 90000, status: 'aktiv', url: 'https://finn.no/e1', title: 'BMW 320d 2018' },
      { price: 195000, km: 110000, status: 'aktiv', url: 'https://finn.no/e2', title: 'BMW 320d 2018' },
      { price: 185000, km: 120000, status: 'aktiv', url: 'https://finn.no/e3', title: 'BMW 320d 2018' },
    ];
    const first = await ensure({
      erpId: 50,
      regnr: 'ZZ99999',
      km: 100000,
      finnPool: pool,
      ident: { make: 'BMW', model: '320d', year: 2018, fuel: 'Diesel' },
      carInfo: {},
    });
    const second = await ensure({
      erpId: 50,
      regnr: 'ZZ99999',
      km: 100000,
      finnPool: [{ price: 1, km: 1, status: 'aktiv', url: 'https://finn.no/SHOULD-NOT', title: 'NO' }],
      ident: { make: 'BMW', model: '320d', year: 2018, fuel: 'Diesel' },
      carInfo: {},
    });
    const sharedOk = first.n_ask === 3 && second.n_ask === first.n_ask && second.built_at === first.built_at;
    console.log(JSON.stringify({ ensure: sharedOk, n_ask: first.n_ask, built: first.built_at, dir: dir }));
    if (!sharedOk) process.exit(1);
  })().catch(function (e) {
    console.error(e);
    process.exit(1);
  });
}
