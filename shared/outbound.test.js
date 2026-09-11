#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  INITIAL_MS,
  MAX_MS,
  nextBackoffMs,
  attemptsInWindow,
  redactUrl,
  classifyUrl,
  shouldRetry,
  fetchWithBackoff,
  telegramFetch,
  metaGraphFetch,
  installOutboundFetch,
  _resetForTests,
} = require('./outbound');

function logsOf(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  return Promise.resolve()
    .then(fn)
    .finally(() => { console.log = orig; })
    .then((value) => ({ value, lines }));
}

async function main() {
  _resetForTests();

  assert.strictEqual(nextBackoffMs(0), 5000);
  assert.strictEqual(nextBackoffMs(1), 10000);
  assert.strictEqual(nextBackoffMs(2), 20000);
  assert.strictEqual(nextBackoffMs(3), 40000);
  assert.strictEqual(nextBackoffMs(7), MAX_MS);
  assert.strictEqual(nextBackoffMs(20), MAX_MS);
  assert.ok(INITIAL_MS === 5000);

  const overnight = attemptsInWindow(12 * 60 * 60 * 1000);
  assert.ok(overnight >= 20 && overnight <= 200, `overnight attempts should be tens, got ${overnight}`);
  assert.ok(overnight < 1000, 'must not be thousands');

  assert.ok(redactUrl('https://api.telegram.org/botSECRET/sendMessage').includes('bot***'));
  assert.ok(!redactUrl('https://api.telegram.org/botSECRET/sendMessage').includes('SECRET'));
  assert.strictEqual(classifyUrl('https://api.telegram.org/botX/getUpdates'), 'telegram');
  assert.strictEqual(classifyUrl('https://graph.facebook.com/v21.0/me/messages'), 'meta');

  assert.strictEqual(shouldRetry({ status: 0 }, null), false);
  assert.strictEqual(shouldRetry({ status: 200 }, null), false);
  assert.strictEqual(shouldRetry({ status: 404 }, null), false);
  assert.strictEqual(shouldRetry({ status: 409 }, null), true);
  assert.strictEqual(shouldRetry({ status: 429 }, null), true);
  assert.strictEqual(shouldRetry({ status: 502 }, null), true);
  assert.strictEqual(shouldRetry(null, new Error('ECONNRESET')), true);

  let calls = 0;
  const fakeFetch = async (url) => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('socket hang up');
      err.url = url;
      throw err;
    }
    return { ok: true, status: 200, url };
  };

  const { value, lines } = await logsOf(() => fetchWithBackoff(
    'https://api.telegram.org/botSECRET/getUpdates',
    {},
    { label: 'test', fetch: fakeFetch, sleep: async () => {} }
  ));
  assert.strictEqual(value.status, 200);
  assert.strictEqual(calls, 3);
  assert.ok(lines.some((l) => l.includes('[outbound] backoff') && l.includes('wait=5000ms')));
  assert.ok(lines.some((l) => l.includes('wait=10000ms')));
  assert.ok(lines.every((l) => !l.includes('SECRET')));

  const tg = await telegramFetch('T', 'sendMessage', { method: 'POST' }, {
    fetch: async (url, opts) => {
      assert.ok(url.startsWith('https://api.telegram.org/botT/sendMessage'));
      assert.strictEqual(opts.method, 'POST');
      return { ok: true, status: 200 };
    },
  });
  assert.strictEqual(tg.status, 200);

  const meta = await metaGraphFetch('v21.0/me/messages', { method: 'POST' }, {
    fetch: async (url) => {
      assert.strictEqual(url, 'https://graph.facebook.com/v21.0/me/messages');
      return { ok: true, status: 200 };
    },
  });
  assert.strictEqual(meta.status, 200);

  const prev = globalThis.fetch;
  let blocked = 0;
  globalThis.fetch = async () => {
    blocked += 1;
    return { ok: false, status: 0 };
  };
  installOutboundFetch({ label: 'unit' });
  const blockedRes = await globalThis.fetch('https://api.biladministrasjon.no/c2b_module/peasy/processing/update/1');
  assert.strictEqual(blockedRes.status, 0);
  assert.strictEqual(blocked, 1, 'status 0 must not retry (ERP readonly)');
  assert.strictEqual(globalThis.fetch.__peasyOutbound, true);
  installOutboundFetch({ label: 'unit-again' });
  assert.strictEqual(globalThis.fetch.__peasyOutboundLabel, 'unit');
  globalThis.fetch = prev;

  console.log(`ok — outbound backoff 5s…10min, overnight=${overnight} attempts, telegram+meta wrappers`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
