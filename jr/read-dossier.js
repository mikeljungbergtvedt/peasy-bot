'use strict';

/**
 * Chef dossier-read (Easy / V3 / V3G / Bot4).
 *
 * Mini path: /Users/bot/peasy-auto/jr/dossiers/{erpId}-{REGNR}.json
 * Override with JR_DOSSIER_DIR.
 *
 * hit.ok=true when a dossier exists. skipOwnSearch=true ONLY if mapped
 * comps.length>=1. Dossier with empty pool → skipOwnSearch=false, still
 * return origin_cv (locked ERP km); chefs MUST run their own Finn search.
 * Missing dossier → fallback to old search + log.
 * origin.km is never overwritten. origin.model_year is locked to ERP
 * førstegang (drive_no_car_data.model_year). own_sold comps are dropped.
 * writes_erp is always false.
 */

const fs = require('fs');
const path = require('path');
const { applyCarInfoIdentity, lockOriginCvYears, upperRegnr, WRITES_ERP } = require('./origin-cv');
const { assertJrFinnUrl } = require('./finn-query');
const { mapChefComps } = require('./analog-comps');

const CHEFS = ['easy', 'v3', 'v3g', 'bot4'];
const MINI_DOSSIER_DIR = '/Users/bot/peasy-auto/jr/dossiers';

function log(msg) {
  console.log(`[${new Date().toISOString()}] [jr-chef] ${msg}`);
}

function dossierDirs(extraDir) {
  const dirs = [];
  if (extraDir) dirs.push(extraDir);
  if (process.env.JR_DOSSIER_DIR) dirs.push(process.env.JR_DOSSIER_DIR);
  dirs.push(MINI_DOSSIER_DIR);
  dirs.push(path.join(__dirname, 'dossiers'));
  return [...new Set(dirs.map(d => path.resolve(d)))];
}

function dossierFilename(erpId, regnr) {
  const id = erpId != null ? String(erpId) : '';
  const plate = upperRegnr(regnr);
  if (id && plate) return `${id}-${plate}.json`;
  if (id) return `${id}.json`;
  if (plate) return `${plate}.json`;
  return null;
}

function candidatePaths({ erpId, internnr, regnr, dir } = {}) {
  const ids = [...new Set([erpId, internnr].filter(v => v != null && v !== ''))];
  const plate = upperRegnr(regnr);
  const names = [];
  for (const id of ids) {
    names.push(dossierFilename(id, plate));
    if (plate) names.push(`${id}-${plate}.json`);
  }
  if (plate) names.push(`${plate}.json`);
  const uniq = [...new Set(names.filter(Boolean))];
  const paths = [];
  for (const d of dossierDirs(dir)) {
    for (const name of uniq) paths.push(path.join(d, name));
    if (ids.length && plate && fs.existsSync(d)) {
      try {
        for (const file of fs.readdirSync(d)) {
          if (!file.endsWith('.json') || file === 'index.json') continue;
          const matchId = ids.some(id => file.startsWith(`${id}-`) || file === `${id}.json`);
          const matchPlate = plate && file.toUpperCase().includes(`-${plate}.JSON`.replace('.JSON', '.json'));
          const plateHit = plate && file.toUpperCase().includes(`-${plate}.`);
          if (matchId || plateHit || matchPlate) paths.push(path.join(d, file));
        }
      } catch (_) { /* ignore unlistable dirs */ }
    }
  }
  return [...new Set(paths)];
}

function freezeOriginKm(dossier) {
  if (!dossier || typeof dossier !== 'object') return dossier;
  const cv = dossier.origin_cv && typeof dossier.origin_cv === 'object' ? dossier.origin_cv : null;
  const nested = dossier.origin && typeof dossier.origin === 'object' && !Array.isArray(dossier.origin)
    ? dossier.origin
    : null;
  const km = cv && cv.km != null ? cv.km : (nested && nested.km != null ? nested.km : null);
  const modelYear = cv && cv.model_year != null
    ? cv.model_year
    : (nested && nested.model_year != null ? nested.model_year : null);
  if (cv) {
    cv.km = km;
    lockOriginCvYears(cv, modelYear);
  }
  if (nested) {
    nested.km = km;
    lockOriginCvYears(nested, modelYear);
  }
  return km;
}

function sanitizeDossier(raw, filePath) {
  if (!raw || typeof raw !== 'object') throw new Error('readDossier: invalid JSON');
  const dossier = JSON.parse(JSON.stringify(raw));
  const lockedKmValue = freezeOriginKm(dossier);
  const lockedYear = dossier.origin_cv && dossier.origin_cv.model_year;
  dossier.writes_erp = WRITES_ERP;
  if (dossier.origin_cv && typeof dossier.origin_cv === 'object') {
    dossier.origin_cv.writes_erp = WRITES_ERP;
    dossier.origin_cv.km = lockedKmValue;
    lockOriginCvYears(dossier.origin_cv, lockedYear);
  }
  if (dossier.identity && typeof dossier.identity === 'object') {
    const ident = { ...dossier.identity };
    delete ident.year;
    delete ident.aar;
    delete ident.model_year;
    dossier.identity = ident;
  }
  dossier.own_sold = false;
  dossier.own_sold_excluded = true;
  const mapped = mapChefComps(dossier);
  dossier.comps = mapped;
  if (dossier.finn && typeof dossier.finn === 'object' && mapped.length) {
    dossier.finn.ads = mapped;
  }
  dossier._path = filePath || null;
  if (dossier.finn && dossier.finn.url) {
    assertJrFinnUrl(dossier.finn.url);
  }
  return dossier;
}

function readDossierFile(filePath) {
  const abs = path.resolve(filePath);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return sanitizeDossier(raw, abs);
}

function findDossier(opts = {}) {
  for (const p of candidatePaths(opts)) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return readDossierFile(p);
    }
  }
  return null;
}

function logFallback({ chef, erpId, internnr, regnr, reason } = {}) {
  const id = internnr != null ? internnr : erpId;
  const plate = upperRegnr(regnr);
  log(
    `DOSSIER MANGLER for ${chef || 'chef'} internnr/erp=${id || '?'} regnr=${plate || '?'} ` +
    `(${reason || 'not found'}) — fallback til gammel Finn/car.info-søk`
  );
}

function preserveOriginKm(originCv, carInfo) {
  if (!originCv) return originCv;
  const beforeKm = originCv.km;
  const beforeYear = originCv.model_year;
  const next = applyCarInfoIdentity(originCv, carInfo || null);
  next.km = beforeKm;
  lockOriginCvYears(next, beforeYear);
  if (Object.prototype.hasOwnProperty.call(next, 'origin')) {
    next.origin = { ...next.origin, km: beforeKm };
    lockOriginCvYears(next.origin, beforeYear);
  }
  return next;
}

/**
 * Official chef API. Easy/V3/V3G/Bot4 call this first.
 * hit.ok=true if dossier exists. skipOwnSearch=true ONLY when pool.length>=1.
 */
function loadForChef({ chef, erpId, internnr, regnr, dir } = {}) {
  const name = String(chef || '').toLowerCase() || 'chef';
  const dossier = findDossier({ erpId, internnr, regnr, dir });
  if (!dossier) {
    const result = {
      ok: false,
      fallback: true,
      skipOwnSearch: false,
      chef: name,
      reason: 'dossier_missing',
      writes_erp: WRITES_ERP,
      origin_cv: null,
      dossier: null,
      comps: [],
      pool: [],
      finn: null,
      path: null,
    };
    logFallback({ chef: name, erpId, internnr, regnr, reason: 'dossier_missing' });
    return result;
  }
  const origin_cv = preserveOriginKm(dossier.origin_cv, null);
  const pool = mapChefComps(dossier).map(c => ({
    price: c.price,
    km: c.km ?? null,
    url: c.url ?? null,
    title: c.title ?? null,
    year: c.year ?? null,
  }));
  const skipOwnSearch = pool.length >= 1;
  if (skipOwnSearch) {
    log(
      `${name} leser Jr-dossier ${dossier._path} km=${origin_cv && origin_cv.km} ` +
      `year=${origin_cv && origin_cv.model_year} ` +
      `n_comps=${pool.length} writes_erp=${WRITES_ERP} — skipOwnSearch=true`
    );
  } else {
    log(
      `${name} leser Jr-dossier ${dossier._path} km=${origin_cv && origin_cv.km} ` +
      `year=${origin_cv && origin_cv.model_year} ` +
      `n_comps=0 writes_erp=${WRITES_ERP} — mapped comps tom (Mini-pool tom). ` +
      `skipOwnSearch=false — sjef MÅ kjøre eget Finn-søk. origin.km+model_year låst.`
    );
  }
  return {
    ok: true,
    fallback: false,
    skipOwnSearch,
    chef: name,
    reason: skipOwnSearch ? 'dossier_hit' : 'dossier_hit_empty_pool',
    writes_erp: WRITES_ERP,
    origin_cv,
    dossier,
    comps: pool,
    pool,
    finn: dossier.finn || null,
    path: dossier._path,
  };
}

function forChef(chef) {
  return {
    chef,
    load: (opts = {}) => loadForChef({ ...opts, chef }),
  };
}

module.exports = {
  WRITES_ERP,
  CHEFS,
  MINI_DOSSIER_DIR,
  dossierDirs,
  dossierFilename,
  candidatePaths,
  findDossier,
  readDossierFile,
  loadForChef,
  logFallback,
  preserveOriginKm,
  freezeOriginKm,
  forChef,
  mapChefComps,
  easy: forChef('easy'),
  v3: forChef('v3'),
  v3g: forChef('v3g'),
  bot4: forChef('bot4'),
};
