'use strict';
// add-active-comps-patch.js
// Sender v2.activeComps (aktive finn-annonser fra car.info) inn i eval-kortet.
// Idempotent + backup. Kjor pa Mini:
//   cd /Users/bot/peasy-auto && node add-active-comps-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('activeComps:')) {
  console.log('Allerede patchet — ingen endring.');
  process.exit(0);
}

const ANCHOR = '      anchor: v2.anchor,';
if (!src.includes(ANCHOR)) {
  console.error('FEIL: fant ikke cardParams-linja (anchor: v2.anchor). Er v2-fusjonen installert?');
  process.exit(1);
}

src = src.replace(ANCHOR, ANCHOR + '\n      activeComps: (v2.activeComps || []),');

const backup = FILE + '.pre-active-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src);
console.log('peasy-auto.js: activeComps koblet inn i kortet.');
console.log('Backup: ' + backup);
