const fs = require('fs');
let c = fs.readFileSync('/Users/bot/peasy-auto/peasy-auto.js', 'utf8');

// Fix calcValuation — anchor * 0.88 - fee = D mid, then *0.95/1.05
const oldFn = `function calcValuation(lowestComp) {
  const t    = formatNOK(lowestComp * 0.88);          // dealer pays 12% below cheapest comp
  const fee  = t >= 125000 ? 9900 : t >= 75000 ? 7900 : 5900;  // Peasy fee
  const dLow = formatNOK(lowestComp * 0.88 * 0.95);  // shown to seller
  const dHigh= formatNOK(lowestComp * 0.88 * 1.05);  // shown to seller
  return { dLow, dHigh, tEstimate: t, fee, sellerT: formatNOK(t - fee) };
}`;

const newFn = `function calcValuation(lowestComp) {
  // Anchor x 0.88 - Peasy fee = D mid
  const bud  = formatNOK(lowestComp * 0.88);
  const fee  = bud >= 125000 ? 9900 : bud >= 75000 ? 7900 : 5900;
  const dMid = bud - fee;
  const dLow = formatNOK(dMid * 0.95);
  const dHigh= formatNOK(dMid * 1.05);
  return { dLow, dHigh, dMid, fee, sannsynligBud: bud };
}`;

if (c.includes(oldFn)) {
  c = c.replace(oldFn, newFn);
  console.log('calcValuation: fixed');
} else {
  console.log('calcValuation: old pattern not found — checking current formula...');
  const idx = c.indexOf('function calcValuation');
  console.log(c.substring(idx, idx + 200));
  process.exit(1);
}

// Fix eval card display — remove T/sellerT references, show D mid
const oldCard = `    msg += 'Finn anker:       <b>' + r.lowestComp.toLocaleString('nb-NO') + ' kr</b>\\n';
    msg += '× 0.88 (T est):  ' + valuation.tEstimate.toLocaleString('nb-NO') + ' kr\\n';
    msg += 'Peasy fee:        ' + valuation.fee.toLocaleString('nb-NO') + ' kr\\n';
    msg += 'Selger T:         ' + valuation.sellerT.toLocaleString('nb-NO') + ' kr\\n';
    msg += '<b>D lav: ' + valuation.dLow.toLocaleString('nb-NO') + ' — D høy: ' + valuation.dHigh.toLocaleString('nb-NO') + ' kr</b>\\n\\n';`;

const newCard = `    msg += 'Finn anker:       <b>' + r.lowestComp.toLocaleString('nb-NO') + ' kr</b>\\n';
    msg += 'x 0.88:           ' + valuation.sannsynligBud.toLocaleString('nb-NO') + ' kr\\n';
    msg += 'Peasy fee (U):  - ' + valuation.fee.toLocaleString('nb-NO') + ' kr\\n';
    msg += 'D mid:            ' + valuation.dMid.toLocaleString('nb-NO') + ' kr\\n';
    msg += '<b>Estimert lav: ' + valuation.dLow.toLocaleString('nb-NO') + ' — hoey: ' + valuation.dHigh.toLocaleString('nb-NO') + ' kr</b>\\n\\n';`;

if (c.includes(oldCard)) {
  c = c.replace(oldCard, newCard);
  console.log('eval card: fixed');
} else {
  console.log('eval card: pattern not found, skipping');
}

// Fix QA check that references tEstimate
c = c.replace(
  "if (valuation.tEstimate < 10000) return { approved: false, reason: 'T-estimat under 10 000 kr — vurder manuelt' };",
  "if (valuation.dMid < 5000) return { approved: false, reason: 'D mid under 5 000 kr — vurder manuelt' };"
);

// Fix /finn card display too
c = c.replace(
  "reply += '× 0.88 (T est):  ' + val.tEstimate.toLocaleString('nb-NO') + ' kr\\n';\n              reply += 'Peasy fee:        ' + val.fee.toLocaleString('nb-NO') + ' kr\\n';\n              reply += 'Selger T:         ' + val.sellerT.toLocaleString('nb-NO') + ' kr\\n';\n              reply += '<b>D lav: ' + val.dLow.toLocaleString('nb-NO') + ' — D høy: ' + val.dHigh.toLocaleString('nb-NO') + ' kr</b>\\n\\n';",
  "reply += 'x 0.88:           ' + val.sannsynligBud.toLocaleString('nb-NO') + ' kr\\n';\n              reply += 'Peasy fee (U):  - ' + val.fee.toLocaleString('nb-NO') + ' kr\\n';\n              reply += 'D mid:            ' + val.dMid.toLocaleString('nb-NO') + ' kr\\n';\n              reply += '<b>Estimert lav: ' + val.dLow.toLocaleString('nb-NO') + ' — hoey: ' + val.dHigh.toLocaleString('nb-NO') + ' kr</b>\\n\\n';"
);

fs.writeFileSync('/Users/bot/peasy-auto/peasy-auto.js', c);
console.log('Done.');
