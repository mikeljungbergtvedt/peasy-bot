// webhook-server.js - HTTP-trigger for Easy bot
// POST /trigger-eval { regnr, internnr, km }  + Authorization: Bearer <EASY_WEBHOOK_TOKEN>
// Inkrementell bygging: steg 1 = skall (ta imot, logge, returnere success).
//   Trigger-funksjonen settes utenfra via setTriggerFn().

const http = require('http');

const PORT = parseInt(process.env.EASY_WEBHOOK_PORT || '7780', 10);
const TOKEN = process.env.EASY_WEBHOOK_TOKEN || '';

let _triggerFn = null;
let _listFetcher = null;
let _carFetcher = null;
function setTriggerFn(fn) { _triggerFn = fn; }
function setListFetcher(fn) { _listFetcher = fn; }
function setCarFetcher(fn) { _carFetcher = fn; }

function start(log) {
  if (!TOKEN) {
    log('[webhook] EASY_WEBHOOK_TOKEN mangler i .env – server starter IKKE');
    return;
  }
  const srv = http.createServer(async (req, res) => {
    // CORS for Pulse (GitHub Pages -> Tailscale)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true, hasTrigger: !!_triggerFn, hasListFetcher: !!_listFetcher}));
      return;
    }

    // GET /list/:endpoint - proxy mot ERP for Pulse Pipe-fanen
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
        const biler = await _listFetcher(listName);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, list:listName, count:(biler||[]).length, biler:biler||[]}));
      } catch(e) {
        log('[webhook] list-fetch EXC for ' + listName + ': ' + (e&&e.message||e));
        res.writeHead(500, {'Content-Type':'application/json'});
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

  if (req.method !== 'POST' || req.url !== '/trigger-eval') {
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
      log(`[webhook] mottatt: regnr=${regnr} internnr=${internnr||'-'} km=${km}`);

      if (_triggerFn) {
        // fire-and-forget – Pulse-knapp får raskt svar
        Promise.resolve().then(() => _triggerFn({regnr, internnr, km}))
          .catch(e => log(`[webhook] trigger EXC: ${e && e.message || e}`));
        res.writeHead(202, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, queued:true, regnr}));
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

module.exports = { start, setTriggerFn, setListFetcher, setCarFetcher };
