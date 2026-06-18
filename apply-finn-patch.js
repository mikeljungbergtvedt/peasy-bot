'use strict';
// apply-finn-patch.js
// Kobler aktiv Finn-annonse-sjekk + anker-cap inn i peasy-auto.js (evalCar).
// Idempotent: kjorer du den to ganger, gjor den ingenting andre gang.
// Kjor pa Mac Mini:  cd /Users/bot/peasy-auto && node apply-finn-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('// Aktiv Finn-annonse: cap anker')) {
  console.log('Allerede patchet — ingen endring.');
  process.exit(0);
}

// ── 1. Sett inn Finn-sjekk + cap rett etter at v2-anker er bygget ──
const ANCHOR_LINE = "    const anchor = { price: v2anker, reason: (v2.anchor && v2.anchor.begrunnelse_kort) || 'v2-anker' };";
const FINN_BLOCK = ANCHOR_LINE + "\n" + [
  "",
  "    // Aktiv Finn-annonse: cap anker til annonsepris hvis anker er hoyere (Easy-arv)",
  "    let finnListing = null;",
  "    try {",
  "      finnListing = await checkFinnListing(regnr, bil, page);",
  "    } catch (eFinn) { logErr(`checkFinnListing ${regnr}`, eFinn); }",
  "    if (finnListing && finnListing.price > 0 && finnListing.price < anchor.price) {",
  "      log(`Finn-annonse (${finnListing.price}) < anker (${anchor.price}) — capper anker til annonsepris`);",
  "      anchor.cappedFrom = anchor.price;",
  "      anchor.price = finnListing.price;",
  "      anchor.reason += ` (capet til Finn-annonsepris ${finnListing.price})`;",
  "    }",
].join("\n");

if (!src.includes(ANCHOR_LINE)) {
  console.error('FEIL: fant ikke anker-linja. Er dette den fusjonerte peasy-auto.js?');
  process.exit(1);
}
src = src.replace(ANCHOR_LINE, FINN_BLOCK);

// ── 2. Send finnListing + anchorUsed + cappedFrom inn i kortet ──
const CARD_LINE = "      anchor: v2.anchor,";
if (!src.includes(CARD_LINE)) {
  console.error('FEIL: fant ikke cardParams-linja.');
  process.exit(1);
}
src = src.replace(
  CARD_LINE,
  CARD_LINE + "\n      finnListing, anchorUsed: anchor.price, cappedFrom: anchor.cappedFrom || null,"
);

// ── Backup + skriv ──
const backup = FILE + '.pre-finn-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src, 'utf8');
console.log('Patchet OK.');
console.log('Backup: ' + backup);
