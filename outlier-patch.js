const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');

const outlierFn = `
function removeOutliers(comps, threshold = 0.35) {
  if (comps.length < 3) return comps;
  const prices = comps.map(c => c.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? (prices[mid-1]+prices[mid])/2 : prices[mid];
  const clean = comps.filter(c => {
    const diff = Math.abs(c.price - median) / median;
    if (diff > threshold) {
      console.log(\\\`  🗑️  Outlier removed: \\\${c.price.toLocaleString('nb-NO')} kr (median: \\\${Math.round(median).toLocaleString('nb-NO')} kr, diff: \\\${Math.round(diff*100)}%)\\\`);
      return false;
    }
    return true;
  });
  return clean.length >= 2 ? clean : comps;
}
`;

if (!src.includes('removeOutliers')) {
  src = src.replace('async function searchFinnComps', outlierFn + '\nasync function searchFinnComps');
  console.log('✅ Added removeOutliers function');
} else {
  console.log('⚠️  removeOutliers already present');
}

const oldReturn = `    // Deduplicate by price+km
    const seen = new Set();
    const unique = comps.filter(c => {
      const key = \`\${c.price}-\${c.km}\`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Remove outliers
    const cleaned = removeOutliers(unique);
    return { comps: cleaned, url };`;

const oldReturn2 = `    // Deduplicate by price+km
    const seen = new Set();
    const unique = comps.filter(c => {
      const key = \`\${c.price}-\${c.km}\`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { comps: unique, url };`;

const newReturn = `    // Deduplicate by price+km
    const seen = new Set();
    const unique = comps.filter(c => {
      const key = \`\${c.price}-\${c.km}\`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const cleaned = removeOutliers(unique);
    return { comps: cleaned, url };`;

if (src.includes(oldReturn)) {
  console.log('⚠️  Outlier removal already applied');
} else if (src.includes(oldReturn2)) {
  src = src.replace(oldReturn2, newReturn);
  console.log('✅ Applied outlier removal to scrape results');
} else {
  console.log('❌ Pattern not found');
}

fs.writeFileSync(path, src);
console.log('\n🎉 Done! Restart bot to activate.');
