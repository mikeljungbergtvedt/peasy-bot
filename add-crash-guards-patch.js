'use strict';
// add-crash-guards-patch.js
// Legger inn krasj-vern i peasy-auto.js: logger 'unhandledRejection' og
// 'uncaughtException' UTEN aa drepe prosessen. Uten dette dreper Node prosessen
// ved en los async-feil (sannsynlig aarsak til at boten doede stille).
// Idempotent + backup. Kjor pa Mini:
//   cd /Users/bot/peasy-auto && node add-crash-guards-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('UNHANDLED REJECTION')) {
  console.log('Allerede patchet — krasj-vern finnes.');
  process.exit(0);
}

const re = /const VERSION = '[^']+';\n/;
const m = src.match(re);
if (!m) { console.error('FEIL: fant ikke VERSION-linja.'); process.exit(1); }

const GUARD =
  "\n// Krasj-vern: logg uventede feil, men hold prosessen i live (launchd KeepAlive er backstop)\n" +
  "process.on('unhandledRejection', (reason) => {\n" +
  "  try { console.error(`[${new Date().toISOString()}] [${VERSION}] UNHANDLED REJECTION:`, (reason && reason.stack) || reason); } catch (e) {}\n" +
  "});\n" +
  "process.on('uncaughtException', (err) => {\n" +
  "  try { console.error(`[${new Date().toISOString()}] [${VERSION}] UNCAUGHT EXCEPTION:`, (err && err.stack) || err); } catch (e) {}\n" +
  "});\n";

src = src.replace(re, m[0] + GUARD);

const backup = FILE + '.pre-guards-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src);
console.log('Krasj-vern lagt inn (unhandledRejection + uncaughtException logges, prosessen holdes i live).');
console.log('Backup: ' + backup);
