// v3g-eval.js — evaluer én bil: ERP → car.info → Finn-utpris → kalkyle → logg
//
// CLI: node v3g-eval.js <regnr> [km]
// Skygge på arm A. På arm B (oddetall internnr) og liste 3: skriver
// samme ERP-felt som Easy (dLav/dHoy, auksjonstype, heftelser, eiersjekk, eval-kort).
// Ordna (source=ordna) står utenfor A/B: locked Ordna = A×0.75; V3G skriver fossefall-armens lav/høy.
// Confirm/send til kunde skjer bare via QA.

import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { createRequire } from 'module';
import { findByRegnr, getCarDetail, fetchEasySnapshot } from './v3g-erp.js';
import { fetchCarInfo, fetchCarInfoRaw } from './v3g-carinfo.js';
import { computeAnker } from './v3g-anker.js';
import { appendMeasurement } from './v3g-measurements.js';
import { writeV3gFinalEstimate } from './v3g-erp-write.js';
import { calculatePricing, applyOrdnaKalkyle, applyV3gReturKalkyle, applyVrakpantOverride } from '../v2/pricing-formula.js';
import { loadKmCache, getKmForRegnr } from '../v2/km-cache.js';
import { countSoldComps } from '../v2/v3-carinfo-anker.js';

const require = createRequire(import.meta.url);
const { buildFossefall, loadFossefallSatser } = require('../fossefall.js');
const { originCv } = require('../origin-cv.js');
const { stripOriginFromMarket, ensureFinnUtpris } = require('../finn-utpris.js');
const {
  classifyBiltype,
  formatScopeCard,
  fetchVegvesenSignals,
  signalsFromCarInfo,
} = require('../biltype-gate.js');
const { findFinnOrigin, writeFinnLink, buildSisterSearch, classifySisterPropulsion, capFinnUtpris } = require('../finn-origin.js');
const { scoreIdentComps } = require('../ident-comps-score.js');
const { liveOwner, isOrdnaSource, v3gShouldWrite } = require('../ab-arm.js');
const originComps = require('../origin-comps.js');
const originChefs = require('../origin-chefs.js');
const { lockOriginIdentity, applyOriginLock, pickCarInfoIdent, identForComps, finnSearchFromIdent } = require('../origin-lock.js');
const { pickTwinCluster } = require('../twin-pool.js');
const { resolveEvalKm } = require('../eval-km.js');
const { resolveKjorbar, wreckerPricing } = require('../kjorbar.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '..', '.env'), quiet: true });
// Force FOSSEFALL_* (dotenv skips pre-set keys)
(function forceFossefallEnvFromDotenv() {
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
      const m = line.match(/^\s*(FOSSEFALL_[A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch (_) {}
})();

function log(msg) {
  console.log(`[${new Date().toISOString()}] [v3g-eval] ${msg}`);
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveKm(cliKm, regnr, listed, detail) {
  return resolveEvalKm({
    cli: cliKm,
    cliExplicit: cliKm != null && Number(cliKm) > 0,
    erp: detail?.km,
    listed: listed?.km,
    cache: getKmForRegnr(regnr),
  });
}

/**
 * Evaluer én intern. Samme skilt kan ligge flere ganger — opts.erpId velger intern.
 * @param {string} regnr
 * @param {number|null} [kmOverride]
 * @param {{origin_cv?:object, erpId?:number|string, jrDossier?:object}} [opts]
 * @returns {Promise<object>}
 */

async function attachFossefall(record) {
  try {
    try { await loadFossefallSatser(); } catch (_) { /* cache miss → PRIS MANUELT downstream */ }
    const finnFf = Number(
      (record.v3g && (record.v3g.finn_utpris != null ? record.v3g.finn_utpris : record.v3g.anker))
      || record.finn_utpris
      || (record.easy && (record.easy.finn_utpris != null ? record.easy.finn_utpris : record.easy.anker))
    );
    if (!Number.isFinite(finnFf) || finnFf <= 0) return record;
    const lagret = {};
    const hints = {};
    if (record.easy && Number.isFinite(Number(record.easy.dLav))) {
      lagret.a = { dLav: record.easy.dLav, dHoy: record.easy.dHoy };
      hints.a = {
        anker_lagret: record.easy.finn_utpris != null ? record.easy.finn_utpris : record.easy.anker,
        km_override: !!(record.easy.km_override || record.km_override),
        origin_cap: !!record.easy.origin_cap,
        vrakpant: !!record.easy.vrakpant,
        wrecker: !!record.easy.wrecker || !!record.wrecker,
        aar_mangler: !(record.modelYear),
      };
    }
    if (record.v3g && Number.isFinite(Number(record.v3g.dLav))) {
      const band = { dLav: record.v3g.dLav, dHoy: record.v3g.dHoy };
      const h = {
        anker_lagret: record.v3g.finn_utpris != null ? record.v3g.finn_utpris : record.v3g.anker,
        km_override: !!record.km_override,
        origin_cap: !!record.v3g.origin_cap,
        wrecker: !!record.wrecker,
        aar_mangler: !(record.modelYear),
      };
      if (record.v3g.kalkyle === 'ordna') { lagret.ordna = band; hints.ordna = h; }
      else { lagret.b = band; hints.b = h; }
    }
    let soldDays = [];
    try {
      const { extractSoldDays } = require('../fossefall.js');
      const vc = (record.valgte_comps
        || (record.v3g && record.v3g.valgte_comps)
        || (record.easy && record.easy.valgte_comps)
        || (record.anchor && record.anchor.valgte_comps)
        || []);
      soldDays = extractSoldDays(vc);
    } catch (_) {}
    record.fossefall = buildFossefall({
      finnUtpris: finnFf,
      km: record.km,
      modelYear: record.modelYear,
      bilInfo: { year: record.modelYear || 2020 },
      lagret,
      hints,
      soldDays,
    });
    // Locked: ERP/Pulse «sent lav» = writing arm's fossefall lav (not retur/Ordna haircut path).
    const ff = record.fossefall;
    if (ff && !ff.pris_manuelt && record.v3g) {
      const ordna = isOrdnaSource(record.source);
      const arm = ordna ? ff.ordna : ff.b;
      const lav = arm && Number(arm.lav);
      const hoy = arm && Number(arm.hoy);
      if (Number.isFinite(lav) && lav > 0 && Number.isFinite(hoy) && hoy > 0) {
        if (record.v3g.dLav !== lav || record.v3g.dHoy !== hoy) {
          record.v3g.original_dLav = record.v3g.dLav;
          record.v3g.original_dHoy = record.v3g.dHoy;
        }
        record.v3g.dLav = lav;
        record.v3g.dHoy = hoy;
        record.v3g.fossefall_arm = ordna ? 'ordna' : 'b';
        record.v3g.kalkyle = 'fossefall';
        delete record.v3g.retur_kalkyle;
        delete record.v3g.retur_mult;
        delete record.v3g.ordna_kalkyle;
        delete record.v3g.ordna_mult;
      }
    }
  } catch (_) { /* ikke-kritisk */ }
  return record;
}

export async function evalRegnr(regnr, kmOverride = null, opts = {}) {
  const plate = String(regnr || '').trim().toUpperCase();
  if (!plate) throw new Error('regnr mangler');

  const startedAt = new Date().toISOString();
  const errors = [];
  const wantId = opts.erpId != null && opts.erpId !== '' ? Number(opts.erpId) : NaN;

  log(`starter ${plate}${Number.isFinite(wantId) ? ' erpId=' + wantId : ''}`);
  await loadKmCache();

  const listed = await findByRegnr(plate, Number.isFinite(wantId) ? { erpId: wantId } : {});
  if (!listed?.erpId) throw new Error(`Regnr ${plate} ikke funnet i ERP`);
  if (Number.isFinite(wantId) && Number(listed.erpId) !== wantId) {
    throw new Error(`${plate} eval bandt erpId=${listed.erpId}, forventet ${wantId}`);
  }
  try { require('../ai-usage.js').setContext({ bot: 'v3g', regnr: plate, erpId: listed.erpId }); } catch (eAi) {}

  /* JR_DOSSIER_HOOK */
  let __jrHit = (opts && opts.jrDossier) || null;
  try {
    if (!(__jrHit && __jrHit.ok)) {
      __jrHit = require("/Users/bot/peasy-auto/jr/read-dossier").loadForChef({ chef: "v3g", internnr: listed.erpId, erpId: listed.erpId, regnr: plate });
    }
    if (__jrHit && __jrHit.ok && __jrHit.origin_cv) {
      opts = Object.assign({}, opts || {}, { origin_cv: __jrHit.origin_cv, jrDossier: __jrHit });
      log("Jr-dossier " + (__jrHit.path || "") + " km=" + __jrHit.origin_cv.km);
    }
  } catch (__jrErr) {
    log("Jr-dossier hook: " + (__jrErr && __jrErr.message));
  }
  if (!(__jrHit && __jrHit.ok)) {
    log("Jr-dossier mangler for " + plate + " — venter (ingen prising)");
    return { skipped: "jr_dossier_missing", regnr: plate, erpId: listed.erpId };
  }

  let origin_cv = (__jrHit && __jrHit.ok && __jrHit.origin_cv) ? __jrHit.origin_cv : (opts.origin_cv || null);
  try {
    if (!origin_cv) origin_cv = await originCv(listed.erpId);
  } catch (eCv) {
    errors.push('origin-cv: ' + (eCv.message || eCv));
  }

  const detail = await getCarDetail(listed.erpId);
  const km = (origin_cv && origin_cv.km != null)
    ? origin_cv.km
    : resolveKm(kmOverride, plate, listed, detail);
  const modelYear = (origin_cv && origin_cv.model_year != null)
    ? origin_cv.model_year
    : (detail.modelYear ?? listed.modelYear ?? null);
  const kundeComment = (origin_cv && origin_cv.seller_comment != null)
    ? origin_cv.seller_comment
    : (detail.kundeComment || null);
  const kb = resolveKjorbar({ is_drivable: detail.is_drivable, sd_comment: kundeComment });
  const source = listed.source || detail.source || null;
  const owner = liveOwner(listed.erpId, source);

  log(`${plate} erpId=${listed.erpId} km=${km} år=${modelYear || '?'} kilde=${source || '—'} eier=${owner}`);

  const vegSignals = await fetchVegvesenSignals(plate);
  const classSignals = vegSignals.ok
    ? {
      avgiftsgruppe: vegSignals.avgiftsgruppe,
      tekniskKode: vegSignals.tekniskKode,
      karosseri: vegSignals.karosseri,
      make: vegSignals.make || detail.make || listed.make,
      model: vegSignals.model || detail.model || listed.model,
    }
    : {
      make: detail.make || listed.make,
      model: detail.model || listed.model,
    };
  if (!vegSignals.ok) {
    errors.push('biltype Vegvesen: ' + (vegSignals.error || 'ukjent'));
    const ciRaw = await fetchCarInfoRaw(plate, km);
    if (ciRaw.ok) Object.assign(classSignals, signalsFromCarInfo(ciRaw.raw));
  }

  const biltypeGate = classifyBiltype(classSignals);
  if (!biltypeGate.ok) {
    log(`UTENFOR SCOPE ${plate} klasse=${biltypeGate.klasse} fant=${biltypeGate.fant} — hopper over Grok-anker`);
    const evalKort = formatScopeCard({
      regnr: plate,
      erpId: listed.erpId,
      make: detail.make || listed.make,
      model: detail.model || listed.model,
      year: modelYear,
      km,
      gate: biltypeGate,
      html: false,
    });
    const record = {
      evaluator: 'v3g',
      timestamp: startedAt,
      regnr: plate,
      erpId: listed.erpId,
      km,
      modelYear,
      make: detail.make || listed.make || null,
      model: detail.model || listed.model || null,
      onListe3: !!listed.onListe3,
      source,
      owner,
      kundeComment,
      utenfor_scope: true,
      origin_cv,
      biltype: {
        klasse: biltypeGate.klasse,
        fant: biltypeGate.fant,
        reason: biltypeGate.reason,
      },
      eval_kort: evalKort,
      v3g: null,
      easy: await fetchEasySnapshot(listed.erpId),
      carinfo: { ok: false, skipped: 'utenfor_scope' },
      pricing: null,
      has_errors: errors.length > 0,
      errors,
    };
    await appendMeasurement(await attachFossefall(record));
    log(`ferdig ${plate} utenfor_scope=${biltypeGate.klasse}`);
    return record;
  }

  /* JR_DOSSIER_HOOK_COMPS */
  let carInfo;
  let originFinn = null;
  if (__jrHit && __jrHit.ok && ((__jrHit.comps || []).length >= 1)) {
    const __raw = (__jrHit.comps || []).concat((__jrHit.finn && __jrHit.finn.ads) || []);
    carInfo = { ok: true, comps: __raw, anker_raw: null, error: null, valuation: null };
    try {
      const ciRaw = await fetchCarInfoRaw(plate, km);
      if (ciRaw && ciRaw.ok) Object.assign(carInfo, pickCarInfoIdent(ciRaw.raw));
    } catch (eId) {}
    log("Jr-dossier pool=" + __raw.length + " (hopper eget Finn-sok)");
  } else {
    if (__jrHit && __jrHit.ok) log("Jr-dossier pool=0 — eget Finn-sok");
    carInfo = await fetchCarInfo(plate, km);
    if (!carInfo.ok) errors.push('car.info: ' + (carInfo.error || 'ukjent feil'));
    originFinn = await findFinnOrigin(plate, {
      vin: detail.vin || listed.vin || (carInfo && carInfo.vin) || null,
      valuation: carInfo && carInfo.valuation,
      erpId: listed.erpId,
    });
    if (originFinn) writeFinnLink(listed.erpId, originFinn);
  }

  const gate2 = classifyBiltype({
    ...classSignals,
    make: detail.make || listed.make || classSignals.make,
    model: detail.model || listed.model || classSignals.model,
    car_name: carInfo?.summary?.full_name || carInfo?.valuation?.company_valuation?.full_name || carInfo?.car_name,
    chassis: carInfo?.chassis || carInfo?.summary?.chassis || classSignals.karosseri,
    body_type: carInfo?.body_type || carInfo?.chassis || classSignals.karosseri,
    vehicle_type: carInfo?.vehicle_type,
  });
  if (!gate2.ok) {
    log(`UTENFOR SCOPE ${plate} (etter car.info) klasse=${gate2.klasse} fant=${gate2.fant}`);
    const evalKort = formatScopeCard({
      regnr: plate,
      erpId: listed.erpId,
      make: detail.make || listed.make,
      model: detail.model || listed.model,
      year: modelYear,
      km,
      gate: gate2,
      html: false,
    });
    const record = {
      evaluator: 'v3g',
      timestamp: startedAt,
      regnr: plate,
      erpId: listed.erpId,
      km,
      modelYear,
      make: detail.make || listed.make || null,
      model: detail.model || listed.model || null,
      onListe3: !!listed.onListe3,
      source,
      owner,
      kundeComment,
      utenfor_scope: true,
      origin_cv,
      biltype: { klasse: gate2.klasse, fant: gate2.fant, reason: gate2.reason },
      eval_kort: evalKort,
      v3g: null,
      easy: await fetchEasySnapshot(listed.erpId),
      carinfo: { ok: !!carInfo.ok, anker_raw: carInfo.anker_raw ?? null, comps: (carInfo.comps || []).length, error: carInfo.error || null },
      pricing: null,
      has_errors: errors.length > 0,
      errors,
    };
    await appendMeasurement(await attachFossefall(record));
    return record;
  }

  if (kb.wrecker) {
    const wp = wreckerPricing(kb.reason);
    log(`${plate} WRECKER kjorbar=${kb.kjorbar} — skip comps (${kb.reason})`);
    const recordW = {
      evaluator: 'v3g',
      timestamp: startedAt,
      regnr: plate,
      erpId: listed.erpId,
      km,
      modelYear,
      make: detail.make || listed.make || null,
      model: detail.model || listed.model || null,
      onListe3: !!listed.onListe3,
      source,
      owner,
      kundeComment,
      kjorbar: kb.kjorbar,
      wrecker: true,
      utenfor_scope: false,
      biltype: {
        klasse: (gate2 && gate2.klasse) || (biltypeGate && biltypeGate.klasse) || null,
        fant: (gate2 && gate2.fant) || (biltypeGate && biltypeGate.fant) || null,
        reason: (gate2 && gate2.reason) || (biltypeGate && biltypeGate.reason) || null,
      },
      v3g: {
        anker: wp.anker,
        dLav: wp.dLav,
        dHoy: wp.dHoy,
        score: 20,
        confidence: 0.2,
        begrunnelse: wp.begrunnelse,
        wrecker: true,
      },
      ident_score: null,
      comps_score: null,
      combined_score: null,
      easy: await fetchEasySnapshot(listed.erpId),
      carinfo: { ok: !!carInfo.ok, skipped: 'wrecker' },
      pricing: { dLav: wp.dLav, dHoy: wp.dHoy, wrecker: true, auctionTypeId: wp.auctionTypeId },
      has_errors: errors.length > 0,
      errors,
    };
    if (v3gShouldWrite(listed.erpId, source) && listed.onListe3 && Number(wp.dLav) > 0) {
      try {
        const wr = await writeV3gFinalEstimate(recordW);
        recordW.erp_write = wr;
        if (wr && wr.ok) log(`${plate} ${owner} wrecker skrevet til ERP`);
      } catch (eW) {
        errors.push('erp-write: ' + eW.message);
        recordW.erp_write = { ok: false, error: eW.message };
        recordW.has_errors = true;
        recordW.errors = errors;
      }
    }
    await appendMeasurement(await attachFossefall(recordW));
    log(`ferdig ${plate} wrecker dLav=${wp.dLav}`);
    return recordW;
  }

  const locked = lockOriginIdentity({
    vegvesen: vegSignals,
    origin_cv,
    carInfo,
  });
  log(`${plate} origin-id ${locked.car_name || locked.model || '?'} fuel=${locked.fuel || '—'} hk=${locked.hk || '—'} gir=${locked.gir || '—'} src=${locked.source || ''}`);
  if (carInfo && typeof carInfo === 'object') {
    Object.assign(carInfo, applyOriginLock(carInfo, locked));
  }
  const finnSearch = finnSearchFromIdent(locked);
  log(`${plate} finn-id q="${finnSearch.q || ''}" hk=${finnSearch.hk || '—'} codes=${JSON.stringify(finnSearch.fuelCodes)}`);

  let jrPool = null;
  if (__jrHit && __jrHit.ok && ((__jrHit.comps || []).length >= 1)) {
    jrPool = (__jrHit.comps || []).concat((__jrHit.finn && __jrHit.finn.ads) || []);
    log(`${plate} Jr-dossier pool=${jrPool.length} — hopper eget Finn-sok`);
  }

  const soldCarinfo = countSoldComps(carInfo.comps);
  const stripped = stripOriginFromMarket((carInfo.comps || []), {
    plate,
    finn_url: originFinn && originFinn.link,
  });
  const clustered = pickTwinCluster(stripped.comps, km);
  let sister = null;
  let sisterComps = [];
  let originRec = null;
  try {
    originRec = await originComps.ensure({
      erpId: listed.erpId,
      regnr: plate,
      km,
      carInfo,
      finnPool: jrPool,
      originFinn,
      origin_cv,
      locked,
      finnSearch,
      klasse: (gate2 && gate2.ok ? gate2.klasse : biltypeGate.klasse) || 'personbil',
      ident: identForComps(locked, {
        make: vegSignals.make || detail.make || listed.make || '',
        model: vegSignals.model || (origin_cv && origin_cv.model_series) || detail.model || listed.model || '',
        year: vegSignals.year || vegSignals.modelYear || modelYear || null,
        fuel: vegSignals.fuel || detail.fuelType || '',
        karosseri: vegSignals.karosseri || classSignals.karosseri || '',
        drive: vegSignals.drive || '',
        gir: vegSignals.gearbox || '',
      }),
    });
    if (originRec && !originRec.skip_put) {
      originRec = await originChefs.price(originRec, {
        origin_cv,
        originFinn,
        km,
        erpId: listed.erpId,
        regnr: plate,
      });
    }
  } catch (eOc) {
    errors.push('origin-comps: ' + (eOc.message || eOc));
    log(`${plate} origin-comps feilet: ${eOc.message || eOc}`);
  }

  if (jrPool) {
    sister = {
      ok: true,
      skipped: 'jr-dossier',
      n_sold: originRec && originRec.n_sold,
      n_ask: originRec && originRec.n_ask,
    };
  } else {
    try {
      sister = await buildSisterSearch({
        make: locked.make || vegSignals.make || detail.make || listed.make,
        model: locked.model || vegSignals.model || (origin_cv && origin_cv.model_series) || detail.model || listed.model,
        year: locked.year || vegSignals.year || vegSignals.modelYear || modelYear,
        km,
        klasse: (gate2 && gate2.ok ? gate2.klasse : biltypeGate.klasse) || 'personbil',
        fuel: locked.fuel || vegSignals.fuel || detail.fuelType,
        fuelType: detail.fuelType,
        fuelId: detail.fuelId,
        gearbox: locked.gir || vegSignals.gearbox || detail.gearboxType,
        gearboxType: detail.gearboxType,
        kw: vegSignals.kw || detail.engineKw,
        hk: locked.hk,
        secondMotorKw: detail.secondMotorKw,
        electricRange: detail.electricRange,
        drive: locked.drivlinje || vegSignals.drive,
        motorCount: vegSignals.motorCount,
        originLink: originFinn && originFinn.link,
        variant: locked.variant,
        car_name: locked.car_name,
        engine: locked.engine,
        search: finnSearch,
      });
      if (sister && sister.url) {
        log(`${plate} søster ${sister.hitsExOrigin ?? sister.hits ?? '?'} treff ${sister.widened || 'base'} ${sister.label || ''}`);
      }
      if (sister && Array.isArray(sister.comps) && sister.comps.length) {
        sisterComps = sister.comps;
      }
    } catch (eSis) {
      errors.push('sister: ' + (eSis.message || 'ukjent'));
      sister = { ok: false, error: eSis && eSis.message };
    }
  }

  let ankerRes;
  let originCap = null;
  if (originRec && originRec.skip_put) {
    ankerRes = {
      ok: false,
      anker: null,
      finn_utpris: null,
      finn_utpris_grunn: '0 eksterne origin-comps',
      valgte_comps: [],
      ekskluderte: (stripped.ekskluderte || []).concat(originComps.toOwnExcluded(originRec)),
      skip_put: true,
      justering_kr: 0,
    };
    log(`${plate} origin-comps SKIP_PUT n_ext=0`);
  } else if (originRec && originRec.finn_utpris > 0) {
    ankerRes = {
      ok: true,
      anker: originRec.finn_utpris,
      finn_utpris: originRec.finn_utpris,
      finn_utpris_grunn: originRec.finn_utpris_kilde,
      valgte_comps: originComps.toValgte(originRec),
      ekskluderte: (stripped.ekskluderte || []).concat(originComps.toOwnExcluded(originRec)),
      skip_put: false,
      justering_kr: 0,
    };
    originCap = /origin95/.test(originRec.finn_utpris_kilde || '') ? 0.95 : null;
    ankerRes.chefs = originRec.chefs || null;
    log(`${plate} origin-chefs utpris=${originRec.finn_utpris} kilde=${originRec.finn_utpris_kilde} n_ext=${originRec.n_external} sold=${originRec.n_sold} ask=${originRec.n_ask}`);
  } else {
    ankerRes = await computeAnker({
      carInfo,
      kundeComment,
      km,
      originFinn,
      extraComps: clustered.comps.length ? clustered.comps : stripped.comps,
      origin_cv,
      bilinfo: {
        regnr: plate,
        erpId: listed.erpId,
        make: detail.make || listed.make,
        model: detail.model || listed.model,
        modelYear,
      },
    });
    ankerRes.justering_kr = 0;
    ankerRes.finn_utpris = ankerRes.finn_utpris != null ? ankerRes.finn_utpris : ankerRes.anker;
    ankerRes.valgte_comps = ankerRes.valgte_comps || [];
    ankerRes.ekskluderte = (ankerRes.ekskluderte || []).concat(stripped.ekskluderte);
    if (!(ankerRes.finn_utpris > 0)) {
      ankerRes.finn_utpris = ensureFinnUtpris(null, stripped.comps, {
        valgte: ankerRes.valgte_comps,
        origin: originFinn,
        carinfo: { price: carInfo.anker_raw, classifieds_avg_price: carInfo.summary && carInfo.summary.classifieds_avg_price },
      });
    }
    if (!(ankerRes.finn_utpris > 0)) {
      ankerRes.ok = false;
      ankerRes.anker = null;
      ankerRes.finn_utpris_grunn = ankerRes.finn_utpris_grunn || ankerRes.begrunnelse || ankerRes.error || 'ingen markedsevidens';
      log(`${plate} Finn-utpris mangler markedsevidens (${ankerRes.finn_utpris_grunn})`);
    } else {
      ankerRes.ok = true;
      ankerRes.anker = ankerRes.finn_utpris;
      log(`${plate} Finn-utpris ${ankerRes.finn_utpris} n=${ankerRes.valgte_comps.length}`);
    }
  }

  if (ankerRes && ankerRes.finn_utpris > 0) {
    const capRes = capFinnUtpris(ankerRes.finn_utpris, originFinn);
    if (capRes.origin_cap != null) {
      const fu = Math.round(Number(capRes.finn_utpris) / 1000) * 1000;
      const from = ankerRes.finn_utpris;
      ankerRes.finn_utpris = fu;
      ankerRes.anker = fu;
      originCap = capRes.origin_cap;
      if (ankerRes.finn_utpris_grunn && !/origin95/.test(String(ankerRes.finn_utpris_grunn))) {
        ankerRes.finn_utpris_grunn += '+origin95';
      }
      log(`${plate} origin_cap ${capRes.origin_cap} (ask ${capRes.originPrice} utpris ${from} → ${fu})`);
    }
  }

  let pricing = null;
  if (ankerRes.ok && Number.isFinite(ankerRes.anker)) {
    pricing = calculatePricing({
      anchorPrice: ankerRes.anker,
      km,
      modelYear,
      lowestComp: null,
    });
    if (isOrdnaSource(source)) {
      pricing = applyOrdnaKalkyle(pricing);
      log(`${plate} Ordna-kalkyle ×${pricing.ordna_mult} dLav ${pricing.original_dLav} → ${pricing.dLav}`);
    } else {
      pricing = applyV3gReturKalkyle(pricing);
      log(`${plate} retur-kalkyle ×${pricing.retur_mult} dLav ${pricing.original_dLav} → ${pricing.dLav}`);
    }
    pricing = applyVrakpantOverride(pricing);
  }

  const easy = await fetchEasySnapshot(listed.erpId);

  let scores = null;
  try {
    scores = scoreIdentComps({
      make: detail.make || listed.make || vegSignals.make,
      model: detail.model || listed.model || vegSignals.model,
      year: modelYear,
      fuel: vegSignals.fuel || detail.fuelType,
      propulsion: classifySisterPropulsion({
        fuel: vegSignals.fuel || detail.fuelType,
        fuelType: detail.fuelType,
        fuelId: detail.fuelId,
        motorCount: vegSignals.motorCount,
        secondMotorKw: vegSignals.secondMotorKw || detail.secondMotorKw,
        electricRange: vegSignals.range || detail.electricRange,
      }),
      drive: vegSignals.drive,
      klasse: (gate2 && gate2.klasse) || (biltypeGate && biltypeGate.klasse) || 'personbil',
      hk: vegSignals.hk,
      kw: vegSignals.kw || detail.engineKw,
      range: vegSignals.range || detail.electricRange,
      originLink: originFinn && originFinn.link,
      originTitle: originFinn && originFinn.title,
      originModel: originFinn && originFinn.model,
      comps: (ankerRes.valgte_comps || []).map((c) => ({
        title: c.title || c.heading || c.tittel,
        model: c.model || c.series,
        licence_plate: c.licence_plate || c.plate,
        price: c.price,
        km: c.km,
        fuel: c.fuel,
        drive: c.drive,
      })),
    });
  } catch (eSc) {
    errors.push('ident-score: ' + eSc.message);
  }

  const record = {
    evaluator: 'v3g',
    timestamp: startedAt,
    regnr: plate,
    erpId: listed.erpId,
    km,
    modelYear,
    make: detail.make || listed.make || null,
    model: detail.model || listed.model || null,
    onListe3: !!listed.onListe3,
    source,
    owner,
    kundeComment,
    kjorbar: kb.kjorbar,
    wrecker: !!kb.wrecker,
    utenfor_scope: false,
    biltype: {
      klasse: biltypeGate.klasse,
      fant: biltypeGate.fant,
      reason: biltypeGate.reason,
    },
    v3g: ankerRes.ok && pricing ? {
      anker: ankerRes.anker,
      dLav: pricing.dLav,
      dHoy: pricing.dHoy,
      score: ankerRes.score,
      confidence: ankerRes.confidence,
      begrunnelse: ankerRes.begrunnelse,
      anker_raw: ankerRes.anker_raw ?? null,
      justering_kr: 0,
      origin_cap: originCap,
      kalkyle: pricing.ordna_kalkyle ? 'ordna' : (pricing.retur_kalkyle ? 'retur' : 'standard'),
      ordna_mult: pricing.ordna_mult || null,
      retur_mult: pricing.retur_mult || null,
      original_dLav: pricing.original_dLav ?? null,
      ident_score: scores ? scores.ident : null,
      comps_score: scores ? scores.comps : null,
      combined_score: scores ? scores.combined : null,
      finn_utpris: ankerRes.finn_utpris,
      finn_utpris_grunn: ankerRes.finn_utpris_grunn,
      valgte_comps: ankerRes.valgte_comps,
      ekskluderte: ankerRes.ekskluderte,
      chefs: ankerRes.chefs || (originRec && originRec.chefs) || null,
    } : {
      anker: ankerRes.anker != null ? ankerRes.anker : null,
      dLav: null,
      dHoy: null,
      score: 0,
      confidence: 0,
      begrunnelse: ankerRes.finn_utpris_grunn || ankerRes.begrunnelse,
      justering_kr: 0,
      ident_score: scores ? scores.ident : null,
      comps_score: scores ? scores.comps : null,
      combined_score: scores ? scores.combined : null,
      finn_utpris: ankerRes.finn_utpris != null ? ankerRes.finn_utpris : null,
      finn_utpris_grunn: ankerRes.finn_utpris_grunn || ankerRes.begrunnelse,
      origin_cap: originCap,
      valgte_comps: ankerRes.valgte_comps || [],
      ekskluderte: ankerRes.ekskluderte || [],
      chefs: ankerRes.chefs || (originRec && originRec.chefs) || null,
    },
    chefs: ankerRes.chefs || (originRec && originRec.chefs) || null,
    finn_utpris: ankerRes.finn_utpris != null ? ankerRes.finn_utpris : null,
    finn_utpris_grunn: ankerRes.finn_utpris_grunn || null,
    origin_cap: originCap,
    valgte_comps: ankerRes.valgte_comps || [],
    ekskluderte: ankerRes.ekskluderte || [],
    ident_score: scores ? scores.ident : null,
    comps_score: scores ? scores.comps : null,
    combined_score: scores ? scores.combined : null,
    easy,
    carinfo: {
      ok: !!carInfo.ok,
      anker_raw: carInfo.anker_raw ?? null,
      comps: (carInfo.comps || []).length,
      sold: soldCarinfo,
      sister_comps: sisterComps.length,
      error: carInfo.error || null,
    },
    pricing,
    origin_cv,
    origin: originFinn,
    sister,
    arm: owner,
    has_errors: errors.length > 0,
    errors,
  };

  // Fossefall first: override v3g.dLav/dHoy to writing arm, then ERP + measurement share that lav.
  await attachFossefall(record);

  if (originRec && originRec.skip_put) {
    log(`${plate} origin-comps SKIP_PUT — V3G skriver ikke ERP (QA Send /qa/anker urørt)`);
    record.erp_write = { ok: false, skipped: 'origin-comps-0-external' };
  } else if (v3gShouldWrite(listed.erpId, source) && listed.onListe3 && record.v3g && Number(record.v3g.dLav) > 0) {
    try {
      const wr = await writeV3gFinalEstimate(record);
      record.erp_write = wr;
      if (wr && wr.ok) log(`${plate} ${owner} skrevet til ERP dLav=${record.v3g.dLav}`);
      else log(`${plate} ${owner} skriv ${wr && (wr.error || wr.skipped) || 'ukjent'}`);
    } catch (eW) {
      errors.push('erp-write: ' + eW.message);
      record.erp_write = { ok: false, error: eW.message };
      record.has_errors = true;
      record.errors = errors;
    }
  }

  await appendMeasurement(record);
  log(`ferdig ${plate} arm=${record.arm} anker=${record.v3g?.anker ?? '—'} dLav=${record.v3g?.dLav ?? '—'} dHoy=${record.v3g?.dHoy ?? '—'}`);
  return record;
}

async function cli() {
  const regnr = process.argv[2];
  const kmArg = process.argv[3];
  const erpIdArg = process.argv[4];
  if (!regnr) {
    console.error('Bruk: node v3g-eval.js <regnr> [km] [erpId]');
    process.exit(1);
  }
  const km = kmArg != null && kmArg !== '' ? Number(kmArg) : null;
  const erpId = erpIdArg != null && erpIdArg !== '' ? Number(erpIdArg) : NaN;
  const out = await evalRegnr(regnr, Number.isFinite(km) ? km : null, {
    erpId: Number.isFinite(erpId) ? erpId : undefined,
  });
  console.log(JSON.stringify(out, null, 2));
  if (out.utenfor_scope) process.exit(0);
  if (out.has_errors) process.exit(1);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  cli().catch((e) => {
    console.error('[v3g-eval] FEIL:', e.message);
    process.exit(1);
  });
}
