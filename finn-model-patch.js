// finn-model-patch.js — run with: ~/.nvm/versions/node/v24.14.0/bin/node finn-model-patch.js
// Replaces q= text search with accurate Finn make/model ID lookup
// This prevents GLC matching GLE etc.

const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');

// ─── 1. ADD FINN MODEL LOOKUP FUNCTION ────────────────────────────────────
const finnLookupFn = `
// Cache for Finn make/model IDs
const _finnModelCache = {};

async function getFinnModelParam(make, model) {
  const cacheKey = (make + '|' + model).toUpperCase();
  if (_finnModelCache[cacheKey]) return _finnModelCache[cacheKey];

  try {
    // Fetch Finn's make list
    const makeRes = await fetch('https://www.finn.no/api/search-qf?searchkey=CAR_NORWAY&q=&aggr=make', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    if (!makeRes.ok) throw new Error('make fetch failed');
    const makeData = await makeRes.json();

    // Find make ID
    const makes = makeData?.filters?.find(f => f.field === 'make')?.queries || [];
    const makeNorm = make.toUpperCase().replace(/-/g, ' ');
    const makeMatch = makes.find(m => m.value.toUpperCase().replace(/-/g, ' ') === makeNorm)
      || makes.find(m => m.value.toUpperCase().includes(makeNorm) || makeNorm.includes(m.value.toUpperCase()));

    if (!makeMatch) {
      console.log(\`  ⚠️  Finn make not found: \${make}, falling back to q=\`);
      _finnModelCache[cacheKey] = { param: \`&q=\${encodeURIComponent(make + ' ' + model)}\`, makeId: null, modelId: null };
      return _finnModelCache[cacheKey];
    }

    const makeId = makeMatch.query?.replace('make=', '') || makeMatch.value;

    // Fetch models for this make
    const modelRes = await fetch(\`https://www.finn.no/api/search-qf?searchkey=CAR_NORWAY&q=&make=\${makeId}&aggr=model\`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    if (!modelRes.ok) throw new Error('model fetch failed');
    const modelData = await modelRes.json();

    const models = modelData?.filters?.find(f => f.field === 'model')?.queries || [];
    const modelNorm = model.toUpperCase();

    // Exact match first, then partial
    const modelMatch = models.find(m => m.value.toUpperCase() === modelNorm)
      || models.find(m => m.value.toUpperCase().startsWith(modelNorm + ' '))
      || models.find(m => m.value.toUpperCase() === modelNorm.replace(' ', '-'));

    if (!modelMatch) {
      console.log(\`  ⚠️  Finn model not found: \${model} under \${make}, using make only\`);
      _finnModelCache[cacheKey] = { param: \`&make=\${makeId}\`, makeId, modelId: null };
      return _finnModelCache[cacheKey];
    }

    const modelId = modelMatch.query?.replace('model=', '') || modelMatch.value;
    console.log(\`  🔎 Finn IDs: \${make} \${model} → make=\${makeId} model=\${modelId}\`);
    _finnModelCache[cacheKey] = { param: \`&make=\${makeId}&model=\${modelId}\`, makeId, modelId };
    return _finnModelCache[cacheKey];

  } catch(e) {
    console.log(\`  ⚠️  Finn model lookup failed: \${e.message}, falling back to q=\`);
    _finnModelCache[cacheKey] = { param: \`&q=\${encodeURIComponent(make + ' ' + model)}\`, makeId: null, modelId: null };
    return _finnModelCache[cacheKey];
  }
}
`;

// ─── 2. REPLACE findComps to use model lookup ─────────────────────────────
const oldFindComps = `async function findComps(make, model, year, km, specs) {`;

const newFindComps = `async function findComps(make, model, year, km, specs) {
  // Resolve accurate Finn make/model IDs before searching
  const finnModel = await getFinnModelParam(make, model);
  const modelParam = finnModel.param;
`;

// ─── 3. REPLACE the scrape function's q= param with modelParam ────────────
// Find and replace the scrape function inside findComps
const oldScrape = `  async function scrape(yFrom, yTo, kmDelta, extra) {
    const kmFrom = Math.max(0, km - kmDelta);
    const kmTo = km + kmDelta;
    const url = \`https://www.finn.no/mobility/search/car?q=\${encodeURIComponent(make + ' ' + model)}&registration_class=1&sales_form=1&sort=PRICE_ASC&year_from=\${yFrom}&year_to=\${yTo}&mileage_from=\${kmFrom}&mileage_to=\${kmTo}\${extra}\`;`;

const newScrape = `  async function scrape(yFrom, yTo, kmDelta, extra) {
    const kmFrom = Math.max(0, km - kmDelta);
    const kmTo = km + kmDelta;
    const url = \`https://www.finn.no/mobility/search/car?registration_class=1&sales_form=1&sort=PRICE_ASC&year_from=\${yFrom}&year_to=\${yTo}&mileage_from=\${kmFrom}&mileage_to=\${kmTo}\${modelParam}\${extra}\`;`;

// ─── 4. APPLY ─────────────────────────────────────────────────────────────
let applied = 0;

if (!src.includes('getFinnModelParam')) {
  src = src.replace('async function findComps(make, model, year, km, specs) {', finnLookupFn + '\nasync function findComps(make, model, year, km, specs) {');
  console.log('✅ Added getFinnModelParam function');
  applied++;
} else {
  console.log('⚠️  getFinnModelParam already present, skipping');
}

if (src.includes(oldScrape)) {
  // First inject modelParam resolution at top of findComps
  src = src.replace(
    'async function findComps(make, model, year, km, specs) {\n',
    'async function findComps(make, model, year, km, specs) {\n  const finnModel = await getFinnModelParam(make, model);\n  const modelParam = finnModel.param;\n'
  );
  // Then replace the scrape URL
  src = src.replace(oldScrape, newScrape);
  console.log('✅ Replaced scrape() URL to use make/model IDs');
  applied++;
} else {
  console.log('❌ scrape() pattern not found — may already be patched or structure differs');
}

if (applied > 0) {
  fs.writeFileSync(path, src);
  console.log('\n🎉 finn-model-patch applied! Restart bot to test.');
} else {
  console.log('\n⚠️  Nothing written — check patterns above.');
}
