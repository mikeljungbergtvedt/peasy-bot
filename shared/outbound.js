'use strict';

/**
 * Shared outbound backoff for every Mini node process.
 *
 * Hypothesis (11 Sep 2026): TIME_WAIT / ephemeral-port exhaustion came from
 * tight retry loops (Telegram + Meta), not sysctl. net.inet.tcp.msl=1000 did
 * not drain faster than inflow. A failing loop overnight must do tens of
 * attempts (5s, 10s, 20s, 40s … cap 10 min), not tens of thousands.
 *
 * Does not change ERP write payloads, Easy V7 pricing, or Finn-utpris rules.
 */

const INITIAL_MS = 5 * 1000;
const MAX_MS = 10 * 60 * 1000;

/** host -> { nextAt, attempt } — stops overlapping setInterval from stacking sockets */
const hostCooldown = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextBackoffMs(attempt) {
  const n = Math.max(0, Number(attempt) || 0);
  return Math.min(INITIAL_MS * (2 ** n), MAX_MS);
}

/** How many backoff sleeps fit in windowMs (overnight ≈ tens, not thousands). */
function attemptsInWindow(windowMs) {
  let elapsed = 0;
  let attempts = 0;
  while (elapsed < windowMs) {
    elapsed += nextBackoffMs(attempts);
    attempts += 1;
  }
  return attempts;
}

function redactUrl(url) {
  return String(url)
    .replace(/(\/bot)[^/?#]+/gi, '$1***')
    .replace(/([?&](?:access_token|token|key|password)=)[^&]+/gi, '$1***');
}

function hostOf(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return 'unknown';
  }
}

function classifyUrl(url) {
  const s = String(url);
  if (/api\.telegram\.org|telegram\.org/i.test(s)) return 'telegram';
  if (/graph\.facebook\.com|graph\.instagram\.com|whatsapp\.com|facebook\.com/i.test(s)) return 'meta';
  return hostOf(url);
}

function shouldRetry(res, err) {
  if (err) return true;
  if (!res || typeof res.status !== 'number') return true;
  if (res.status === 0) return false; // jr/v2 readonly block — do not spin
  if (res.status === 408 || res.status === 409 || res.status === 425 || res.status === 429) return true;
  if (res.status >= 500) return true;
  return false;
}

function logBackoff(info) {
  const parts = [
    '[outbound] backoff',
    `label=${info.label}`,
    `host=${info.host}`,
    `kind=${info.kind}`,
    `attempt=${info.attempt}`,
    `wait=${info.waitMs}ms`,
    `reason=${info.reason}`,
    `url=${redactUrl(info.url)}`,
  ];
  console.log(parts.join(' '));
}

async function waitHostCooldown(host, label, waitFn) {
  const st = hostCooldown.get(host);
  if (!st) return;
  const waitMs = st.nextAt - Date.now();
  if (waitMs > 0) {
    console.log(`[outbound] host-cooldown label=${label} host=${host} wait=${waitMs}ms`);
    await (waitFn || sleep)(waitMs);
  }
}

function noteFailure(host, attempt) {
  const waitMs = nextBackoffMs(attempt);
  hostCooldown.set(host, { nextAt: Date.now() + waitMs, attempt });
  return waitMs;
}

function noteSuccess(host) {
  hostCooldown.delete(host);
}

function nativeFetch(extra) {
  if (extra && extra.fetch) return extra.fetch;
  const f = globalThis.fetch;
  if (typeof f !== 'function') throw new Error('global fetch is not available');
  return f.bind(globalThis);
}

/**
 * fetch with exponential backoff on transport / 408 / 409 / 429 / 5xx.
 * Infinite attempts; delay 5s, 10s, 20s, 40s … capped at 10 minutes.
 */
async function fetchWithBackoff(url, opts, extra) {
  const options = extra || {};
  const label = options.label || 'fetch';
  const kind = classifyUrl(url);
  const host = hostOf(url);
  const doFetch = nativeFetch(options);
  const wait = options.sleep || sleep;
  let attempt = 0;

  while (true) {
    await waitHostCooldown(host, label, wait);
    try {
      const res = await doFetch(url, opts);
      if (!shouldRetry(res, null)) {
        noteSuccess(host);
        return res;
      }
      const waitMs = noteFailure(host, attempt);
      logBackoff({
        label,
        host,
        kind,
        attempt: attempt + 1,
        waitMs,
        reason: `HTTP ${res && res.status}`,
        url,
      });
      await wait(waitMs);
      attempt += 1;
    } catch (err) {
      const waitMs = noteFailure(host, attempt);
      logBackoff({
        label,
        host,
        kind,
        attempt: attempt + 1,
        waitMs,
        reason: (err && err.message) || String(err),
        url,
      });
      await wait(waitMs);
      attempt += 1;
    }
  }
}

function telegramUrl(token, method, query) {
  const q = query ? (String(query).startsWith('?') ? query : `?${query}`) : '';
  return `https://api.telegram.org/bot${token}/${method}${q}`;
}

async function telegramFetch(token, method, opts, extra) {
  const options = extra || {};
  const url = options.url || telegramUrl(token, method, options.query);
  return fetchWithBackoff(url, opts || {}, {
    label: options.label || `telegram:${method}`,
    fetch: options.fetch,
  });
}

async function telegramSendMessage(token, chatId, text, extra) {
  const options = extra || {};
  const body = Object.assign({
    chat_id: chatId,
    text,
    parse_mode: options.parse_mode || 'HTML',
    disable_web_page_preview: options.disable_web_page_preview !== false,
  }, options.fields || {});
  if (options.reply_markup) body.reply_markup = options.reply_markup;
  return telegramFetch(token, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, options);
}

function metaGraphUrl(pathOrUrl) {
  const base = (process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${base}/${String(pathOrUrl).replace(/^\//, '')}`;
}

async function metaGraphFetch(pathOrUrl, opts, extra) {
  const options = extra || {};
  return fetchWithBackoff(metaGraphUrl(pathOrUrl), opts || {}, {
    label: options.label || 'meta-graph',
    fetch: options.fetch,
  });
}

function installOutboundFetch(opts) {
  const options = opts || {};
  if (globalThis.fetch && globalThis.fetch.__peasyOutbound) {
    return globalThis.fetch;
  }
  if (typeof globalThis.fetch !== 'function' && !options.fetch) {
    throw new Error('installOutboundFetch: no fetch to wrap');
  }
  const inner = options.fetch
    ? options.fetch
    : globalThis.fetch.bind(globalThis);
  const label = options.label || process.env.PEASY_PROCESS_LABEL || 'fetch';
  const wrapped = function peasyFetch(url, init) {
    return fetchWithBackoff(url, init, { label, fetch: inner });
  };
  wrapped.__peasyOutbound = true;
  wrapped.__peasyOutboundLabel = label;
  globalThis.fetch = wrapped;
  console.log(`[outbound] installed fetchWithBackoff label=${label}`);
  return wrapped;
}

function _resetForTests() {
  hostCooldown.clear();
}

module.exports = {
  INITIAL_MS,
  MAX_MS,
  nextBackoffMs,
  attemptsInWindow,
  redactUrl,
  classifyUrl,
  shouldRetry,
  fetchWithBackoff,
  telegramUrl,
  telegramFetch,
  telegramSendMessage,
  metaGraphUrl,
  metaGraphFetch,
  installOutboundFetch,
  _resetForTests,
};
