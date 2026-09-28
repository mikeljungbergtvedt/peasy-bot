#!/usr/bin/env node
// v3g-watcher.js — poll ERP liste 3 og evaluer nye biler
//
// Leser kun ERP (GET + login). Skriver aldri til ERP, Easy, V2-kø eller V3.
// Evaluerer via samme evalRegnr som v3g-eval.js.
//
//   node v3g-watcher.js
//
// Env:
//   V3G_POLL_MS       poll-intervall (default 5 min)
//   V3G_THROTTLE_MS   pause mellom biler (default 5000)
//   V3G_SEEN_TTL_MS   ttl i seen.json (default 7 dager)
//   V3G_AUTO_PUSH     "1" = push til Pulse etter vellykket eval (default av)

import { config as loadEnv } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { getListe3 } from './v3g-erp.js';
import { evalRegnr } from './v3g-eval.js';
import { measurementsPath } from './v3g-measurements.js';
import { pushToPulse } from './v3g-push-to-pulse.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// 28.09: V3G er stoppet — fossefallet er eneste motor (beslutning 24.09). Starter bare med V3G_ENABLED=1.
if (process.env.V3G_ENABLED !== '1') {
  console.log(`[${new Date().toISOString()}] [v3g-watcher] STOPPET: V3G er slått av (sett V3G_ENABLED=1 for å starte). Avslutter.`);
  process.exit(0);
}
require('../shared/instance-lock').acquireOrExit(process.env.PEASY_PROCESS_LABEL || 'v3g');
const { installOutboundFetch } = require('../shared/outbound.js');
installOutboundFetch({ label: 'v3g' });
const { isNightQuiet, CHECK_MS } = require('../bot-schedule.js');
const { hasReevalLock } = require('../qa-clear-cache.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '..', '.env'), quiet: true });

const LOG_DIR = path.join(__dirname, 'logs.nosync');
const LOG_FILE = path.join(LOG_DIR, 'v3g.log');
const SEEN_FILE = path.join(LOG_DIR, 'seen.json');

const POLL_MS = Number(process.env.V3G_POLL_MS) || CHECK_MS;
const THROTTLE_MS = Number(process.env.V3G_THROTTLE_MS) || 5_000;
const SEEN_TTL_MS = Number(process.env.V3G_SEEN_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const AUTO_PUSH = process.env.V3G_AUTO_PUSH === '1';

let stopRequested = false;
process.on('SIGINT', () => { stopRequested = true; });
process.on('SIGTERM', () => { stopRequested = true; });
process.on('unhandledRejection', (e) => {
  log(`unhandledRejection: ${e?.message || e}`).catch(() => {});
});
process.on('uncaughtException', (e) => {
  log(`uncaughtException: ${e?.message || e}`).catch(() => {});
});

async function log(msg) {
  const line = `[${new Date().toISOString()}] [v3g-watcher] ${msg}`;
  console.log(line);
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, line + '\n', 'utf8');
  } catch {
    // logging må aldri knekke loopen
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (stopRequested || Date.now() - started >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, 250);
    };
    setTimeout(tick, Math.min(250, ms));
  });
}

function nowMs() {
  return Date.now();
}

function pruneSeen(map) {
  const cutoff = nowMs() - SEEN_TTL_MS;
  const out = {};
  for (const [id, entry] of Object.entries(map || {})) {
    const ts = typeof entry === 'number' ? entry : Number(entry?.ts);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    out[String(id)] = typeof entry === 'object' && entry
      ? { ...entry, ts }
      : { erpId: Number(id) || id, ts };
  }
  return out;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    await log(`kunne ikke lese ${path.basename(file)}: ${e.message}`);
    return fallback;
  }
}

async function loadSeenFromMeasurements() {
  const extra = {};
  const cutoff = nowMs() - SEEN_TTL_MS;
  try {
    const raw = await fs.readFile(measurementsPath(), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec.erpId == null) continue;
      const ts = Date.parse(rec.timestamp);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      extra[String(rec.erpId)] = {
        erpId: rec.erpId,
        regnr: rec.regnr || null,
        ts,
        source: 'measurements',
      };
    }
  } catch (e) {
    if (e.code !== 'ENOENT') await log(`measurements-hydrate feilet: ${e.message}`);
  }
  return extra;
}

async function loadSeen() {
  const fromFile = pruneSeen(await readJson(SEEN_FILE, {}));
  const fromMeas = pruneSeen(await loadSeenFromMeasurements());
  return pruneSeen({ ...fromMeas, ...fromFile });
}

async function saveSeen(map) {
  const pruned = pruneSeen(map);
  await fs.mkdir(LOG_DIR, { recursive: true });
  const tmp = SEEN_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(pruned, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, SEEN_FILE);
  return pruned;
}

function isSeen(map, erpId) {
  const entry = map[String(erpId)];
  if (!entry) return false;
  const ts = typeof entry === 'number' ? entry : Number(entry.ts);
  if (!Number.isFinite(ts)) return false;
  if (entry.skip === 'utenfor_scope' || entry.skip === '0_comps' || entry.priced) {
    return (nowMs() - ts) < SEEN_TTL_MS;
  }
  // Feilet uten dLav: prøv igjen etter 10 min, ikke lås i 7 dager
  return (nowMs() - ts) < 10 * 60 * 1000;
}

function markSeen(map, car, extra = {}) {
  map[String(car.erpId)] = {
    erpId: car.erpId,
    regnr: car.regnr || null,
    ts: nowMs(),
    ...extra,
  };
}

async function maybePush(regnr) {
  if (!AUTO_PUSH) return;
  try {
    const result = await pushToPulse();
    if (result.skipped) await log(`push hoppet over etter ${regnr}: ${result.skipped}`);
    else if (result.ok) await log(`push OK etter ${regnr} commit=${result.commit || '?'}`);
    else await log(`push feilet etter ${regnr}: ${result.error || 'ukjent'}`);
  } catch (e) {
    await log(`push kastet etter ${regnr}: ${e.message}`);
  }
}

async function processCar(car, seen) {
  /* JR_DOSSIER_HOOK */
  try {
    const __jr = require("/Users/bot/peasy-auto/jr/read-dossier");
    const __jrHit = __jr.loadForChef({ chef: "v3g", internnr: car.erpId, erpId: car.erpId, regnr: car.regnr });
    if (__jrHit && __jrHit.ok && __jrHit.origin_cv) {
      if (__jrHit.origin_cv.km != null) car.km = __jrHit.origin_cv.km;
      car._jrDossier = __jrHit;
      await log("Jr-dossier " + (__jrHit.path || "") + " km=" + car.km);
    }
  } catch (__jrErr) {
    await log("Jr-dossier hook: " + (__jrErr && __jrErr.message));
  }
  const label = `${car.regnr || 'uten-regnr'} erpId=${car.erpId}`;
  if (car.erpId == null) {
    await log(`SKIP ${label} — mangler erpId`);
    return;
  }
  if (hasReevalLock(car.regnr, car.erpId)) {
    await log(`SKIP ${label} — qa-reeval lock (blank slate)`);
    return;
  }
  if (isSeen(seen, car.erpId)) {
    await log(`SKIP ${label} — allerede i seen.json`);
    return;
  }
  if (!car.regnr) {
    await log(`SKIP ${label} — mangler regnr, merkes sett`);
    markSeen(seen, car, { skip: 'no-regnr' });
    await saveSeen(seen);
    return;
  }

  await log(`starter ${label}`);
  try {
    const record = await evalRegnr(car.regnr, car.km != null ? car.km : null, {
      jrDossier: car._jrDossier || null,
      erpId: car.erpId,
    });
    if (record && record.skipped === 'jr_dossier_missing') {
      await log(`VENTER ${label} — Jr-dossier mangler (ikke sett)`);
      return;
    }
    if (record?.erpId != null && Number(record.erpId) !== Number(car.erpId)) {
      await log(`FEIL ${label} — eval bandt erpId=${record.erpId}, ikke seen`);
      return;
    }
    const scopeSkip = !!record?.utenfor_scope;
    const zeroComps = !!(record?.erp_write && record.erp_write.skipped === 'origin-comps-0-external')
      || (record && record.v3g && record.v3g.finn_utpris_grunn === '0 eksterne origin-comps')
      || (record && record.finn_utpris_grunn === '0 eksterne origin-comps');
    const priced = Number(record?.v3g?.dLav) > 0;
    markSeen(seen, car, {
      skip: scopeSkip ? 'utenfor_scope' : (zeroComps ? '0_comps' : (priced ? null : 'no_dLav')),
      priced,
      fant: record?.biltype?.fant || null,
    });
    await saveSeen(seen);
    if (scopeSkip) {
      await log(
        `UTENFOR SCOPE ${label} — ikke personbil/varebil ` +
        `(fant: ${record?.biltype?.fant || record?.biltype?.klasse || 'ukjent'})`,
      );
    } else {
      await log(
        `ferdig ${label} anker=${record?.v3g?.anker ?? '—'} ` +
        `dLav=${record?.v3g?.dLav ?? '—'} dHoy=${record?.v3g?.dHoy ?? '—'} ` +
        `feil=${(record?.errors || []).length}`,
      );
      await maybePush(car.regnr);
    }
  } catch (e) {
    await log(`FEIL ${label}: ${e.message}`);
    // ikke mark seen — neste poll prøver igjen
  }
}

async function pollOnce(seen) {
  if (isNightQuiet()) {
    await log('natt 22–05 Oslo — hopper over liste 3');
    return seen;
  }
  let list;
  try {
    list = await getListe3();
  } catch (e) {
    await log(`liste 3 feilet: ${e.message}`);
    return seen;
  }
  if (!Array.isArray(list)) {
    await log('liste 3 returnerte ikke en array');
    return seen;
  }

  const fresh = list.filter((c) => c?.erpId != null && !isSeen(seen, c.erpId));
  await log(`poll: ${list.length} på liste 3, ${fresh.length} nye`);

  for (let i = 0; i < fresh.length; i++) {
    if (stopRequested) break;
    await processCar(fresh[i], seen);
    if (THROTTLE_MS > 0 && i < fresh.length - 1 && !stopRequested) {
      await sleep(THROTTLE_MS);
    }
  }

  // Push uavhengig av nye biler — retrier 503/uteblitt Pulse-synk
  if (AUTO_PUSH && !stopRequested) {
    try {
      const result = await pushToPulse();
      if (result.ok && !result.skipped) await log(`periodisk push OK commit=${result.commit || '?'}`);
      else if (!result.ok) await log(`periodisk push feilet: ${result.error || result.skipped || 'ukjent'}`);
    } catch (e) {
      await log(`periodisk push kastet: ${e.message}`);
    }
  }
  return seen;
}

async function loop() {
  await fs.mkdir(LOG_DIR, { recursive: true });
  let seen = await loadSeen();
  await saveSeen(seen);
  await log(
    `starter. poll=${POLL_MS}ms throttle=${THROTTLE_MS}ms ` +
    `seen=${Object.keys(seen).length} autoPush=${AUTO_PUSH ? 'på' : 'av'}`,
  );

  while (!stopRequested) {
    try {
      seen = await pollOnce(seen);
    } catch (e) {
      await log(`poll-feil: ${e.message}`);
    }
    if (stopRequested) break;
    await sleep(POLL_MS);
  }
  await log('stoppet');
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  loop().catch(async (e) => {
    await log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
