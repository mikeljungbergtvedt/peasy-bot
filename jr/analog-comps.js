'use strict';

/**
 * Analog-comps + Finn-utpris.
 *
 * Always a number. Never 0 comps.
 * Cap ask * 0.95 if origin has an active Finn-ask.
 * own_sold comps are dropped. writes_erp false.
 */

const { dropOwnSold } = require('./origin-cv');

const WRITES_ERP = false;
const ASK_CAP = 0.95;
const FLOOR_KR = 3000;

function asPositiveNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
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
  const year = asPositiveNumber(
    (originCv && (originCv.year || originCv.model_year)) || identity.year
  ) || (new Date().getFullYear() - 5);
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
    const n = asPositiveNumber(v);
    if (n) return n;
  }
  const ads = []
    .concat(Array.isArray(dossier.origin) ? dossier.origin : [])
    .concat(Array.isArray(dossier.origin_ads) ? dossier.origin_ads : []);
  for (const ad of ads) {
    if (!ad || typeof ad !== 'object') continue;
    const active = ad.is_active === true || ad.active === true || ad.status === 'aktiv';
    const n = asPositiveNumber(ad.price || ad.ask);
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
    status: 'analog',
    ...extra,
  };
}

/**
 * Always returns ≥1 comp with price > 0. Never own_sold.
 */
function analogComps(dossier) {
  const originCv = (dossier && dossier.origin_cv) || {};
  const cleaned = dropOwnSold((dossier && dossier.comps) || []);
  const usable = cleaned.filter(c => asPositiveNumber(c.price || c.classified_price));
  if (usable.length) {
    return usable.map(c => ({
      ...c,
      own_sold: false,
      price: asPositiveNumber(c.price || c.classified_price),
      analog: !!c.analog,
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
};
