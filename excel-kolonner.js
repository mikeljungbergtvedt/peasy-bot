'use strict';
// excel-kolonner.js — ERP-eksporten (Excel) leses etter kolonnenavn, ikke posisjon.
// Koden rundt bruker fortsatt r[12] = Status osv. kanon() stokker radene til denne faste rekkefølgen etter navn,
// så flytter Softteam en kolonne, virker alt som før. Mangler en kolonne, blir feltet tomt og det logges et varsel.
// Samme liste som pulseKanon i Pulse (c498).

const KOL = ['Internnr.', 'RegNr.', 'Drive verdi', 'Endelig AR verdi', 'Høyeste bud', 'Finans', 'Merke', 'Modell', 'År',
  'Postnr.', 'Sted', 'Kilde', 'Status', 'Registrert', 'SD mottatt på', 'Gire bestilt på', 'Levere selv', 'Mottatt',
  'Solgt på', 'Bud', 'Avgift', 'Returnert på', 'KM', 'utm_source', 'utm_campaign', 'utm_content', 'adset', 'placement',
  'ad-id', 'utm_medium', 'Kjøperens postnr.', 'Estimering'];

const norm = (x) => String(x == null ? '' : x).trim().toLowerCase();

/** rows = sheet_to_json(..., { header: 1 }) med header først. Returnerer rader i KOL-rekkefølge (header = KOL). */
function kanon(rows, logg) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) return rows;
  const h = rows[0].map(norm);
  const idx = KOL.map((n) => h.indexOf(norm(n)));
  const mangler = KOL.filter((n, i) => idx[i] < 0);
  if (mangler.length) (logg || console.warn)('[excel-kolonner] ERP-eksporten mangler kolonner: ' + mangler.join(', '));
  if (idx.every((v, i) => v === i)) return rows;
  return rows.map((r, ri) => (ri === 0 ? KOL.slice() : idx.map((j) => (j < 0 ? undefined : r[j]))));
}

module.exports = { KOL, kanon };
