const fs = require('fs');
const { execSync } = require('child_process');
let c = fs.readFileSync('/Users/bot/peasy-auto/peasy-auto.js', 'utf8');

// Find the broken area and show surrounding lines
const lines = c.split('\n');
const catchLine = lines.findIndex(l => l.includes('} catch (err) {'));
const brokenArea = lines.slice(catchLine - 8, catchLine + 3).join('\n');
console.log('Around catch:\n' + brokenArea);

// The ERP section needs a closing brace for the for..of loop and try block
// Current broken structure:
//   msg += ERP
//   } catch          <- this catch has no matching try
// 
// Need to close: the for (const r of results) loop, then the try
c = c.replace(
  "    // ERP\n    msg += '<b>ERP</b>\\n';\n      } catch (err) {",
  "    // ERP\n    msg += '<b>ERP</b>\\n';\n    }\n        } catch (err) {"
);

try {
  execSync('/Users/bot/.nvm/versions/node/v24.14.0/bin/node --check /Users/bot/peasy-auto/peasy-auto.js 2>&1');
  fs.writeFileSync('/Users/bot/peasy-auto/peasy-auto.js', c);
  console.log('Syntax OK. Saved.');
} catch(e) {
  console.log('Still broken at: ' + e.stdout?.toString().split('\n')[1]);
}
