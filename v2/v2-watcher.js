#!/usr/bin/env node
// v2-watcher.js v0.7
// Lytter paa koe-fil og kjorer v2-eval for hver bil.
// Aksepterer BAADE Grok-stil (registration_number) og gammel v2-stil (regnr).
// Sender easy_eval-data videre til evalRegnr saa measurement kan kobles.

import 'dotenv/config';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { evalRegnr } from './v2-eval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = process.env.V2_QUEUE_FILE || '/Users/bot/peasy-pricing-v2-queue.txt';
const POLL_MS    = +process.env.V2_POLL_MS   || 5000;
const THROTTLE_MS = +process.env.V2_THROTTLE_MS || 25000;  // pause mellom biler for aa unngaa rate limit

const LOG_DIR = path.join(__dirname, 'logs');

let stopRequested = false;
process.on('SIGINT', () => { console.log('\nStopper watcher...'); stopRequested = true; });
process.on('SIGTERM', () => { stopRequested = true; });

function ts() { return new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' }); }

async function ensureQueueFile() {
  if (!existsSync(QUEUE_FILE)) {
    await fs.writeFile(QUEUE_FILE, '');
    console.log(`[${ts()}] Opprettet tom koe-fil: ${QUEUE_FILE}`);
  }
}

async function popFirstLine() {
  if (!existsSync(QUEUE_FILE)) return null;
  const data = await fs.readFile(QUEUE_FILE, 'utf8');
  const lines = data.split('\n').filter(Boolean);
  if (!lines.length) return null;
  const first = lines.shift();
  await fs.writeFile(QUEUE_FILE, lines.length ? lines.join('\n') + '\n' : '');
  return first;
}

async function processLine(line) {
  let job;
  try {
    job = JSON.parse(line);
  } catch (e) {
    console.error(`[${ts()}] Ugyldig JSON i koe-linje, hopper over: ${line.slice(0, 100)}`);
    return;
  }

  // Aksepter BAADE Grok-stil (registration_number, mileage) OG gammel v2-stil (regnr, km)
  const regnr = job.registration_number || job.regnr;
  const km    = job.mileage             ?? job.km;
  const erpId = job.id                  ?? job.erpId;
  // NY: hent easy_eval (Easys benchmark-tall)
  const easyEval = job.easy_eval || null;

  if (!regnr || !Number.isFinite(Number(km))) {
    console.error(`[${ts()}] Manglende regnr eller km i koe-linje:`, job);
    return;
  }

  // Dedupe: skip hvis regnr evaluert siste 7 dager (sparer Anthropic-tokens)
  try {
    const measFile = path.join(__dirname, 'logs.nosync', 'measurements.jsonl');
    if (fs.existsSync(measFile)) {
      const lines = fs.readFileSync(measFile, 'utf-8').trim().split('\n');
      const recent = lines.slice().reverse().find(l => {
        try {
          const r = JSON.parse(l);
          if (r.regnr !== regnr) return false;
          const age = Date.now() - new Date(r.timestamp).getTime();
          return age < 7 * 24 * 60 * 60 * 1000;
        } catch { return false; }
      });
      if (recent) {
        const r = JSON.parse(recent);
        const hoursAgo = Math.round((Date.now() - new Date(r.timestamp).getTime()) / 3600000);
        console.log(`[${ts()}] SKIP ${regnr} — allerede evaluert for ${hoursAgo}t siden (v2 anker=${r.v2?.anker || '?'})`);
        return;
      }
    }
  } catch(e) { console.error(`[${ts()}] Dedupe-sjekk feilet, fortsetter: ${e.message}`); }
  console.log(`[${ts()}] Starter v2-eval for ${regnr} (${km} km, erpId=${erpId || '?'})${easyEval ? ' [easy_eval finnes]' : ''}`);
  try {
    const run = await evalRegnr(regnr, Number(km), { erpId, easyEval });
    const anker = run?.steps?.anchor?.anker_beregning?.anker;
    const dLav  = run?.steps?.pricing?.dLav;
    const dHoy  = run?.steps?.pricing?.dHoy;
    console.log(`[${ts()}] Ferdig ${regnr}: anker=${anker} dLav=${dLav} dHoy=${dHoy} feil=${run.errors.length}`);
  } catch (e) {
    console.error(`[${ts()}] v2-eval feilet for ${regnr}: ${e.message}`);
  }
}

async function loop() {
  console.log(`[${ts()}] v2-watcher v0.7 starter. Koe-fil: ${QUEUE_FILE}, poll: ${POLL_MS}ms`);
  await ensureQueueFile();
  await fs.mkdir(LOG_DIR, { recursive: true });

  while (!stopRequested) {
    try {
      const line = await popFirstLine();
      if (line) {
        await processLine(line);
        if (THROTTLE_MS > 0) {
          console.log(`[${ts()}] Throttle ${Math.round(THROTTLE_MS/1000)}s for neste bil...`);
          await new Promise(r => setTimeout(r, THROTTLE_MS));
        }
      } else {
        await new Promise(r => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      console.error(`[${ts()}] Watcher-feil: ${e.message}`);
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
  console.log(`[${ts()}] v2-watcher stoppet.`);
}

loop().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
