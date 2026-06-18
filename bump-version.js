'use strict';
// bump-version.js — oker patch-tallet i VERSION ('v20.00' -> 'v20.01' -> ...).
// Kjor pa Mini for hver restart:  node bump-version.js
// Gi argument for a sette eksakt versjon:  node bump-version.js v21.00

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let s = fs.readFileSync(FILE, 'utf8');

const m = s.match(/const VERSION = 'v(\d+)\.(\d+)';/);
if (!m) { console.error('Fant ikke VERSION-linja i peasy-auto.js'); process.exit(1); }

let next = process.argv[2];
if (!next) {
  const maj = m[1];
  const min = String(parseInt(m[2], 10) + 1).padStart(2, '0');
  next = `v${maj}.${min}`;
}
if (!/^v\d+\.\d+$/.test(next)) { console.error('Ugyldig versjon: ' + next); process.exit(1); }

s = s.replace(m[0], `const VERSION = '${next}';`);
fs.writeFileSync(FILE, s);
console.log(`VERSION: v${m[1]}.${m[2]} -> ${next}`);
