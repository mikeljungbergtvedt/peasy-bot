const fs = require('fs');
let c = fs.readFileSync('/Users/bot/peasy-auto/peasy-auto.js', 'utf8');

// ── Find formatSingleResult and replace the entire card ──
const sec1 = c.indexOf('// Section 1: Origin car');
const sec1b = c.indexOf('// Sections 1-4: Business card');
const cardStart = sec1 > -1 ? sec1 : sec1b;

// Find end of card content — just before markProcessed or results.push
const cardEnd = c.indexOf('        results.push(', cardStart > -1 ? cardStart : 0);

if (cardStart === -1 || cardEnd === -1) {
  console.log('ERROR: could not find card section. cardStart=' + cardStart + ' cardEnd=' + cardEnd);
  process.exit(1);
}

const oldCard = c.substring(cardStart, cardEnd);

const newCard = `// ── EVAL CARD ──────────────────────────────────────────────────
    // Title: source determines Drive or Peasy
    const source = (car.source || '').toLowerCase();
    const listTitle = source === 'driveno' ? 'DRIVE BIL TIL ESTIMERING' : 'PEASY BIL TIL ESTIMERING';

    // Car specs line
    const isElectric = specs.fuel.toLowerCase().includes('elektr');
    const hkStr = isElectric
      ? (specs.range ? specs.range + ' km rekkevidde' : specs.kw + ' kW')
      : Math.round((specs.kw||0) * 1.36) + 'hk';

    msg += '<b>' + listTitle + '</b>\\n';
    msg += r.regNr + '  |  ' + car.make + ' ' + car.model + ' ' + car.year + '  |  ' + car.km.toLocaleString('nb-NO') + ' km  |  ' + specs.fuel + '  |  ' + specs.gearbox + '  |  ' + specs.drive + '  |  ' + hkStr + '\\n';
    msg += '\\n';

    // Finn search
    msg += '<b>FINN-SOK</b>  ' + specs.fuel + '  |  ' + car.year + '  |  ' + (r.totalCount || comps.length) + ' treff  |  <a href="' + finnUrl + '">Apne sok</a>\\n';

    // Finn listing near comp pool if found
    if (r.finnListing) {
      const gap = r.finnListing.price - r.lowestComp;
      const gapStr = gap >= 0 ? '+' + Math.round(gap/1000) + 'k over anker' : Math.abs(Math.round(gap/1000)) + 'k under anker';
      msg += '   Egen annonse: <a href="https://www.finn.no/mobility/search/car?q=' + car.regNr + '">' + r.finnListing.price.toLocaleString('nb-NO') + ' kr (' + gapStr + ')</a>\\n';
    }

    // Comp table
    msg += '\\n';
    comps.sort((a, b) => a.price - b.price).slice(0, 5).forEach((comp, i) => {
      const isAnker = r.anchor && comp.price === r.anchor.price && comp.km === r.anchor.km;
      msg += (isAnker ? '> ' : '  ') + (i+1) + '.  '
        + comp.price.toLocaleString('nb-NO') + ' kr  '
        + comp.km.toLocaleString('nb-NO') + ' km  '
        + (comp.year || '') + (isAnker ? '  <- anker' : '') + '\\n';
    });
    msg += '   Snitt: ' + fmtNOKstr(finnAvg) + '\\n';
    msg += '\\n';

    // AI comment
    if (r.anchor && r.anchor.aiReason) {
      msg += '<b>AI KOMMENTAR</b>\\n';
      msg += r.anchor.aiReason + '\\n';
      msg += '\\n';
    }

    // Kalkyle
    msg += '<b>KALKYLE</b>\\n';
    msg += '   Anker:          ' + r.lowestComp.toLocaleString('nb-NO') + ' kr\\n';
    msg += '   x 0.88:         ' + valuation.sannsynligBud.toLocaleString('nb-NO') + ' kr\\n';
    msg += '   Peasy fee (U): -' + valuation.fee.toLocaleString('nb-NO') + ' kr\\n';
    msg += '   D mid:          ' + valuation.dMid.toLocaleString('nb-NO') + ' kr\\n';
    msg += '<b>   Estimert:      ' + valuation.dLow.toLocaleString('nb-NO') + ' - ' + valuation.dHigh.toLocaleString('nb-NO') + ' kr</b>\\n';
    msg += '\\n';

    // Heftelser
    msg += '<b>HEFTELSER</b>\\n';
    msg += '   ' + r.heftelser + '\\n';
    if (valuation.dMid < 10000) msg += '   NB: Lav okonomi - vurder manuelt\\n';
    msg += '\\n';

    // Customer comment
    if (r.sdComment) {
      msg += '<b>KOMMENTAR FRA SELGER</b>\\n';
      msg += '   ' + r.sdComment.substring(0, 300) + '\\n';
      msg += '\\n';
    }

    // ERP
    msg += '<b>ERP</b>\\n';
        `;

c = c.substring(0, cardStart) + newCard + c.substring(cardEnd);

// Also fix ERP status lines — remove emoji, keep info
c = c.replace(
  "msg += '✅ Skrevet til ERP\\n';",
  "msg += '   Skrevet til ERP\\n';"
);
c = c.replace(
  "msg += '⚠️ Ikke skrevet — bil annonsert på Finn\\n';",
  "msg += '   Ikke skrevet - bil annonsert pa Finn\\n';"
);
c = c.replace(
  "msg += '⚠️ Ikke skrevet — heftelser registrert\\n';",
  "msg += '   Ikke skrevet - heftelser registrert\\n';"
);
c = c.replace(
  "msg += '⚠️ Ikke skrevet — manuell gjennomgang\\n';",
  "msg += '   Ikke skrevet - manuell gjennomgang\\n';"
);
c = c.replace(
  "msg += 'QA: ' + qa.reason + '\\n';",
  "msg += '   QA: ' + qa.reason + '\\n';"
);

// Remove any remaining border lines
c = c.replace(/msg \+= '[━\-]{10,}\\n';\n/g, '');
c = c.replace(/msg \+= '[━\-]{10,}\\n\\n';\n/g, "msg += '\\n';\n");

// Also add source to car object in fetchPendingCars
c = c.replace(
  "cars.push({ erpId: c.id, regNr: c.registration_number, make: c.manufacturer || '', model: c.model_series || '', year: c.model_year || 0, km: c.mileage || 0, hasSdComment: c.has_sd_comment === 1 });",
  "cars.push({ erpId: c.id, regNr: c.registration_number, make: c.manufacturer || '', model: c.model_series || '', year: c.model_year || 0, km: c.mileage || 0, hasSdComment: c.has_sd_comment === 1, source: c.source || '' });"
);

fs.writeFileSync('/Users/bot/peasy-auto/peasy-auto.js', c);
console.log('Done. Card rebuilt.');
