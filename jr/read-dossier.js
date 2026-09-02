'use strict';

/**
 * Chef dossier-read (Easy / V3 / V3G / Bot4).
 *
 * Mini path: /Users/bot/peasy-auto/jr/dossiers/{erpId}-{REGNR}.json
 * Override with JR_DOSSIER_DIR.
 *
 * When a dossier exists, chefs MUST use it instead of their own
 * Finn / car.info search. Missing dossier → fallback to old search + log.
 * origin.km is never overwritten. own_sold comps are dropped.
 * writes_erp is always false.
 */

const fs = require('fs');
const path = require('path');
const { applyCarInfoIdentity, dropOwnSold, lockedKm, upperRegnr, WRITES_ERP } = require('./origin-cv');
const { assertJrFinnUrl } = require('./finn-query');

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
  if (cv) cv.km = km;
  if (nested) nested.km = km;
  return km;
}

function sanitizeDossier(raw, filePath) {
  if (!raw || typeof raw !== 'object') throw new Error('readDossier: invalid JSON');
  const dossier = JSON.parse(JSON.stringify(raw));
  const lockedKmValue = freezeOriginKm(dossier);
  dossier.writes_erp = WRITES_ERP;
  if (dossier.origin_cv && typeof dossier.origin_cv === 'object') {
    dossier.origin_cv.writes_erp = WRITES_ERP;
    dossier.origin_cv.km = lockedKmValue;
  }
  dossier.own_sold = false;
  dossier.own_sold_excluded = true;
  dossier.comps = dropOwnSold(dossier.comps || []);
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
  const before = originCv.km;
  const next = applyCarInfoIdentity(originCv, carInfo || null);
  next.km = before;
  if (Object.prototype.hasOwnProperty.call(next, 'origin')) {
    next.origin = { ...next.origin, km: before };
  }
  return next;
}

/**
 * Official chef API. Easy/V3/V3G/Bot4 call this first.
 * skipOwnSearch=true → do not build Finn/car.info search.
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
      finn: null,
      path: null,
    };
    logFallback({ chef: name, erpId, internnr, regnr, reason: 'dossier_missing' });
    return result;
  }
  const origin_cv = preserveOriginKm(dossier.origin_cv, null);
  log(
    `${name} leser Jr-dossier ${dossier._path} km=${origin_cv && origin_cv.km} ` +
    `writes_erp=${WRITES_ERP} — hopper over egen Finn/car.info-søk`
  );
  return {
    ok: true,
    fallback: false,
    skipOwnSearch: true,
    chef: name,
    reason: 'dossier_hit',
    writes_erp: WRITES_ERP,
    origin_cv,
    dossier,
    comps: dropOwnSold(dossier.comps || []),
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
  easy: forChef('easy'),
  v3: forChef('v3'),
  v3g: forChef('v3g'),
  bot4: forChef('bot4'),
};
