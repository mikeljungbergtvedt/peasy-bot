const fs = require('fs');
let src = fs.readFileSync('peasy-auto.js', 'utf8');
const oldBlock = `        if (text === '/run') {
          console.log('📱 /run received');
          await sendTelegram('⚙️ Manuell kjøring startet...');
          await run(true);
        }
        if (text === '/status') {
          const processed = loadJSON(PROCESSED_FILE);
          await sendTelegram(\`Bot kjører\\n\${Object.keys(processed).length} biler behandlet\`);
        }`;
const newBlock = `        if (text === '/run') {
          console.log('📱 /run received');
          await sendTelegram('⚙️ Manuell kjøring startet...');
          await run(true);
        }
        if (text === '/rerun') {
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
        }
        if (text === '/status') {
          const processed = loadJSON(PROCESSED_FILE);
          await sendTelegram(\`Bot kjører\\n\${Object.keys(processed).length} biler behandlet\`);
        }`;
if (!src.includes(oldBlock)) { console.log('Block not found - no changes made'); process.exit(1); }
src = src.replace(oldBlock, newBlock);
fs.writeFileSync('peasy-auto.js', src);
console.log('Patch applied successfully');
