// erp-patch.js — run with: node erp-patch.js
// Patches peasy-auto.js to use ERP API instead of Excel

const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');

// ─── 1. ADD ERP TOKEN FUNCTION after PROCESSED_FILE line ───────────────────
const erpFunctions = `
let _erpToken = null;
let _erpTokenExpiry = null;

async function getERPToken() {
  if (_erpToken && _erpTokenExpiry && new Date() < _erpTokenExpiry) return _erpToken;
  console.log('🔑 Logging in to ERP...');
  const res = await fetch('https://api.biladministrasjon.no/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS })
  });
  const data = await res.json();
  if (!data.success) throw new Error('ERP login failed: ' + JSON.stringify(data));
  _erpToken = data.data.token.token;
  _erpTokenExpiry = new Date(data.data.token.expires_at);
  return _erpToken;
}

async function getERPCarComment(erpId, token) {
  try {
    const res = await fetch(\`https://api.biladministrasjon.no/c2b_module/driveno/\${erpId}\`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    return data.data?.car?.self_declaration?.comment || null;
  } catch(e) { return null; }
}

async function writeARValueToERP(erpId, priceMin, priceMax, token) {
  try {
    const res = await fetch(\`https://api.biladministrasjon.no/c2b_module/driveno/processing/estimating_ar_final/\${erpId}\`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_final_min: Math.round(priceMin), price_final_max: Math.round(priceMax) })
    });
    const data = await res.json();
    if (data.success) {
      console.log(\`  ✅ ERP updated: \${Math.round(priceMin).toLocaleString('nb-NO')} - \${Math.round(priceMax).toLocaleString('nb-NO')} kr\`);
      return true;
    } else {
      console.error('  ⚠️ ERP write failed:', JSON.stringify(data));
      return false;
    }
  } catch(e) {
    console.error('  ⚠️ ERP write error:', e.message);
    return false;
  }
}
`;

// ─── 2. REPLACE fetchPendingCars ───────────────────────────────────────────
const oldFetch = `async function fetchPendingCars() {
  console.log('📊 Fetching Excel report...');
  const res = await fetch(REPORT_URL);
  if (!res.ok) throw new Error(\`Report fetch failed: \${res.status}\`);
  const ab = await res.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = json[0].map(h => String(h).trim());
  const rows = json.slice(1);
  const col = names => { for (const n of (Array.isArray(names)?names:[names])) { const i = headers.findIndex(h => h.toLowerCase().includes(n.toLowerCase())); if (i !== -1) return i; } return -1; };
  const sdCol = col(['SD mottatt']), arCol = col(['Endelig AR verdi']);
  const statusCol = col(['Status']), regCol = col(['RegNr','Reg nr']);
  const merkeCol = col(['Merke']), modellCol = col(['Modell']);
  const yearCol = col(['År','Årgang']), kmCol = col(['KM','Kilometer','Kjørelengde']);
  const processed = loadJSON(PROCESSED_FILE);
  return rows.filter(row => {
    const sd = String(row[sdCol]||'').trim(), ar = String(row[arCol]||'').trim();
    const status = String(row[statusCol]||'').trim().toLowerCase();
    const reg = String(row[regCol]||'').trim();
    return sd !== '' && ['-','–','—',''].includes(ar) && (status.includes('endelig estimat')||status.includes('sd mottatt')) && reg !== '' && !processed[reg];
  }).map(row => ({
    regNr: String(row[regCol]||'').trim(), make: String(row[merkeCol]||'').trim(),
    model: String(row[modellCol]||'').trim(), year: parseInt(row[yearCol])||0,
    km: parseInt(String(row[kmCol]||'0').replace(/\\D/g,''))||0,
  }));
}`;

const newFetch = `async function fetchPendingCars() {
  console.log('📊 Fetching pending cars from ERP...');
  const token = await getERPToken();
  const processed = loadJSON(PROCESSED_FILE);
  const cars = [];
  for (const endpoint of ['estimating_ar_final', 'estimating_ar_temp']) {
    const res = await fetch(\`https://api.biladministrasjon.no/c2b_module/driveno/processing/\${endpoint}?per_page=50\`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { console.error(\`ERP \${endpoint} failed: \${res.status}\`); continue; }
    const data = await res.json();
    const list = data.data?.data?.data || [];
    for (const c of list) {
      if (!c.registration_number || processed[c.registration_number]) continue;
      cars.push({
        erpId: c.id,
        regNr: c.registration_number,
        make: c.manufacturer || '',
        model: c.model_series || '',
        year: c.model_year || 0,
        km: c.mileage || 0,
        hasSdComment: c.has_sd_comment === 1,
        hasImages: c.has_images === 1,
      });
    }
  }
  console.log(\`  Found \${cars.length} unprocessed car(s)\`);
  return cars;
}`;

// ─── 3. APPLY PATCHES ──────────────────────────────────────────────────────

// Insert ERP functions before fetchPendingCars
if (!src.includes('getERPToken')) {
  src = src.replace('async function fetchPendingCars()', erpFunctions + '\nasync function fetchPendingCars()');
  console.log('✅ Added ERP token + comment + write functions');
} else {
  console.log('⚠️  ERP functions already present, skipping');
}

// Replace fetchPendingCars
if (src.includes("console.log('📊 Fetching Excel report...');")) {
  src = src.replace(oldFetch, newFetch);
  console.log('✅ Replaced fetchPendingCars with ERP API');
} else {
  console.log('⚠️  fetchPendingCars already patched, skipping');
}

// ─── 4. PATCH run() to fetch comment and write back AR value ───────────────
const oldMarkProcessed = `        markProcessed(car.regNr, { make: car.make, model: car.model, year: car.year, finnAvg, ...valuation });
        results.push({ status: 'ok', regNr: car.regNr, car, specs, comps: topComps, finnUrl, finnAvg, valuation, heftelser });`;

const newMarkProcessed = `        markProcessed(car.regNr, { make: car.make, model: car.model, year: car.year, finnAvg, ...valuation });
        // Fetch SD comment if present
        let sdComment = null;
        if (car.hasSdComment && car.erpId) {
          const erpToken = await getERPToken();
          sdComment = await getERPCarComment(car.erpId, erpToken);
          if (sdComment) console.log(\`  💬 Comment: \${sdComment}\`);
        }
        // Write AR value back to ERP
        if (car.erpId) {
          const erpToken = await getERPToken();
          await writeARValueToERP(car.erpId, valuation.low, valuation.high, erpToken);
        }
        results.push({ status: 'ok', regNr: car.regNr, car, specs, comps: topComps, finnUrl, finnAvg, valuation, heftelser, sdComment });`;

if (src.includes(oldMarkProcessed)) {
  src = src.replace(oldMarkProcessed, newMarkProcessed);
  console.log('✅ Patched run() to fetch comment and write AR value');
} else {
  console.log('⚠️  run() already patched or mismatch, skipping');
}

// ─── 5. PATCH formatResults to show SD comment ─────────────────────────────
const oldComment = `    const hLine = r.heftelser ? \`\\n⚠️ Heftelser: \${r.heftelser}\` : '';`;
const newComment = `    const hLine = r.heftelser ? \`\\n⚠️ Heftelser: \${r.heftelser}\` : '';
    const commentLine = r.sdComment ? \`\\n💬 Selger: \${r.sdComment}\` : '';`;

const oldCommentUse = `\${hLine}`;
const newCommentUse = `\${hLine}\${commentLine || ''}`;

if (src.includes(oldComment)) {
  src = src.replace(oldComment, newComment);
  // Also find the first occurrence of ${hLine} in the template literal and add commentLine
  src = src.replace(/(\$\{hLine\})(\n\s*\`\s*;)/, '\${hLine}${commentLine || \'\'}$2');
  console.log('✅ Added SD comment to Telegram message');
} else {
  console.log('⚠️  formatResults already patched or mismatch, skipping');
}

fs.writeFileSync(path, src);
console.log('\n🎉 Patch complete! Restart the bot with: pm2 restart peasy-auto or launchctl');
