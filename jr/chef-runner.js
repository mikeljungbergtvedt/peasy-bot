#!/usr/bin/env node
'use strict';

/**
 * Chef runner — dossier file → Finn-utpris JSON.
 *
 * Claude + Grok if ANTHROPIC_API_KEY / XAI_API_KEY|GROK_API_KEY in env.
 * Else dry-run analog-comps (always a number, never 0 comps).
 * Cap ask*0.95 if origin has an active ask.
 * writes_erp false. Does not write ERP. Does not touch Pulse.
 *
 *   node jr/chef-runner.js path/to/{erpId}-{REGNR}.json
 */

const fs = require('fs');
const path = require('path');
const { readDossierFile, preserveOriginKm, WRITES_ERP } = require('./read-dossier');
const { analogComps, finnUtprisFromDossier, assertAlwaysNumber, capAsk, ASK_CAP } = require('./analog-comps');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GROK_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;

function parseJsonFromText(text) {
  const t = String(text || '');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('ingen JSON i AI-svar');
  return JSON.parse(m[0]);
}

function asPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function callClaude(prompt) {
  if (!ANTHROPIC_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        max_tokens: 800,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'anthropic error');
    const text = (j.content && j.content[0] && j.content[0].text) || '';
    return parseJsonFromText(text);
  } finally {
    clearTimeout(t);
  }
}

async function callGrok(prompt) {
  if (!GROK_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROK_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GROK_MODEL || 'grok-3',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'grok error');
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return parseJsonFromText(text);
  } finally {
    clearTimeout(t);
  }
}

function buildPrompt(dossier, analog) {
  const cv = dossier.origin_cv || {};
  return [
    'Du er bruktbilsjef. Sett Finn-utpris (forhandler-annonsepris etter klargjøring) for ORIGIN.',
    'Svar BARE med JSON: {"finn_utpris": <positivt heltall>}',
    'Alltid et tall. Ikke 0. Ikke null.',
    'Bruk analog-comps. Ikke own_sold (Peasy/Autoringen/Drive/Ordna).',
    `origin.km er LÅST på ${cv.km} — ikke overskriv fra car.info/Finn.`,
    analog.ask ? `Origin har aktiv Finn-ask ${analog.ask}. Cap utpris på ask*${ASK_CAP}.` : '',
    'ORIGIN:',
    JSON.stringify({
      regnr: cv.regnr,
      erpId: cv.erpId,
      km: cv.km,
      make: cv.make,
      model: cv.model || cv.model_series,
      year: cv.year || cv.model_year,
      seller_comment: cv.seller_comment,
    }, null, 2),
    'ANALOG-COMPS:',
    JSON.stringify(analog.comps, null, 2),
    `Analog-forslag (dry-run): ${analog.finn_utpris}`,
  ].filter(Boolean).join('\n');
}

async function runChefOnDossier(dossier, opts = {}) {
  const dry = assertAlwaysNumber(finnUtprisFromDossier(dossier));
  const origin_cv = preserveOriginKm(dossier.origin_cv, opts.carInfo || null);
  if (origin_cv.km !== dossier.origin_cv.km) {
    throw new Error('chef-runner: origin.km must stay locked');
  }

  const haveAi = !!(ANTHROPIC_KEY || GROK_KEY) && !opts.forceDry;
  let mode = haveAi ? 'claude+grok' : 'dry-run-analog';
  let claude = null;
  let grok = null;
  let aiNumber = null;

  if (haveAi) {
    const prompt = buildPrompt(dossier, dry);
    const tasks = [];
    if (ANTHROPIC_KEY) {
      tasks.push(callClaude(prompt).then(j => { claude = j; }).catch(e => { claude = { error: e.message }; }));
    }
    if (GROK_KEY) {
      tasks.push(callGrok(prompt).then(j => { grok = j; }).catch(e => { grok = { error: e.message }; }));
    }
    await Promise.all(tasks);
    const nums = [claude && claude.finn_utpris, grok && grok.finn_utpris]
      .map(asPositiveNumber)
      .filter(Boolean);
    if (nums.length) {
      aiNumber = nums.reduce((a, b) => a + b, 0) / nums.length;
    } else {
      mode = 'dry-run-analog';
    }
  }

  const raw = aiNumber || dry.finn_utpris;
  const capped = capAsk(raw, dry.ask);
  const finn_utpris = asPositiveNumber(capped.finn_utpris) || dry.finn_utpris;
  if (typeof finn_utpris !== 'number' || !Number.isFinite(finn_utpris) || finn_utpris <= 0) {
    throw new Error('chef-runner: Finn-utpris must always be a number');
  }

  return {
    schema: 'peasy-jr-finn-utpris/v1',
    writes_erp: WRITES_ERP,
    mode,
    chef: opts.chef || dossier.chef || 'shared',
    regnr: origin_cv.regnr,
    erpId: origin_cv.erpId,
    origin_km: origin_cv.km,
    finn: dossier.finn || null,
    finn_utpris,
    raw: Math.round(raw),
    capped: !!capped.capped,
    ask: capped.ask || null,
    cap: capped.cap || null,
    comps: analogComps(dossier),
    claude,
    grok,
    analog: dry,
  };
}

async function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error('usage: node jr/chef-runner.js <dossier.json>');
    process.exit(2);
  }
  const dossier = readDossierFile(path.resolve(file));
  const out = await runChefOnDossier(dossier);
  assertAlwaysNumber({ finn_utpris: out.finn_utpris, comps: out.comps });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

if (require.main === module) {
  main(process.argv).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runChefOnDossier, buildPrompt };
