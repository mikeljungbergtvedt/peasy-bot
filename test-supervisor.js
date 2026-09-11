#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;

function plistProgramArguments(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const block = xml.split('<key>ProgramArguments</key>')[1];
  assert.ok(block, 'ProgramArguments missing in ' + file);
  const array = block.split('<array>')[1].split('</array>')[0];
  return [...array.matchAll(/<string>([^<]*)<\/string>/g)].map(m => m[1]);
}

function plistInt(file, key) {
  const xml = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`);
  const m = xml.match(re);
  return m ? Number(m[1]) : null;
}

function plistHasKeepAliveLimit(file) {
  const xml = fs.readFileSync(file, 'utf8');
  return xml.includes('<key>Crashed</key>') && xml.includes('<key>SuccessfulExit</key>');
}

function main() {
  const jobs = [
    ['launchd/com.peasy.auto.plist', 'peasy-auto', '/Users/bot/peasy-auto/peasy-auto.js'],
    ['launchd/com.peasy.v3g.plist', 'v3g', '/Users/bot/peasy-auto/v3g/v3g-watcher.js'],
    ['launchd/com.peasy.v2-bot.plist', 'v2-bot', '/Users/bot/peasy-auto/v2/peasy-bot.js'],
    ['launchd/com.peasy.v2-watcher.plist', 'v2-watcher', '/Users/bot/peasy-auto/v2/v2-watcher.js'],
    ['launchd/com.peasy.bot4.plist', 'bot4', '/Users/bot/peasy-auto/bot4/watcher.js'],
    ['launchd/com.peasy.jr.plist', 'jr', '/Users/bot/peasy-auto/jr/runner.js'],
    ['launchd/com.peasy.track.plist', 'peasy-track', '/Users/bot/peasy-auto/peasy-track/peasy-track.js'],
  ];

  for (const [rel, short, script] of jobs) {
    const file = path.join(ROOT, rel);
    const args = plistProgramArguments(file);
    assert.deepStrictEqual(args, [
      '/bin/bash',
      '/Users/bot/peasy-auto/scripts/peasy-supervised-node.sh',
      short,
      script,
    ], rel);
    assert.ok(plistInt(file, 'ThrottleInterval') >= 60, rel + ' ThrottleInterval');
    assert.ok(plistHasKeepAliveLimit(file), rel + ' KeepAlive crash limit');
  }

  const wd = path.join(ROOT, 'launchd/com.peasy.timewait.plist');
  assert.deepStrictEqual(plistProgramArguments(wd), [
    '/bin/bash',
    '/Users/bot/peasy-auto/scripts/peasy-timewait-watchdog.sh',
  ]);
  assert.strictEqual(plistInt(wd, 'StartInterval'), 60);
  assert.ok(plistInt(wd, 'ThrottleInterval') >= 60);

  const autoRoot = path.join(ROOT, 'com.peasy.auto.plist');
  assert.ok(plistInt(autoRoot, 'ThrottleInterval') >= 60);
  assert.ok(plistHasKeepAliveLimit(autoRoot));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peasy-sup-'));
  const failJs = path.join(tmp, 'fail.js');
  fs.writeFileSync(failJs, 'process.exit(2);\n');
  const env = {
    ...process.env,
    PEASY_HOME: tmp,
    PEASY_STATE_DIR: tmp,
    PEASY_NODE: process.execPath,
    PEASY_CRASH_LIMIT: '3',
    PEASY_CRASH_WINDOW_SEC: '300',
  };
  const wrap = path.join(ROOT, 'scripts/peasy-supervised-node.sh');
  let last = null;
  for (let i = 0; i < 3; i++) {
    last = spawnSync('/bin/bash', [wrap, 'unit', failJs], { env, encoding: 'utf8' });
  }
  assert.strictEqual(last.status, 0, 'crash-loop must exit 0 so launchd stops');
  assert.ok(fs.existsSync(path.join(tmp, 'unit.CRASHLOOP')));
  assert.ok((last.stdout + last.stderr).includes('CRASHLOOP'));

  const wdScript = path.join(ROOT, 'scripts/peasy-timewait-watchdog.sh');
  const printed = execFileSync('/bin/bash', [wdScript, '--counts', '9000', '115', '40'], {
    env: {
      ...process.env,
      PEASY_HOME: tmp,
      PEASY_TIMEWAIT_LOG: path.join(tmp, 'timewait.log'),
      PEASY_TIMEWAIT_ALERT_STAMP: path.join(tmp, 'timewait.alerted'),
      PEASY_TIMEWAIT_THRESHOLD: '8000',
      TELEGRAM_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    encoding: 'utf8',
  });
  assert.ok(printed.includes('TIME_WAIT total=9000 telegram=115 meta=40'));
  const log = fs.readFileSync(path.join(tmp, 'timewait.log'), 'utf8');
  assert.ok(log.includes('total=9000'));
  assert.ok(!/sysctl|msl/i.test(fs.readFileSync(wdScript, 'utf8').split('\n').filter(l => !l.startsWith('#')).join('\n')) ||
    fs.readFileSync(wdScript, 'utf8').includes('Do NOT touch sysctl'));

  const entryNeedles = [
    ['peasy-auto.js', "installOutboundFetch({ label: 'peasy-auto' })"],
    ['jr/runner.js', "installOutboundFetch({ label: 'jr' })"],
    ['v2/peasy-bot.js', "import '../shared/install-outbound.mjs'"],
    ['v2/v2-watcher.js', "import '../shared/install-outbound.mjs'"],
    ['v3g/v3g-watcher.js', "installOutboundFetch({ label: 'v3g' })"],
    ['bot4/watcher.js', "installOutboundFetch({ label: 'bot4' })"],
    ['peasy-track/peasy-track.js', "installOutboundFetch({ label: 'peasy-track' })"],
  ];
  for (const [rel, needle] of entryNeedles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(src.includes(needle), rel + ' must install outbound hook');
    assert.ok(!/writeToERP|final_estimate|finn_utpris|dLav/.test(needle));
  }

  console.log('ok — supervisor plists ThrottleInterval>=60, crash-loop limit, TIME_WAIT watchdog, 7 hooks');
}

main();
