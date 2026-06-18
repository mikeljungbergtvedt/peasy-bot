'use strict';
// backsync.js — fyller outcome-feltene i v2-measurements fra ERP-eksporten.
// Folger bilen hele livslopet: transport bestilt (= eval akseptert) -> mottatt
// -> hoyeste bud -> solgt (kontrakt) eller returnert (bud avvist).
// Skriver KUN nar noe faktisk er endret (ingen push-stoy), og pusher da
// oppdatert fil til GitHub slik at Pulse V2 Benchmark viser ekte funnel-tall.
//
// Kjor pa Mini:  cd /Users/bot/peasy-auto && node backsync.js
// Cron (minutt 40, unngaar Easy :00 og health :20):
//   40 * * * * cd /Users/bot/peasy-auto && node backsync.js >> logs/backsync.log 2>&1

const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: '/Users/bot/peasy-auto/.env' }); }
catch (e) {
  try {
    for (const l of fs.readFileSync('/Users/bot/peasy-auto/.env', 'utf8').split('\n')) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (e2) {}
}

const V2_DIR = process.env.PEASY_V2_DIR || '/Users/bot/peasy-pricing-v2';
const XLSX_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';
const GH_REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const GH_FILE = 'v2-measurements.jsonl';

// Filene som oppdateres:
//  1. Git-klonen (det Pulse faktisk leser) — publiseres med git push.
//  2. Lokale watcher-buffere (grok + pricing-v2) — slik at linjer som senere
//     appendes/re-pushes derfra allerede baerer outcome.
const GH_CLONE = '/Users/bot/mikeljungbergtvedt.github.io';
function measurementsFiles() {
  const cands = [
    path.join(GH_CLONE, GH_FILE),
    '/Users/bot/peasy-grok/logs.nosync/measurements.jsonl',
    path.join(V2_DIR, 'logs.nosync', 'measurements.jsonl'),
  ];
  return cands.filter(f => fs.existsSync(f));
}

function toStr(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s || null;
}
function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ERP-eksport kolonner (0-basert): 0=erpId 1=regnr 3=dLav-dHoy 12=status
// 13=evaluert-dato 15/16=transport bestilt 17=mottatt 18=solgt 19=hoyeste bud
// 21=returnert
function outcomeFromRow(row) {
  const bestilt = toStr(row[15]) || toStr(row[16]);
  const mottatt = toStr(row[17]);
  const solgt = toStr(row[18]);
  const returnert = toStr(row[21]);
  const accepted = !!(bestilt || mottatt || solgt || returnert);
  // Eksplisitt kunde-nei: ERP-status "Avvist by customer" o.l.
  const avvist = !accepted && /avvist|declined|rejected/i.test(String(row[12] || ''));
  return {
    eval_accepted: accepted ? true : (avvist ? false : null),
    eval_accepted_at: bestilt || (accepted ? (mottatt || solgt || returnert) : null),
    received_date: mottatt,
    bud_amount: toNum(row[19]),
    bud_accepted: solgt ? true : (returnert ? false : null),
    sold_date: solgt,
    returned_date: returnert,
    status: toStr(row[12]),
  };
}

// Oppdater linjene. backsync_at settes KUN pa linjer som reelt endres,
// slik at uendrede biler ikke gir fil-/push-stoy hver time.
function applyOutcomes(lines, byId, nowIso) {
  let changed = 0;
  const stats = { akseptert: 0, medBud: 0, solgt: 0, returnert: 0 };
  const out = lines.map(l => {
    if (!l.trim()) return l;
    let o;
    try { o = JSON.parse(l); } catch (e) { return l; }
    const oc = o.erpId != null ? byId.get(String(o.erpId)) : null;
    if (!oc) return l;
    const prev = o.outcome || {};
    const merged = Object.assign({}, prev, oc);
    const norm = (x) => { const c = Object.assign({}, x); delete c.backsync_at; return JSON.stringify(c); };
    if (norm(prev) !== norm(merged)) { merged.backsync_at = nowIso; changed++; }
    else if (prev.backsync_at) merged.backsync_at = prev.backsync_at;
    o.outcome = merged;
    if (merged.eval_accepted) stats.akseptert++;
    if (merged.bud_amount) stats.medBud++;
    if (merged.sold_date) stats.solgt++;
    if (merged.returned_date) stats.returnert++;
    return JSON.stringify(o);
  });
  return { out, changed, stats };
}

// Git-haandtering av klonen. VIKTIG: klonen behandles som automasjons-
// arbeidskopi — alt backsync skriver er deriverbart fra ERP, saa ved konflikt
// er det alltid trygt aa resette til origin/main og bygge paa nytt neste runde.
const { execSync } = require('child_process');
function git(cmd) { return execSync('git ' + cmd, { cwd: GH_CLONE, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
function gitTry(cmd) { try { return git(cmd); } catch (e) { return null; } }
function safePush() {
  for (let i = 1; i <= 5; i++) {
    try { return git('push origin main'); }
    catch (e) {
      const err = ((e.stderr || '').toString() + (e.message || '')).toLowerCase();
      const conflict = /rejected|fast-forward|non-fast-forward|fetch first/.test(err);
      if (i === 5 || !conflict) throw e;
      console.log('backsync: push avvist (' + i + '/5), pull-rebase + retry');
      try { git('pull --rebase --autostash'); } catch(_) {}
      const wait = Date.now() + (Math.random() * 1500 + 500);
      while (Date.now() < wait) {}
    }
  }
}

// Kalles FOER vi leser/endrer klone-fila: sørg for ren, oppdatert klone.
function syncCloneStart() {
  gitTry('rebase --abort');
  try { git('pull --rebase origin main'); return true; }
  catch (e) {
    gitTry('rebase --abort');
    gitTry('fetch origin');
    gitTry('reset --hard origin/main');
    console.log('backsync: klonen divergerte — resatt til origin/main');
    return true;
  }
}

function pushClone(changed) {
  try {
    git('add ' + GH_FILE);
    const status = git('status --porcelain ' + GH_FILE);
    if (!status) { console.log('backsync: ingen diff i klonen — hopper over push'); return; }
    git('commit -m "backsync ' + new Date().toISOString().slice(0, 16) + ' (' + changed + ' rader)"');
    git('pull --rebase origin main');
    safePush();
    console.log('backsync: pushet til GitHub via git (' + GH_FILE + ')');
  } catch (e) {
    console.error('backsync: git-push FEILET: ' + ((e.stderr && e.stderr.toString().slice(0, 200)) || e.message));
    gitTry('rebase --abort');
    gitTry('fetch origin');
    gitTry('reset --hard origin/main');
    console.log('backsync: klonen resatt — outcome gjenskapes neste kjoring');
  }
}

async function main() {
  const files = measurementsFiles();
  if (!files.length) { console.error('backsync FEIL: fant ingen measurements-filer'); process.exit(1); }

  const XLSX = require('xlsx');
  const res = await fetch(XLSX_URL);
  if (!res.ok) { console.error('backsync FEIL: ERP-rapport HTTP ' + res.status); process.exit(1); }
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer', cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

  const byId = new Map();
  for (const row of rows.slice(1)) {
    const id = toStr(row[0]);
    if (id) byId.set(id, outcomeFromRow(row));
  }

  syncCloneStart();
  let cloneChanged = 0;
  for (const measFile of files) {
    const lines = fs.readFileSync(measFile, 'utf8').split('\n');
    const r = applyOutcomes(lines, byId, new Date().toISOString());
    console.log('[' + new Date().toISOString() + '] backsync: ' + byId.size + ' ERP-rader | '
      + r.changed + ' oppdatert | akseptert ' + r.stats.akseptert + ' | bud ' + r.stats.medBud
      + ' | solgt ' + r.stats.solgt + ' | returnert ' + r.stats.returnert + ' | fil ' + measFile);
    if (!r.changed) continue;
    const tmp = measFile + '.tmp';
    fs.writeFileSync(tmp, r.out.join('\n'));
    fs.renameSync(tmp, measFile);
    if (measFile.indexOf(GH_CLONE) === 0) cloneChanged = r.changed;
  }
  if (cloneChanged) pushClone(cloneChanged);
}

module.exports = { outcomeFromRow, applyOutcomes, toStr, toNum, measurementsFiles };
if (require.main === module) {
  main().catch(e => { console.error('backsync exception: ' + (e && e.message)); process.exit(1); });
}
