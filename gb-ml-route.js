'use strict';
/**
 * gb-ml-route.js — HTTP-endepunkt GET /gb-ml?regnr=XX[&force=1] (Bearer-token), kun for GB-fanen.
 * Kobles inn i webhook-server.js med én linje (se gb-ml/README.md). Påvirker ingen andre ruter.
 */
async function handle(req, res, opts) {
  const reqPath = String(req.url || '').split('?')[0];
  if (req.method !== 'GET' || reqPath !== '/gb-ml') return false;
  const log = (opts && opts.log) || function () {};
  const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!opts || !opts.TOKEN || auth !== opts.TOKEN) {
    log('[webhook] 401 gb-ml');
    res.writeHead(401); res.end('unauthorized');
    return true;
  }
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    const out = require('./gb-ml').getGbMl(u.searchParams.get('regnr'), { force: u.searchParams.get('force') === '1' });
    res.writeHead(out.status === 'error' ? 422 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(Object.assign({ ok: out.status !== 'error' }, out)));
  } catch (e) {
    log('[webhook] gb-ml EXC: ' + ((e && e.message) || e));
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, status: 'error', err: String((e && e.message) || e) }));
  }
  return true;
}
module.exports = { handle };
