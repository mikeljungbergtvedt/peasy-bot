#!/usr/bin/env node
// v2-stats.js
// Leser measurements.jsonl og viser sammenligning v1 (Easy) vs v2.
//
// Bruk:
//   node v2-stats.js              # siste 7 dager
//   node v2-stats.js --all        # alle records
//   node v2-stats.js --days 14    # siste 14 dager
//   node v2-stats.js --csv        # eksporter CSV til stdout

import { readAllMeasurements } from './v2-measurements.js';

function fmtKr(n) {
  if (!Number.isFinite(Number(n))) return '?';
  return Math.round(Number(n)).toLocaleString('nb-NO') + ' kr';
}
function pct(n) {
  if (!Number.isFinite(Number(n))) return '?';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

const args = process.argv.slice(2);
const isCsv = args.includes('--csv');
const all   = args.includes('--all');
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? +args[daysIdx + 1] : 7;

const records = await readAllMeasurements();
const since = all ? 0 : Date.now() - days * 86400 * 1000;
const inRange = records.filter(r => new Date(r.timestamp).getTime() >= since);
const withDiff = inRange.filter(r => r.diff && Number.isFinite(r.diff.anker_kr));

if (isCsv) {
  console.log('regnr,timestamp,km,variant,easy_anker,v2_anker,diff_kr,diff_pct,easy_dLav,v2_dLav,easy_dHoy,v2_dHoy,v2_confidence,comp_cap,has_errors');
  for (const r of inRange) {
    console.log([
      r.regnr,
      r.timestamp,
      r.km,
      '"' + (r.identifikasjon?.variant || '').replace(/"/g, '""') + '"',
      r.easy?.anker ?? '',
      r.v2?.anker ?? '',
      r.diff?.anker_kr ?? '',
      r.diff?.anker_pct ?? '',
      r.easy?.dLav ?? '',
      r.v2?.dLav ?? '',
      r.easy?.dHoy ?? '',
      r.v2?.dHoy ?? '',
      r.v2?.confidence ?? '',
      r.v2?.comp_cap ?? '',
      r.has_errors,
    ].join(','));
  }
  process.exit(0);
}

console.log('');
console.log('=== V2 SHADOW STATS ===');
console.log(`Periode: ${all ? 'all-time' : 'siste ' + days + ' dager'}`);
console.log(`Records: ${inRange.length} totalt, ${withDiff.length} med komplett v1/v2-data`);
console.log('');

if (!withDiff.length) {
  console.log('Ingen records med diff. Vent paa flere biler.');
  process.exit(0);
}

// Aggregat
const ankerDiffs = withDiff.map(r => r.diff.anker_kr).sort((a,b) => a - b);
const pctDiffs   = withDiff.map(r => r.diff.anker_pct).sort((a,b) => a - b);
const avgKr  = ankerDiffs.reduce((s,n) => s+n, 0) / ankerDiffs.length;
const avgPct = pctDiffs.reduce((s,n) => s+n, 0) / pctDiffs.length;
const median = ankerDiffs[Math.floor(ankerDiffs.length / 2)];
const medianPct = pctDiffs[Math.floor(pctDiffs.length / 2)];

const higher = withDiff.filter(r => r.diff.anker_kr > 0);
const lower  = withDiff.filter(r => r.diff.anker_kr < 0);
const same   = withDiff.filter(r => r.diff.anker_kr === 0);

console.log('ANKER-DIFF (v2 - easy):');
console.log(`  Snitt:   ${avgKr >= 0 ? '+' : ''}${Math.round(avgKr).toLocaleString('nb-NO')} kr  (${pct(avgPct)})`);
console.log(`  Median:  ${median >= 0 ? '+' : ''}${Math.round(median).toLocaleString('nb-NO')} kr  (${pct(medianPct)})`);
console.log(`  v2 hoyere:  ${higher.length} (${Math.round(higher.length / withDiff.length * 100)}%)`);
console.log(`  v2 lavere:  ${lower.length} (${Math.round(lower.length / withDiff.length * 100)}%)`);
console.log(`  Likt:       ${same.length}`);
console.log('');

// Per bracket
const byBracket = {};
for (const r of withDiff) {
  const b = r.v2?.bracket || r.easy?.bracket || '?';
  if (!byBracket[b]) byBracket[b] = { n: 0, sumKr: 0, sumPct: 0 };
  byBracket[b].n++;
  byBracket[b].sumKr += r.diff.anker_kr;
  byBracket[b].sumPct += r.diff.anker_pct;
}
console.log('PER BRACKET:');
console.log('Bracket'.padEnd(14) + 'N    Snitt diff (kr)   Snitt diff (%)');
console.log('-'.repeat(60));
for (const b of Object.keys(byBracket).sort()) {
  const x = byBracket[b];
  const avgKr = x.sumKr / x.n;
  const avgPct = x.sumPct / x.n;
  console.log(
    b.padEnd(14) +
    String(x.n).padEnd(5) +
    ((avgKr >= 0 ? '+' : '') + Math.round(avgKr).toLocaleString('nb-NO')).padStart(15) +
    '  ' +
    pct(avgPct).padStart(8)
  );
}
console.log('');

// Top 5 storste positive avvik
const topHigher = [...higher].sort((a,b) => b.diff.anker_pct - a.diff.anker_pct).slice(0, 5);
if (topHigher.length) {
  console.log('TOP 5 — v2 HOYERE enn Easy:');
  for (const r of topHigher) {
    console.log(`  ${r.regnr}  ${(r.identifikasjon?.variant || '').slice(0, 40).padEnd(40)}  easy ${fmtKr(r.easy.anker).padStart(12)}  v2 ${fmtKr(r.v2.anker).padStart(12)}  ${pct(r.diff.anker_pct)}`);
  }
  console.log('');
}

// Top 5 negative
const topLower = [...lower].sort((a,b) => a.diff.anker_pct - b.diff.anker_pct).slice(0, 5);
if (topLower.length) {
  console.log('TOP 5 — v2 LAVERE enn Easy:');
  for (const r of topLower) {
    console.log(`  ${r.regnr}  ${(r.identifikasjon?.variant || '').slice(0, 40).padEnd(40)}  easy ${fmtKr(r.easy.anker).padStart(12)}  v2 ${fmtKr(r.v2.anker).padStart(12)}  ${pct(r.diff.anker_pct)}`);
  }
  console.log('');
}

console.log('Bruk --csv for eksport, --all for alt, --days N for periode.');
