#!/usr/bin/env node
// v2-eval.js v0.7
// Orkestrator: data -> splitt origin -> AI velger comps -> Easy-formel -> Telegram + logg + measurement

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

import { collectAllData }     from './data-collector.js';
import { chooseAnchor }       from './ai-anchor.js';
import { calculatePricing }   from './pricing-formula.js';
import { sendV2Eval, buildEvalCard } from './telegram-v2.js';
import { recordMeasurement }  from './v2-measurements.js';
import { pushToPulse }       from './v2-push-to-pulse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, 'logs');

const EVAL_CACHE_FILE = '/Users/bot/peasy-pricing-v2/v2-eval-cache.json';
let evalCache = {};
try { evalCache = JSON.parse(readFileSync(EVAL_CACHE_FILE, 'utf8')); } catch (e) { evalCache = {}; }

function fmtKr(n) {
  if (!Number.isFinite(Number(n))) return '?';
  return Math.round(Number(n)).toLocaleString('nb-NO') + ' kr';
}

export function splitOriginAndComps(classifieds, regnr) {
  const origin = [];
  const comps = [];
  const normRegnr = regnr.toUpperCase().replace(/\s/g, '');
  for (const c of classifieds) {
    const plate = (c.licence_plate || '').toUpperCase().replace(/\s/g, '');
    if (c.same_car === 1 || plate === normRegnr) origin.push(c);
    else comps.push(c);
  }
  return { origin, comps };
}

export function formatClassified(c, type) {
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

export function dedupeComps(comps) {
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

export async function evalRegnr(regnr, km, opts = {}) {
  const run = {
    regnr, km,
    erpId: opts.erpId ?? null,
    started_at: new Date().toISOString(),
    steps: {},
    errors: [],
  };

  const cacheKey = String(opts.erpId || regnr);
  run.cacheKey = cacheKey;
  if (evalCache[cacheKey]) {
    console.log(`[v2-eval] cache-hit ${cacheKey} — skip (evaluert ${evalCache[cacheKey]})`);
    run.skipReason = 'cached';
    return finish(run, { ...opts, noTelegram: true, noPush: true });
  }

  try {
    run.steps.data = await collectAllData(regnr, km);
    run.errors.push(...(run.steps.data.errors || []));
  } catch (e) {
    run.errors.push(`data: ${e.message}`);
    return finish(run, opts);
  }

  const ci = run.steps.data.sources?.car_info?.result || {};
  const companyRaw = ci.valuation?.company_classifieds || [];
  const privateRaw = ci.valuation?.private_classifieds || [];

  const allClassifieds = [
    ...companyRaw.map(c => formatClassified(c, 'forhandler')),
    ...privateRaw.map(c => formatClassified(c, 'privat')),
  ];

  const { origin, comps: rawComps } = splitOriginAndComps(allClassifieds, regnr);
  const comps = dedupeComps(rawComps);
  // V1.1 PATCH: aktivt server-side Finn-regnr-sjekk (uavhengig av car.info classifieds)
  try {
    const finnHit = await fetchOriginPaaFinn(regnr);
    if (finnHit) {
      const synth = {
        is_active: true,
        sold_date: null,
        published_date: new Date().toISOString().slice(0,10),
        km: finnHit.km || null,
        price: finnHit.price,
        type: 'finn-live',
        finn_url: finnHit.link,
        source: 'origin-paa-finn-direkte',
      };
      // Dupe-sjekk: ikke legg til hvis allerede til stede
      const alreadyHas = origin.some(o => (o.finn_url || '') === finnHit.link);
      if (!alreadyHas) origin.unshift(synth);
      run.steps.origin_finn_aktiv = finnHit;
    }
  } catch (e) { /* ikke fatal */ }

  run.steps.split = {
    origin_count: origin.length,
    comps_raw_count: rawComps.length,
    comps_deduped_count: comps.length,
  };

  try {
    run.steps.anchor = await chooseAnchor({
      data: run.steps.data,
      origin,
      comps,
    });
    run.steps.anchor.origin_annonser = origin;
  } catch (e) {
    run.errors.push(`ai-anchor: ${e.message}`);
    return finish(run, opts);
  }

  const anchor = run.steps.anchor;
  const anchorPrice = anchor?.anker_beregning?.anker;
  if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) {
    run.errors.push('AI returnerte ingen gyldig anker');
    return finish(run, opts);
  }

  const valgteComps = anchor?.valgte_comps || [];
  const lowestComp = valgteComps.length
    ? Math.min(...valgteComps.map(c => Number(c.price)).filter(Number.isFinite))
    : null;

  const modelYear = anchor?.identifikasjon?.model_year
    || run.steps.data?.sources?.vegvesen?.data?.firstRegYear
    || ci.model_year;

  run.steps.pricing = calculatePricing({
    anchorPrice,
    km: Number(km),
    modelYear: Number(modelYear),
    lowestComp,
  });

  run.steps.all_comps_for_display = comps;

  return finish(run, opts);
}

async function finish(run, opts = {}) {
  run.finished_at = new Date().toISOString();
  run.duration_ms = Date.now() - new Date(run.started_at).getTime();

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const fname = `${run.regnr}-${Date.now()}.json`;
    await fs.writeFile(path.join(LOG_DIR, fname), JSON.stringify(run, null, 2));
    run.log_file = fname;
  } catch (e) {
    console.error('Logg-feil:', e.message);
  }

  printSummary(run);

  // Telegram
  if (!opts.noTelegram) {
    const card = buildEvalCard({
      regnr: run.regnr,
      km: run.km,
      anchor: run.steps.anchor,
      pricing: run.steps.pricing,
      all_comps: run.steps.all_comps_for_display || [],
      errors: run.errors,
    });
    const tg = await sendV2Eval(card);
    if (!tg.ok) console.error('Telegram-feil:', tg.error);
    else        console.log(`  -> Telegram message_id ${tg.message_id} (${tg.chunks || 1} chunks)`);
  }

  // Benchmark-måling: skriv linje til measurements.jsonl
  // Inkluderer Easys tall hvis vi har dem fra peasy-auto-payload
  try {
    const mres = await recordMeasurement(run, opts.easyEval || null);
    if (!mres.ok) console.error('Measurement-feil:', mres.error);
  } catch (e) {
    console.error('Measurement-exception:', e.message);
  }
  // Skriv kompakt resultat-fil saa Easy kan lese v2-anker for ERP-skriving
  try {
    const RESULT_FILE = '/Users/bot/peasy-pricing-v2-result.jsonl';
    const fsSync = await import('fs');
    const resultLine = JSON.stringify({
      regnr: run.regnr,
      erpId: run.erpId,
      timestamp: new Date().toISOString(),
      anker: run.steps?.anchor?.anker_beregning?.anker || null,
      dLav: run.steps?.pricing?.dLav || null,
      dHoy: run.steps?.pricing?.dHoy || null,
      bracket: run.steps?.pricing?.bracket || null,
      confidence: run.steps?.anchor?.confidence || 0,
      has_errors: run.errors?.length > 0
    });
    fsSync.appendFileSync(RESULT_FILE, resultLine + '\n');
    console.log(`  -> Result-fil oppdatert for ${run.regnr}`);
  } catch (e) {
    console.error('Result-fil-skriving feilet:', e.message);
  }

  // Auto-push til Pulse (isolert — feiler den, er eval+maaling allerede trygt lagret)
  if (!opts.noPush) {
    try {
      const pr = await pushToPulse();
      if (pr.ok && !pr.skipped) console.log(`  -> Pulse oppdatert (commit ${pr.commit})`);
      else if (!pr.ok) console.error('  -> Pulse-push feilet (ikke kritisk):', pr.error);
    } catch (e) {
      console.error('  -> Pulse-push exception (ikke kritisk):', e.message);
    }
  }

  if (run.errors.length === 0 && !run.skipReason) {
    evalCache[run.cacheKey] = new Date().toISOString();
    try { writeFileSync(EVAL_CACHE_FILE, JSON.stringify(evalCache, null, 2)); }
    catch (e) { console.error(`[v2-eval] cache write feilet: ${e.message}`); }
  }

  return run;
}

function printSummary(run) {
  const a = run.steps.anchor || {};
  const p = run.steps.pricing || {};
  const id = a.identifikasjon || {};
  const s = run.steps.split || {};

  console.log('');
  console.log(`=== V2 ${run.regnr} (${run.km.toLocaleString('nb-NO')} km) ===`);
  if (run.errors.length) console.log(`Advarsler: ${run.errors.length}`);

  console.log(`Bil:       ${id.variant || '?'}`);
  console.log(`Motor:     ${id.motor || '?'}  ${id.drivlinje || ''}`);
  console.log(`Pakke:     ${id.pakke || '-'}`);
  console.log(`Origin-annonser: ${s.origin_count}`);
  console.log(`Comps (raw -> dedupe): ${s.comps_raw_count} -> ${s.comps_deduped_count}`);
  console.log(`Valgte comps: ${(a.valgte_comps || []).length}`);
  console.log(`Anker:     ${fmtKr(a.anker_beregning?.anker)}`);
  if (p.bracket) {
    console.log(`Bracket:   ${p.bracket} | segment ${p.segment}`);
    console.log(`D mid:     ${fmtKr(p.dMid)}`);
    console.log(`D lav:     ${fmtKr(p.dLav)}`);
    console.log(`D hoey:    ${fmtKr(p.dHoy)}${p.compCapApplied ? ' (comp-cap)' : ''}`);
  }
  console.log(`Confidence: ${a.confidence ?? '?'}/100`);
  if (a.begrunnelse_kort) console.log(`Begrunnelse: ${a.begrunnelse_kort}`);
  console.log(`Logg: logs/${run.log_file || '(feil)'}`);
}

// CLI
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [,, regnrArg, kmArg, ...flags] = process.argv;
  if (!regnrArg || !kmArg) {
    console.error('Bruk: node v2-eval.js <regnr> <km> [--no-telegram]');
    process.exit(1);
  }
  const km = Number(kmArg);
  if (!Number.isFinite(km) || km < 0) {
    console.error('km maa vaere et positivt tall');
    process.exit(1);
  }
  const noTelegram = flags.includes('--no-telegram');
  evalRegnr(regnrArg.toUpperCase(), km, { noTelegram })
    .then(run => process.exit(run.errors.length ? 2 : 0))
    .catch(e => { console.error('FATAL:', e); process.exit(1); });
}
