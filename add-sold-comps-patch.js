'use strict';
// add-sold-comps-patch.js
// Sender v2.soldForhandler + v2.soldPrivat (solgte comps fra car.info) inn i kortet.
// Krever at add-active-comps-patch.js er kjort forst (activeComps-linja finnes).
// Idempotent + backup. Kjor pa Mini:
//   cd /Users/bot/peasy-auto && node add-sold-comps-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('soldForhandler:')) {
  console.log('Allerede patchet — solgte comps sendes allerede inn.');
  process.exit(0);
}

const TARGET = '      activeComps: (v2.activeComps || []),';
if (!src.includes(TARGET)) {
  console.error('FEIL: fant ikke activeComps-linja. Kjor add-active-comps-patch.js forst.');
  process.exit(1);
}

src = src.replace(
  TARGET,
  TARGET + '\n      soldForhandler: (v2.soldForhandler || []), soldPrivat: (v2.soldPrivat || []),'
);

const backup = FILE + '.pre-sold-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src);
console.log('peasy-auto.js: soldForhandler + soldPrivat koblet inn i kortet.');
console.log('Backup: ' + backup);
