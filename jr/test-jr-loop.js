#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { applyCarInfoIdentity } = require('./origin-cv');
const { buildFinnUrl, assertJrFinnUrl } = require('./finn-query');
const { buildDossier } = require('./dossier');
const { loadForChef, readDossierFile, findDossier, preserveOriginKm } = require('./read-dossier');
const {
  analogComps,
  finnUtprisFromDossier,
  assertAlwaysNumber,
  ASK_CAP,
  mapChefComps,
  miniHookPool,
} = require('./analog-comps');
const { runChefOnDossier } = require('./chef-runner');
const { POLL_MS } = require('./runner');

function plistProgramArguments(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const block = xml.split('<key>ProgramArguments</key>')[1];
  assert.ok(block, 'ProgramArguments missing in ' + file);
  const array = block.split('<array>')[1].split('</array>')[0];
  return [...array.matchAll(/<string>([^<]*)<\/string>/g)].map(m => m[1]);
}

function plistValue(file, key) {
  const xml = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`<key>${key}</key>\\s*<(string|integer)>([^<]*)</\\1>`);
  const m = xml.match(re);
  return m ? m[2] : null;
}

async function main() {
  const fixture = path.join(__dirname, 'fixtures', 'el54991.shared.json');
  const dossier = readDossierFile(fixture);
  assert.strictEqual(dossier.writes_erp, false);
  assert.strictEqual(dossier.origin_cv.km, 11820);

  // dossier origin.km preserved against car.info / Finn km
  const poisoned = applyCarInfoIdentity(dossier.origin_cv, {
    result: { brand: 'Tesla', series: 'Model 3', mileage: 999999, km: 42 },
  });
  assert.strictEqual(poisoned.km, 11820);
  const locked = preserveOriginKm(dossier.origin_cv, { result: { km: 1, mileage: 2 } });
  assert.strictEqual(locked.km, 11820);
  assert.strictEqual(locked.origin_cv ? locked.origin_cv.km : locked.km, 11820);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-dossier-'));
  const named = path.join(tmp, '4202-EL54991.json');
  fs.writeFileSync(named, JSON.stringify(dossier));
  const hit = loadForChef({ chef: 'easy', erpId: 4202, internnr: 4202, regnr: 'EL54991', dir: tmp });
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.skipOwnSearch, false, 'empty mapped comps must not skip own Finn');
  assert.ok(Array.isArray(hit.pool) && hit.pool.length === 0);
  assert.strictEqual(hit.origin_cv.km, 11820);
  assert.strictEqual(hit.writes_erp, false);
  const v3 = loadForChef({ chef: 'v3', internnr: 4202, regnr: 'el 54991', dir: tmp });
  const v3g = loadForChef({ chef: 'v3g', erpId: 4202, regnr: 'EL54991', dir: tmp });
  const bot4 = loadForChef({ chef: 'bot4', erpId: 4202, regnr: 'EL54991', dir: tmp });
  assert.strictEqual(JSON.stringify(v3.origin_cv), JSON.stringify(hit.origin_cv));
  assert.strictEqual(JSON.stringify(v3g.origin_cv), JSON.stringify(bot4.origin_cv));

  const miss = loadForChef({ chef: 'easy', erpId: 9999, regnr: 'XX00000', dir: tmp });
  assert.strictEqual(miss.ok, false);
  assert.strictEqual(miss.fallback, true);
  assert.strictEqual(miss.skipOwnSearch, false);

  // Finn URL still no year/km
  const url = buildFinnUrl('Tesla', 'Model 3');
  assert.ok(!/year_from|year_to|mileage_|engine_effect/.test(url));
  assert.ok(!/\b(19|20)\d{2}\b/.test(new URL(url).searchParams.get('q') || ''));
  assertJrFinnUrl(url);
  assertJrFinnUrl(dossier.finn.url);
  assert.strictEqual(dossier.finn.year, null);
  assert.strictEqual(dossier.finn.km, null);
  const rebuilt = buildDossier({ originCv: dossier.origin_cv });
  assertJrFinnUrl(rebuilt.finn.url);
  assert.strictEqual(rebuilt.finn.km, null);

  // analog Finn-utpris always a number, never 0 comps
  const empty = { origin_cv: { ...dossier.origin_cv }, comps: [], writes_erp: false };
  const analogEmpty = assertAlwaysNumber(finnUtprisFromDossier(empty));
  assert.strictEqual(typeof analogEmpty.finn_utpris, 'number');
  assert.ok(analogEmpty.finn_utpris > 0);
  assert.ok(analogEmpty.comps.length >= 1);
  assert.ok(analogComps(empty).length >= 1);

  const withAsk = {
    origin_cv: { ...dossier.origin_cv, km: 11820 },
    comps: [
      { seller: 'Follo Auto', price: 400000 },
      { seller: 'Peasy Oslo', price: 1 },
    ],
    origin: [{ is_active: true, price: 300000 }],
  };
  const capped = assertAlwaysNumber(finnUtprisFromDossier(withAsk));
  assert.ok(capped.comps.every(c => !/peasy/i.test(c.seller || '')));
  assert.ok(capped.finn_utpris <= Math.round(300000 * ASK_CAP) + 999);
  assert.strictEqual(capped.capped, true);
  assert.strictEqual(withAsk.origin_cv.km, 11820);

  const dry = await runChefOnDossier(dossier, { forceDry: true });
  assert.strictEqual(dry.writes_erp, false);
  assert.strictEqual(dry.mode, 'dry-run-analog');
  assert.strictEqual(typeof dry.finn_utpris, 'number');
  assert.ok(dry.finn_utpris > 0);
  assert.ok(dry.comps.length >= 1);
  assert.strictEqual(dry.origin_km, 11820);

  // launchd plist ProgramArguments valid
  const jrPlist = path.join(__dirname, 'com.peasy.jr.plist');
  const jrArgs = plistProgramArguments(jrPlist);
  assert.strictEqual(jrArgs.length, 2, 'jr plist must be node + runner.js (no --once)');
  assert.ok(jrArgs[0].endsWith('/bin/node'));
  assert.strictEqual(jrArgs[1], '/Users/bot/peasy-auto/jr/runner.js');
  assert.ok(!jrArgs.includes('--once'));
  assert.strictEqual(plistValue(jrPlist, 'WorkingDirectory'), '/Users/bot/peasy-auto');
  assert.strictEqual(plistValue(jrPlist, 'JR_DOSSIER_DIR'), '/Users/bot/peasy-auto/jr/dossiers');
  assert.strictEqual(plistValue(jrPlist, 'JR_POLL_MS'), '60000');
  assert.strictEqual(plistValue(jrPlist, 'WRITES_ERP'), 'false');
  assert.ok(POLL_MS === 60000 || Number(process.env.JR_POLL_MS) > 0);

  const pullPlist = path.join(__dirname, 'com.peasy.jr-pull.plist');
  const pullArgs = plistProgramArguments(pullPlist);
  assert.deepStrictEqual(pullArgs, [
    '/bin/bash',
    '/Users/bot/peasy-auto/jr/mini-pull.sh',
  ]);
  assert.strictEqual(plistValue(pullPlist, 'WorkingDirectory'), '/Users/bot/peasy-auto');
  assert.strictEqual(plistValue(pullPlist, 'StartInterval'), '60');

  // copy script does not copy peasy-auto.js and does not delete backups
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-src-'));
  const destParent = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-dest-'));
  const dest = path.join(destParent, 'jr');
  fs.mkdirSync(path.join(srcRoot, 'jr'), { recursive: true });
  fs.writeFileSync(path.join(srcRoot, 'jr', 'hello.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(srcRoot, 'peasy-auto.js'), 'EASY_V7_ONLY_ON_MINI\n');
  fs.writeFileSync(path.join(srcRoot, 'jr', 'peasy-auto.js'), 'SHOULD_NOT_COPY\n');
  const miniEasy = path.join(destParent, 'peasy-auto.js');
  fs.writeFileSync(miniEasy, 'MINI_EASY_V7_BACKUP_OK\n');
  fs.writeFileSync(path.join(destParent, 'peasy-auto.js.bak'), 'KEEP_BACKUP\n');
  execFileSync('/bin/bash', [path.join(__dirname, 'mini-pull.sh'), '--copy-only'], {
    env: {
      ...process.env,
      JR_WORKDIR: destParent,
      JR_PULL_SRC: srcRoot,
      JR_PULL_DEST: dest,
      JR_PULL_LOG: path.join(destParent, 'jr-pull.log'),
    },
  });
  assert.ok(fs.existsSync(path.join(dest, 'hello.js')), 'jr/ files must be copied');
  assert.ok(!fs.existsSync(path.join(dest, 'peasy-auto.js')), 'must not copy peasy-auto.js');
  assert.strictEqual(fs.readFileSync(miniEasy, 'utf8'), 'MINI_EASY_V7_BACKUP_OK\n');
  assert.strictEqual(fs.readFileSync(path.join(destParent, 'peasy-auto.js.bak'), 'utf8'), 'KEEP_BACKUP\n');

  const found = findDossier({ erpId: 4202, regnr: 'EL54991', dir: tmp });
  assert.strictEqual(found.origin_cv.km, 11820);

  // Nested Finn ads without top-level .price (2 Sep Mini empty-pool bug)
  const nestedPath = path.join(__dirname, 'fixtures', 'nested-finn-ads.json');
  const nestedRaw = JSON.parse(fs.readFileSync(nestedPath, 'utf8'));
  assert.strictEqual(miniHookPool(nestedRaw).length, 0, 'hunch: Mini price|ask|finn_price misses nested ads');
  const mappedNested = mapChefComps(nestedRaw);
  assert.ok(mappedNested.length >= 1, 'mapper must flatten nested Finn ads');
  assert.ok(mappedNested.every(c => c.price > 0 && 'km' in c && 'url' in c && 'title' in c && 'year' in c));
  assert.ok(!mappedNested.some(c => /own sold/i.test(c.title || '')));

  const nestedTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-nested-'));
  const nestedNamed = path.join(nestedTmp, '4202-EL54991.json');
  fs.writeFileSync(nestedNamed, JSON.stringify(nestedRaw));
  const nestedHit = loadForChef({ chef: 'bot4', erpId: 4202, regnr: 'EL54991', dir: nestedTmp });
  assert.strictEqual(nestedHit.ok, true);
  assert.strictEqual(nestedHit.writes_erp, false);
  assert.strictEqual(nestedHit.origin_cv.km, 11820);
  const n = (nestedHit.pool || nestedHit.comps || []).length;
  assert.ok(n >= 1 || nestedHit.skipOwnSearch === false, 'n>=1 OR skipOwnSearch false');
  assert.strictEqual(nestedHit.skipOwnSearch, n >= 1);
  assert.ok(n >= 1, 'nested fixture must map to a usable pool');
  assert.ok(nestedHit.comps.every(c => c.price > 0));
  assert.deepStrictEqual(nestedHit.pool, nestedHit.comps);

  const analogNested = assertAlwaysNumber(finnUtprisFromDossier(nestedRaw));
  assert.ok(analogNested.comps.length >= 1);
  assert.ok(analogNested.comps.some(c => c.price === 349000 || c.price === 335000 || c.price === 360000));
  assert.strictEqual(typeof analogNested.finn_utpris, 'number');
  assert.ok(analogNested.finn_utpris > 0);

  const rebuiltNested = buildDossier({
    originCv: nestedRaw.origin_cv,
    comps: nestedRaw.finn.ads,
    finn: { ads: nestedRaw.finn.listings },
  });
  assert.ok(rebuiltNested.comps.length >= 1);
  assert.ok(rebuiltNested.comps.every(c => typeof c.price === 'number' && c.price > 0));
  assert.strictEqual(rebuiltNested.origin_cv.km, 11820);

  const emptyNested = {
    origin_cv: { ...nestedRaw.origin_cv },
    comps: [],
    finn: { ads: [{ heading: 'ingen pris', mileage: 10000, finnkode: 123 }] },
    writes_erp: false,
  };
  const emptyHitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-empty-ads-'));
  fs.writeFileSync(path.join(emptyHitDir, '4202-EL54991.json'), JSON.stringify(emptyNested));
  const emptyAdsHit = loadForChef({ chef: 'v3g', erpId: 4202, regnr: 'EL54991', dir: emptyHitDir });
  assert.strictEqual(emptyAdsHit.ok, true);
  assert.strictEqual(emptyAdsHit.skipOwnSearch, false);
  assert.strictEqual(emptyAdsHit.origin_cv.km, 11820);
  assert.ok(analogComps(emptyNested).length >= 1, 'chef-runner never finishes with 0 comps');

  console.log('ok — jr loop: origin.km 11820, nested Finn map, skipOwnSearch, pull kopierer kun jr/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
