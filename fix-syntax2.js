const fs = require('fs');
const { execSync } = require('child_process');
let c = fs.readFileSync('/Users/bot/peasy-auto/peasy-auto.js', 'utf8');

c = c.replace(
  "    // ERP\n    msg += '<b>ERP</b>\\n';\n      } catch (err) {",
  "    // ERP\n    msg += '<b>ERP</b>\\n';\n      }\n      } catch (err) {"
);

fs.writeFileSync('/Users/bot/peasy-auto/peasy-auto.js', c);

try {
  execSync('/Users/bot/.nvm/versions/node/v24.14.0/bin/node --check /Users/bot/peasy-auto/peasy-auto.js');
  console.log('Syntax OK.');
} catch(e) {
  console.log('Still broken: ' + e.stderr.toString().split('\n')[2]);
}
