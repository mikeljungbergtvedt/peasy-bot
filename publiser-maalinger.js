'use strict';
// publiser-maalinger.js — legger nye målinger fra A til v2-measurements.jsonl på Pages.
// v2-boten pushet fila før; den har ikke kjørt siden 23.09, så nye målinger ble liggende på Mini.
// Bare tillegg: eksisterende linjer røres aldri (backsync skriver utfall i dem).
// Nøkkel for «finnes fra før»: regnr + timestamp + evaluator.
// Bruker git-klonen på Mini, samme som backsync (fila er for stor til GitHub contents-API).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOKAL = '/Users/bot/peasy-auto/v2/logs.nosync/measurements.jsonl';
const KLONE = '/Users/bot/mikeljungbergtvedt.github.io';
const FIL = 'v2-measurements.jsonl';

function nokkel(r) {
  return [String(r.regnr || '').toUpperCase(), String(r.timestamp || ''), String(r.evaluator || '')].join('|');
}
function nokler(tekst) {
  const s = new Set();
  for (const l of tekst.split('\n')) {
    if (!l.trim()) continue;
    try { s.add(nokkel(JSON.parse(l))); } catch (e) { /* hopp over */ }
  }
  return s;
}

/** Linjer i lokal som mangler i remote, i lokal rekkefølge. */
function nyeLinjer(lokalTekst, remoteTekst) {
  const finnes = nokler(remoteTekst);
  const ut = [];
  for (const l of lokalTekst.split('\n')) {
    if (!l.trim()) continue;
    let r;
    try { r = JSON.parse(l); } catch (e) { continue; }
    if (!r || !r.regnr || !r.timestamp) continue;
    const k = nokkel(r);
    if (finnes.has(k)) continue;
    finnes.add(k);
    ut.push(l.trim());
  }
  return ut;
}

function git(klone, args) {
  return execFileSync('git', args, { cwd: klone, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/** Kaster aldri. Returnerer { lagtTil } eller { feil }. */
function publiserMaalinger({ lokal = LOKAL, klone = KLONE, log } = {}) {
  const L = log || console.log;
  try {
    if (!fs.existsSync(path.join(klone, '.git'))) return { feil: 'fant ikke git-klonen ' + klone };
    const lokalTekst = fs.readFileSync(lokal, 'utf8');
    git(klone, ['pull', '-q', '--rebase', 'origin', 'main']);
    const remoteFil = path.join(klone, FIL);
    const remoteTekst = fs.existsSync(remoteFil) ? fs.readFileSync(remoteFil, 'utf8') : '';
    const nye = nyeLinjer(lokalTekst, remoteTekst);
    if (!nye.length) { L('Målinger: ingen nye linjer til Pages'); return { lagtTil: 0 }; }
    const prefiks = remoteTekst && !remoteTekst.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(remoteFil, prefiks + nye.join('\n') + '\n');
    git(klone, ['add', FIL]);
    git(klone, ['commit', '-q', '-m', `målinger A: +${nye.length} linjer ${new Date().toISOString().slice(0, 16)}`]);
    for (let i = 0; i < 3; i++) {
      try { git(klone, ['push', '-q', 'origin', 'HEAD:main']); L(`Målinger: +${nye.length} linjer til Pages`); return { lagtTil: nye.length }; }
      catch (e) { git(klone, ['pull', '-q', '--rebase', 'origin', 'main']); }
    }
    return { feil: 'push feilet tre ganger', lagtTil: 0 };
  } catch (e) {
    L('Målinger: feil — ' + ((e && e.message) || e).toString().split('\n')[0]);
    return { feil: (e && e.message) || String(e) };
  }
}

module.exports = { nyeLinjer, publiserMaalinger };

// For hånd på Mini:  node publiser-maalinger.js
if (require.main === module) {
  const r = publiserMaalinger();
  if (r.feil) { console.error('Feil:', r.feil); process.exit(1); }
}
