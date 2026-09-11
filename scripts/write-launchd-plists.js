#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const HOME = '/Users/bot/peasy-auto';
const NODE_PATH = '/Users/bot/.nvm/versions/node/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const WRAP = `${HOME}/scripts/peasy-supervised-node.sh`;

const jobs = [
  { label: 'com.peasy.auto', short: 'peasy-auto', script: `${HOME}/peasy-auto.js` },
  { label: 'com.peasy.v3g', short: 'v3g', script: `${HOME}/v3g/v3g-watcher.js` },
  { label: 'com.peasy.v2-bot', short: 'v2-bot', script: `${HOME}/v2/peasy-bot.js` },
  { label: 'com.peasy.v2-watcher', short: 'v2-watcher', script: `${HOME}/v2/v2-watcher.js` },
  { label: 'com.peasy.bot4', short: 'bot4', script: `${HOME}/bot4/watcher.js` },
  {
    label: 'com.peasy.jr',
    short: 'jr',
    script: `${HOME}/jr/runner.js`,
    extraEnv: {
      JR_DOSSIER_DIR: `${HOME}/jr/dossiers`,
      JR_POLL_MS: '60000',
      WRITES_ERP: 'false',
    },
  },
  { label: 'com.peasy.track', short: 'peasy-track', script: `${HOME}/peasy-track/peasy-track.js` },
];

function envXml(extra) {
  const env = Object.assign({
    PATH: NODE_PATH,
    PEASY_HOME: HOME,
  }, extra || {});
  return Object.entries(env).map(([k, v]) =>
    `    <key>${k}</key>\n    <string>${v}</string>`
  ).join('\n');
}

function nodePlist(job) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${job.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${WRAP}</string>
    <string>${job.short}</string>
    <string>${job.script}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${HOME}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${HOME}/logs.nosync/${job.short}.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/logs.nosync/${job.short}.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml(Object.assign({ PEASY_PROCESS_LABEL: job.short }, job.extraEnv))}
  </dict>
</dict>
</plist>
`;
}

function watchdogPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.peasy.timewait</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${HOME}/scripts/peasy-timewait-watchdog.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${HOME}</string>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${HOME}/logs.nosync/timewait.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/logs.nosync/timewait.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PEASY_HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
`;
}

const root = path.join(__dirname, '..');
const launchd = path.join(root, 'launchd');
fs.mkdirSync(launchd, { recursive: true });

for (const job of jobs) {
  const xml = nodePlist(job);
  fs.writeFileSync(path.join(launchd, `${job.label}.plist`), xml);
  if (job.label === 'com.peasy.auto') {
    fs.writeFileSync(path.join(root, 'com.peasy.auto.plist'), xml);
  }
  if (job.label === 'com.peasy.jr') {
    fs.writeFileSync(path.join(root, 'jr', 'com.peasy.jr.plist'), xml);
  }
}
fs.writeFileSync(path.join(launchd, 'com.peasy.timewait.plist'), watchdogPlist());
console.log('wrote launchd plists + root/jr copies');
