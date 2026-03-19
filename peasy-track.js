require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const SEEN_FILE        = path.join(__dirname, 'seen-emails.json');
const LOG_FILE         = path.join(__dirname, 'daily-log.json');
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN_TRACK || process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID_TRACK || process.env.TELEGRAM_CHAT_ID;
const ERP_USER         = process.env.ERP_USER;
const ERP_PASS         = process.env.ERP_PASS;
const ERP_BASE         = 'https://api.biladministrasjon.no';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min

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

// ─── Daily log ────────────────────────────────────────────────────────────────
function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch(e) { return {}; }
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

function logEvent(type, data) {
  const log = loadLog();
  const key = todayKey();
  if (!log[key]) log[key] = { emails: [], statusChanges: [] };
  if (type === 'email') log[key].emails.push({ ...data, ts: new Date().toISOString() });
  if (type === 'status') log[key].statusChanges.push({ ...data, ts: new Date().toISOString() });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ─── HTML rensing ─────────────────────────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x[0-9A-Fa-f]+;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n')
    .trim();
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(msg) {
  try {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch(e) { console.error('[Telegram] Feil:', e.message); }
}

// ─── ERP Token ────────────────────────────────────────────────────────────────
let _erpToken = null;
let _erpExpiry = null;
async function getErpToken() {
  if (_erpToken && _erpExpiry && new Date() < _erpExpiry) return _erpToken;
  const res = await fetch(`${ERP_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ERP_USER, password: ERP_PASS })
  });
  const d = await res.json();
  _erpToken = d.data.token.token;
  _erpExpiry = new Date(d.data.token.expires_at);
  return _erpToken;
}

// ─── ERP: Hent statistikk for dagsoppsummering ───────────────────────────────
async function getErpStats() {
  try {
    const token = await getErpToken();
    const h = { 'Authorization': `Bearer ${token}` };

    const [r1, r2, r3] = await Promise.all([
      fetch(`${ERP_BASE}/c2b_module/driveno/processing/estimating_ar_final?per_page=100`, { headers: h }),
      fetch(`${ERP_BASE}/c2b_module/driveno/processing/estimating_ar_temp?per_page=100`, { headers: h }),
      fetch(`${ERP_BASE}/public/reports/peasy/dhqui7Hkl54?output=json`, { headers: h }).catch(() => null),
    ]);

    const liste3 = ((await r1.json()).data?.data?.data || []);
    const liste2 = ((await r2.json()).data?.data?.data || []);

    return { liste3: liste3.length, liste2: liste2.length };
  } catch(e) {
    console.error('[ERP] Stats feil:', e.message);
    return { liste3: 0, liste2: 0 };
  }
}

// ─── Email klassifisering ─────────────────────────────────────────────────────
function extractRegNr(text) {
  const match = text?.match(/\b([A-Z]{2}\d{5})\b/);
  return match ? match[1] : null;
}

function classifyEmail(subject, from) {
  const s = subject.toLowerCase();
  const f = (from || '').toLowerCase();

  // BCC fra ERP system
  if (f.includes('noreply') || f.includes('no-reply') || f.includes('autoringen')) return { type: 'bcc' };

  // Statusendringer
  if (s.includes('solgt') || s.includes('sold')) return { type: 'status', event: 'SOLGT' };
  if (s.includes('avvist') || s.includes('rejected')) return { type: 'status', event: 'AVVIST' };
  if (s.includes('levering') || s.includes('delivery')) return { type: 'status', event: 'LEVERING' };
  if (s.includes('auksjon') || s.includes('auction')) return { type: 'status', event: 'AUKSJON' };
  if (s.includes('bud') || s.includes('bid')) return { type: 'status', event: 'BUD' };

  // Alt annet er menneskelig epost
  return { type: 'human' };
}

// ─── EWS Hent innboks ─────────────────────────────────────────────────────────
async function fetchInbox() {
  const https = require('https');
  const EWS_URL  = process.env.EWS_URL  || 'https://exchange.tornado.email/EWS/Exchange.asmx';
  const EWS_USER = process.env.EWS_USER || ERP_USER;
  const EWS_PASS = process.env.EWS_PASS || ERP_PASS;
  const auth = Buffer.from(`${EWS_USER}:${EWS_PASS}`).toString('base64');

  // Finn alle eposter i innboks
  const findXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:FindItem Traversal="Shallow">
      <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape>
      <m:IndexedPageItemView MaxEntriesReturned="50" Offset="0" BasePoint="Beginning"/>
      <m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds>
    </m:FindItem>
  </soap:Body>
</soap:Envelope>`;

  const ewsCall = (xml) => new Promise((resolve) => {
    const req = https.request(EWS_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(xml)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: '' }));
    req.write(xml);
    req.end();
  });

  const findRes = await ewsCall(findXml);
  const idMatches = [...findRes.body.matchAll(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/g)];
  if (!idMatches.length) return [];

  const items = idMatches.map(m => ({ id: m[1], ck: m[2] }));
  const results = [];

  for (const item of items) {
    if (seenEmails.has(item.id)) continue;

    const getXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:GetItem>
      <m:ItemShape>
        <t:BaseShape>Default</t:BaseShape>
        <t:IncludeMimeContent>false</t:IncludeMimeContent>
        <t:BodyType>HTML</t:BodyType>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="message:From"/>
          <t:FieldURI FieldURI="item:Subject"/>
          <t:FieldURI FieldURI="item:Body"/>
          <t:FieldURI FieldURI="item:DateTimeReceived"/>
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:ItemIds><t:ItemId Id="${item.id}" ChangeKey="${item.ck}"/></m:ItemIds>
    </m:GetItem>
  </soap:Body>
</soap:Envelope>`;

    const getRes = await ewsCall(getXml);
    const subject  = getRes.body.match(/<t:Subject>([^<]*)<\/t:Subject>/)?.[1] || '';
    const from     = getRes.body.match(/<t:EmailAddress>([^<]*)<\/t:EmailAddress>/)?.[1] || '';
    const rawBody  = getRes.body.match(/<t:Body[^>]*>([\s\S]*?)<\/t:Body>/)?.[1] || '';
    const body     = stripHtml(rawBody).substring(0, 300);
    const received = getRes.body.match(/<t:DateTimeReceived>([^<]*)<\/t:DateTimeReceived>/)?.[1] || '';

    results.push({ id: item.id, subject, from, body, received });
  }

  return results;
}

// ─── Prosesser ny epost ───────────────────────────────────────────────────────
async function processEmail(email) {
  const { id, subject, from, body, received } = email;
  const regNr = extractRegNr(subject) || extractRegNr(body);
  const cls   = classifyEmail(subject, from);

  const timeStr = received ? new Date(received).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '';

  console.log(`[Track] [${cls.type.toUpperCase()}] ${regNr || '-'} | ${from} | ${subject.substring(0, 60)}`);

  if (cls.type === 'bcc') {
    // Stille
    markSeen(id);
    return;
  }

  if (cls.type === 'status') {
    const statusLabels = {
      'SOLGT':    'Solgt',
      'AVVIST':   'Avvist av selger',
      'LEVERING': 'Levering',
      'AUKSJON':  'Auksjon',
      'BUD':      'Bud mottatt',
    };
    const label = statusLabels[cls.event] || cls.event;
    const reg   = regNr ? ` | ${regNr}` : '';
    await sendTelegram(`${label}${reg}\nEmne: ${subject}`);
    logEvent('status', { event: cls.event, regNr, subject, from });
    markSeen(id);
    return;
  }

  if (cls.type === 'human') {
    let msg = `NY E-POST${regNr ? ': ' + regNr : ''}\nFra: ${from}\nEmne: ${subject}`;
    if (body) msg += `\n\n${body}`;
    await sendTelegram(msg);
    logEvent('email', { regNr, subject, from, time: timeStr });
    markSeen(id);
    return;
  }
}

// ─── Dagsoppsummering kl 17:00 ───────────────────────────────────────────────
let lastSummaryDate = '';

async function maybeSendDailySummary() {
  const now  = new Date();
  const hour = now.getHours();
  const key  = todayKey();
  if (hour !== 17 || lastSummaryDate === key) return;
  lastSummaryDate = key;
  await sendDailySummary();
}

async function sendDailySummary() {
  const key  = todayKey();
  const log  = loadLog();
  const today = log[key] || { emails: [], statusChanges: [] };
  const stats = await getErpStats();

  const dato = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [];
  lines.push(`PEASY DAGSOVERSIKT — ${dato}`);
  lines.push('');

  // Statusendringer
  const solgt    = today.statusChanges.filter(e => e.event === 'SOLGT');
  const avvist   = today.statusChanges.filter(e => e.event === 'AVVIST');
  const levering = today.statusChanges.filter(e => e.event === 'LEVERING');
  const auksjon  = today.statusChanges.filter(e => e.event === 'AUKSJON');

  lines.push('STATUSENDRINGER');
  if (!today.statusChanges.length) {
    lines.push('   Ingen statusendringer i dag');
  } else {
    if (solgt.length)    lines.push(`   Solgt (${solgt.length}): ${solgt.map(e => e.regNr || '?').join(', ')}`);
    if (avvist.length)   lines.push(`   Avvist (${avvist.length}): ${avvist.map(e => e.regNr || '?').join(', ')}`);
    if (levering.length) lines.push(`   Levering (${levering.length}): ${levering.map(e => e.regNr || '?').join(', ')}`);
    if (auksjon.length)  lines.push(`   Auksjon (${auksjon.length}): ${auksjon.map(e => e.regNr || '?').join(', ')}`);
  }

  lines.push('');

  // Innboks
  lines.push(`INNBOKS — ${today.emails.length} nye eposter`);
  if (!today.emails.length) {
    lines.push('   Ingen nye eposter i dag');
  } else {
    for (const e of today.emails.slice(0, 8)) {
      const reg  = e.regNr ? e.regNr + ' | ' : '';
      const time = e.time ? e.time + ' | ' : '';
      lines.push(`   ${time}${reg}${e.subject.substring(0, 50)}`);
    }
    if (today.emails.length > 8) lines.push(`   ... og ${today.emails.length - 8} til`);
  }

  lines.push('');

  // ERP-status
  lines.push('ERP NA');
  lines.push(`   Liste 3 (klar for eval): ${stats.liste3}`);
  lines.push(`   Liste 2 (venter): ${stats.liste2}`);

  await sendTelegram(lines.join('\n'));
  console.log('[Track] Dagsoppsummering sendt');
}

// ─── Hovedloop ────────────────────────────────────────────────────────────────
async function poll() {
  try {
    const emails = await fetchInbox();
    for (const email of emails) {
      await processEmail(email);
      await new Promise(r => setTimeout(r, 500));
    }
    await maybeSendDailySummary();
  } catch(e) {
    console.error('[Track] Poll feil:', e.message);
  }
}

console.log('[Track] Peasy Track starter...');
poll();
setInterval(poll, POLL_INTERVAL_MS);
