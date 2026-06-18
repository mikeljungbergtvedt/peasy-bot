// dedupe-patch.js — run with: ~/.nvm/versions/node/v24.14.0/bin/node dedupe-patch.js
// Fixes duplicate car processing when same regNr appears in multiple ERP endpoints

const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');

const oldEnd = `  console.log(\`  Found \${cars.length} unprocessed car(s)\`);
  return cars;
}`;

const newEnd = `  // Deduplicate by regNr (same car can appear in multiple endpoints)
  const seen = new Set();
  const unique = cars.filter(c => {
    if (seen.has(c.regNr)) {
      console.log(\`  ⚠️  Duplicate skipped: \${c.regNr}\`);
      return false;
    }
    seen.add(c.regNr);
    return true;
  });
  console.log(\`  Found \${unique.length} unprocessed car(s) (\${cars.length - unique.length} duplicate(s) removed)\`);
  return unique;
}`;

if (src.includes(oldEnd)) {
  src = src.replace(oldEnd, newEnd);
  fs.writeFileSync(path, src);
  console.log('✅ Deduplicate fix applied');
} else {
  console.log('❌ Pattern not found — check fetchPendingCars ending');
}
