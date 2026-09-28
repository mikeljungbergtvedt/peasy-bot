'use strict';
// finn-utpris-felt.js — skriver Finn-utprisen til ERP-feltet finn_asking_price (PS-162).
//
// Frittstående kall rett etter ERP-kommentaren. Rører ikke kommentaren, confirmFinalEstimate(), SEND,
// satser eller fossefall. Feil logges og returneres, kastes aldri.
//
// Flagg FINN_FELT_SKRIV i .env (leses ved hvert kall, ingen restart):
//   0 / mangler  → av, ingen kall
//   dry          → logger hva som ville blitt sendt, ingen kall
//   1            → skriver
//
// Softteam Bot API (openapi/v2/bot, lest 28.09.2026):
//   PUT https://api.biladministrasjon.no/api/bot/cars/{carId}/finn-asking-price
//   Authorization: Bearer <SOFTTEAM_BOT_TOKEN> · Accept: application/json · Content-Type: application/json
//   Body { "finn_asking_price": 57000 } eller { "finn_asking_price": null } (tømmer). Heltall 0–4 294 967 295.
//   Svar 200 / 401 / 403 / 404 / 422 (spesifikasjonen nevner 409 generelt).
// UBEKREFTET: at {carId} er ERP-internnummeret (erpId). Bekreftes ved testen på én ekte bil.
// Overstyr adressen med FINN_FELT_URL ({carId} som plassholder). Kaller aldri /mileage.
//
// Tørrkjøring fra kommandolinja (sender aldri):
//   node finn-utpris-felt.js --dry-run <erpId> <kr|null>

const fs = require('fs');
const path = require('path');

const ENV_FIL = path.join(__dirname, '.env');
const STANDARD_URL = 'https://api.biladministrasjon.no/api/bot/cars/{carId}/finn-asking-price';
const MAKS = 4294967295;
const TIMEOUT_MS = 10000;

function lesEnv(fil) {
  const ut = {};
  try {
    for (const l of fs.readFileSync(fil || ENV_FIL, 'utf8').split('\n')) {
      const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) ut[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
  return ut;
}

/** Heltall kr (avrundet til nærmeste krone), eller null. 0, negative, tekst og tomme → null. Aldri 0 som «ukjent». */
function normaliserKr(kr) {
  if (kr == null || kr === '' || typeof kr === 'boolean') return null;
  const n = Number(kr);
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n);
  return r > MAKS ? null : r;
}

/**
 * Samme tall som står under FINN-UTPRIS i ERP-kommentaren (eval-card-hybrid.js: cappedFrom ? anchorUsed : anker_beregning.anker).
 *   p: cardParams slik de sendes til formatEvalCardHybrid
 */
function kommentarFinnUtpris(p) {
  if (!p) return null;
  const ab = (p.anchor && p.anchor.anker_beregning) || {};
  return normaliserKr(p.cappedFrom ? p.anchorUsed : ab.anker);
}

function erKunKundensAnnonse(x) {
  return x === 'kun_kundens_annonse' || x === 'kun kundens annonse';
}

/**
 * Verdien til feltet: Finn-utprisen fra armen som ga kunden estimatet, lik tallet i kommentaren.
 * null når det ikke finnes sammenlignbare biler, eller bare kundens egen Finn-annonse.
 *   kommentar: tallet under FINN-UTPRIS i kommentaren (kommentarFinnUtpris) — brukes når det finnes
 *   card/arm:  fossefall-kortet og armen som skrev ERP ('A' | 'B' | 'O' | 'ORDNA'), reserve
 *   antallComps: antall sammenlignbare biler (0 → null)
 */
function velgFinnUtpris({ kommentar, card, arm, kilde, grunn, kunKundensAnnonse, antallComps, reserve } = {}) {
  if (kunKundensAnnonse || erKunKundensAnnonse(kilde) || erKunKundensAnnonse(grunn)) return null;
  if (antallComps != null && Number(antallComps) === 0) return null;
  const fraKommentar = normaliserKr(kommentar);
  if (fraKommentar != null) return fraKommentar;
  const a = String(arm || 'A').toUpperCase();
  const key = a === 'O' || a === 'ORDNA' ? 'ordna' : a === 'B' ? 'b' : 'a';
  const armRec = card && card[key];
  if (armRec && erKunKundensAnnonse(armRec.finn_utpris_grunn)) return null;
  if (armRec && armRec.finn_utpris !== undefined) return normaliserKr(armRec.finn_utpris);
  return normaliserKr(reserve);
}

function flagg(env) {
  const v = String(env.FINN_FELT_SKRIV == null ? '0' : env.FINN_FELT_SKRIV).trim().toLowerCase();
  return v === '1' ? 'paa' : v === 'dry' ? 'dry' : 'av';
}

function vis(v) { return v == null ? 'null' : String(v); }

async function ettKall(f, url, init) {
  const res = await f(url, Object.assign({}, init, { signal: AbortSignal.timeout(TIMEOUT_MS) }));
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, ok: res.ok, data };
}

/**
 * Skriver feltet. Kaster aldri. Én logglinje per bil: «[finn-felt] 4758 57000 200».
 *   opts: { dryRun, log, fetchImpl, env }  — dryRun (eller flagg dry) sender ingenting
 * Nytt forsøk én gang ved 5xx, nettverksfeil og tidsavbrudd. Ikke ved 4xx.
 */
async function skrivFinnUtpris(erpId, kr, opts = {}) {
  const log = opts.log || console.log;
  const env = opts.env || lesEnv();
  const verdi = normaliserKr(kr);
  const id = String(erpId == null ? '' : erpId).trim();
  try {
    if (!/^\d+$/.test(id)) { log(`[finn-felt] ${id || '?'} ${vis(verdi)} ugyldig erpId`); return { ok: false, skipped: 'ugyldig erpId' }; }
    const modus = opts.dryRun ? 'dry' : flagg(env);
    if (modus === 'av') return { ok: false, skipped: 'flagg av' };
    const url = (env.FINN_FELT_URL || STANDARD_URL).replace('{carId}', id);
    const body = JSON.stringify({ finn_asking_price: verdi });
    if (modus === 'dry') { log(`[finn-felt] ${id} ${vis(verdi)} dry`); return { ok: true, skipped: 'dry', url, body: { finn_asking_price: verdi } }; }
    const token = env.SOFTTEAM_BOT_TOKEN || '';
    if (!token) { log(`[finn-felt] ${id} ${vis(verdi)} FEIL: SOFTTEAM_BOT_TOKEN mangler i .env`); return { ok: false, skipped: 'mangler token' }; }
    const f = opts.fetchImpl || fetch;
    const init = { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' }, body };
    let svar = null, feil = null;
    for (let forsok = 1; forsok <= 2; forsok++) {
      try {
        svar = await ettKall(f, url, init); feil = null;
        if (svar.status >= 500 && forsok === 1) continue;
        break;
      } catch (e) {
        feil = e && e.name === 'TimeoutError' ? 'tidsavbrudd' : (e && e.message ? e.message : String(e));
        svar = null;
      }
    }
    if (!svar) { log(`[finn-felt] ${id} ${vis(verdi)} FEIL: ${feil}`); return { ok: false, feil }; }
    if (svar.ok && svar.data && svar.data.success) { log(`[finn-felt] ${id} ${vis(verdi)} ${svar.status}`); return { ok: true, status: svar.status, data: svar.data.data }; }
    const kort = svar.data ? JSON.stringify(svar.data).slice(0, 160) : '';
    log(`[finn-felt] ${id} ${vis(verdi)} ${svar.status} ${kort}`.trim());
    return { ok: false, status: svar.status, feil: kort || ('HTTP ' + svar.status) };
  } catch (e) {
    log(`[finn-felt] ${id} ${vis(verdi)} FEIL: ${e && e.message ? e.message : e}`);
    return { ok: false, feil: e && e.message ? e.message : String(e) };
  }
}

module.exports = { skrivFinnUtpris, velgFinnUtpris, kommentarFinnUtpris, normaliserKr, lesEnv, flagg, STANDARD_URL };

if (require.main === module) {
  const a = process.argv.slice(2).filter((x) => x !== '--dry-run');
  if (!process.argv.includes('--dry-run') || !a[0]) { console.error('Bruk: node finn-utpris-felt.js --dry-run <erpId> <kr|null>'); process.exit(2); }
  skrivFinnUtpris(a[0], a[1] === 'null' ? null : a[1], { dryRun: true });
}
