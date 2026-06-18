// finn-quality-patch.js — run with: ~/.nvm/versions/node/v24.14.0/bin/node finn-quality-patch.js
// Fixes: 1) Tesla make name in query, 2) impossible year filtering, 3) duplicate comps

const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');
let applied = 0;

// ─── 1. FIX TESLA MAKE NAME IN QUERY ─────────────────────────────────────
// "TESLA MOTORS Model S" → "Tesla Model S"
const oldQ = `  const q = encodeURIComponent(\`\${make} \${model}\`);`;
const newQ = `  const cleanMake = make.replace(/\\s*MOTORS\\s*/i, '').trim();
  const q = encodeURIComponent(\`\${cleanMake} \${model}\`);`;

if (src.includes(oldQ)) {
  src = src.replace(oldQ, newQ);
  console.log('✅ Fixed Tesla make name in query');
  applied++;
} else {
  console.log('⚠️  Tesla make fix — pattern not found, may already be patched');
}

// ─── 2. FIX YEAR FILTERING IN SCRAPER ────────────────────────────────────
// Filter out impossible years (> current year or < 1990)
const oldFilter = `}).filter(c => c.price >= 20000 && c.price <= 2000000);`;
const newFilter = `}).filter(c => {
        const currentYear = new Date().getFullYear();
        return c.price >= 20000 && c.price <= 2000000 && (c.year === 0 || (c.year >= 1990 && c.year <= currentYear));
      });`;

if (src.includes(oldFilter)) {
  src = src.replace(oldFilter, newFilter);
  console.log('✅ Fixed year filtering (removes impossible years)');
  applied++;
} else {
  console.log('⚠️  Year filter — pattern not found, may already be patched');
}

// ─── 3. DEDUPLICATE COMPS BY PRICE+KM ────────────────────────────────────
// Remove duplicate listings (same price and km)
const oldReturn = `    return { comps, url };`;
const newReturn = `    // Deduplicate by price+km
    const seen = new Set();
    const unique = comps.filter(c => {
      const key = \`\${c.price}-\${c.km}\`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { comps: unique, url };`;

if (src.includes(oldReturn)) {
  src = src.replace(oldReturn, newReturn);
  console.log('✅ Added comp deduplication by price+km');
  applied++;
} else {
  console.log('⚠️  Comp dedup — pattern not found, may already be patched');
}

// ─── SAVE ─────────────────────────────────────────────────────────────────
if (applied > 0) {
  fs.writeFileSync(path, src);
  console.log(`\n🎉 ${applied} fix(es) applied! Restart bot to activate.`);
} else {
  console.log('\n⚠️  Nothing written — check patterns above.');
}
