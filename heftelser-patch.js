// heftelser-patch.js — run with: node heftelser-patch.js
// Patches writeARValueToERP to also set heftelser checked, owners checked, and save

const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');

// ─── REPLACE writeARValueToERP ─────────────────────────────────────────────
const oldFn = `async function writeARValueToERP(erpId, priceMin, priceMax, token) {
  try {
    const res = await fetch(\`https://api.biladministrasjon.no/c2b_module/driveno/\${erpId}\`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_final_min: Math.round(priceMin/1000)*1000, price_final_max: Math.round(priceMax/1000)*1000 })
    });
    const data = await res.json();
    if (data.success) {
      console.log(\`  ✅ ERP updated: \${Math.round(priceMin).toLocaleString('nb-NO')} - \${Math.round(priceMax).toLocaleString('nb-NO')} kr\`);
      return true;
    } else {
      console.error('  ⚠️ ERP write failed:', JSON.stringify(data));
      return false;
    }
  } catch(e) {
    console.error('  ⚠️ ERP write error:', e.message);
    return false;
  }
}`;

const newFn = `async function writeARValueToERP(erpId, priceMin, priceMax, heftelser, token) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const hasDebt = heftelser && heftelser.includes('⚠️');

    const payload = {
      price_final_min: Math.round(priceMin/1000)*1000,
      price_final_max: Math.round(priceMax/1000)*1000,
      encumbrance: {
        is_checked: true,
        has_debt: hasDebt,
        comment: heftelser || 'Ingen heftelser',
        date: today,
      },
      owners_check_date: today,
      owners_check_comment: null,
      owners_is_checked: true,
    };

    const res = await fetch(\`https://api.biladministrasjon.no/c2b_module/driveno/\${erpId}\`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      console.log(\`  ✅ ERP updated: \${(Math.round(priceMin/1000)*1000).toLocaleString('nb-NO')} - \${(Math.round(priceMax/1000)*1000).toLocaleString('nb-NO')} kr | heftelser: \${hasDebt ? '⚠️' : '✅'} | eiere: ✅\`);
      return true;
    } else {
      console.error('  ⚠️ ERP write failed:', JSON.stringify(data));
      return false;
    }
  } catch(e) {
    console.error('  ⚠️ ERP write error:', e.message);
    return false;
  }
}`;

// ─── ALSO UPDATE THE CALL SITE to pass heftelser ───────────────────────────
const oldCall = `          await writeARValueToERP(car.erpId, valuation.low, valuation.high, erpToken);`;
const newCall = `          await writeARValueToERP(car.erpId, valuation.low, valuation.high, heftelser, erpToken);`;

// ─── APPLY ─────────────────────────────────────────────────────────────────
if (src.includes('async function writeARValueToERP(erpId, priceMin, priceMax, token)')) {
  src = src.replace(oldFn, newFn);
  console.log('✅ Replaced writeARValueToERP with heftelser + owners');
} else {
  console.log('❌ writeARValueToERP not found — check function signature');
}

if (src.includes(oldCall)) {
  src = src.replace(oldCall, newCall);
  console.log('✅ Updated call site to pass heftelser');
} else {
  console.log('❌ Call site not found');
}

fs.writeFileSync(path, src);
console.log('\n🎉 Done! Test with: node test-erp-write.js');
