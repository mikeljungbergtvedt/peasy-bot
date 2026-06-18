// finn-search-patch.js — run with: node finn-search-patch.js
// Improves Finn search to be more gradual and keep fuel filter longer

const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');

const oldSearch = `  let r;
  r = await scrape(year, year, delta, fuel + trans + drive + kw);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  r = await scrape(year, year, delta, fuel + trans + drive);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  r = await scrape(year, year, delta, fuel);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  r = await scrape(year-1, year+1, delta, fuel);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  let expandedDelta = delta;
  const MAX_DELTA = delta * 8;
  while (expandedDelta < MAX_DELTA) {
    expandedDelta = Math.round(expandedDelta * 1.5);
    r = await scrape(year-1, year+1, expandedDelta, fuel);
    if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  }
  r = await scrape(year-1, year+1, expandedDelta, '');
  return { comps: r.comps, finnUrl: r.url };
}`;

const newSearch = `  let r;
  // Step 1: Same year, tight km, all filters
  r = await scrape(year, year, delta, fuel + trans + drive + kw);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  // Step 2: Same year, tight km, fuel + trans + drive (drop kw)
  r = await scrape(year, year, delta, fuel + trans + drive);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  // Step 3: Same year, tight km, fuel + trans (drop drive)
  r = await scrape(year, year, delta, fuel + trans);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  // Step 4: Same year, tight km, fuel only
  r = await scrape(year, year, delta, fuel);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  // Step 5: Year ±1, tight km, fuel + trans
  r = await scrape(year-1, year+1, delta, fuel + trans);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  // Step 6: Year ±1, tight km, fuel only
  r = await scrape(year-1, year+1, delta, fuel);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  // Step 7: Year ±1, expanding km, fuel only
  let expandedDelta = delta;
  const MAX_DELTA = delta * 8;
  while (expandedDelta < MAX_DELTA) {
    expandedDelta = Math.round(expandedDelta * 1.5);
    r = await scrape(year-1, year+1, expandedDelta, fuel);
    if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  }
  // Step 8: Year ±2, max km, fuel only
  r = await scrape(year-2, year+2, expandedDelta, fuel);
  if (r.comps.length >= 5) return { comps: r.comps, finnUrl: r.url };
  // Step 9: Year ±2, no km limit, fuel only
  r = await scrape(year-2, year+2, 999999, fuel);
  if (r.comps.length >= 2) return { comps: r.comps, finnUrl: r.url };
  // Last resort: no filters at all
  r = await scrape(year-2, year+2, 999999, '');
  return { comps: r.comps, finnUrl: r.url };
}`;

if (src.includes('// Step 1: Same year, tight km, all filters')) {
  console.log('⚠️  Already patched, skipping');
} else if (src.includes(oldSearch)) {
  src = src.replace(oldSearch, newSearch);
  fs.writeFileSync(path, src);
  console.log('✅ Finn search logic improved');
} else {
  console.log('❌ Pattern not found — check manually');
}
