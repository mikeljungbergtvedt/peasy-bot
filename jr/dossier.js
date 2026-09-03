'use strict';

const { applyCarInfoIdentity, WRITES_ERP } = require('./origin-cv');
const { buildFinnQuery, buildFinnUrl } = require('./finn-query');
const { mapChefComps } = require('./analog-comps');

const CHEFS = ['easy', 'v3', 'v3g', 'bot4'];
const SCHEMA = 'peasy-jr-dossier/v1';

function merkeModellFrom(originCv) {
  const identity = originCv && originCv.identity;
  const merke = (identity && identity.make) || originCv.make || '';
  const modell = (identity && identity.model) || originCv.model || originCv.model_series || '';
  return { merke, modell };
}

/**
 * One dossier JSON for the chefs. Same origin_cv bytes for Easy / V3 / V3G / Bot4.
 * writes_erp is always false. own_sold comps are dropped, never attached.
 */
function buildDossier({ originCv, carInfo, comps, finn, chef } = {}) {
  if (!originCv) throw new Error('buildDossier: originCv required');
  const locked = applyCarInfoIdentity(originCv, carInfo || null);
  if (locked.km !== originCv.km) {
    throw new Error('buildDossier: car.info must never overwrite origin.km');
  }
  if (locked.model_year !== originCv.model_year) {
    throw new Error('buildDossier: car.info must never overwrite origin.model_year');
  }
  const { merke, modell } = merkeModellFrom(locked);
  const q = buildFinnQuery(merke, modell);
  const url = buildFinnUrl(merke, modell);
  const mapped = mapChefComps({
    comps: comps || [],
    finn: finn && typeof finn === 'object' ? finn : null,
  });

  return {
    schema: SCHEMA,
    trinn: 1,
    writes_erp: WRITES_ERP,
    chef: chef || 'shared',
    chefs: CHEFS,
    origin_cv: locked,
    identity: locked.identity || null,
    finn: {
      q,
      url,
      year: null,
      km: null,
      kW: null,
      ...(mapped.length ? { ads: mapped } : {}),
    },
    own_sold: false,
    own_sold_excluded: true,
    comps: mapped,
    built_at: new Date().toISOString(),
  };
}

function dossiersForChefs(args) {
  const shared = buildDossier({ ...args, chef: 'shared' });
  const byChef = {};
  for (const chef of CHEFS) {
    byChef[chef] = { ...shared, chef };
  }
  const bytes = CHEFS.map(c => JSON.stringify(byChef[c].origin_cv));
  if (new Set(bytes).size !== 1) {
    throw new Error('chefs received different origin_cv bytes');
  }
  return { shared, byChef };
}

module.exports = {
  SCHEMA,
  CHEFS,
  buildDossier,
  dossiersForChefs,
  merkeModellFrom,
};
