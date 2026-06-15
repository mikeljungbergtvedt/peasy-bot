// ai-client.js
// Felles wrapper rundt Anthropic Messages API.

import 'dotenv/config';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL   = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const TIMEOUT = +process.env.TIMEOUT_AI || 30000;
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Retry-konfig
const MAX_RETRIES = +process.env.AI_MAX_RETRIES || 4;
const RETRY_STATUSES = new Set([429, 529, 500, 502, 503]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function backoffDelay(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const secs = parseInt(retryAfterHeader, 10);
    if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  }
  const schedule = [5000, 15000, 30000, 120000];
  const base = schedule[Math.min(attempt, schedule.length - 1)] || 5000;
  return base + Math.floor(Math.random() * 2000);
}

async function doFetch({ system, user, maxTokens, temperature = 1.0 }) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export async function callClaude({ system, user, maxTokens = 2000, temperature = 0 }) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY mangler');
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await doFetch({ system, user, maxTokens, temperature });
      if (res.ok) {
        const json = await res.json();
        const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        return { text, usage: json.usage, stop_reason: json.stop_reason, attempts: attempt + 1 };
      }
      const bodyText = await res.text().catch(() => '');
      if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        const delay = backoffDelay(attempt, res.headers.get('retry-after'));
        console.error(`[ai-client] HTTP ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} om ${Math.round(delay/1000)}s`);
        await sleep(delay);
        lastErr = new Error(`anthropic HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
        continue;
      }
      throw new Error(`anthropic HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    } catch (e) {
      const isAbort = e.name === 'AbortError';
      const isNetwork = e.message && /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(e.message);
      if ((isAbort || isNetwork) && attempt < MAX_RETRIES) {
        const delay = backoffDelay(attempt, null);
        console.error(`[ai-client] ${isAbort ? 'timeout' : 'nettverksfeil'}, retry ${attempt + 1}/${MAX_RETRIES} om ${Math.round(delay/1000)}s`);
        await sleep(delay);
        lastErr = e;
        continue;
      }
      if (e.message && e.message.startsWith('anthropic HTTP')) throw e;
      if (attempt >= MAX_RETRIES) throw (lastErr || e);
      throw e;
    }
  }
  throw lastErr || new Error('callClaude: ukjent feil etter retries');
}

// Parse JSON fra AI-respons. Robust mot ```json-fences og ekstra tekst.
export function parseJsonFromAi(text) {
  if (!text) throw new Error('tom AI-respons');
  let t = text.trim();
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) t = fenceMatch[1].trim();
  const start = Math.min(
    ...['{', '['].map(c => t.indexOf(c)).filter(i => i >= 0)
  );
  if (!Number.isFinite(start)) throw new Error('ingen JSON funnet');
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, end = -1;
  for (let i = start; i < t.length; i++) {
    if (t[i] === open) depth++;
    else if (t[i] === close) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('uavsluttet JSON');
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new Error(`JSON.parse: ${e.message}\n---\n${slice.slice(0, 500)}`);
  }
}
