#!/usr/bin/env node
// v2-push-to-pulse.js
// Push measurements.jsonl til Pulse-repo (mikeljungbergtvedt/mikeljungbergtvedt.github.io).
// Pulse-fanen leser fila via raw.githubusercontent.com.
//
// Kjor manuelt: node v2-push-to-pulse.js
// Eller via cron/launchd hver kveld kl 22:00.

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_FILE = path.join(__dirname, 'logs.nosync', 'measurements.jsonl');
const REMOTE_PATH = 'v2-measurements.jsonl';

const TOKEN  = process.env.GITHUB_TOKEN;
const REPO   = process.env.GITHUB_REPO   || 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

if (!TOKEN) {
  console.error('FEIL: GITHUB_TOKEN mangler i .env');
  process.exit(1);
}

async function readLocal() {
  try {
    return await fs.readFile(LOCAL_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

async function getRemoteSha() {
  const url = `https://api.github.com/repos/${REPO}/contents/${REMOTE_PATH}?ref=${BRANCH}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 404) return null;  // fila finnes ikke enda
  if (!res.ok) throw new Error(`GET sha feilet: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.sha;
}

async function pushFile(content, sha) {
  const url = `https://api.github.com/repos/${REPO}/contents/${REMOTE_PATH}`;
  const body = {
    message: `v2 measurements update ${new Date().toISOString().slice(0,16)}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PUT feilet: ${res.status} ${err}`);
  }
  return await res.json();
}


// Eksportert for auto-push fra v2-eval. Med 409-retry mot SHA-konflikt.

// PATCHED: safety guard - never overwrite GitHub with shorter file
async function _remoteLines(){
  try{
    const url = 'https://raw.githubusercontent.com/mikeljungbergtvedt/mikeljungbergtvedt.github.io/main/v2-measurements.jsonl?t=' + Date.now();
    const r = await fetch(url);
    if(!r.ok) return -1;
    const t = await r.text();
    return t.split('\n').filter(l => l.trim()).length;
  }catch(e){ return -1; }
}
async function _safetyCheck(localContent){
  const localN = localContent.split('\n').filter(l => l.trim()).length;
  const remoteN = await _remoteLines();
  if(remoteN > 0 && localN < remoteN){
    try{ await fs.writeFile(LOCAL_FILE, (await fetch('https://raw.githubusercontent.com/mikeljungbergtvedt/mikeljungbergtvedt.github.io/main/v2-measurements.jsonl?t='+Date.now())).text()); }catch(e){}
    return { abort: true, reason: 'local ' + localN + ' < remote ' + remoteN + ' - hydrated local from remote' };
  }
  return { abort: false };
}

export async function pushToPulse() {
  const content = await readLocal();
  if (!content) return { ok: true, skipped: 'tom fil' };
  const _safety = await _safetyCheck(content);
  if(_safety.abort){ console.error('pushToPulse SAFETY ABORT:', _safety.reason); return { ok: false, skipped: _safety.reason }; }
    for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sha = await getRemoteSha();
      const result = await pushFile(content, sha);
      return { ok: true, commit: result.commit.sha.slice(0, 8) };
    } catch (e) {
      if (/\b409\b/.test(e.message) && attempt < 2) {
        await new Promise(r => setTimeout(r, 1500));
        continue;  // hent ny SHA og proev igjen
      }
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'oppgav etter 3 forsoek' };
}

async function main() {
  const content = await readLocal();
  const lines = content.split('\n').filter(Boolean).length;

  if (!content) {
    console.log('Ingen measurements lokalt — hopper over push.');
    return;
  }

  console.log(`Lokal fil: ${lines} records, ${content.length} tegn`);

  const sha = await getRemoteSha();
  console.log(sha ? `Eksisterende remote SHA: ${sha.slice(0,8)}...` : 'Ingen eksisterende fil — oppretter.');

  const result = await pushFile(content, sha);
  console.log(`Push OK. Commit: ${result.commit.sha.slice(0,8)}, URL: ${result.content.html_url}`);
  console.log(`Pulse leser fra: https://raw.githubusercontent.com/${REPO}/${BRANCH}/${REMOTE_PATH}`);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
