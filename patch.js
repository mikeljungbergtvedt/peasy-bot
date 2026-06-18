#!/usr/bin/env node
const fs = require('fs');
const file = '/Users/bot/peasy-auto/peasy-auto.js';
let c = fs.readFileSync(file, 'utf8');

// ── FIX 1: Add firstReg to Vegvesen specs ──
c = c.replace(
  "isVarebil: k?.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering?.tekniskKode?.kodeBeskrivelse?.toLowerCase().includes('varebil') || false,",
  "isVarebil: k?.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering?.tekniskKode?.kodeBeskrivelse?.toLowerCase().includes('varebil') || false,\n    firstReg: k?.forstegangsregistrering?.registrertForstegangNorgeDato || null,"
);

// ── FIX 2: Year rule based on firstReg ──
// Replace the first scrapeFinn call that uses (year, year, ...)
c = c.replace(
  `  comps = await scrapeFinn(url(year, year, fuel + trans + drive + kmFrom + kmTo + kwTo), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel + trans + drive + kmFrom + kmTo + kwTo) };
  comps = await scrapeFinn(url(year, year, fuel + trans + drive), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel + trans + drive) };
  comps = await scrapeFinn(url(year, year, fuel + trans), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel + trans) };
  comps = await scrapeFinn(url(year, year, fuel), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel) };
  comps = await scrapeFinn(url(year - 1, year + 1, fuel + trans), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year - 1, year + 1, fuel + trans) };
  comps = await scrapeFinn(url(year - 1, year + 1, fuel), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year - 1, year + 1, fuel) };
  comps = await scrapeFinn(url(year - 2, year + 2, ''), km, page);
  return { comps: comps.slice(0, 10), finnUrl: url(year - 2, year + 2, '') };`,

  `  // Steg 1: firstReg month rule
  const firstRegDate = specs.firstReg ? new Date(specs.firstReg) : null;
  const firstRegYear = firstRegDate ? firstRegDate.getFullYear() : year;
  const firstRegMonth = firstRegDate ? firstRegDate.getMonth() + 1 : 1;
  const yFrom = firstRegYear;
  const yTo = firstRegMonth >= 9 ? firstRegYear + 1 : firstRegYear;
  console.log('  Steg 1: firstReg=' + (specs.firstReg||'ukjent') + ' -> year_from=' + yFrom + ' year_to=' + yTo);

  comps = await scrapeFinn(url(yFrom, yTo, fuel + trans + drive + kmFrom + kmTo), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(yFrom, yTo, fuel + trans + drive + kmFrom + kmTo) };
  comps = await scrapeFinn(url(yFrom, yTo, fuel + trans + drive), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(yFrom, yTo, fuel + trans + drive) };
  comps = await scrapeFinn(url(yFrom, yTo, fuel + trans), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(yFrom, yTo, fuel + trans) };
  comps = await scrapeFinn(url(yFrom, yTo, fuel), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(yFrom, yTo, fuel) };
  comps = await scrapeFinn(url(yFrom - 1, yTo + 1, fuel), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(yFrom - 1, yTo + 1, fuel) };
  comps = await scrapeFinn(url(yFrom - 2, yTo + 2, ''), km, page);
  return { comps: comps.slice(0, 10), finnUrl: url(yFrom - 2, yTo + 2, '') };`
);

// ── FIX 3: Kalkyle — anchor * 0.88 - U = D mid ──
c = c.replace(
  `function calcValuation(finnAvg) {
  const mid = finnAvg * (1 - 0.12) * (1 + 0.03);
  return {
    low: formatNOK(mid * (1 - 0.05)),
    high: formatNOK(mid * (1 + 0.05)),`,

  `function calcValuation(anchor) {
  const sannsynligBud = Math.round(anchor * 0.88);
  const margin = anchor - sannsynligBud;
  const adjBud = margin >= 10000 ? sannsynligBud : anchor - 10000;
  const fee = adjBud >= 125000 ? 9900 : adjBud >= 75000 ? 7900 : 5900;
  const dMid = adjBud - fee;
  return {
    low: formatNOK(Math.round(dMid * 0.95)),
    high: formatNOK(Math.round(dMid * 1.05)),
    dMid: formatNOK(dMid),
    fee: fee,
    sannsynligBud: adjBud,`
);

// ── FIX 4: Update kalkyle display in card ──
c = c.replace(
  "msg += 'Fra: ' + valuation.low.toLocaleString('nb-NO') + ' — Til: ' + valuation.high.toLocaleString('nb-NO') + ' kr\\n';",
  "msg += 'Anker x 0.88:     ' + valuation.sannsynligBud.toLocaleString('nb-NO') + ' kr\\n';\n    msg += 'Peasy fee (U):  - ' + valuation.fee.toLocaleString('nb-NO') + ' kr\\n';\n    msg += 'D mid:            ' + valuation.dMid.toLocaleString('nb-NO') + ' kr\\n';\n    msg += 'D lav: ' + valuation.low.toLocaleString('nb-NO') + ' — D hoy: ' + valuation.high.toLocaleString('nb-NO') + ' kr\\n';"
);

fs.writeFileSync(file, c, 'utf8');

// Verify
const v = fs.readFileSync(file, 'utf8');
console.log('firstReg:', v.includes('firstReg:'));
console.log('yFrom:', v.includes('const yFrom'));
console.log('dMid:', v.includes('dMid'));
console.log('D lav:', v.includes('D lav'));
console.log('Done.');
