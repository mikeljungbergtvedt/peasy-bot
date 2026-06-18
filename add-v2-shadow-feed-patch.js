'use strict';
// add-v2-shadow-feed-patch.js
// Kobler Easy sin koe-mating til standalone-v2 PAA IGJEN (fjernet i fusjonen).
// Easy skriver {regnr, id, km, ...} til /Users/bot/peasy-pricing-v2-queue.txt som
// v2-watcher leser -> standalone-v2 gjenopptar sammenligning + pusher measurements
// (= Pulse V2 Benchmark lever igjen). Standalone-v2 er skrivefri mot ERP fra for.
// Idempotent + backup. Kjor pa Mini:
//   cd /Users/bot/peasy-auto && node add-v2-shadow-feed-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('[easy->v2] Matet shadow')) {
  console.log('Allerede patchet — koe-matingen er pa.');
  process.exit(0);
}

const MARKER = '    // 11c. v2-shadow fjernet — v2 kjorer naa inline (se steg 2-5)';
if (!src.includes(MARKER)) {
  console.error('FEIL: fant ikke 11c-markoren. Er fusjonen installert?');
  process.exit(1);
}

const FEED = [
  "    // 11c. Mat standalone-v2 shadow (sammenligning) — skriver til koefil v2-watcher leser",
  "    try {",
  "      if (!qaOverrideUrl) {",
  "        const v2Payload = JSON.stringify({",
  "          registration_number: regnr,",
  "          id: erpId,",
  "          model_year: bil.model_year,",
  "          mileage: bil.mileage,",
  "          model_series: bil.model_series,",
  "          make: vegData ? vegData.make : (bil.make || ''),",
  "          easy_eval: {",
  "            anker: (anchor && anchor.price) || null,",
  "            dLav: (valuation && valuation.dLav) || null,",
  "            dHoy: (valuation && valuation.dHoy) || null,",
  "            bracket: (valuation && valuation.bracket) || null",
  "          }",
  "        });",
  "        fs.appendFileSync('/Users/bot/peasy-pricing-v2-queue.txt', v2Payload + '\\n');",
  "        log(`[easy->v2] Matet shadow for ${regnr}`);",
  "      }",
  "    } catch (eFeed) { logErr('easy->v2 feed', eFeed); }",
].join('\n');

src = src.replace(MARKER, FEED);

const backup = FILE + '.pre-v2feed-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src);
console.log('Koe-mating til standalone-v2 gjenopprettet.');
console.log('Backup: ' + backup);
