// webhook-server.js - HTTP-trigger for Easy bot
// PROXY_BIL_VERSION=v20.137 — /bil inkl. sd_received+final_estimate (før estimering)
// POST /trigger-eval { regnr, internnr, km }  + Authorization: Bearer <EASY_WEBHOOK_TOKEN>
// Inkrementell bygging: steg 1 = skall (ta imot, logge, returnere success).
//   Trigger-funksjonen settes utenfra via setTriggerFn().

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.EASY_WEBHOOK_PORT || '7780', 10);
const TOKEN = process.env.EASY_WEBHOOK_TOKEN || '';
const path = require('path');

function loadEnvFileMap() {
  const map = {};
  try {
    const lines = require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n');
    for (const line of lines) {
      if (!line || line[0] === '#' || line.indexOf('=') < 0) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      if (k && !(k in map)) map[k] = v;
    }
  } catch (_) { /* .env uleselig */ }
  return map;
}

function loadErpWebhookSecrets() {
  const file = loadEnvFileMap();
  const keys = ['ERP_WEBHOOK_SECRET', 'ERP_WEBHOOK_SECRET_PROD', 'ERP_WEBHOOK_SECRET_TEST'];
  const out = [];
  const seen = new Set();
  for (const k of keys) {
    const v = process.env[k] || file[k] || '';
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function loadErpWebhookSecret() {
  return loadErpWebhookSecrets()[0] || '';
}

function erpSignatureOk(raw, received, secrets) {
  const rec = String(received || '').trim();
  if (!rec || !secrets.length) return false;
  const gotList = [rec];
  if (/^sha256=/i.test(rec)) gotList.push(rec.slice(7));
  for (const secret of secrets) {
    const hex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const b64 = crypto.createHmac('sha256', secret).update(raw).digest('base64');
    for (const exp of [hex, b64]) {
      for (const got of gotList) {
        const a = Buffer.from(got);
        const b = Buffer.from(exp);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
      }
    }
  }
  return false;
}

const { findKmBlock } = require('./km-qa-block');
const { clearRegnrCache } = require('./qa-clear-cache');

let _triggerFn = null;
let _listFetcher = null;
let _bilLookup = null;
let _carFetcher = null;
let _ankerFn = null;
function setTriggerFn(fn) { _triggerFn = fn; }
function setListFetcher(fn) { _listFetcher = fn; }
function setBilLookup(fn) { _bilLookup = fn; }
function setCarFetcher(fn) { _carFetcher = fn; }
let _auctionDatesFn = null;
function setAuctionDatesFn(fn) { _auctionDatesFn = fn; }
function setAnkerFn(fn) { _ankerFn = fn; }
let _reevalFn = null;
function setReevalFn(fn) { _reevalFn = fn; }

function start(log) {
  if (!TOKEN) {
    log('[webhook] EASY_WEBHOOK_TOKEN mangler i .env – server starter IKKE');
    return;
  }
  const srv = http.createServer(async (req, res) => {
    // CORS for Pulse (GitHub Pages -> Tailscale)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const reqPath = String(req.url || '').split('?')[0];

    if (req.method === 'GET' && reqPath === '/finn-utpris') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 finn-utpris');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const regnr = String(u.searchParams.get('regnr') || '').toUpperCase().replace(/\s/g, '');
        if (!regnr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'regnr mangler' }));
          return;
        }
        const { computeFinnUtpris } = require('./finn-utpris');
        const out = await computeFinnUtpris(regnr);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(Object.assign({ ok: true }, out)));
      } catch (e) {
        log('[webhook] finn-utpris EXC: ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && reqPath === '/gb-utpris') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 gb-utpris');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const regnr = String(u.searchParams.get('regnr') || '').toUpperCase().replace(/\s/g, '');
        if (!regnr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'regnr mangler' }));
          return;
        }
        const { estimateAsync } = require('./gb-utpris');
        const out = await estimateAsync(regnr);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      } catch (e) {
        log('[webhook] gb-utpris EXC: ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

        if (req.method === 'GET' && reqPath === '/og-image') {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const auth = (u.searchParams.get('auth') || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')).trim();
        if (auth !== TOKEN) { res.writeHead(401); res.end('unauthorized'); return; }
        const target = String(u.searchParams.get('url') || '');
        let host = '';
        try { host = new URL(target).hostname; } catch (eH) { host = ''; }
        if (!/(^|\.)finn\.no$|(^|\.)finncdn\.no$|(^|\.)car\.info$/.test(host)) {
          res.writeHead(400); res.end('bad url'); return;
        }
        const ctrl = new AbortController();
        const t = setTimeout(function () { ctrl.abort(); }, 8000);
        const r = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'nb-NO,nb;q=0.9', Accept: 'text/html' },
          signal: ctrl.signal,
          redirect: 'follow',
        });
        clearTimeout(t);
        const html = await r.text();
        const m = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)
          || html.match(/content=["'](https:\/\/images\.finncdn\.no[^"']+)["']/i);
        if (m && m[1] && /^https:\/\/images\.finncdn\.no\/dynamic\//i.test(m[1])) {
          res.writeHead(302, { Location: m[1], 'Cache-Control': 'public, max-age=86400' });
          res.end();
          return;
        }
        res.writeHead(404); res.end('no image');
      } catch (eOg) {
        res.writeHead(502); res.end('og fail');
      }
      return;
    }

if (req.method === 'GET' && reqPath === '/ai-usage') {
      try {
        const { readLines, summarize } = require('./ai-usage');
        const u = new URL(req.url, 'http://127.0.0.1');
        const days = Math.min(62, Math.max(1, parseInt(u.searchParams.get('days') || '14', 10) || 14));
        const fromYmd = String(u.searchParams.get('from') || '').trim();
        const rows = fromYmd
          ? readLines({ fromYmd: fromYmd })
          : readLines(days * 24 * 60 * 60 * 1000);
        const summary = summarize(rows);
        try { require('./carinfo-usage').attachCarinfo(summary, fromYmd ? { fromYmd: fromYmd } : { maxAgeMs: days * 24 * 60 * 60 * 1000 }); } catch (eCi) {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(Object.assign({ ok: true, days: fromYmd ? null : days, from: fromYmd || null }, summary)));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && (reqPath === '/xlsx' || reqPath === '/kjerne.xlsx')) {
      try {
        const fs = require('fs');
        const file = '/Users/bot/peasy-auto/cache/peasy-master.xlsx';
        if (!fs.existsSync(file)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'xlsx cache tom' }));
          return;
        }
        const st = fs.statSync(file);
        const body = fs.readFileSync(file);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Length': String(body.length),
          'X-Cache-Age-Sec': String(Math.round((Date.now() - st.mtimeMs) / 1000)),
          'X-Cache-Mtime': st.mtime.toISOString(),
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && reqPath === '/laering-cars') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 laering-cars');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      try {
        const fs = require('fs');
        const file = '/Users/bot/peasy-auto/data/laering-cars.json';
        if (!fs.existsSync(file)) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: false, err: 'laering-cars mangler' }));
          return;
        }
        const body = fs.readFileSync(file, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch (e) {
        log('[webhook] laering-cars EXC ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    // drive-anne-logg: hva månedsmailen til Anne (Drive) har sendt og når. Leser drive-gire-state.json (skrives av monthly-drive-gire-report.js).
    if (req.method === 'GET' && reqPath === '/drive/anne-logg') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (!TOKEN || auth !== TOKEN) {
        log('[webhook] 401 drive/anne-logg');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      try {
        const fil = path.join(__dirname, 'drive-gire-state.json');
        const st = require('fs').existsSync(fil) ? JSON.parse(require('fs').readFileSync(fil, 'utf8')) : {};
        const mnd = {};
        const keys = new Set([...Object.keys(st.test_sent || {}), ...Object.keys(st.anne_sent || {}), ...Object.keys(st.logg || {})]);
        for (const k of keys) {
          const l = (st.logg || {})[k] || {};
          mnd[k] = {
            test: l.test || ((st.test_sent || {})[k] ? { dato: st.test_sent[k] } : null),
            anne: l.anne || ((st.anne_sent || {})[k] ? { dato: st.anne_sent[k] } : null),
          };
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, mnd }));
      } catch (e) {
        log('[webhook] drive/anne-logg EXC ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    // drive-anne-logg: hva månedsmailen til Anne (Drive) har sendt og når. Leser drive-gire-state.json (skrives av monthly-drive-gire-report.js).
    if (req.method === 'GET' && reqPath === '/drive/anne-logg') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (!TOKEN || auth !== TOKEN) {
        log('[webhook] 401 drive/anne-logg');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      try {
        const fil = path.join(__dirname, 'drive-gire-state.json');
        const st = require('fs').existsSync(fil) ? JSON.parse(require('fs').readFileSync(fil, 'utf8')) : {};
        const mnd = {};
        const keys = new Set([...Object.keys(st.test_sent || {}), ...Object.keys(st.anne_sent || {}), ...Object.keys(st.logg || {})]);
        for (const k of keys) {
          const l = (st.logg || {})[k] || {};
          mnd[k] = {
            test: l.test || ((st.test_sent || {})[k] ? { dato: st.test_sent[k] } : null),
            anne: l.anne || ((st.anne_sent || {})[k] ? { dato: st.anne_sent[k] } : null),
          };
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, mnd }));
      } catch (e) {
        log('[webhook] drive/anne-logg EXC ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    // qa-meas: bare målingene for bilene på liste 3 (Pulse QA). Samme JSONL som /measurements, filtrert.
    if (req.method === 'GET' && reqPath === '/qa/meas') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (!TOKEN || auth !== TOKEN) {
        log('[webhook] 401 qa/meas');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      try {
        const params = new URL(req.url, 'http://mini').searchParams;
        const svar = require('./qa-meas.js').qaMeasSvar(params);
        const hdr = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
        if (svar.status === 200 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
          hdr['Content-Encoding'] = 'gzip';
          res.writeHead(200, hdr);
          res.end(require('zlib').gzipSync(svar.body));
        } else {
          res.writeHead(svar.status, hdr);
          res.end(svar.body);
        }
      } catch (e) {
        log('[webhook] qa/meas EXC ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && (reqPath === '/measurements' || reqPath === '/v3g-measurements' || reqPath === '/bot4-measurements' || reqPath === '/loop2-measurements')) {
      try {
        const fs = require('fs');
        const file = reqPath === '/loop2-measurements'
          ? '/Users/bot/peasy-auto/loop2/logs.nosync/loop2-measurements.jsonl'
          : reqPath === '/bot4-measurements'
          ? '/Users/bot/peasy-auto/bot4/logs.nosync/bot4-measurements.jsonl'
          : (reqPath === '/v3g-measurements'
            ? '/Users/bot/peasy-auto/v3g/logs.nosync/v3g-measurements.jsonl'
            : '/Users/bot/peasy-auto/v2/logs.nosync/measurements.jsonl');
        const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && reqPath === '/auction-dates') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 auction-dates');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      try {
        const payload = _auctionDatesFn ? await _auctionDatesFn() : { ok: true, dates: {} };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(payload));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && reqPath === '/erp-events') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 erp-events');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      try {
        const payload = require('./erp-webhook-store').pulsePayload();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({
        ok: true,
        hasTrigger: !!_triggerFn,
        hasListFetcher: !!_listFetcher,
        hasErpWebhookSecret: loadErpWebhookSecrets().length > 0,
        erpWebhookSecrets: loadErpWebhookSecrets().length,
      }));
      return;
    }

    // GET /list/:endpoint - proxy mot ERP for Pulse Pipe-fanen (v20.129: page+per_page)
    if (req.method === 'GET' && req.url.indexOf('/list/') === 0) {
      const auth = (req.headers['authorization']||'').replace(/^Bearer\s+/i,'').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 list-fetch wrong token');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      const listName = req.url.slice('/list/'.length).split('?')[0];
      if (!/^[a-z_]+$/i.test(listName)) {
        res.writeHead(400); res.end('bad list name'); return;
      }
      if (!_listFetcher) {
        res.writeHead(503); res.end('list-fetcher ikke koblet pa'); return;
      }
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const page = u.searchParams.get('page') || '1';
        const per_page = u.searchParams.get('per_page') || '100';
        const pack = await _listFetcher(listName, { page, per_page });
        const biler = Array.isArray(pack) ? pack : (pack && pack.biler) || [];
        const meta = Array.isArray(pack) ? {} : {
          page: pack.page != null ? pack.page : Number(page),
          per_page: pack.per_page != null ? pack.per_page : Number(per_page),
          total: pack.total,
          last_page: pack.last_page,
        };
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify(Object.assign({
          ok:true, list:listName, count:(biler||[]).length, biler:biler||[]
        }, meta)));
      } catch(e) {
        if (e && (e.code === 'ERP_AUTH_EXPIRED' || /ERP_AUTH_EXPIRED/.test(String(e && e.message)))) {
          res.writeHead(503, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({feil:'ERP-innlogging utløpt'}));
          return;
        }
        log('[webhook] list-fetch EXC for ' + listName + ': ' + (e&&e.message||e));
        res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:false, err:String(e&&e.message||e)}));
      }
      return;
    }

    // GET /bil?regnr= — én bil på tvers av ERP-lister (v20.129)
    if (req.method === 'GET' && (req.url === '/bil' || req.url.indexOf('/bil?') === 0)) {
      const auth = (req.headers['authorization']||'').replace(/^Bearer\s+/i,'').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 /bil wrong token');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      if (!_bilLookup) {
        res.writeHead(503, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:false, err:'bil-lookup ikke koblet pa'})); return;
      }
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const regnr = String(u.searchParams.get('regnr') || '').toUpperCase().replace(/[\s-]/g, '');
        if (!regnr) {
          res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:false, err:'mangler regnr'})); return;
        }
        const out = await _bilLookup(regnr);
        if (!out || out.funnet === false) {
          res.writeHead(404, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({regnr: regnr, funnet: false})); return;
        }
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify(out));
      } catch(e) {
        if (e && (e.code === 'ERP_AUTH_EXPIRED' || /ERP_AUTH_EXPIRED/.test(String(e && e.message)))) {
          res.writeHead(503, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({feil:'ERP-innlogging utløpt'}));
          return;
        }
        log('[webhook] /bil EXC: ' + (e&&e.message||e));
        res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:false, err:String(e&&e.message||e)}));
      }
      return;
    }


  // /car/:car_id — proxy single car lookup
  if (req.method === 'GET' && req.url.indexOf('/car/') === 0) {
    const auth = req.headers['authorization'] || '';
    if (TOKEN && auth !== 'Bearer ' + TOKEN) {
      res.writeHead(401, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:'unauthorized'}));
      return;
    }
    const carId = req.url.split('/car/')[1].split('?')[0];
    if (!carId || !/^\d+$/.test(carId)) {
      res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:'bad car id'}));
      return;
    }
    if (!_carFetcher) {
      res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:'no car fetcher'}));
      return;
    }
    try {
      const bil = await _carFetcher(carId);
      res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:true, bil}));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:String(e && e.message || e)}));
    }
    return;
  }

  // --- /finn-links endpoint (Pulse V2 BM Finn-kolonne) ---
  if (req.method === 'GET' && req.url === '/finn-links') {
    const auth = req.headers['authorization'] || '';
    if (TOKEN && auth !== 'Bearer ' + TOKEN) {
      res.writeHead(401, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:'unauthorized'}));
      return;
    }
    try {
      const fs = require('fs');
      let fl = {};
      try { fl = JSON.parse(fs.readFileSync('/Users/bot/peasy-auto/finn-links.json', 'utf8')) || {}; } catch (e) { fl = {}; }
      res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:true,finn:fl}));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:String(e.message||e)}));
    }
    return;
  }

  // --- /signaler endpoint (Pulse V2 BM Signaler column) ---
  if (req.method === 'GET' && req.url === '/signaler') {
    const auth = req.headers['authorization'] || '';
    if (TOKEN && auth !== 'Bearer ' + TOKEN) {
      res.writeHead(401, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:'unauthorized'}));
      return;
    }
    try {
      const fs = require('fs');
      const sig = JSON.parse(fs.readFileSync('/Users/bot/peasy-auto/signaler-data.json', 'utf8'));
      res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:true,signaler:sig}));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:String(e.message||e)}));
    }
    return;
  }

    // GET /overrides - returnerer easy-overrides.jsonl som {regnr -> siste override}
  if (req.method === 'GET' && req.url === '/overrides') {
    const auth = req.headers['authorization'] || '';
    if (TOKEN && auth !== 'Bearer ' + TOKEN) {
      res.writeHead(401, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:false,err:'unauthorized'}));
      return;
    }
    try {
      const fs = require('fs');
      const OV_FILE = '/Users/bot/peasy-auto/easy-overrides.jsonl';
      const map = {};
      if (fs.existsSync(OV_FILE)) {
        const lines = fs.readFileSync(OV_FILE, 'utf8').split('\n');
        for (const ln of lines) {
          const t = ln.trim();
          if (!t) continue;
          try {
            const rec = JSON.parse(t);
            if (rec && rec.regnr) map[String(rec.regnr).toUpperCase()] = rec;
          } catch (_le) { /* hopp over korrupt linje */ }
        }
      }
      res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:true,overrides:map}));
    } catch (e) {
      res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({ok:true,overrides:{},err:String(e.message||e)}));
    }
    return;
  }

    if (req.method === 'GET' && reqPath === '/qa/auksjon') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 qa/auksjon');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      try {
        const snap = require('./auksjon-block').snapshot();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(snap));
      } catch (e) {
        log('[webhook] qa/auksjon EXC: ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'POST' && reqPath === '/qa/auksjon-ok') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 qa/auksjon-ok');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'bad json' }));
          return;
        }
        const regnr = String(payload.regnr || '').toUpperCase().replace(/\s/g, '');
        const internnr = String(payload.internnr || payload.erpId || '').trim();
        if (!regnr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'regnr mangler' }));
          return;
        }
        try {
          const ab = require('./auksjon-block');
          const added = ab.addBypass(regnr);
          if (!added.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(added));
            return;
          }
          let cleared = {};
          try { cleared = clearRegnrCache({ regnr, internnr }); } catch (eC) { cleared = { ok: false, err: String(eC && eC.message || eC) }; }
          log('[webhook] qa/auksjon-ok ' + regnr + ' inn=' + (internnr || '-') + ' bypass=' + added.n);
          if (_reevalFn) {
            Promise.resolve().then(() => _reevalFn({ regnr, internnr }))
              .catch((eR) => log('[webhook] qa/auksjon-ok reeval EXC: ' + (eR && eR.message || eR)));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, regnr, internnr, bypass: added, cleared, reeval: !!_reevalFn }));
        } catch (e) {
          log('[webhook] qa/auksjon-ok EXC: ' + (e && e.message || e));
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && reqPath === '/qa/clear-cache') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 qa/clear-cache');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'bad json' }));
          return;
        }
        const regnr = String(payload.regnr || '').toUpperCase().replace(/\s/g, '');
        const internnr = String(payload.internnr || payload.erpId || '').trim();
        if (!regnr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'regnr mangler' }));
          return;
        }
        try {
          const result = clearRegnrCache({ regnr, internnr });
          log('[webhook] qa/clear-cache ' + regnr + ' inn=' + (internnr || '-') + ' ' + JSON.stringify(result.removed || {}));
          if (result.ok && _reevalFn) {
            Promise.resolve().then(() => _reevalFn({ regnr, internnr }))
              .catch((eR) => log('[webhook] qa/clear-cache reeval EXC: ' + (eR && eR.message || eR)));
          }
          res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(Object.assign({}, result, { reeval: !!_reevalFn })));
        } catch (e) {
          log('[webhook] qa/clear-cache EXC: ' + (e && e.message || e));
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && reqPath === '/qa/anker') {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      if (auth !== TOKEN) {
        log('[webhook] 401 qa/anker');
        res.writeHead(401); res.end('unauthorized'); return;
      }
      if (!_ankerFn) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'anker-fn ikke koblet på' }));
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', async () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'bad json' }));
          return;
        }
        const regnr = String(payload.regnr || '').toUpperCase().replace(/\s/g, '');
        const internnr = String(payload.internnr || payload.erpId || '').trim();
        const anker = parseInt(payload.anker, 10);
        if (!regnr || !Number.isFinite(anker)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: 'regnr og anker kreves' }));
          return;
        }
        const kmAnkerBlock = findKmBlock(regnr);
        if (kmAnkerBlock && kmAnkerBlock.blocked) {
          log('[webhook] qa/anker blokkert km ' + regnr);
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: kmAnkerBlock.message }));
          return;
        }
        try {
          log(`[webhook] qa/anker ${regnr} internnr=${internnr || '-'} anker=${anker}`);
          const result = await _ankerFn({
            regnr,
            internnr,
            anker,
            source: payload.source,
            km: payload.km,
            statidKr: payload.statidKr,     // v20.166: QA-hake for ståtid (≤ 0), ellers uten
            statidKilde: payload.statidKilde || null,
          });
          const ok = !!(result && result.ok);
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result || { ok: false, err: 'tomt svar' }));
        } catch (e) {
          log('[webhook] qa/anker EXC: ' + (e && e.message || e));
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
        }
      });
      return;
    }

    function socialAuthOk() {
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      return auth === TOKEN;
    }
    function socialReadJson(limit) {
      return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > (limit || 65536)) req.destroy(); });
        req.on('end', () => {
          try { resolve(JSON.parse(raw || '{}')); }
          catch (e) { reject(e); }
        });
      });
    }

    if (req.method === 'GET' && (reqPath === '/social/inbox' || reqPath === '/social/status')) {
      if (!socialAuthOk()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      const qs = String(req.url || '').split('?')[1] || '';
      const refresh = /(?:^|&)refresh=1(?:&|$)/.test(qs);
      try {
        const social = require('./social-inbox');
        const payload = reqPath === '/social/status'
          ? await social.inboxStatus({ refresh })
          : await social.fetchInbox({ refresh });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch (e) {
        log('[webhook] ' + reqPath + ' EXC: ' + (e && e.message || e));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          updatedAt: new Date().toISOString(),
          graphVersion: 'v21.0',
          unanswered: 0,
          threads: [],
          items: [],
          errors: [{ where: 'inbox', code: 0, message: String(e && e.message || e) }],
        }));
      }
      return;
    }

    if (req.method === 'POST' && reqPath === '/social/draft-reply') {
      if (!socialAuthOk()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      try {
        const body = await socialReadJson(65536);
        const out = await require('./social-inbox').draftReply(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'POST' && reqPath === '/social/reply') {
      if (!socialAuthOk()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      try {
        const body = await socialReadJson(16384);
        const out = await require('./social-inbox').publishReply(body);
        res.writeHead(out && out.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        log('[webhook] social/reply EXC: ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'POST' && reqPath === '/social/done') {
      if (!socialAuthOk()) {
        res.writeHead(401); res.end('unauthorized'); return;
      }
      try {
        const body = await socialReadJson(16384);
        const out = require('./social-inbox').markThreadDone(body);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify(out));
      } catch (e) {
        log('[webhook] social/done EXC: ' + (e && e.message || e));
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, err:String(e && e.message || e)}));
      }
      return;
    }

    if (req.method === 'POST' && reqPath === '/social/hide') {
      if (!socialAuthOk()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: 'unauthorized' }));
        return;
      }
      try {
        const body = await socialReadJson(16384);
        const out = await require('./social-inbox').hideComment(body);
        res.writeHead(out && out.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out && out.ok ? { ok: true } : { ok: false, err: (out && out.err) || 'ukjent' }));
      } catch (e) {
        log('[webhook] social/hide EXC: ' + (e && e.message || e));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
      }
      return;
    }

    if (req.method === 'POST' && reqPath === '/webhooks/erp') {
      let raw = '';
      req.on('data', c => { raw += c; if (raw.length > 65536) req.destroy(); });
      req.on('end', () => {
        const secrets = loadErpWebhookSecrets();
        if (!secrets.length) {
          log('[webhook] erp status: ERP_WEBHOOK_SECRET mangler');
          res.writeHead(503, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false, err:'secret not configured'}));
          return;
        }
        const received = String(req.headers['signature'] || '');
        if (!erpSignatureOk(raw, received, secrets)) {
          log('[webhook] erp status: ugyldig Signature');
          res.writeHead(401, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false, err:'bad signature'}));
          return;
        }
        let ev = {};
        try { ev = JSON.parse(raw || '{}'); } catch (e) {
          res.writeHead(400, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false, err:'bad json'}));
          return;
        }
        const store = require('./erp-webhook-store');
        const p = store.statusPayload(ev);
        log('[webhook] erp status ' + (p.registrationNumber || '?') + ' id=' + (p.carId || '?') + ' → ' + (p.status || p.event || '?'));
        try {
          store.appendEvent(ev);
        } catch (eLog) {
          log('[webhook] erp status: store-skriv feilet: ' + (eLog && eLog.message || eLog));
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      });
      return;
    }

  if (req.method !== 'POST' || !req.url.startsWith('/trigger-eval')) {
      res.writeHead(404); res.end('not found'); return;
    }

    const auth = (req.headers['authorization']||'').replace(/^Bearer\s+/i,'').trim();
    if (auth !== TOKEN) {
      log('[webhook] 401 wrong token from ' + (req.socket.remoteAddress||'?'));
      res.writeHead(401); res.end('unauthorized'); return;
    }

    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, err:'bad json'}));
        return;
      }
      const regnr = String(payload.regnr||'').toUpperCase().replace(/\s/g,'');
      const internnr = String(payload.internnr||'').trim();
      const km = parseInt(payload.km, 10) || 0;
      if (!regnr) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, err:'regnr mangler'}));
        return;
      }
      // [c197] force=true → slett V3-cache (measurements-record) før trigger
      const forceClear = /[?&]force=(1|true)/i.test(req.url);
      if (forceClear) {
        try {
          const cleared = clearRegnrCache({ regnr, internnr });
          log('[webhook] force-clear ' + regnr + ' ' + JSON.stringify(cleared.removed || {}));
        } catch(e) { log(`[webhook] force-clear EXC: ${e && e.message || e}`); }
      }
      log(`[webhook] mottatt: regnr=${regnr} internnr=${internnr||'-'} km=${km}`);

      const kmSendBlock = !forceClear && findKmBlock(regnr);
      if (kmSendBlock && kmSendBlock.blocked) {
        log('[webhook] send blokkert km ' + regnr);
        res.writeHead(409, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, err: kmSendBlock.message}));
        return;
      }

      if (_triggerFn) {
        // force=true → skip confirmFinalEstimate (cache er slettet, peasy-auto plukker opp neste runde)
        if (forceClear) {
          log('[webhook] force=true → skipper confirm-send, cache slettet');
          res.writeHead(202, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:true, queued:false, force_cleared:true, note:'cache slettet, peasy-auto plukker opp neste runde', regnr}));
        } else {
          // fire-and-forget – Pulse-knapp får raskt svar
          Promise.resolve().then(() => _triggerFn({regnr, internnr, km}))
            .catch(e => log(`[webhook] trigger EXC: ${e && e.message || e}`));
          res.writeHead(202, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:true, queued:true, regnr}));
        }
      } else {
        // steg 1: ingen trigger koblet på – bare bekreft mottatt
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, queued:false, note:'trigger ikke koblet på', regnr}));
      }
    });
  });
  srv.on('error', e => log(`[webhook] server-feil: ${e.message}`));
  srv.listen(PORT, '0.0.0.0', () => {
    log(`[webhook] lytter på 0.0.0.0:${PORT} (token-lengde=${TOKEN.length})`);
  });
}

module.exports = { start, setTriggerFn, setListFetcher, setBilLookup, setCarFetcher, setAuctionDatesFn, setAnkerFn, setReevalFn };
