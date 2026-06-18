'use strict';
// pipeline-health.js
// Varsler i Telegram HVIS V2 Benchmark-kjeden er brutt:
//   Easy priser/mater biler, men measurements.jsonl paa GitHub oppdateres ikke
//   (= v2-watcher nede eller push feiler). Stille naar alt er friskt.
// Kjor pa Mini (cron/launchd), f.eks. hver time i arbeidstid.
//   cd /Users/bot/peasy-auto && node pipeline-health.js

require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const EASY_LOG = '/Users/bot/peasy-auto/logs/out.log';
const MEAS_URL = 'https://raw.githubusercontent.com/mikeljungbergtvedt/mikeljungbergtvedt.github.io/main/v2-measurements.jsonl';
const WINDOW_MS = 2.5 * 3600 * 1000; // 2,5 timer

async function tg(text) {
  if (!TOKEN || !CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) {}
}

(async () => {
  const now = Date.now();
  const oslo = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const day = oslo.getDay(), hour = oslo.getHours();
  // Sjekk kun hverdager i/like etter arbeidstid (08–20) for aa unngaa falske varsler
  if (day === 0 || day === 6 || hour < 8 || hour > 20) process.exit(0);

  const problems = [];

  // 1) v2-watcher i live?
  let watcherUp = false;
  try { watcherUp = !!execSync('pgrep -f v2-watcher.js', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
  if (!watcherUp) problems.push('v2-watcher er NEDE — ingen v2-anker blir laget.');

  // 2) Hvor mange biler matet Easy siste vindu? (logg-linjer "Matet shadow")
  let fed = 0;
  try {
    for (const l of fs.readFileSync(EASY_LOG, 'utf8').split('\n')) {
      if (l.includes('Matet shadow')) {
        const m = l.match(/\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\]/);
        if (m && now - Date.parse(m[1]) < WINDOW_MS) fed++;
      }
    }
  } catch (e) {}

  // 3) Hvor mange ferske measurements naadde GitHub siste vindu?
  let fresh = 0, measOk = true;
  try {
    const res = await fetch(MEAS_URL + '?t=' + now);
    const txt = await res.text();
    for (const l of txt.split('\n')) {
      if (!l.trim()) continue;
      try { const o = JSON.parse(l); if (o.timestamp && now - Date.parse(o.timestamp) < WINDOW_MS) fresh++; } catch (_) {}
    }
  } catch (e) { measOk = false; problems.push('Kunne ikke hente v2-measurements fra GitHub.'); }

  // 4) Brutt kjede: Easy matet, men ingenting naadde measurements
  if (measOk && fed >= 1 && fresh === 0) {
    problems.push(`Easy matet ${fed} bil(er) siste 2,5t, men 0 nye measurements paa GitHub — kjeden er brutt (v2-watcher eller push?).`);
  }

  if (problems.length) {
    await tg('⚠️ <b>Pipeline-helse — V2 Benchmark</b>\n\n• ' + problems.join('\n• ')
      + `\n\n<i>(matet: ${fed} · ferske measurements: ${fresh} · siste 2,5t)</i>`);
  }
  process.exit(0);
})().catch(() => process.exit(0));
