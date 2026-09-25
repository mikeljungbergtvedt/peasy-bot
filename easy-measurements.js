'use strict';
// Easy skriver sitt eget easy-objekt til samme jsonl som v2.
// Dual-write: v2 fortsetter. Arkiver v2 først når compare-easy-v2-meas.js er identisk i 7 dager.

const fs = require('fs');
const path = require('path');
const { easyField } = require('./shared/easy-meas-field.js');

const MEASUREMENTS_FILE = process.env.PEASY_EASY_MEAS_FILE
  || path.join(__dirname, 'v2/logs.nosync/measurements.jsonl');

function appendEasyMeasurement({ regnr, km, erpId, origin_cv, easyEval, timestamp, soldDays } = {}) {
  const plate = String(regnr || '').toUpperCase().replace(/\s/g, '');
  if (!plate) return { ok: false, error: 'regnr mangler' };
  let fossefall = null;
  try {
    const { buildFossefall } = require('./fossefall');
    const easyObj = easyField(easyEval) || {};
    const finn = Number(easyObj.finn_utpris != null ? easyObj.finn_utpris : easyObj.anker);
    if (Number.isFinite(finn) && finn > 0) {
      const year = (origin_cv && (origin_cv.aar || origin_cv.model_year || origin_cv.year
        || (origin_cv.identity && origin_cv.identity.year)
        || (origin_cv.ident && origin_cv.ident.year)
        || (origin_cv.carinfo && (origin_cv.carinfo.model_year || origin_cv.carinfo.year))))
        || (easyEval && (easyEval.model_year || easyEval.year)) || null;
      const egenvekt = (origin_cv && (origin_cv.egenvekt || origin_cv.weight))
        || (easyEval && easyEval.egenvekt) || null;
      const hintsA = {
        anker_lagret: finn,
        km_override: !!(easyEval && easyEval.km_override) || !!(easyObj.km_override),
        origin_cap: !!(easyObj.origin_cap),
        vrakpant: !!easyObj.vrakpant,
        aar_mangler: !year,
        egenvekt_mangler: !egenvekt,
        wrecker: !!easyObj.wrecker,
      };
      const { extractSoldDays } = require('./fossefall');
      let _sold = Array.isArray(soldDays) ? soldDays : null;
      if (!_sold || !_sold.length) {
        const vc = (easyEval && (easyEval.valgte_comps || (easyEval.finn_utpris && easyEval.finn_utpris.valgte_comps))) || [];
        _sold = extractSoldDays(vc);
      }
      // v20.166: QA-godkjent ståtid (hake i Pulse) — samme tall som ble skrevet til ERP.
      const _qaStatid = easyEval && easyEval.statid_qa_kr != null ? Number(easyEval.statid_qa_kr) : NaN;
      const _built = buildFossefall({
        statidKrQa: Number.isFinite(_qaStatid) && _qaStatid <= 0 ? _qaStatid : undefined,
        finnUtpris: finn,
        km: km,
        modelYear: year,
        bilInfo: { year: year || 2020, egenvekt: egenvekt || undefined },
        lagret: Number.isFinite(Number(easyObj.dLav))
          ? { a: { dLav: easyObj.dLav, dHoy: easyObj.dHoy } }
          : {},
        hints: { a: hintsA },
        soldDays: _sold,
        annonsepris: (easyObj.annonsepris != null ? easyObj.annonsepris : (easyObj.finn_price != null ? easyObj.finn_price : (easyEval && easyEval.finn_price))) || null,
        chefsUtprisBeforeCap: (function(){
          var m = easyObj.chefs && easyObj.chefs.merge;
          if (m && m.raw != null) return Number(m.raw);
          return null;
        })(),
        originCapTak: (function(){
          var ask = Number(easyObj.annonsepris != null ? easyObj.annonsepris : (easyObj.finn_price != null ? easyObj.finn_price : (easyEval && easyEval.finn_price)));
          if (Number.isFinite(ask) && ask > 0) return Math.round((ask * 0.95) / 1000) * 1000;
          return null;
        })(),
      });
      const cardMod = require('./fossefall-card');
      fossefall = cardMod.cardFromBuilt(_built) || _built;
      // v20.166: ståtid-forslag fra carinfo (vises i QA, trekkes aldri automatisk) og QA-godkjent ståtid.
      try {
        if (fossefall && typeof fossefall === 'object') {
          if (origin_cv) {
            fossefall.statid_forslag = require('./statid-forslag').statidForslag({ originCv: origin_cv, regnr: plate, finn, maalt: timestamp || new Date().toISOString() });
          }
          if (Number.isFinite(_qaStatid) && _qaStatid < 0) {
            fossefall.statid_qa = { kr: Math.round(_qaStatid), kilde: (easyEval && easyEval.statid_qa_kilde) || null };
          }
        }
      } catch (eSf) { /* forslaget er ikke-kritisk */ }
      // Measurement easy.dLav follows writing-arm fossefall lav when live (even=A).
      if (fossefall && fossefall.tables_live && !fossefall.pris_manuelt && fossefall.a && Number.isFinite(Number(fossefall.a.lav))) {
        const plan = cardMod.planErpWrite({ erpId: erpId, source: (easyEval && easyEval.source) || null, card: fossefall, legacyLav: easyObj.dLav, legacyHoy: easyObj.dHoy });
        if (plan && Number.isFinite(Number(plan.dLav))) {
          easyObj.dLav = Number(plan.dLav);
          easyObj.dHoy = Number(plan.dHoy);
          if (easyEval && typeof easyEval === 'object') {
            easyEval.dLav = easyObj.dLav;
            easyEval.dHoy = easyObj.dHoy;
          }
        }
      }
      let _grunn = easyObj.finn_utpris_grunn || (easyEval && easyEval.finn_utpris_grunn) || null;
      if (_grunn === 'kun_kundens_annonse') _grunn = 'kun kundens annonse';
      const _kilde = easyObj.finn_utpris_kilde || easyObj.anker_kilde || (easyEval && easyEval.finn_utpris_kilde) || null;
      if (!_grunn && _kilde === 'kun_kundens_annonse') _grunn = 'kun kundens annonse';
      const _ap = easyObj.annonsepris != null ? easyObj.annonsepris : (easyEval && easyEval.annonsepris);
      if (fossefall && typeof fossefall === 'object') {
        ['a', 'b', 'ordna'].forEach(function (k) {
          if (!fossefall[k] || typeof fossefall[k] !== 'object') return;
          if (_grunn) {
            fossefall[k].finn_utpris_grunn = _grunn;
            // finn_utpris_kilde blir på easy-objektet, ikke på fossefall-armen (akseptansetest gruppe C: *_grunn OK, *_kilde ikke i fasit)
          }
          if (_ap != null && Number.isFinite(Number(_ap))) fossefall[k].annonsepris = Number(_ap);
        });
      }
    }
  } catch (eFf) { /* fossefall er ikke-kritisk */ }
  const record = {
    evaluator: 'easy',
    writer: 'easy',
    regnr: plate,
    timestamp: timestamp || new Date().toISOString(),
    km: km != null && Number.isFinite(Number(km)) ? Number(km) : null,
    erpId: erpId != null && erpId !== '' ? erpId : null,
    origin_cv: origin_cv || null,
    easy: easyField(easyEval),  // dLav may have been overridden to writing-arm fossefall lav above
    km_override: (easyEval && easyEval.km_override) || null,
    v2: null,
    fossefall,
    has_errors: false,
  };
  fs.mkdirSync(path.dirname(MEASUREMENTS_FILE), { recursive: true });
  fs.appendFileSync(MEASUREMENTS_FILE, JSON.stringify(record) + '\n');
  return { ok: true, file: MEASUREMENTS_FILE };
}

module.exports = { appendEasyMeasurement, MEASUREMENTS_FILE };
