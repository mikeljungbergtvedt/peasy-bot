// pricing-v2-glue.js
// Bro mellom Easy (CommonJS) og v2-prisemotoren (ES-moduler).
// Eksponerer runV2Pricing(regnr, km): collectAllData -> formatClassified ->
// splitOriginAndComps -> dedupe -> chooseAnchor (ingen Telegram/Pulse/measurements).
//
// v20.48: collectOnly(regnr, km) eksponeres separat - kjorer hele
// data-innsamlingen UTEN chooseAnchor, slik at Easy kan kjore sin EGEN AI-anker
// paa NOEYAKTIG samme {data, origin, comps}. runV2Pricing bruker collectOnly
// internt (DRY) og legger kun chooseAnchor + comp-begrunnelse paa.
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const V2_DIR = process.env.PEASY_V2_DIR || '/Users/bot/peasy-pricing-v2';

let _mods = null;
async function loadV2() {
  if (_mods) return _mods;
  const dcUrl = pathToFileURL(path.join(V2_DIR, 'data-collector.js')).href;
  const aiUrl = pathToFileURL(path.join(V2_DIR, 'ai-anchor.js')).href;
  const [dc, ai] = await Promise.all([import(dcUrl), import(aiUrl)]);
  if (typeof dc.collectAllData !== 'function') throw new Error('data-collector.js: collectAllData mangler');
  if (typeof ai.chooseAnchor !== 'function') throw new Error('ai-anchor.js: chooseAnchor mangler');
  _mods = { collectAllData: dc.collectAllData, chooseAnchor: ai.chooseAnchor };
  return _mods;
}

function formatClassified(c, type) {
  return {
    type,
    licence_plate: c.licence_plate,
    ident_id: c.ident_id,
    title: c.classified_title,
    price: Number(c.classified_price),
    km: Number(c.mileage_km),
    published_date: c.classified_published_date,
    sold_date: c.ca_sold_date,
    is_active: !c.classified_removed_date,
    same_car: c.same_car === 1,
    success_factor: Number(c.success_factor),
    days_on_market: c.days,
    finn_url: c.classified_url,
  };
}

function splitOriginAndComps(classifieds, regnr) {
  const origin = [];
  const comps = [];
  const normRegnr = String(regnr).toUpperCase().replace(/\s/g, '');
  for (const c of classifieds) {
    const plate = (c.licence_plate || '').toUpperCase().replace(/\s/g, '');
    if (plate && plate === normRegnr) origin.push(c);
    else comps.push(c);
  }
  return { origin, comps };
}

function dedupeComps(comps) {
  const byId = new Map();
  for (const c of comps) {
    const key = `${c.ident_id}-${c.type}`;
    const existing = byId.get(key);
    if (!existing || (c.published_date || '') > (existing.published_date || '')) {
      byId.set(key, c);
    }
  }
  return Array.from(byId.values());
}

function capComps(comps, originKm, cap) {
  if (!Array.isArray(comps) || comps.length <= cap) return comps;
  const now = Date.now();
  const scored = comps.map(c => {
    const t = Date.parse(c.sold_date || c.published_date || '');
    const ageDays = Number.isFinite(t) ? (now - t) / 86400000 : 1e9;
    const kmDiff = (Number.isFinite(c.km) && Number.isFinite(originKm) && originKm > 0) ? Math.abs(c.km - originKm) : 1e9;
    return { c, ageDays, kmDiff };
  });
  const maxAge = Math.max(1, ...scored.map(s => (s.ageDays === 1e9 ? 0 : s.ageDays)));
  const maxKm = Math.max(1, ...scored.map(s => (s.kmDiff === 1e9 ? 0 : s.kmDiff)));
  scored.forEach(s => {
    const a = s.ageDays === 1e9 ? 1 : s.ageDays / maxAge;
    const k = s.kmDiff === 1e9 ? 1 : s.kmDiff / maxKm;
    s.score = 0.5 * a + 0.5 * k;
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, cap).map(s => s.c);
}

function stripMeta(list) {
  return (list || []).map(c => {
    const o = {};
    for (const k of Object.keys(c)) { if (k[0] !== '_') o[k] = c[k]; }
    return o;
  });
}

function pickArray(obj, paths) {
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  for (const p of paths) { const v = get(obj, p); if (Array.isArray(v) && v.length) return { arr: v, path: p }; }
  for (const p of paths) { const v = get(obj, p); if (Array.isArray(v)) return { arr: v, path: p }; }
  return { arr: [], path: null };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const BODY_WORDS = ['Stasjonsvogn', 'Flerbruksbil', 'Hatchback', 'Cabriolet', 'Pickup', 'Pick Up', 'Kombi', 'Sedan', 'Coupe', 'Varebil', 'Kasse', 'SUV', 'MPV'];
function parseAh(s) { const m = String(s || '').match(/(\d{2,3})\s*Ah/i); return m ? parseInt(m[1], 10) : null; }
function stripMake(model, make) {
  let m = String(model || '').trim();
  const mk = String(make || '').split(/\s+/)[0];
  if (mk) m = m.replace(new RegExp('^' + mk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), '').trim();
  return m;
}
function modelCore(model) {
  return String(model || '').toLowerCase().replace(/\s+\d{2,3}\s*ah\b.*$/i, '').split(/\s+/)[0].replace(/-?serien?$/, '').replace(/^e-/, '').replace(/[^a-z0-9]/g, '');
}
function parseCompSpecs(title, make) {
  let t = String(title || '').replace(/^Bruktbil til salgs:\s*/i, '').replace(/\s*\|\s*FINN\.no\s*$/i, '');
  const erAuksjon = /^Auksjon:\s*/i.test(t);
  t = t.replace(/^Auksjon:\s*/i, '');
  t = t.replace(/^Brukt\s+/i, '');
  const yearM = t.match(/\b(19|20)\d{2}\b/);
  const hkM = t.match(/(\d{2,3})\s*hk/i);
  const hk = hkM ? parseInt(hkM[1], 10) : null;
  let model = stripMake((t.split(' - ')[0] || '').split('|')[0].trim(), make);
  if (erAuksjon && model) model = model + ' (auksjon)';
  let body = '';
  for (const b of BODY_WORDS) { if (new RegExp(b.replace(/ /g, '\\s*'), 'i').test(t)) { body = /suv/i.test(b) ? 'SUV' : b; break; } }
  return { year: yearM ? parseInt(yearM[0], 10) : null, hk, kW: hk ? Math.round(hk / 1.36) : null, model, body, ah: parseAh(t) };
}
function comparability(origin, spec) {
  const reasons = [];
  if (origin.year && spec.year && Math.abs(spec.year - origin.year) > 1) reasons.push('år');
  const hkTol = origin.ev ? 0.22 : 0.10;
  if (origin.hk && spec.hk && Math.abs(spec.hk - origin.hk) / origin.hk > hkTol) reasons.push('hk');
  const compCore = modelCore(spec.model);
  if (origin.modelCore && origin.modelCore.length >= 2 && compCore && compCore.length >= 2 && origin.modelCore !== compCore) reasons.push('variant');
  if (origin.ah && spec.ah && origin.ah !== spec.ah) reasons.push('batteri');
  return { comparable: reasons.length === 0, reasons };
}

// collectOnly: hele data-innsamlingen UTEN chooseAnchor (v20.48).
async function collectOnly(regnr, km) {
  const { collectAllData } = await loadV2();
  const kmNum = Number(km) || 0;
  let data;
  for (let attempt = 0; ; attempt++) {
    data = await collectAllData(regnr, kmNum);
    const cinfo = data.sources && data.sources.car_info;
    const transient = cinfo && !cinfo.ok && /429|HTTP 5\d\d|timeout|fetch failed|ECONNRESET/i.test(cinfo.error || '');
    if (!transient || attempt >= 2) break;
    const wait = 3000 * (attempt + 1);
    console.log(`[v2-glue] ${regnr} car.info ${cinfo.error} - retry ${attempt + 1}/2 om ${wait / 1000}s`);
    await sleep(wait);
  }
  const carOk = !!(data.sources && data.sources.car_info && data.sources.car_info.ok);
  const ci = (data.sources && data.sources.car_info && data.sources.car_info.result) || {};
  const val = ci.valuation || {};
  const company = pickArray(val, ['company_classifieds', 'company_valuation.classifieds', 'company_valuation.result.classifieds']);
  const priv = pickArray(val, ['private_classifieds', 'private_valuation.classifieds', 'private_valuation.result.classifieds']);
  console.log(`[v2-glue] ${regnr} km=${kmNum} | car.info ok=${carOk} | forhandler=${company.arr.length} | privat=${priv.arr.length} | val-nokler=[${Object.keys(val).join(',')}]`);
  const allClassifieds = [...company.arr.map(c => formatClassified(c, 'forhandler')), ...priv.arr.map(c => formatClassified(c, 'privat'))];
  const { origin, comps: rawComps } = splitOriginAndComps(allClassifieds, regnr);
  const deduped = dedupeComps(rawComps);
  const veg = (data.sources && data.sources.vegvesen && data.sources.vegvesen.data) || {};
  const make = ci.brand || veg.make || '';
  const elbilData = (data.sources && data.sources.elbilradar && data.sources.elbilradar.data) || null;
  const originSpecs = {
    year: Number(ci.model_year) || Number(veg.firstRegYear) || null,
    hk: Number(ci.horsepower) || Number(veg.hk) || null,
    ah: parseAh(ci.car_name) || parseAh(elbilData ? elbilData.variantLine : '') || null,
    modelCore: modelCore(stripMake(ci.car_name || ci.series || '', make)),
    ev: /elektri|electric/i.test(String(veg.fuel || ci.engine_type || '')),
  };
  for (const c of deduped) {
    c._spec = parseCompSpecs(c.title, make);
    const cmp = comparability(originSpecs, c._spec);
    c._comparable = cmp.comparable;
    c._flag = cmp.reasons;
  }
  const comparablePool = deduped.filter(c => c._comparable);
  const dealerPool = comparablePool.filter(c => c.type === 'forhandler');
  let anchorPool = dealerPool;
  let relaxed = '';
  if (anchorPool.length < 4) { anchorPool = comparablePool; relaxed = 'privat backup'; }
  if (anchorPool.length < 4) { anchorPool = deduped; relaxed = 'alle comps'; }
  const capN = parseInt(process.env.PEASY_V2_MAX_COMPS, 10) || 25;
  const cappedPool = capComps(anchorPool, kmNum, capN);
  console.log(`[v2-glue] ${regnr} sammenlignbare ${comparablePool.length}/${deduped.length} | forhandler ${dealerPool.length}${relaxed ? ' (' + relaxed + ')' : ''} -> anker-pool ${cappedPool.length}`);
  const activeSeen = new Set();
  const activeComps = deduped.filter(c => c.is_active && !c.sold_date).filter(c => { if (activeSeen.has(c.ident_id)) return false; activeSeen.add(c.ident_id); return true; }).sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || ''))).slice(0, 8);
  return { data, origin, comps: stripMeta(cappedPool), deduped, anchorPool, activeComps, kmNum, capN, carOk, val };
}

const ankerOk = (a) => {
  const n = a && a.anker_beregning ? Number(a.anker_beregning.anker) : NaN;
  return Number.isFinite(n) && n > 0;
};

function buildSoldLists(deduped, anchor) {
  const begMap = new Map();
  for (const v of [...((anchor && anchor.valgte_comps) || []), ...((anchor && anchor.ekskluderte_comps) || [])]) {
    const plate = String(v.licence_plate || '').toUpperCase().replace(/\s/g, '');
    if (plate && v.begrunnelse && !begMap.has(plate)) begMap.set(plate, v.begrunnelse);
  }
  const withBeg = (c) => { const p = String(c.licence_plate || '').toUpperCase().replace(/\s/g, ''); const b = begMap.get(p); return b ? { ...c, begrunnelse: b } : c; };
  const soldSort = (a, b) => String(b.sold_date || '').localeCompare(String(a.sold_date || ''));
  const soldForhandler = deduped.filter(c => c.type === 'forhandler' && c.sold_date).sort(soldSort).slice(0, 10).map(withBeg);
  const soldPrivat = deduped.filter(c => c.type === 'privat' && c.sold_date).sort(soldSort).slice(0, 10).map(withBeg);
  return { soldForhandler, soldPrivat };
}

async function runV2Pricing(regnr, km) {
  const { chooseAnchor } = await loadV2();
  const c = await collectOnly(regnr, km);
  const { data, origin, comps, deduped, anchorPool, activeComps, kmNum, capN, carOk, val } = c;
  let anchor = null;
  if (comps.length > 0) {
    anchor = await chooseAnchor({ data, origin, comps });
    if (!ankerOk(anchor) && anchorPool !== deduped && deduped.length > 0) {
      console.log(`[v2-glue] ${regnr} gatet pool ga ikke anker -> retry med alle ${deduped.length} comps`);
      anchor = await chooseAnchor({ data, origin, comps: stripMeta(capComps(deduped, kmNum, capN)) });
    }
  } else if (!carOk) {
    data.errors.push(`car.info feilet (${(data.sources && data.sources.car_info && data.sources.car_info.error) || 'ukjent'})`);
  } else if (kmNum <= 0) {
    data.errors.push('Ingen comps - km mangler (prov /REGNR <km>)');
  } else {
    data.errors.push(`Ingen comps fra car.info (val-nokler: ${Object.keys(val).join(',') || 'tom'})`);
  }
  const { soldForhandler, soldPrivat } = buildSoldLists(deduped, anchor);
  return { data, anchor, comps, origin, activeComps, soldForhandler, soldPrivat, errors: data.errors || [] };
}

module.exports = {
  runV2Pricing,
  collectOnly,
  formatClassified,
  splitOriginAndComps,
  dedupeComps,
  capComps,
  parseCompSpecs,
  comparability,
  modelCore,
  parseAh,
};
