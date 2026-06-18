const fs = require('fs'), os = require('os');
const OD = '/Users/bot/Library/CloudStorage/OneDrive-Autoringenas/C2B/Peasy/Bot/Dokumentasjon';
let src = fs.readFileSync(os.homedir()+'/peasy-auto/peasy-auto.js','utf8');

const newFunc = `
// — Liste 8: Auksjon avsluttet varsel ————————————————————
let _liste8Varslet = new Set();
let _liste8SistSjekket = '';

async function checkAuksjonAvsluttet() {
  const now = new Date();
  const oslo = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const h = oslo.getHours();
  const key = oslo.toISOString().slice(0,10) + 'h' + h;
  if ((h !== 12 && h !== 15) || _liste8SistSjekket === key) return;
  _liste8SistSjekket = key;
  try {
    const token = await getErpToken();
    const res = await fetch(\`\${CONFIG.erp.base}/c2b_module/peasy/processing/auction_finished?per_page=100\`, { headers: authH(token) });
    const data = await res.json();
    const biler = data.data?.data || [];
    log(\`Liste 8: \${biler.length} biler pa auksjon avsluttet\`);
    for (const bil of biler) {
      const regnr = bil.registration_number || '';
      if (_liste8Varslet.has(regnr)) continue;
      _liste8Varslet.add(regnr);
      const merke = bil.drive_no_car_data?.make || bil.make || '';
      const modell = bil.drive_no_car_data?.model_series || bil.model_series || '';
      const bud = bil.highest_bid ? bil.highest_bid.toLocaleString('nb-NO') + ' kr' : 'ukjent';
      await sendTelegram(\`🏁 AUKSJON AVSLUTTET\\n\${regnr} | \${merke} \${modell}\\nHøyeste bud: \${bud}\`);
    }
  } catch(e) { logErr('checkAuksjonAvsluttet', e); }
}

`;

// Legg til funksjonen rett before async function main()
const anchor = 'async function main() {';
if (!src.includes(anchor)) { console.error('ANCHOR IKKE FUNNET'); process.exit(1); }
src = src.replace(anchor, newFunc + anchor);
console.log('Funksjon lagt til');

// Kall checkAuksjonAvsluttet fra main() sin setInterval
const oldInterval = `  setInterval(async () => {
    if (now.getHours`;
// Finn main() setInterval og legg til kall
const mainIdx = src.indexOf('async function main() {');
const siIdx = src.indexOf('setInterval(async () => {', mainIdx);
const siLine = src.indexOf('\n', siIdx);
const before = src.slice(0, siIdx);
const after = src.slice(siIdx);

// Legg til checkAuksjonAvsluttet kall i eksisterende setInterval
const oldSi = 'setInterval(async () => {';
// Finn siste setInterval i main og legg til kall der
const callStr = '    await checkAuksjonAvsluttet();\n    ';
const mainSrc = src.slice(mainIdx);
const siInMain = mainSrc.indexOf(oldSi);
const insertAt = mainIdx + siInMain + oldSi.length + 1; // etter {
src = src.slice(0, insertAt) + callStr + src.slice(insertAt);
console.log('checkAuksjonAvsluttet lagt til i setInterval');

// Bump versjon
src = src.replace("const VERSION = 'v18.03.dp2'", "const VERSION = 'v18.03.dq2'");
console.log('VERSION:', src.match(/const VERSION = '([^']+)'/)[1]);

fs.writeFileSync(os.homedir()+'/peasy-auto/peasy-auto.js', src);
fs.writeFileSync(OD+'/peasy-auto-v18.03.dq2.js', src);
console.log('dq2 skrevet');
