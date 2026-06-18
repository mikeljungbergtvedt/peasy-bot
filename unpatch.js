const fs = require('fs');
let c = fs.readFileSync('/Users/bot/peasy-auto/peasy-auto.js', 'utf8');
c = c.replace('  const processed = loadJSON(PROCESSED_FILE);\n', '');
c = c.replace('      if (!c.registration_number || processed[c.registration_number]) continue;\n',
              '      if (!c.registration_number) continue;\n');
fs.writeFileSync('/Users/bot/peasy-auto/peasy-auto.js', c);
console.log('done | hasProcessedCheck:', c.includes('processed[c.registration_number]'));
