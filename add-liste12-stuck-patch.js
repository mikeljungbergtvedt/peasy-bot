'use strict';
// add-liste12-stuck-patch.js
// 1) Legger liste 12 (wait_for_signing / "VENTER PA SIGNERING") til LISTE_DEFS.
// 2) Bytter checkListeWatch til en DAGLIG samlet stuck-oversikt (kl 12 + 15):
//    alle biler som fortsatt staar paa liste 8-12 listes i EN melding per kjoring.
// Idempotent + backup. Kjor pa Mini:
//   cd /Users/bot/peasy-auto && node add-liste12-stuck-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('wait_for_signing')) {
  console.log('Allerede patchet — liste 12 finnes.');
  process.exit(0);
}

// ── 1) Sett inn liste 12 rett etter incomplete_contract-linja (linjebasert) ──
const lines = src.split('\n');
const idx = lines.findIndex(l => l.includes("'incomplete_contract'"));
if (idx < 0) { console.error('FEIL: fant ikke incomplete_contract i LISTE_DEFS.'); process.exit(1); }
lines.splice(idx + 1, 0,
  "  { nr: 12, navn: 'VENTER PÅ SIGNERING',  emoji: '✍️', endpoint: 'wait_for_signing',         vis_bud: false },");
src = lines.join('\n');

// ── 2) Bytt hele checkListeWatch-funksjonen ──
const START = 'async function checkListeWatch() {';
const END = '// checkStuckCars: kjorer liste-watch';
const s = src.indexOf(START);
const e = src.indexOf(END);
if (s < 0 || e < 0 || e < s) { console.error('FEIL: fant ikke checkListeWatch-grensene.'); process.exit(1); }

const NEW_FN = `async function checkListeWatch() {
  const now = new Date();
  const oslo = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const h = oslo.getHours();
  const key = oslo.toISOString().slice(0,10) + 'h' + h;
  // Daglig stuck-oversikt kl 12 og 15 (en gang per klokketime)
  if ((h !== 12 && h !== 15) || _listeWatchSistSjekket === key) return;
  _listeWatchSistSjekket = key;

  const hhmm = String(oslo.getHours()).padStart(2,'0') + ':' + String(oslo.getMinutes()).padStart(2,'0');
  try {
    const token = await getErpToken();
    const seksjoner = [];
    let totalt = 0;
    for (const def of LISTE_DEFS) {
      try {
        const res = await fetch(\`\${CONFIG.erp.base}/c2b_module/peasy/processing/\${def.endpoint}?per_page=100\`, { headers: authH(token) });
        if (!res.ok) { log(\`Liste \${def.nr} (\${def.endpoint}): HTTP \${res.status}\`); continue; }
        const data = await res.json();
        const biler = data.data?.data?.data || [];
        log(\`Liste \${def.nr} (\${def.navn}): \${biler.length} biler\`);
        if (!biler.length) continue;
        totalt += biler.length;
        const linjer = biler.map(bil => {
          const regnr = bil.registration_number || '?';
          const merke  = bil.drive_no_car_data?.make || bil.make || '';
          const modell = bil.drive_no_car_data?.model_series || bil.model_series || '';
          let s = '  ' + regnr + ' | ' + (merke + ' ' + modell).trim();
          if (def.vis_bud) {
            const bud = bil.highest_bid ? bil.highest_bid.toLocaleString('nb-NO') + ' kr' : 'ukjent';
            s += ' | bud ' + bud;
          }
          return s;
        });
        seksjoner.push(def.emoji + ' <b>' + def.navn + '</b> (' + biler.length + ')\\n' + linjer.join('\\n'));
      } catch(eList) {
        logErr(\`checkListeWatch liste \${def.nr}\`, eList);
      }
    }
    if (seksjoner.length) {
      await sendTelegram('📋 <b>STUCK-OVERSIKT ' + hhmm + '</b> — ' + totalt + ' biler står på vent\\n\\n' + seksjoner.join('\\n\\n'));
      log('Stuck-oversikt sendt: ' + totalt + ' biler');
    } else {
      log('Stuck-oversikt: ingen biler på liste 8-12');
    }
  } catch(e) { logErr('checkListeWatch', e); }
}

`;

src = src.slice(0, s) + NEW_FN + src.slice(e);

const backup = FILE + '.pre-liste12-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src);
console.log('Liste 12 (wait_for_signing) lagt til + daglig stuck-oversikt aktivert.');
console.log('Backup: ' + backup);
