// v2-measurements.js
// Append én linje per v2-eval til logs.nosync/measurements.jsonl
// Inneholder BAADE Easys tall (fra peasy-auto-payload) OG v2 sine tall + auto diff.
//
// outcome-felter (eval_accepted, bud_accepted osv.) er null naa,
// fylles inn senere via backsync fra Pulse.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEASUREMENTS_FILE = path.join(__dirname, 'logs.nosync', 'measurements.jsonl');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function recordMeasurement(run, easyEval) {
  const anchor  = run?.steps?.anchor || {};
  const pricing = run?.steps?.pricing || {};
  const id      = anchor.identifikasjon || {};

  const v2Anker = num(anchor?.anker_beregning?.anker);
  const v2DLav  = num(pricing?.dLav);
  const v2DHoy  = num(pricing?.dHoy);

  const easyAnker = num(easyEval?.anker);
  const easyDLav  = num(easyEval?.dLav);
  const easyDHoy  = num(easyEval?.dHoy);

  const record = {
    regnr: run.regnr,
    timestamp: run.started_at,
    km: run.km,
    erpId: run.erpId ?? null,

    identifikasjon: {
      variant: id.variant ?? null,
      motor: id.motor ?? null,
      pakke: id.pakke ?? null,
      drivlinje: id.drivlinje ?? null,
      fuel: id.fuel ?? null,
      model_year: id.model_year ?? null,
    },

    easy: easyEval ? {
      anker: easyAnker,
      dLav: easyDLav,
      dHoy: easyDHoy,
      T: num(easyEval.T),
      margin: num(easyEval.margin),
      fee: num(easyEval.fee),
      comps_count: num(easyEval.comps_count),
      bracket: easyEval.bracket || null,
      anchor_reason: easyEval.anchor_reason || null,
      km_override: easyEval.km_override || null,
    } : null,

    km_override: (easyEval && easyEval.km_override) || null,

    v2: {
      anker: v2Anker,
      dLav: v2DLav,
      dHoy: v2DHoy,
      comps_count: (anchor?.valgte_comps || []).length,
      bracket: pricing?.bracket || null,
      segment: pricing?.segment || null,
      confidence: num(anchor?.confidence),
      risiko_flagg: anchor?.risiko_flagg || [],
      comp_cap: !!pricing?.compCapApplied,
      begrunnelse_kort: anchor?.begrunnelse_kort || null,
      version: (anchor && anchor.v22_flags && anchor.v22_flags.v22_strict_3mnd) ? 'v22.0' : 'v1.1',
      flags: (anchor && anchor.v22_flags) ? anchor.v22_flags : null,
    },

    // Diff = v2 - easy (positivt tall = v2 hoyere)
    diff: (easyAnker && v2Anker) ? {
      anker_kr: v2Anker - easyAnker,
      anker_pct: Math.round(((v2Anker / easyAnker) - 1) * 1000) / 10,
      dLav_kr: (v2DLav && easyDLav) ? v2DLav - easyDLav : null,
      dHoy_kr: (v2DHoy && easyDHoy) ? v2DHoy - easyDHoy : null,
    } : null,

    outcome: {
      eval_accepted: null,
      eval_accepted_at: null,
      bud_amount: null,
      bud_accepted: null,
      sold_date: null,
      returned_date: null,
      backsync_at: null,
    },

    log_file: run.log_file ?? null,
    has_errors: (run.errors || []).length > 0,
  };

  try {
    await fs.mkdir(path.dirname(MEASUREMENTS_FILE), { recursive: true });
    await fs.appendFile(MEASUREMENTS_FILE, JSON.stringify(record) + '\n');
    return { ok: true, file: MEASUREMENTS_FILE };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function readAllMeasurements() {
  try {
    const data = await fs.readFile(MEASUREMENTS_FILE, 'utf8');
    return data.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
