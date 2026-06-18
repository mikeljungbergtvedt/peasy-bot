'use strict';
// add-telegram-chunking-patch.js
// Fikser at lange eval-kort ikke sendes til Telegram (>4096 tegn -> stille avvist).
// Bytter sendTelegram til a dele meldinger paa seksjons-grenser (blank linje),
// knapper kun pa siste bit, og logge hvis Telegram svarer feil.
// Idempotent + backup. Kjor pa Mini:
//   cd /Users/bot/peasy-auto && node add-telegram-chunking-patch.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'peasy-auto.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes("text.split('\\n\\n')")) {
  console.log('Allerede patchet — sendTelegram deler opp lange meldinger.');
  process.exit(0);
}

const START = 'async function sendTelegram(text, reply_markup) {';
const END = "  } catch (e) { logErr('sendTelegram', e); }\n}";
const s = src.indexOf(START);
const e = src.indexOf(END, s);
if (s < 0 || e < 0) { console.error('FEIL: fant ikke sendTelegram-funksjonen.'); process.exit(1); }
const endPos = e + END.length;

const NEW_FN = `async function sendTelegram(text, reply_markup) {
  const MAX = 4000; // Telegram-grense er 4096; vi holder margin
  let chunks;
  if (!text || text.length <= MAX) {
    chunks = [text || ''];
  } else {
    // Del paa seksjons-grenser (blank linje) saa HTML-tagger som <pre> ikke brytes
    chunks = [];
    let buf = '';
    for (const block of text.split('\\n\\n')) {
      const cand = buf ? buf + '\\n\\n' + block : block;
      if (cand.length > MAX && buf) { chunks.push(buf); buf = block; }
      else buf = cand;
    }
    if (buf) chunks.push(buf);
    // Sikkerhetsnett: hard-splitt en enkelt-blokk som fortsatt er for stor
    const safe = [];
    for (const c of chunks) {
      if (c.length <= 4096) { safe.push(c); continue; }
      let rest = c;
      while (rest.length > 4096) { safe.push(rest.slice(0, MAX)); rest = rest.slice(MAX); }
      if (rest) safe.push(rest);
    }
    chunks = safe;
  }
  try {
    for (let i = 0; i < chunks.length; i++) {
      const body = {
        chat_id: CONFIG.telegram.chatId,
        text: chunks[i],
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      // Knapper (reply_markup) kun pa siste bit
      if (reply_markup && i === chunks.length - 1) body.reply_markup = reply_markup;
      const res = await fetch(\`https://api.telegram.org/bot\${CONFIG.telegram.token}/sendMessage\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res && !res.ok) {
        const t = await res.text().catch(() => '');
        logErr('sendTelegram', new Error(\`HTTP \${res.status}: \${t.slice(0, 150)}\`));
      }
    }
  } catch (e) { logErr('sendTelegram', e); }
}`;

src = src.slice(0, s) + NEW_FN + src.slice(endPos);

const backup = FILE + '.pre-tgchunk-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, src);
console.log('sendTelegram deler na opp lange kort (knapper pa siste bit) + logger Telegram-feil.');
console.log('Backup: ' + backup);
