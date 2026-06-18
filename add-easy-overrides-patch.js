'use strict';
// add-easy-overrides-patch.js
// Logger hver "Endre anker"-overstyring i Easy og pusher easy-overrides.jsonl til GitHub,
// slik at Pulse V2 Benchmark kan vise "Endret Easy-anker"-kolonnen.
// Krever GITHUB_TOKEN i .env (kjor move-github-token-patch.js forst + legg tokenet i .env).
// Idempotent + backup. Kjor pa Mini:
//   cd /Users/bot/peasy-auto && node add-easy-overrides-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('pushEasyOverride')) {
  console.log('Allerede patchet — easy-overrides finnes.');
  process.exit(0);
}

// ── 1) Sett inn hjelpefunksjonen rett for updateBracketsJson ──
const ANCHOR_FN = 'async function updateBracketsJson(rows) {';
if (!src.includes(ANCHOR_FN)) { console.error('FEIL: fant ikke updateBracketsJson.'); process.exit(1); }

const HELPER = [
  "// ── Easy-anker-overstyring -> easy-overrides.jsonl (lokalt + GitHub) ───",
  "const EASY_OVERRIDES_FILE = path.join(__dirname, 'easy-overrides.jsonl');",
  "async function pushEasyOverride(regnr, erpId, nyAnker, nyVal) {",
  "  const rec = {",
  "    regnr, erpId, anker: nyAnker,",
  "    dLav: nyVal ? nyVal.dLav : null,",
  "    dHoy: nyVal ? nyVal.dHoy : null,",
  "    timestamp: new Date().toISOString(),",
  "  };",
  "  try { fs.appendFileSync(EASY_OVERRIDES_FILE, JSON.stringify(rec) + '\\n'); }",
  "  catch (e) { logErr('easy-overrides lokal', e); }",
  "",
  "  const TOKEN = process.env.GITHUB_TOKEN;",
  "  if (!TOKEN) { log('easy-overrides: GITHUB_TOKEN mangler i .env — kun lokal logg'); return; }",
  "  const REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';",
  "  const GHFILE = 'easy-overrides.jsonl';",
  "  try {",
  "    const content = Buffer.from(fs.readFileSync(EASY_OVERRIDES_FILE)).toString('base64');",
  "    const shaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${GHFILE}`, {",
  "      headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },",
  "    });",
  "    const shaData = await shaRes.json();",
  "    const body = { message: `easy-override ${regnr} ${new Date().toISOString().slice(0,10)}`, content };",
  "    if (shaData && shaData.sha) body.sha = shaData.sha;",
  "    const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${GHFILE}`, {",
  "      method: 'PUT',",
  "      headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },",
  "      body: JSON.stringify(body),",
  "    });",
  "    const putData = await putRes.json();",
  "    if (putData.content) log(`easy-overrides: pushet ${regnr} (${nyAnker}) til GitHub`);",
  "    else logErr('easy-overrides push', putData);",
  "  } catch (e) { logErr('easy-overrides push', e); }",
  "}",
  "",
  ANCHOR_FN,
].join('\n');

src = src.replace(ANCHOR_FN, HELPER);

// ── 2) Kall funksjonen i Endre-anker-handleren, rett etter writeToERP ──
const CALL_ANCHOR = '            await writeToERP(aId, nyVal.dLav, nyVal.dHoy, nyVal.auctionTypeId, d.anyDebts, d.brreg, tok);';
if (!src.includes(CALL_ANCHOR)) { console.error('FEIL: fant ikke writeToERP i Endre-anker-handleren.'); process.exit(1); }
src = src.replace(
  CALL_ANCHOR,
  CALL_ANCHOR + "\n            try { await pushEasyOverride(aRegnr, aId, nyAnker, nyVal); } catch (eOv) { logErr('pushEasyOverride', eOv); }"
);

const backup = FILE + '.pre-overrides-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src);
console.log('Easy logger + pusher na easy-overrides.jsonl ved hver Endre anker.');
console.log('Backup: ' + backup);
