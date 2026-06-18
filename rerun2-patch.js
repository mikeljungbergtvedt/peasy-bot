const fs = require('fs');
let src = fs.readFileSync('peasy-auto.js', 'utf8');
const oldBlock = `        if (text === '/rerun') {
          console.log('📱 /rerun received');
          const processed = loadJSON(PROCESSED_FILE);
          const keys = Object.keys(processed);
          if (keys.length === 0) { await sendTelegram('Ingen biler i cache.'); }
          else {
            await sendTelegram(\`⚙️ Kjører om igjen \${keys.length} bil(er)...\`);
            keys.forEach(k => delete processed[k]);
            saveJSON(PROCESSED_FILE, processed);
            await run(true);
          }
        }`;
const newBlock = `        if (text === '/rerun') {
          console.log('📱 /rerun received');
          const pendingCars = await fetchPendingCars();
          if (pendingCars.length === 0) {
            await sendTelegram('Ingen biler i køen.');
          } else {
            const processed = loadJSON(PROCESSED_FILE);
            pendingCars.forEach(c => delete processed[c.regNr]);
            saveJSON(PROCESSED_FILE, processed);
            await sendTelegram(\`⚙️ Kjører om igjen \${pendingCars.length} bil(er)...\`);
            await run(true);
          }
        }`;
if (!src.includes(oldBlock)) { console.log('Block not found - no changes made'); process.exit(1); }
src = src.replace(oldBlock, newBlock);
fs.writeFileSync('peasy-auto.js', src);
console.log('Patch applied successfully');
