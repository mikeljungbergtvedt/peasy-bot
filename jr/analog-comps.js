'use strict';

/**
 * Analog-comps + Finn-utpris.
 *
 * Always a number. Never 0 comps.
 * Cap ask * 0.95 if origin has an active Finn-ask.
 * own_sold comps are dropped. writes_erp false.
 *
 * Jr Finn listings are often nested (finn.ads / listings / hits / items)
 * with price.amount, soldPrice, asking_price — not top-level .price.
 * Mini hook only reads price|ask|finn_price and km|mileage; mapChefComps
 * flattens to {price, km, url, title, year} with price>0.
 */

const { dropOwnSold } = require('./origin-cv');

const WRITES_ERP = false;
const ASK_CAP = 0.95;
const FLOOR_KR = 3000;

const LISTING_ARRAY_KEYS = [
  'comps', 'ads', 'listings', 'hits', 'items', 'results', 'docs', 'classifieds',
];
const LISTING_WRAP_KEYS = [
  'finn', 'sold', 'active', 'market', 'search', 'data', 'result',
];
const PRICE_KEYS = [
  'price', 'ask', 'finn_price', 'soldPrice', 'sold_price',
  'asking_price', 'askingPrice', 'classified_price', 'priceAmount',
  'total_price', 'current_price',
];
const KM_KEYS = [
  'km', 'mileage', 'mileage_km', 'kilometer', 'kilometerstand',
  'mileageKm', 'kmstand',
];
const URL_KEYS = [
  'url', 'canonical_url', 'canonicalUrl', 'finn_url', 'link', 'href', 'ad_url',
];
const TITLE_KEYS = [
  'title', 'heading', 'headingText', 'heading_text', 'name', 'subject',
];
const YEAR_KEYS = [
  'year', 'model_year', 'yearModel', 'modelYear', 'year_model', 'firstRegYear',
];
const SKIP_WALK_KEYS = new Set([
  'origin', 'origin_cv', 'origin_ads', 'identity', 'chefs',
]);

function asPositiveNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return null;
  const n = Number(String(value).replace(/\s+/g, '').replace(/kr$/i, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asNonNegativeNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return null;
  const n = Number(String(value).replace(/\s+/g, '').replace(/kr$/i, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function unwrapNumber(value, { allowZero } = {}, depth = 0) {
  const direct = allowZero ? asNonNegativeNumber(value) : asPositiveNumber(value);
  if (direct != null) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return null;
  const nestedKeys = [
    'amount', 'value', 'price', 'ask', 'km', 'mileage',
    'soldPrice', 'asking_price', 'classified_price',
  ];
  for (const k of nestedKeys) {
    if (value[k] == null) continue;
    const n = unwrapNumber(value[k], { allowZero }, depth + 1);
    if (n != null) return n;
  }
  return null;
}

function firstMapped(ad, keys, unwrap) {
  for (const k of keys) {
    if (ad[k] == null) continue;
    const n = unwrap(ad[k]);
    if (n != null) return n;
  }
  return null;
}

function extractPrice(ad) {
  return firstMapped(ad, PRICE_KEYS, v => unwrapNumber(v));
}

function extractKm(ad) {
  return firstMapped(ad, KM_KEYS, v => unwrapNumber(v, { allowZero: true }));
}

function extractYear(ad) {
  return firstMapped(ad, YEAR_KEYS, v => unwrapNumber(v));
}

function extractTitle(ad) {
  if (!ad || typeof ad !== 'object') return null;
  for (const k of TITLE_KEYS) {
    const s = ad[k];
    if (s == null) continue;
    const t = String(s).trim();
    if (t) return t;
  }
  return null;
}

function extractUrl(ad) {
  if (!ad || typeof ad !== 'object') return null;
  for (const k of URL_KEYS) {
    const s = ad[k];
    if (typeof s === 'string' && /^https?:\/\//i.test(s.trim())) return s.trim();
  }
  const kode = asPositiveNumber(ad.finnkode || ad.finn_kode || ad.ad_id || ad.adId);
  if (kode) return `https://www.finn.no/mobility/item/${kode}`;
  const id = asPositiveNumber(ad.id);
  if (id && String(Math.trunc(id)).length >= 6) {
    return `https://www.finn.no/mobility/item/${Math.trunc(id)}`;
  }
  return null;
}

function collectRawListings(root) {
  const out = [];
  const seen = new Set();
  function addItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    if (seen.has(item)) return;
    seen.add(item);
    out.push(item);
  }
  function walk(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        addItem(item);
        if (item && typeof item === 'object') walk(item, depth + 1);
      }
      return;
    }
    for (const key of LISTING_ARRAY_KEYS) {
      if (Array.isArray(obj[key])) walk(obj[key], depth + 1);
    }
    for (const key of LISTING_WRAP_KEYS) {
      if (SKIP_WALK_KEYS.has(key)) continue;
      if (obj[key] && typeof obj[key] === 'object') walk(obj[key], depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

/**
 * Mini hook: only top-level price|ask|finn_price and km|mileage.
 * Nested Finn ads (price.amount, soldPrice) yield an empty pool — the 2 Sep bug.
 */
function miniHookPool(dossier) {
  const ads = []
    .concat(Array.isArray(dossier && dossier.comps) ? dossier.comps : [])
    .concat(dossier && dossier.finn && Array.isArray(dossier.finn.ads) ? dossier.finn.ads : []);
  return ads.filter(ad => {
    if (!ad || typeof ad !== 'object') return false;
    const price = ad.price || ad.ask || ad.finn_price;
    return typeof price === 'number' && price > 0;
  });
}

/**
 * Flat chef comps: {price, km, url, title, year} with price>0.
 * Pulls ads/listings/hits/items plus soldPrice/asking_price/finnkode.
 */
function mapChefComps(source) {
  const dossier = Array.isArray(source) ? { comps: source } : (source || {});
  const raw = dropOwnSold(collectRawListings(dossier));
  const out = [];
  const seen = new Set();
  for (const ad of raw) {
    const price = extractPrice(ad);
    if (!price) continue;
    const seller = [ad.seller, ad.company, ad.dealer, ad.seller_name]
      .map(v => (v == null ? '' : String(v).trim()))
      .find(Boolean) || null;
    const mapped = {
      price,
      km: extractKm(ad),
      url: extractUrl(ad),
      title: extractTitle(ad),
      year: extractYear(ad),
    };
    if (seller) mapped.seller = seller;
    const key = mapped.url || `${mapped.price}|${mapped.km}|${mapped.title}|${mapped.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}

function round1000(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return FLOOR_KR;
  return Math.max(FLOOR_KR, Math.round(x / 1000) * 1000);
}

function median(nums) {
  const a = nums.filter(n => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function residualPrice(originCv) {
  const identity = (originCv && originCv.identity) || {};
  const year = asPositiveNumber(originCv && originCv.model_year)
    || (new Date().getFullYear() - 5);
  const age = Math.max(0, new Date().getFullYear() - year);
  const km = asPositiveNumber(originCv && originCv.km) || 100000;
  const make = String((originCv && originCv.make) || identity.make || '').toLowerCase();
  let base = 280000;
  if (/tesla|porsche|bmw|mercedes|audi|volvo/.test(make)) base = 380000;
  if (/toyota|vw|volkswagen|skoda|hyundai|kia|mazda/.test(make)) base = 260000;
  const ageFactor = Math.pow(0.88, age);
  const kmFactor = Math.max(0.35, 1 - (km / 250000) * 0.55);
  return Math.max(FLOOR_KR, Math.round(base * ageFactor * kmFactor));
}

function originActiveAsk(dossier) {
  if (!dossier || typeof dossier !== 'object') return null;
  const direct = [
    dossier.origin_ask,
    dossier.active_ask,
    dossier.finn_ask,
    dossier.ask,
    dossier.finnSelf && dossier.finnSelf.price,
    dossier.origin_cv && dossier.origin_cv.active_ask,
    dossier.origin_cv && dossier.origin_cv.ask,
    dossier.finn && dossier.finn.ask,
  ];
  for (const v of direct) {
    const n = unwrapNumber(v);
    if (n) return n;
  }
  const ads = []
    .concat(Array.isArray(dossier.origin) ? dossier.origin : [])
    .concat(Array.isArray(dossier.origin_ads) ? dossier.origin_ads : []);
  for (const ad of ads) {
    if (!ad || typeof ad !== 'object') continue;
    const active = ad.is_active === true || ad.active === true || ad.status === 'aktiv';
    const n = extractPrice(ad) || unwrapNumber(ad.price) || unwrapNumber(ad.ask);
    if (active && n) return n;
  }
  return null;
}

function analogCompFrom(price, km, tag, extra) {
  return {
    analog: true,
    own_sold: false,
    seller: `analog-${tag}`,
    price: round1000(price),
    km: km || null,
    url: null,
    title: `analog-${tag}`,
    year: null,
    status: 'analog',
    ...extra,
  };
}

/**
 * Always returns ≥1 comp with price > 0. Never own_sold.
 * Uses mapped nested Finn ads when present; otherwise residual analog.
 */
function analogComps(dossier) {
  const originCv = (dossier && dossier.origin_cv) || {};
  const mapped = mapChefComps(dossier);
  if (mapped.length) {
    return mapped.map(c => ({
      ...c,
      own_sold: false,
      analog: false,
    }));
  }
  const base = residualPrice(originCv);
  const km = originCv.km || null;
  return [
    analogCompFrom(base * 0.96, km, 'low'),
    analogCompFrom(base, km, 'mid'),
    analogCompFrom(base * 1.04, km, 'high'),
  ];
}

function capAsk(utpris, ask) {
  const n = asPositiveNumber(utpris);
  const a = asPositiveNumber(ask);
  if (!n) return { finn_utpris: FLOOR_KR, capped: false, ask: a, cap: null };
  if (!a) return { finn_utpris: round1000(n), capped: false, ask: null, cap: null };
  const cap = Math.round(a * ASK_CAP);
  if (n > cap) return { finn_utpris: round1000(cap), capped: true, ask: a, cap };
  return { finn_utpris: round1000(n), capped: false, ask: a, cap };
}

/**
 * Finn-utpris: always a number. Median of analog comps, then ask*0.95 cap.
 */
function finnUtprisFromDossier(dossier) {
  const comps = analogComps(dossier);
  if (!comps.length) {
    throw new Error('analog-comps: 0 comps — invariant broken');
  }
  const prices = comps.map(c => asPositiveNumber(c.price)).filter(Boolean);
  const raw = median(prices) || residualPrice((dossier && dossier.origin_cv) || {});
  const ask = originActiveAsk(dossier);
  const capped = capAsk(raw, ask);
  const finn_utpris = asPositiveNumber(capped.finn_utpris) || FLOOR_KR;
  return {
    writes_erp: WRITES_ERP,
    raw: round1000(raw),
    comps,
    comp_count: comps.length,
    ask: capped.ask,
    cap: capped.cap,
    capped: capped.capped,
    finn_utpris,
  };
}

function assertAlwaysNumber(result) {
  const n = result && result.finn_utpris;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error('Finn-utpris must always be a positive number, got ' + n);
  }
  if (!result.comps || result.comps.length === 0) {
    throw new Error('analog-comps: never 0 comps');
  }
  return result;
}

module.exports = {
  WRITES_ERP,
  ASK_CAP,
  FLOOR_KR,
  analogComps,
  residualPrice,
  originActiveAsk,
  capAsk,
  finnUtprisFromDossier,
  assertAlwaysNumber,
  round1000,
  mapChefComps,
  miniHookPool,
  extractPrice,
  extractKm,
  extractUrl,
  extractTitle,
  extractYear,
  asPositiveNumber,
};
