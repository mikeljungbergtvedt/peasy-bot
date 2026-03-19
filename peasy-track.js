require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const TRACKED_FILE     = path.join(__dirname, 'tracked-cars.json');
const SEEN_FILE        = path.join(__dirname, 'seen-emails.json');
const GITHUB_TOKEN     = process.env.GITHUB_TOKEN;
const GITHUB_REPO      = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const GITHUB_PATH      = 'tracked-cars.json';
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN_TRACK || process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID_TRACK || process.env.TELEGRAM_CHAT_ID;
const POLL_INTERVAL_MS = 60 * 60 * 1000;

// ─── Seen-emails cache ────────────────────────────────────────────────────────
let seenEmails = new Set();
try { seenEmails = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch(e) {}

function markSeen(id) {
  seenEmails.add(id);
  if (seenEmails.size > 5000) {
    const arr = [...seenEmails];
    seenEmails = new Set(arr.slice(arr.length - 5000));
  }
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenEmails]));
}

// ─── Tracked-cars ─────────────────────────────────────────────────────────────
function loadTracked() {
  try { return JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8')); } catch(e) { return {}; }
}

function saveEvent(regNr, eventType, subject) {
  if (!regNr) return;
  const data = loadTracked();
  if (!data[regNr]) data[regNr] = [];
  const today = new Date().toISOString().slice(0, 10);
  const alreadyToday = data[regNr].some(e => e.event === eventType && e.ts.startsWith(today));
  if (alreadyToday) {
    console.log(`[Track] ${regNr} → ${eventType} (duplikat i dag, hopper over)`);
    return;
  }
  data[regNr].push({ event: eventType, ts: new Date().toISOString(), subject: subject || '' });
  fs.writeFileSync(TRACKED_FILE, JSON.stringify(data, null, 2));
  console.log(`[Track] ${regNr} → ${eventType}`);
  pushToGitHub(data);
}

// ─── GitHub push ──────────────────────────────────────────────────────────────
async function pushToGitHub(data) {
  try {
    const https   = require('https');
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

    const getSha = () => new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'User-Agent': 'peasy-track', 'Accept': 'application/vnd.github+json' }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d).sha || null); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.end();
    });

    const sha  = await getSha();
    const body = JSON.stringify({ message: 'peasy-track: update tracked-cars.json', content, ...(sha ? { sha } : {}) });

    await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'User-Agent': 'peasy-track', 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) console.log('[GitHub] ✅ tracked-cars.json pushed');
          else console.error('[GitHub] ❌ Push failed:', res.statusCode, d.substring(0, 200));
          resolve();
        });
      });
      req.on('error', e => { console.error('[GitHub] Error:', e.message); resolve(); });
      req.write(body);
      req.end();
    });
  } catch(e) { console.error('[GitHub] pushToGitHub error:', e.message); }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(msg) {
  try {
    const res = await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg })
    });
    const json = await res.json();
    if (!json.ok) console.error('[Telegram] ❌', json.description);
  } catch (err) { console.error('[Telegram] Error:', err.message); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractRegNr(text) {
  const match = text?.match(/\b([A-Z]{2}\d{5})\b/);
  return match ? match[1] : null;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x[0-9A-Fa-f]+;/g, ' ').replace(/&#\d+;/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{3,}/g, '\n')
    .trim();
}

// ─── Email classification ─────────────────────────────────────────────────────
// Returns:
//   { type: 'status', event: 'SOLD' | 'REJECTED' | ... }  → Telegram + event log
//   { type: 'noise' }                                       → ignorer stille
//   { type: 'human' }                                       → Telegram
function classifyEmail(subject, from) {
  const s = subject.toLowerCase();
  const f = from.toLowerCase();

  const isSystem = f.includes('noreply') || f.includes('no-reply') ||
                   f.includes('c2badmin') || f.includes('biladministrasjon') ||
                   f.includes('autoringen') || f.includes('tornado.email') ||
                   f.includes('post@peasy.no');

  if (isSystem) {
    // Kjente status-events
    if (s.includes('rejected by user') || (s.includes('avvist') && s.includes('c2b')))
      return { type: 'status', event: 'REJECTED' };
    if (s.includes('e05a') || s.includes('peasy price estimate') || s.includes('prisen på din'))
      return { type: 'status', event: 'EVALUATED' };
    if (s.includes('seller has selected the date') || s.includes('self-delivery') ||
        s.includes('selvlevering') || s.includes('dato for levering') || s.includes('delivery info'))
      return { type: 'status', event: 'PICKUP_ORDERED' };
    if (s.includes('har ankommet') || s.includes('your car has arrived'))
      return { type: 'status', event: 'CAR_ARRIVED' };
    if (s.includes('er vasket, fotografert') || s.includes('ready for auction'))
      return { type: 'status', event: 'READY_AUCTION' };
    if (s.includes('er nå på auksjon') || s.includes('car is on auction'))
      return { type: 'status', event: 'ON_AUCTION' };
    if (s.includes('auction finished'))
      return { type: 'status', event: 'AUCTION_FINISHED' };
    if (s.includes('owner has signed') || s.includes('gratulerer med salget') ||
        s.includes('has been sold') || s.includes('kontrakt') || s.includes('contract'))
      return { type: 'status', event: 'SOLD' };
    if (s.includes('not sold') || s.includes('ikke solgt') || s.includes("didn't sell"))
      return { type: 'status', event: 'NOT_SOLD' };
    if (s.includes('created payment') || s.includes('betaling'))
      return { type: 'status', event: 'PAYMENT' };

    // Alt annet fra system → ignorer
    return { type: 'noise' };
  }

  return { type: 'human' };
}

// ─── Telegram-format per status-event ────────────────────────────────────────
function formatStatusMessage(event, regNr, subject) {
  const reg = regNr ? ` ${regNr}` : '';
  const labels = {
    EVALUATED:        `📋 Estimat sendt${reg}`,
    REJECTED:         `❌ Avvist av selger${reg}`,
    PICKUP_ORDERED:   `🚚 Henting bestilt${reg}`,
    CAR_ARRIVED:      `🏭 Bil ankommet anlegg${reg}`,
    READY_AUCTION:    `🔨 Klar for auksjon${reg}`,
    ON_AUCTION:       `🔨 På auksjon${reg}`,
    AUCTION_FINISHED: `🏁 Auksjon ferdig${reg}`,
    SOLD:             `✅ SOLGT${reg}`,
    NOT_SOLD:         `↩️ Ikke solgt / returnert${reg}`,
    PAYMENT:          `💰 Betaling opprettet${reg}`,
  };
  return `${labels[event] || event + reg}\nEmne: ${subject}`;
}

// ─── EWS ──────────────────────────────────────────────────────────────────────
async function ewsRequest(xml) {
  const https = require('https');
  const auth  = Buffer.from(process.env.IMAP_USER + ':' + process.env.IMAP_PASS).toString('base64');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'exchange.tornado.email',
      path: '/EWS/Exchange.asmx',
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(xml);
    req.end();
  });
}

// ─── Hoved-pollefunksjon ──────────────────────────────────────────────────────
async function pollEmails() {
  const now  = new Date();
  const day  = now.getDay();
  const hour = now.getHours();

  if (day < 1 || day > 5 || hour < 7 || hour > 19) {
    console.log(`[${now.toLocaleString('nb-NO')}] Utenfor arbeidstid — skip`);
    return;
  }

  console.log(`[${now.toLocaleString('nb-NO')}] Starter polling...`);

  try {
    const findXml = `<?xml version='1.0' encoding='utf-8'?>
<soap:Envelope xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/' xmlns:t='http://schemas.microsoft.com/exchange/services/2006/types' xmlns:m='http://schemas.microsoft.com/exchange/services/2006/messages'>
  <soap:Body>
    <m:FindItem Traversal='Shallow'>
      <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape>
      <m:ParentFolderIds><t:DistinguishedFolderId Id='inbox'/></m:ParentFolderIds>
    </m:FindItem>
  </soap:Body>
</soap:Envelope>`;

    const findRes = await ewsRequest(findXml);
    if (findRes.status !== 200) { console.error('[FindItem] feilet:', findRes.status); return; }

    const idMatches = [...findRes.body.matchAll(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/g)];
    if (!idMatches.length) { console.log('[EWS] Innboks tom'); return; }

    console.log(`[EWS] Fant ${idMatches.length} e-post(er) i innboks`);

    for (const m of idMatches) {
      const itemId    = m[1];
      const changeKey = m[2];

      if (seenEmails.has(itemId)) continue;

      const getXml = `<?xml version='1.0' encoding='utf-8'?>
<soap:Envelope xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/' xmlns:t='http://schemas.microsoft.com/exchange/services/2006/types' xmlns:m='http://schemas.microsoft.com/exchange/services/2006/messages'>
  <soap:Body>
    <m:GetItem>
      <m:ItemShape>
        <t:BaseShape>Default</t:BaseShape>
        <t:IncludeMimeContent>false</t:IncludeMimeContent>
      </m:ItemShape>
      <m:ItemIds><t:ItemId Id="${itemId}" ChangeKey="${changeKey}"/></m:ItemIds>
    </m:GetItem>
  </soap:Body>
</soap:Envelope>`;

      const getRes = await ewsRequest(getXml);
      if (getRes.status !== 200) continue;

      const subject = getRes.body.match(/<t:Subject>([^<]*)<\/t:Subject>/)?.[1] || '';
      const from    = getRes.body.match(/<t:EmailAddress>([^<]*)<\/t:EmailAddress>/)?.[1] || '';
      const rawBody = getRes.body.match(/<t:Body[^>]*>([\s\S]*?)<\/t:Body>/)?.[1] || '';
      const body    = stripHtml(rawBody).substring(0, 400);

      const regNr = extractRegNr(subject) || extractRegNr(body);
      const cls   = classifyEmail(subject, from);

      console.log(`[${new Date().toLocaleString('nb-NO')}] [${cls.type.toUpperCase()}${cls.event ? ':' + cls.event : ''}] ${regNr || '–'} | "${from}" → "${subject.substring(0, 60)}"`);

      if (cls.type === 'status') {
        await sendTelegram(formatStatusMessage(cls.event, regNr, subject));
        saveEvent(regNr, cls.event, subject);
      } else if (cls.type === 'human') {
        let msg = `📧 NY E-POST${regNr ? ': ' + regNr : ''}\nFra: ${from}\nEmne: ${subject}`;
        if (body) msg += `\n\n${body}`;
        await sendTelegram(msg);
      }
      // noise → ignorer stille

      markSeen(itemId);
    }
  } catch (e) { console.error('[pollEmails] error:', e.message); }
}

// ─── Start ────────────────────────────────────────────────────────────────────
console.log('[peasy-track] Starter... polling hver time 07:00–19:00 man–fre');
pollEmails();
setInterval(pollEmails, POLL_INTERVAL_MS);
