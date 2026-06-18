'use strict';
// diag-carinfo.js — dumper den faktiske car.info-strukturen for EN bil.
// Viser hvor forhandler- vs privat-annonsene faktisk ligger.
// Kjor pa Mini:  node diag-carinfo.js BU39939 24000

const path = require('path');
const { pathToFileURL } = require('url');
const V2_DIR = process.env.PEASY_V2_DIR || '/Users/bot/peasy-pricing-v2';

function walk(obj, prefix, depth) {
  if (depth > 3 || !obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? prefix + '.' + k : k;
    if (Array.isArray(v)) {
      console.log(`  ${p}: array(${v.length})`);
    } else if (v && typeof v === 'object') {
      console.log(`  ${p}: {${Object.keys(v).join(',')}}`);
      walk(v, p, depth + 1);
    }
  }
}

(async () => {
  const regnr = process.argv[2];
  const km = Number(process.argv[3]) || 0;
  if (!regnr) { console.error('Bruk: node diag-carinfo.js REGNR KM'); process.exit(1); }

  const dcUrl = pathToFileURL(path.join(V2_DIR, 'data-collector.js')).href;
  const dc = await import(dcUrl);

  const data = await dc.collectAllData(regnr, km);
  const ci = data.sources && data.sources.car_info;
  console.log('=== car.info ===');
  console.log('ok    =', ci && ci.ok);
  console.log('error =', (ci && ci.error) || '(ingen)');

  const result = (ci && ci.result) || {};
  const val = result.valuation || {};

  console.log('\n=== result topp-nokler ===');
  console.log(Object.keys(result).join(', ') || '(tom)');

  console.log('\n=== valuation-struktur (arrays markert) ===');
  if (Object.keys(val).length) walk(val, '', 0);
  else console.log('  (valuation er tom)');

  // Finn forste array som ser ut som annonser, dump ett eksempel
  console.log('\n=== forste annonse-array funnet ===');
  let found = false;
  (function scan(obj, prefix, depth) {
    if (found || depth > 3 || !obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const p = prefix ? prefix + '.' + k : k;
      if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object'
          && ('classified_price' in v[0] || 'licence_plate' in v[0] || 'mileage_km' in v[0])) {
        console.log(`sti: ${p}  (lengde ${v.length})`);
        console.log('felter:', Object.keys(v[0]).join(', '));
        console.log('eksempel:', JSON.stringify(v[0]).slice(0, 600));
        found = true;
        return;
      }
      if (v && typeof v === 'object') scan(v, p, depth + 1);
    }
  })(val, '', 0);
  if (!found) console.log('(fant ingen annonse-array i valuation)');

  // AKTIVE vs SOLGTE — kjernen i sporsmaalet: har car.info aktive finn-annonser?
  console.log('\n=== AKTIVE vs SOLGTE i car.info ===');
  console.log('(aktiv = ingen classified_removed_date | solgt = har ca_sold_date)');
  for (const key of ['company_classifieds', 'private_classifieds']) {
    const arr = Array.isArray(val[key]) ? val[key] : [];
    const aktive = arr.filter(c => !c.classified_removed_date);
    const solgte = arr.filter(c => !!c.ca_sold_date);
    console.log(`\n${key}: totalt ${arr.length} | aktive ${aktive.length} | solgte ${solgte.length}`);
    aktive.slice(0, 5).forEach(c => console.log(
      `   AKTIV: ${c.licence_plate} | ${c.mileage_km} km | ${Number(c.classified_price).toLocaleString('nb-NO')} kr`
      + ` | publ ${c.classified_published_date || '?'} | ${c.classified_url || ''}`));
    if (!aktive.length) console.log('   (ingen aktive i denne lista)');
  }

  if (data.errors && data.errors.length) {
    console.log('\n=== errors ===');
    console.log(data.errors.join('\n'));
  }
})().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
