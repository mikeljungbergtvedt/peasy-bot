'use strict';

/**
 * Peasy Jr Finn query (trinn 1): q = merke + modell.
 * No year, no km, no kW — not in q, not as query params.
 */

const BANNED_PARAMS = [
  'year_from',
  'year_to',
  'mileage_from',
  'mileage_to',
  'engine_effect_from',
  'engine_effect_to',
  'engine_effect',
];

function stripBannedTokens(text) {
  return String(text || '')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{1,3}(?:[\s.]?\d{3})?\s*km\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*kW\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFinnQuery(merke, modell) {
  const merkeClean = stripBannedTokens(merke);
  const modellClean = stripBannedTokens(modell);
  return [merkeClean, modellClean].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function buildFinnUrl(merke, modell) {
  const q = buildFinnQuery(merke, modell);
  const url = new URL('https://www.finn.no/mobility/search/car');
  if (q) url.searchParams.set('q', q);
  url.searchParams.set('registration_class', '1');
  url.searchParams.set('sales_form', '1');
  assertJrFinnUrl(url.toString());
  return url.toString();
}

function assertJrFinnUrl(urlString) {
  const url = new URL(urlString);
  for (const key of BANNED_PARAMS) {
    if (url.searchParams.has(key)) {
      throw new Error('Jr Finn URL must not include ' + key);
    }
  }
  const q = url.searchParams.get('q') || '';
  if (/\b(19|20)\d{2}\b/.test(q)) throw new Error('Jr Finn q must not include year');
  if (/\bkm\b/i.test(q)) throw new Error('Jr Finn q must not include km');
  if (/\bkW\b/i.test(q)) throw new Error('Jr Finn q must not include kW');
  return true;
}

module.exports = {
  BANNED_PARAMS,
  stripBannedTokens,
  buildFinnQuery,
  buildFinnUrl,
  assertJrFinnUrl,
};
