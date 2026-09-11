#!/usr/bin/env node
'use strict';

/**
 * Peasy Jr Mini runner — trinn 1 origin-CV.
 *
 * Live runtime is Mike's Mac Mini. This file is what launchd starts.
 * Cursor owns the repo; copy onto /Users/bot/peasy-auto and restart com.peasy.jr.
 * Pulse (mikeljungbergtvedt.github.io) is a separate site — Jr does not publish it.
 *
 * writes_erp is always false.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { installErpReadonly } = require('./erp-readonly');
const { buildOriginCv, applyCarInfoIdentity, originKmFromListe3, upperRegnr } = require('./origin-cv');
const { dossiersForChefs } = require('./dossier');

installErpReadonly();
require('../shared/outbound').installOutboundFetch({ label: 'jr' });

const ERP_BASE = process.env.ERP_BASE || 'https://api.biladministrasjon.no';
const MINI_DOSSIER_DIR = '/Users/bot/peasy-auto/jr/dossiers';
const OUT_DIR = process.env.JR_DOSSIER_DIR
  || (fs.existsSync('/Users/bot/peasy-auto') ? MINI_DOSSIER_DIR : path.join(__dirname, 'dossiers'));
const ONCE = process.argv.includes('--once');
const POLL_MS = Number(process.env.JR_POLL_MS) || 60 * 1000;

function log(msg) {
  console.log(`[${new Date().toISOString()}] [jr] ${msg}`);
}

function authH(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function getErpToken() {
  const res = await fetch(`${ERP_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ERP_USER,
      password: process.env.ERP_PASS,
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error('ERP login failed');
  return data.data.token.token;
}

/**
 * Raw liste 3 rows. Do not apply XLSX km-cache.
 * origin.km is read from drive_no_car_data.mileage only.
 */
async function fetchListe3(token) {
  const res = await fetch(
    `${ERP_BASE}/c2b_module/peasy/processing/final_estimate?per_page=100`,
    { headers: authH(token) }
  );
  const data = await res.json();
  return data.data?.data?.data || [];
}

async function fetchDetail(token, erpId) {
  const res = await fetch(`${ERP_BASE}/c2b_module/peasy/cars/${erpId}`, {
    headers: authH(token),
  });
  const data = await res.json();
  return data.data || null;
}

async function fetchCarInfoIdentity(regnr, km) {
  const key = process.env.CAR_INFO_KEY;
  if (!key) return null;
  const ident = process.env.CAR_INFO_IDENTIFIER || 'autoringen';
  const url = `https://api.car.info/v2/app/autoringen/license-plate/N/${encodeURIComponent(regnr)}/${km || 0}`;
  const res = await fetch(url, {
    headers: {
      'x-auth-identifier': ident,
      'x-auth-key': key,
      Accept: 'application/json',
      'Accept-Language': 'nb',
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json;
}

function dossierPathForCar(car) {
  const erpId = car.id != null ? car.id : car.erpId;
  const regnr = upperRegnr(car.registration_number || car.regnr);
  return path.join(OUT_DIR, `${erpId}-${regnr}.json`);
}

function hasDossier(car) {
  return fs.existsSync(dossierPathForCar(car));
}

function writeDossiers(shared, byChef) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const erpId = shared.origin_cv.erpId;
  const regnr = shared.origin_cv.regnr || 'unknown';
  const base = path.join(OUT_DIR, `${erpId}-${regnr}`);
  fs.writeFileSync(base + '.json', JSON.stringify(shared, null, 2));
  for (const chef of Object.keys(byChef)) {
    fs.writeFileSync(`${base}.${chef}.json`, JSON.stringify(byChef[chef], null, 2));
  }
  fs.appendFileSync(path.join(OUT_DIR, 'index.jsonl'), JSON.stringify({
    erpId,
    regnr,
    km: shared.origin_cv.km,
    writes_erp: false,
    built_at: shared.built_at,
  }) + '\n');
  return base + '.json';
}

async function processCar(token, car) {
  const km = originKmFromListe3(car);
  const origin = buildOriginCv({ liste3Car: car });
  let detail = null;
  try {
    if (car.id) detail = await fetchDetail(token, car.id);
  } catch (e) {
    log(`detail ${car.id} failed: ${e.message}`);
  }
  const withDetail = buildOriginCv({ liste3Car: car, detail });
  let carInfo = null;
  try {
    carInfo = await fetchCarInfoIdentity(withDetail.regnr, km || 0);
  } catch (e) {
    log(`car.info identity ${withDetail.regnr} failed: ${e.message}`);
  }
  const locked = applyCarInfoIdentity(withDetail, carInfo);
  if (locked.km !== withDetail.km) {
    throw new Error('car.info overwrote origin.km — abort');
  }
  const { shared, byChef } = dossiersForChefs({ originCv: locked, carInfo });
  const file = writeDossiers(shared, byChef);
  log(`${locked.regnr} erp=${locked.erpId} km=${locked.km} writes_erp=${shared.writes_erp} → ${file}`);
  return shared;
}

async function runOnce() {
  if (!process.env.ERP_USER || !process.env.ERP_PASS) {
    log('ERP_USER/ERP_PASS missing — dry run only. Use tests for mocked ERP.');
    return [];
  }
  const token = await getErpToken();
  const cars = await fetchListe3(token);
  log(`liste 3: ${cars.length} cars (raw, no km-cache) — skriver kun nye (mangler dossier)`);
  const out = [];
  for (const car of cars) {
    try {
      if (hasDossier(car) && !process.env.JR_REWRITE) {
        log(`skip ${upperRegnr(car.registration_number || car.regnr)} erp=${car.id} — dossier finnes`);
        continue;
      }
      out.push(await processCar(token, car));
    } catch (e) {
      log(`fail ${car.registration_number || car.id}: ${e.message}`);
    }
  }
  return out;
}

async function main() {
  log(`Peasy Jr origin-CV loop. writes_erp=false. poll=${POLL_MS}ms. Pulse is not this repo.`);
  if (ONCE) {
    await runOnce();
    return;
  }
  await runOnce();
  setInterval(() => {
    runOnce().catch(e => log('loop: ' + e.message));
  }, POLL_MS);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { fetchListe3, processCar, runOnce, writeDossiers, hasDossier, dossierPathForCar, POLL_MS, OUT_DIR };
