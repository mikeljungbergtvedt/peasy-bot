try { require('./shared/outbound.js').installOutboundFetch({ label: 'peasy-auto' }); } catch (e) { console.error('outbound hook', e && e.message); }
// ============================================================
// peasy-auto.js v18.11
//   Nytt fra v18.06:
//   KP-01: Kveldspuls/dagspuls-mail avviklet 19.08 — dagsanalyse overtar. Brackets nattlig 23:30.
//
// peasy-auto.js v18.06
//   Nytt fra v18.05:
//   LW-01: Liste-watch utvidet til lister 9, 10, 11 (samme monster som liste 8)
//   LW-02: Liste 9 (Vent. pa budaksept) — ERP endpoint waiting_bid_acceptance
//   LW-03: Liste 10 (Vent. salgsmelding) — ERP endpoint waiting_for_sale_reaction
//   LW-04: Liste 11 (Uferdige kontrakter) — ERP endpoint incomplete_contract
//   LW-05: Per-liste Set for spam-kontroll (_liste9Varslet, _liste10Varslet, _liste11Varslet)
//   LW-06: Sjekkes kl 12 og 15 (samme cron som liste 8)
//
// peasy-auto.js v18.05
//   Nytt fra v18.04.b:
//   ST-01: Stuck-watch — varsel for biler >5 arb.dager fra Mottatt -> ready_for_auction
//   ST-02: Norske helligdager 2026 ekskluderes fra arbeidsdag-telling
//   ST-03: Telegram /stuck [N] - sett threshold eller vis status
//   ST-04: Daglig pamninnelse (en gang per dag per bil) inntil status endres
//   ST-05: State-fil stuck-state.json for spam-kontroll
//
// peasy-auto.js v18.03.de2
//   Endringer fra bz:
//   CA-01: identifySegment() — criterion-felt per segment
//   CA-02: getAnchor() — snitt av 3 billigste (ikke 5), take i retur
//   CA-03: getPrevEvals() — filtrerer bort navaerende erpId
//   CA-04: formatEvalCard prevLine — bruker e.dato + e.dLavHoy
//   CA-05: getFinnComps() — ny funnel-rekkefølge:
//          steg 1 (merke+modell+ar+varebil/personbil) →
//          2a km-band → 2b drivstoff (hybrid/el laases, ikke skip) →
//          2c drivtype → 2d karosseri → 2e kW ±15% KUN fossil
//          Stopp funnel ved <5 treff (ikke bare dropp).
//          funnelSteps[] returnert med label+treff per steg.
//          finnUrl = URL til siste godkjente steg (comps-kilde).
//   CA-06: formatEvalCard — viser funnelSteps i eval-kort
//   CA-07: formatEvalCard — rett prevLine-felt (dato/dLavHoy)
// ============================================================

'use strict';

// [_botversion_stamp] Bot-versjon vises i hver ERP-eval
const BOT_VERSION = 'v19.31.3';
let BOT_GIT_HASH = '';
try {
  BOT_GIT_HASH = require('child_process').execSync('git -C ' + __dirname + ' rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch (e) { BOT_GIT_HASH = 'nogit'; }
const BOT_STAMP = () => BOT_VERSION + ' (' + BOT_GIT_HASH + ') \u00b7 ' + new Date().toISOString().replace('T',' ').substring(0,16);


require('dotenv').config();
// Force FOSSEFALL_* from .env (dotenv skips keys already set in process env)
(function forceFossefallEnvFromDotenv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
      const m = line.match(/^\s*(FOSSEFALL_[A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch (_) {}
})();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function writeEasyMeasurement(regnr, erpId, bil, originCV, payloadJson) {
  if (bil && bil.testMode) return;
  try {
    const parsed = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
    let _soldDays = null;
    try {
      const { extractSoldDays } = require('./fossefall');
      const ee = parsed && parsed.easy_eval;
      const vc = (ee && (ee.valgte_comps || (ee.finn_utpris && ee.finn_utpris.valgte_comps)))
        || (parsed && parsed.valgte_comps)
        || (parsed && parsed.anchor && parsed.anchor.valgte_comps)
        || [];
      _soldDays = extractSoldDays(vc);
    } catch (_) {}
    require("./easy-measurements").appendEasyMeasurement({
      regnr,
      erpId,
      source: bil && bil.source,
      km: bil && bil.mileage,
      origin_cv: originCV || null,
      easyEval: parsed && parsed.easy_eval,
      soldDays: _soldDays,
    });
    log("[easy-meas] " + regnr);
  } catch (eMeas) {
    logErr("easy-meas", eMeas);
  }
}

const { collectOnly } = require('./pricing-v2-glue');
const easy = require('./easy-anchor');
const { stripOriginFromMarket, ensureFinnUtpris } = require('./finn-utpris');
const originComps = require('./origin-comps');
const originChefs = require('./origin-chefs');
const { lockOriginIdentity, identForComps, finnSearchFromIdent } = require('./origin-lock');
const { capFinnUtpris } = require('./finn-origin');
const { originCv } = require('./origin-cv');
const { formatEvalCardHybrid } = require('./eval-card-hybrid');
const fossefallCard = require('./fossefall-card');
const { classifyBiltype, formatScopeCard, scopeHeadline } = require('./biltype-gate');
const { resolveKjorbar, wreckerPricing } = require('./kjorbar');

const VERSION = 'v20.167'; // avvik bare på armen som eier bilen, egenvekt som merknad når den ikke påvirker omreg; v20.166: ståtid-forslag fra carinfo i QA, legges på bare med hake; v20.165: eval-kort og logg viser fossefallet, ikke easy-cost-v7; v20.164: nye målinger fra A publiseres til Pages hver natt; v20.163: scenario-kontroll: e-post i stedet for Telegram, pares på internnr; v20.162: scenario-kontroll hver natt (ERP-lav mot fossefallet); v20.161: postToChat finner eksisterende eval-kort (data.comments); v20.160: takst-celler v2: eldre biler fra 01.11 i heatmap (anker fra ERP-kommentar, bare lesing); v20.159: nattjobben skriver peasy-cells.json; v20.158: updateBracketsJson leser GITHUB_TOKEN fra .env; v20.154: QA Sett Finn-pris går gjennom fossefallet

// Krasj-vern: logg uventede feil, men hold prosessen i live (launchd KeepAlive er backstop)
process.on('unhandledRejection', (reason) => {
  try { console.error(`[${new Date().toISOString()}] [${VERSION}] UNHANDLED REJECTION:`, (reason && reason.stack) || reason); } catch (e) {}
});
process.on('uncaughtException', (err) => {
  try { console.error(`[${new Date().toISOString()}] [${VERSION}] UNCAUGHT EXCEPTION:`, (err && err.stack) || err); } catch (e) {}
});
const CACHE_FILE = path.join(__dirname, 'peasy-cache.json');
const STUCK_STATE_FILE = path.join(__dirname, 'stuck-state.json');
const STUCK_CONFIG_FILE = path.join(__dirname, 'stuck-config.json');
try { require('./shared/instance-lock').acquireOrExit(process.env.PEASY_PROCESS_LABEL || 'peasy-auto'); } catch (e) {
  console.error('[lock] peasy-auto', e && e.message);
  process.exit(0);
}

// ── Konfigurasjon ─────────────────────────────────────────────
const CONFIG = {
  useAiV30: false, // DEAKTIVERT 26.5: AI valgte upresise comps (5-Serie blandet i 3-Serie). Bruker deterministisk getAnchor (snitt 5 billigste).
  version: VERSION,
  schedule: { startHour: 7, endHour: 19 },
  erp: {
    base: 'https://api.biladministrasjon.no',
    user: process.env.ERP_USER,
    pass: process.env.ERP_PASS,
  },
  telegram: {
    token: process.env.TELEGRAM_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  anthropic: { key: process.env.ANTHROPIC_API_KEY },
  vegvesen:  { key: process.env.VEGVESEN_API_KEY },
  bracketsUrl: 'https://mikeljungbergtvedt.github.io/peasy-brackets.json',
  bodyTypes: {},  // id -> name, lastes ved oppstart
  pdec1: { lav: 0.102, mid: -0.089, hoy: -0.046, premium: -0.073 },
  fee: [
    { maxT: 35000,    fee: 5900 },  // v20.87: nye vilkaar per 3.8.2026
    { maxT: 75000,    fee: 8900 },
    { maxT: 150000,   fee: 9900 },
    { maxT: Infinity, fee: 11900 },
  ],
  stuckWatch: {
    defaultThresholdDays: 5,
    // Norske helligdager 2026 (ekskluderes fra arbeidsdag-telling)
    holidays2026: [
      '2026-01-01', // Nyttarsdag
      '2026-04-02', // Skjaertorsdag
      '2026-04-03', // Langfredag
      '2026-04-05', // 1. paskedag
      '2026-04-06', // 2. paskedag
      '2026-05-01', // Arbeidernes dag
      '2026-05-14', // Kristi himmelfartsdag
      '2026-05-17', // Grunnlovsdag
      '2026-05-24', // 1. pinsedag
      '2026-05-25', // 2. pinsedag
      '2026-12-25', // 1. juledag
      '2026-12-26', // 2. juledag
    ],
    // Endelige statuser - bilen er ute av Mottatt-til-ready-vinduet
    finalStatuses: ['ready_for_auction', 'on_auction', 'sold', 'sold_and_paid', 'returned', 'to_be_returned'],
  },
};

// ── Logging ───────────────────────────────────────────────────
function log(msg)       { console.log(`[${new Date().toISOString()}] [${VERSION}] ${msg}`); }
function logErr(ctx, e) { console.error(`[${new Date().toISOString()}] [${VERSION}] FEIL [${ctx}]`, e?.message || e || ''); }

// ── Filhjelp ──────────────────────────────────────────────────
function loadJSON(file) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { logErr('loadJSON', e); }
  return {};
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { logErr('saveJSON', e); }
}

// ── Cache ─────────────────────────────────────────────────────
function isInCache(cache, erpId) { return !!cache[String(erpId)]; }
function cacheSkipReason(cache, erpId) {
  const entry = cache[String(erpId)];
  if (entry && typeof entry === 'object' && entry.skip) {
    return entry.skip + (entry.fant ? ' (' + entry.fant + ')' : '');
  }
  return null;
}
function addScopeSkipToCache(cache, erpId, gate) {
  if (!erpId) return;
  cache[String(erpId)] = {
    ts: new Date().toISOString(),
    skip: 'utenfor_scope',
    fant: gate && gate.fant || 'ukjent',
    klasse: gate && gate.klasse || 'ukjent',
  };
  saveJSON(CACHE_FILE, cache);
  log(`Cache: ${erpId} utenfor_scope (${(gate && gate.fant) || 'ukjent'})`);
}
function addZeroCompsSkipToCache(cache, erpId) {
  if (!erpId) return;
  cache[String(erpId)] = {
    ts: new Date().toISOString(),
    skip: '0_comps',
    fant: '0 eksterne origin-comps',
  };
  saveJSON(CACHE_FILE, cache);
  log(`Cache: ${erpId} 0_comps — pris for hånd`);
}
function pickCompName(c) {
  if (!c) return '';
  return c.title || c.heading || c.tittel || c.classified_title || c.car_name || c.model || '';
}
function enrichValgteFromPool(valgte, pool) {
  const src = Array.isArray(pool) ? pool : [];
  const list = Array.isArray(valgte) && valgte.length ? valgte : src;
  function findHit(c) {
    const plate = String(c.licence_plate || '').toUpperCase().replace(/\s/g, '');
    const ident = String(c.ident_id || '');
    const price = Number(c.price) || 0;
    const km = Number(c.km) || 0;
    if (plate) {
      const h = src.find(function (p) {
        return String(p.licence_plate || '').toUpperCase().replace(/\s/g, '') === plate;
      });
      if (h) return h;
    }
    if (ident) {
      const h = src.find(function (p) {
        return String(p.ident_id || '') === ident || String(p.finn_url || '') === ident;
      });
      if (h) return h;
    }
    if (price && km) {
      const h = src.find(function (p) {
        return Number(p.price) === price && Number(p.km) === km;
      });
      if (h) return h;
    }
    return null;
  }
  const enriched = list.map(function (c) {
    const hit = findHit(c);
    return {
      title: pickCompName(c) || pickCompName(hit),
      model: c.model || (hit && hit.model) || '',
      fuel: c.fuel || (hit && hit.fuel),
      drive: c.drive || (hit && hit.drive),
    };
  });
  const named = enriched.filter(function (c) { return pickCompName(c); }).length;
  if (named === 0 && src.length) {
    return src.map(function (c) {
      return { title: pickCompName(c), model: c.model, fuel: c.fuel, drive: c.drive };
    });
  }
  return enriched;
}
function scoreEasyIdentComps(vegData, bil, finnSelf, comps, collectedComps) {
  try {
    const { scoreIdentComps } = require('./ident-comps-score');
    return scoreIdentComps({
      make: (vegData && vegData.make) || (bil && bil.make) || '',
      model: (vegData && vegData.model) || (bil && bil.model_series) || '',
      year: (vegData && vegData.firstRegYear) || (bil && bil.model_year) || null,
      fuel: vegData && vegData.fuel,
      propulsion: vegData && vegData.propulsion,
      drive: vegData && vegData.drive,
      klasse: vegData && vegData.isVarebil ? 'varebil' : 'personbil',
      hk: vegData && vegData.hk,
      kw: vegData && vegData.kw,
      range: vegData && vegData.range,
      originLink: finnSelf && finnSelf.link,
      originTitle: finnSelf && (finnSelf.title || finnSelf.heading),
      originModel: finnSelf && finnSelf.model,
      comps: enrichValgteFromPool(comps, collectedComps),
    });
  } catch (e) {
    return null;
  }
}

function writeFinnLink(erpId, finnSelf) {
  // v20.84: aldri slett, aldri no-op-skriv. Fjernet delete-branch som skapte race pa fallback-path.
  try {
    if (!erpId) return;
    var link = (finnSelf && finnSelf.link) ? String(finnSelf.link) : null;
    if (!link) return;
    var fs = require('fs');
    var FP = '/Users/bot/peasy-auto/finn-links.json';
    var m = {};
    try { m = JSON.parse(fs.readFileSync(FP, 'utf8')) || {}; } catch (e) { m = {}; }
    if (m[String(erpId)] === link) return;
    m[String(erpId)] = link;
    fs.writeFileSync(FP, JSON.stringify(m));
  } catch (e) { try { logErr('writeFinnLink ' + erpId, e); } catch (e2) {} }
}
function addToCache(cache, erpId) {
  if (erpId) { cache[String(erpId)] = new Date().toISOString(); }
  saveJSON(CACHE_FILE, cache);
  log(`Cache: ${erpId} lagt til`);
}
const { shouldCachePriced, pickSharedUtpris } = require('./cache-ferdig');
function cacheIfPriced(cache, erpId, erpWritten, bil, utpris) {
  let skipWrite = false;
  try {
    skipWrite = !!require('./ab-arm.js').easyShouldSkipWrite(erpId, bil && bil.source);
  } catch (e) { /* skip */ }
  const d = shouldCachePriced({
    erpWritten: !!erpWritten,
    utpris,
    skipWrite,
    erpLav: bil && bil.price_final_min,
  });
  if (!d.ok) {
    log(`Cache: ${erpId} ikke ferdig — ${d.why}`);
    return false;
  }
  addToCache(cache, erpId);
  return true;
}
function reloadCacheFromDisk(cache) {
  const fresh = loadJSON(CACHE_FILE);
  for (const k of Object.keys(cache)) delete cache[k];
  Object.assign(cache, fresh || {});
}


// ── Body type mapping ─────────────────────────────────────────
const BODY_TYPE_MAP = {
  1: 'Sedan', 2: 'Kombi', 3: 'Stasjonsvogn', 4: 'Pick Up',
  5: 'Cabriolet', 6: 'SUV', 7: 'Kasse', 8: 'Coupe',
  9: 'Flerbruksbil', 10: 'Annet'
};

// ── KM fra XLSX-rapport ───────────────────────────────────────
let _kmCache = {};
let _kmCacheLoaded = false;
let _prevEvalsMap = {}; // regnr → [{ id, status, dato }]
let _evalRegnrMap = {}; // erpId → regnr (for callback-melding)
let _evalDataMap = {};  // erpId → kalkyle-data for Endre anker
const EVAL_DATA_FILE = path.join(__dirname, 'eval-data.json');
function persistEvalData() {
  try {
    const slim = {};
    for (const k of Object.keys(_evalDataMap)) {
      const v = _evalDataMap[k] || {};
      slim[k] = { regnr: v.regnr, segment: v.segment, lowestComp: v.lowestComp, anyDebts: v.anyDebts, brreg: { anyDebts: !!(v.brreg && v.brreg.anyDebts), text: (v.brreg && v.brreg.text) || '' }, bil: { id: (v.bil && v.bil.id) || null } };
    }
    fs.writeFileSync(EVAL_DATA_FILE, JSON.stringify(slim));
  } catch (ePd) {}
}
try {
  const lastet = JSON.parse(fs.readFileSync(EVAL_DATA_FILE, 'utf8'));
  for (const k of Object.keys(lastet)) { _evalDataMap[k] = lastet[k]; if (lastet[k] && lastet[k].regnr) _evalRegnrMap[k] = lastet[k].regnr; }
} catch (eLd) {}
let _awaitingAnchor = null; // venter paa ny anker

function _filterOldComps(comps, mnd) {
  if (!Array.isArray(comps)) return comps;
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - (mnd || 6));
  let dropped = 0;
  const out = comps.filter(c => {
    if (!c) return false;
    if (c.status && /aktiv|active/i.test(String(c.status))) return true;
    const sold = c.soldDate || c.sold_date || c.solgt_dato || c.sold_at || c.published_at || c.published_date || c.date_sold;
    if (!sold) return true;
    const d = new Date(sold);
    if (isNaN(d.getTime())) return true;
    if (d < cutoff) { dropped++; return false; }
    return true;
  });
  if (dropped > 0) console.log('[' + (mnd||6) + 'mnd-filter] droppet ' + dropped + ' av ' + comps.length + ' eldre salg');
  return out;
}

const XLSX_CACHE_FILE = path.join(__dirname, 'cache', 'peasy-master.xlsx');
const XLSX_CACHE_MAX_MS = 10 * 60 * 1000;
let _xlsxRefreshInflight = null;

async function refreshXlsxCache(force) {
  try {
    if (!force && fs.existsSync(XLSX_CACHE_FILE)) {
      const age = Date.now() - fs.statSync(XLSX_CACHE_FILE).mtimeMs;
      if (age < XLSX_CACHE_MAX_MS) return fs.readFileSync(XLSX_CACHE_FILE);
    }
    if (_xlsxRefreshInflight) return _xlsxRefreshInflight;
    _xlsxRefreshInflight = (async () => {
      const res = await fetch('https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx');
      if (!res.ok) throw new Error('XLSX HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      try { fs.mkdirSync(path.dirname(XLSX_CACHE_FILE), { recursive: true }); } catch (eMk) {}
      fs.writeFileSync(XLSX_CACHE_FILE, buf);
      log('XLSX-cache: skrevet ' + buf.length + ' bytes');
      return buf;
    })();
    try { return await _xlsxRefreshInflight; }
    finally { _xlsxRefreshInflight = null; }
  } catch (e) {
    logErr('refreshXlsxCache', e);
    if (fs.existsSync(XLSX_CACHE_FILE)) return fs.readFileSync(XLSX_CACHE_FILE);
    throw e;
  }
}

async function loadKmCache() {
  if (_kmCacheLoaded) return;
  try {
    const XLSX = require('xlsx');
    const buf = await refreshXlsxCache(false);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    _prevEvalsMap = {};
    for (const row of rows.slice(1)) {
      const regnr = String(row[1] || '').trim().toUpperCase().replace(/\s/g, '');
      const km = parseInt(row[22]) || 0;
      if (regnr && km > 0) _kmCache[regnr] = km;
      // Bygg previousEvalsMap: col A=id, col B=regnr, col M=status, col N=dato
      const id = row[0];
      const status = String(row[12] || '').trim();
      const dato = String(row[13] || '').trim();
      const dLavHoy = String(row[3] || '').trim();
      if (regnr && id) {
        if (!_prevEvalsMap[regnr]) _prevEvalsMap[regnr] = [];
        _prevEvalsMap[regnr].push({ id, status, dato, dLavHoy });
      }
    }
    _kmCacheLoaded = true;
    log(`KM-cache: ${Object.keys(_kmCache).length} biler fra XLSX`);
  } catch (e) { logErr('loadKmCache', e); }
}
// CA-03: filtrerer bort navaerende erpId slik at bilen ikke vises som tidligere registrert mot seg selv
function getPrevEvals(regnr, currentErpId) {
  const all = _prevEvalsMap[(regnr || '').toUpperCase().replace(/\s/g, '')] || [];
  return all.filter(e => String(e.id) !== String(currentErpId));
}
function getKmForRegnr(regnr) {
  return _kmCache[(regnr || '').toUpperCase().replace(/\s/g, '')] || 0;
}
async function getKmForRegnrFresh(regnr) {
  const km = getKmForRegnr(regnr);
  if (km > 0) return km;
  // Reload cache og prøv igjen
  _kmCacheLoaded = false;
  await loadKmCache();
  return getKmForRegnr(regnr);
}

// ── ERP Auth ──────────────────────────────────────────────────
let _erpToken = null;
let _erpTokenExpiry = null;

async function getErpToken() {
  if (_erpToken && _erpTokenExpiry && new Date() < _erpTokenExpiry) return _erpToken;
  log('ERP: logger inn...');
  const res = await fetch(`${CONFIG.erp.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CONFIG.erp.user, password: CONFIG.erp.pass }),
  });
  const data = await res.json();
  if (!data.success) throw new Error('ERP login feilet: ' + JSON.stringify(data));
  _erpToken = data.data.token.token;
  _erpTokenExpiry = new Date(data.data.token.expires_at);
  log('ERP: innlogget OK');
  return _erpToken;
}

function authH(token) { return { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }; }

function clearErpToken() { _erpToken = null; _erpTokenExpiry = null; }

let _erpAuthAlertAt = 0;
async function alertErpAuthExpired() {
  const now = Date.now();
  if (now - _erpAuthAlertAt < 60 * 60 * 1000) return;
  _erpAuthAlertAt = now;
  try {
    await sendTelegram('⚠️ ERP-innlogging utløpt (proxy). /list og /bil feiler til innlogging virker igjen.');
  } catch (_) {}
}

async function erpFetch(url, opts) {
  opts = opts || {};
  let tok = await getErpToken();
  let res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, authH(tok), (opts.headers || {})) }));
  if (res.status === 401) {
    clearErpToken();
    tok = await getErpToken();
    res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, authH(tok), (opts.headers || {})) }));
    if (res.status === 401) {
      await alertErpAuthExpired();
      const err = new Error('ERP_AUTH_EXPIRED');
      err.code = 'ERP_AUTH_EXPIRED';
      throw err;
    }
  }
  return res;
}

// ── ERP: Hent liste 3 ─────────────────────────────────────────
async function getListe3() {
  log('ERP: henter liste 3...');
  const token = await getErpToken();
  const res = await fetch(
    `${CONFIG.erp.base}/c2b_module/peasy/processing/final_estimate?per_page=100`,
    { headers: authH(token) }
  );
  const data = await res.json();
  const raw = data.data?.data?.data || [];
  await loadKmCache();
  const biler = raw.map(b => ({
    ...b,
    model_series: b.drive_no_car_data?.model_series || b.driveNoCarData?.model_series || b.model_series || '',
    model_year:   b.drive_no_car_data?.model_year   || b.driveNoCarData?.model_year   || b.model_year   || 0,
    mileage:      getKmForRegnr(b.registration_number) || b.mileage || 0,
    karosseri_erp: b.body_type_id ? (CONFIG.bodyTypes[b.body_type_id] || '') : '',
  }));
  log(`ERP: ${biler.length} biler pa liste 3`);
  return biler;
}

const { enrichRejected, reasonLabel } = require('./reject-reasons.js');

function unwrapListe(data) {
  return data?.data?.data?.data || data?.data?.data || data?.data || [];
}

// Liste 16 = avvist. Valgt årsak = reject_reason_id.
async function getListe16({ page, perPage, reasonId, regnr } = {}) {
  const token = await getErpToken();
  const q = new URLSearchParams();
  q.set('per_page', String(perPage || 50));
  if (page) q.set('page', String(page));
  if (reasonId != null) q.set('filter[reject_reason_id]', String(reasonId));
  if (regnr) q.set('filter[registration_number]', String(regnr).toUpperCase());
  const res = await fetch(
    `${CONFIG.erp.base}/c2b_module/peasy/processing/rejected?${q}`,
    { headers: authH(token) }
  );
  if (!res.ok) throw new Error('Liste 16 HTTP ' + res.status);
  const data = await res.json();
  const pag = data.data?.data || {};
  const raw = Array.isArray(pag.data) ? pag.data : unwrapListe(data);
  return {
    total: pag.total || raw.length,
    page: pag.current_page || page || 1,
    lastPage: pag.last_page || 1,
    biler: raw.map(enrichRejected),
  };
}

async function getListe16Siste(n = 20) {
  const first = await getListe16({ page: 1, perPage: 1 });
  const lastPage = Math.max(1, first.lastPage || 1);
  // per_page=1 → lastPage ≈ total. Hent siste bolk med 50.
  const perPage = 50;
  const page = Math.max(1, Math.ceil((first.total || lastPage) / perPage));
  const pack = await getListe16({ page, perPage });
  const biler = (pack.biler || []).slice().reverse().slice(0, n);
  return { ...pack, biler };
}

async function getListe2() {
  const token = await getErpToken();
  const res = await fetch(
    `${CONFIG.erp.base}/c2b_module/peasy/processing/sd_received?per_page=100`,
    { headers: authH(token) }
  );
  const data = await res.json();
  const raw = data.data?.data?.data || [];
  await loadKmCache();
  const biler = raw.map(b => ({
    ...b,
    model_series: b.drive_no_car_data?.model_series || b.driveNoCarData?.model_series || b.model_series || '',
    model_year:   b.drive_no_car_data?.model_year   || b.driveNoCarData?.model_year   || b.model_year   || 0,
    mileage:      getKmForRegnr(b.registration_number) || b.mileage || 0,
    karosseri_erp: b.body_type_id ? (CONFIG.bodyTypes[b.body_type_id] || '') : '',
  }));
  log(`ERP: ${biler.length} biler pa liste 2`);
  return biler;
}

async function promoteToListe3(erpId, token) {
  log(`Liste 2: promoterer bil ${erpId} via API...`);
  try {
    const res = await fetch(`${CONFIG.erp.base}/c2b_module/peasy/processing/update/${erpId}/sd_received`, {
      method: 'PUT',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_temp_min: null, price_temp_max: null, purchase_price_estimate_min: null, purchase_price_estimate_max: null, change_status: true }),
    });
    const data = await res.json();
    if (data.success) { log(`Liste 2: bil ${erpId} promotert OK`); return true; }
    logErr(`promoteToListe3 ${erpId}`, data); return false;
  } catch (err) {
    logErr(`promoteToListe3 ${erpId}`, err); return false;
  }
}

async function getErpCarDetail(erpId, token) {
  const res = await fetch(`${CONFIG.erp.base}/c2b_module/peasy/cars/${erpId}`, { headers: authH(token) });
  const data = await res.json();
  return data.data || null;
}

async function fillErpViaBrowser(erpId, auctionTypeId, anyDebts, brreg) {
  log(`ERP UI: oppdaterer bil ${erpId}...`);
  try {
    const token = await getErpToken();
    // Hent encumbrance.id fra bil-detalj (påkrevd i payload)
    const detail = await maybeGetErpDetail(bil, erpId, token);
    const encumbranceId = detail?.car?.encumbrance?.id || null;
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}.${mm}.${yyyy}`;
    const payload = {
      auction_price_type_id: auctionTypeId,
      encumbrance: Object.assign(
        { check_date: dateStr, comment: '', debt_date: dateStr, amount: 0, account_number: '0', reference: '0', contact_information: '0', contact_person: '', any_debts: anyDebts || false, checkmark: true },
        encumbranceId ? { id: encumbranceId } : {}
      ),
      owners_check_comment: null,
      owners_check_date: dateStr,
      change_status: false,
    };
    const res = await fetch(`${CONFIG.erp.base}/c2b_module/peasy/processing/update/${erpId}/final_estimate`, {
      method: 'PUT',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) { log(`ERP: toggles/auction satt OK for bil ${erpId}`); return true; }
    logErr(`fillErpViaBrowser ${erpId}`, data); return false;
  } catch (err) {
    logErr(`fillErpViaBrowser ${erpId}`, err); return false;
  }
}

async function writeToERP(erpId, dLav, dHoy, auctionTypeId, anyDebts, brreg, token, anker) {
  log(`ERP: PUT D lav/hoy + alle felt for bil ${erpId}...`);
  try {
    const { isPositiveKr } = require('./ab-arm.js');
    if (!isPositiveKr(dLav) || !isPositiveKr(anker != null ? anker : dLav)) {
      log('ERP PUT BLOKKERT ' + erpId + ' — Ingen utpris — sett anker (dLav=' + dLav + ' anker=' + anker + ')');
      return false;
    }
    // Hent encumbrance.id
    const detail = await getErpCarDetail(erpId, token);
    const encumbranceId = detail?.car?.encumbrance?.id || null;
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}.${mm}.${yyyy}`;
    const encumbranceBase = {
        check_date: dateStr,
        comment: '',
        debt_date: dateStr,
        amount: 0,
        account_number: '0',
        reference: '0',
        contact_information: '0',
        contact_person: '',
        any_debts: anyDebts || false,
        checkmark: true,
      };
    if (encumbranceId) encumbranceBase.id = encumbranceId;
    const payload = {
      price_final_min: dLav,
      price_final_max: dHoy,
      auction_price_type_id: auctionTypeId,
      encumbrance: encumbranceBase,
      owners_check_comment: null,
      owners_check_date: dateStr,
      change_status: false,
    };
    if (anker != null && Number.isFinite(Number(anker)) && Number(anker) > 0) {
      payload.price_temp_min = Math.round(Number(anker));
    }
    const res = await fetch(`${CONFIG.erp.base}/c2b_module/peasy/processing/update/${erpId}/final_estimate`, {
      method: 'PUT',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) { log(`ERP: bil ${erpId} skrevet OK`); return true; }
    logErr(`writeToERP ${erpId}`, data); return false;
  } catch (err) {
    logErr(`writeToERP ${erpId}`, err); return false;
  }
}


async function verifyErpStatus(erpId, token) {
  try {
    const res = await fetch(`${CONFIG.erp.base}/c2b_module/peasy/cars/${erpId}`, { headers: authH(token) });
    const data = await res.json();
    const c = data.data?.car || data.data;
    const dLavHoy = (c.price_final_min > 0 && c.price_final_max > 0);
    return {
      dLavHoy,
      auctionType:  (c.auction_price_type_id != null),
      encumbrances: (c.encumbrance?.checkmark === true),
      owners:       (c.owners_check_date != null),
      finans:       (c.encumbrance?.any_debts === true),
    };
  } catch (e) {
    logErr(`verifyErpStatus ${erpId}`, e);
    return { dLavHoy: false, auctionType: false, encumbrances: false, owners: false, finans: false };
  }
}

async function postToChat(erpId, evalText, token) {
  const checkRes = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}/comments/all`, { headers: authH(token) });
  const checkData = await checkRes.json();
  // v20.161: ERP svarer { data: { comments: [...] } } — før ble lista aldri funnet, så sjekken slo aldri inn.
  const existing = Array.isArray(checkData.data) ? checkData.data
    : (checkData.data && Array.isArray(checkData.data.comments) ? checkData.data.comments : []);
  if (existing.some(c => (c.comment || '').includes('BIL TIL ESTIMERING'))) {
    log(`Kommentar: bil ${erpId} har allerede eval-kort — skipper`);
    return false;
  }
  const res = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}/comments`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: evalText }),
  });
  const data = await res.json();
  if (data.success) { log(`Kommentar: postet for bil ${erpId}`); return true; }
  logErr(`postToChat ${erpId}`, data);
  return false;
}

// PEASY: helpers for testmodus uten ERP-skriving
async function maybeWriteToERP(bil, erpId, dLav, dHoy, atid, ad, br, tok, anker) {
  // Returnerer { written, skipBy } — skipBy er 'A'|'B'|'Ordna'|null. FEIL kun når written=false og skipBy=null.
  if (!bil || !bil.id) { log("TESTMODUS - hopper over writeToERP"); return { written: false, skipBy: 'A' }; }
  if (bil._originSkipPut && !bil._kunKundensAnnonse) {
    log('origin-comps: 0 eksterne comps — Easy skriver ikke ERP (QA Send /qa/anker urørt)');
    return { written: false, skipBy: null, originSkip: true };
  }
  try {
    const { easyShouldSkipWrite, liveOwner } = require('./ab-arm.js');
    const why = easyShouldSkipWrite(erpId, bil.source);
    if (why === 'ordna' && !bil._kunKundensAnnonse) {
      log('Ordna: Easy skriver ikke ERP (V3G eier kohorten)');
      return { written: false, skipBy: 'Ordna' };
    }
    if (why === 'arm-B' && !bil._kunKundensAnnonse) {
      log('A/B: B-bil ' + erpId + ' — Easy skriver ikke ERP (V3G eier skriv)');
      return { written: false, skipBy: 'B' };
    }
    if (bil._kunKundensAnnonse && (why === 'arm-B' || why === 'ordna')) {
      log('kun kundens annonse: Easy skriver ERP likevel (skipBy=' + why + ' overstyrt)');
    }
  } catch (eAb) { /* lodd-feil skal ikke stoppe A */ }
  const ok = await writeToERP(erpId, dLav, dHoy, atid, ad, br, tok, anker);
  return { written: !!ok, skipBy: ok ? 'A' : null };
}
async function maybeVerifyErp(bil, erpId, tok) {
  if (!bil || !bil.id) return null;
  return verifyErpStatus(erpId, tok);
}
async function maybePostToChat(bil, erpId, text, tok) {
  if (!bil || !bil.id) { log("TESTMODUS - hopper over postToChat"); return false; }
  try {
    const { easyShouldSkipWrite } = require('./ab-arm.js');
    const why = easyShouldSkipWrite(erpId, bil.source);
    if (why === 'ordna') {
      log('Ordna: Easy poster ikke eval-kort (V3G eier kohorten)');
      return false;
    }
  } catch (eAb) {}
  return postToChat(erpId, text, tok);
}
async function maybeGetErpDetail(bil, erpId, tok) {
  if (!bil || !bil.id) return null;
  return getErpCarDetail(erpId, tok);
}


// ── Telegram ──────────────────────────────────────────────────
// v19.32: starter grok-bot ved aa spawne grok-mini.js direkte (samme som /regnr km i Telegram)
function sendGrok(regnr, km) {
  // Grok utfaset 1. juni 2026 — funksjonen er deaktivert, beholdes for kompatibilitet
  return;
}

async function sendTelegram(text, reply_markup) {
  // ai-mail-judge av. Telegram uendret.

  const MAX = 4000; // Telegram-grense er 4096; vi holder margin
  let chunks;
  if (!text || text.length <= MAX) {
    chunks = [text || ''];
  } else {
    // Del paa seksjons-grenser (blank linje) saa HTML-tagger som <pre> ikke brytes
    chunks = [];
    let buf = '';
    for (const block of text.split('\n\n')) {
      const cand = buf ? buf + '\n\n' + block : block;
      if (cand.length > MAX && buf) { chunks.push(buf); buf = block; }
      else buf = cand;
    }
    if (buf) chunks.push(buf);
    // Sikkerhetsnett: hard-splitt en enkelt-blokk som fortsatt er for stor
    const safe = [];
    for (const c of chunks) {
      if (c.length <= 4096) { safe.push(c); continue; }
      let rest = c;
      while (rest.length > 4096) { safe.push(rest.slice(0, MAX)); rest = rest.slice(MAX); }
      if (rest) safe.push(rest);
    }
    chunks = safe;
  }
  try {
    for (let i = 0; i < chunks.length; i++) {
      const body = {
        chat_id: CONFIG.telegram.chatId,
        text: chunks[i],
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      // Knapper (reply_markup) kun pa siste bit
      if (reply_markup && i === chunks.length - 1) body.reply_markup = reply_markup;
      const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (res && !res.ok) {
        const t = await res.text().catch(() => '');
        logErr('sendTelegram', new Error(`HTTP ${res.status}: ${t.slice(0, 150)}`));
      }
      // chunk-delay: sørg for at mobil-klienten ikke grupperer chunks til én visning
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1200));
    }
  } catch (e) { logErr('sendTelegram', e); }
}

// v18.04.b: Send POST /final_estimate/confirm (= grnn knapp i ERP)
async function confirmFinalEstimate(erpId, token) {
  try {
    try {
      const det = await getErpCarDetail(erpId, token);
      const { erpHasPositiveD } = require('./ab-arm.js');
      if (!erpHasPositiveD(det)) {
        log('confirm BLOKKERT ' + erpId + ' — Ingen utpris — sett anker');
        return { ok: false, errors: 'Ingen utpris — sett anker' };
      }
    } catch (eGuard) {
      logErr('confirm guard ' + erpId, eGuard);
      return { ok: false, errors: 'Ingen utpris — sett anker' };
    }
    const res = await fetch(`${CONFIG.erp.base}/c2b_module/peasy/processing/update/${erpId}/final_estimate/confirm`, {
      method: 'POST',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.success) { log(`ERP confirm OK for ${erpId}`); return { ok: true }; }
    // v20.52: behandle "allerede bekreftet/laast" som OK (no-op) -- bilen er alt ferdigstilt i ERP
    const _msg = JSON.stringify(data || {}).toLowerCase();
    if (/allerede|already|confirmed|bekreftet|laast|l\u00e5st|locked|finalized|ferdigstilt/.test(_msg)) {
      log(`ERP confirm: ${erpId} allerede bekreftet (no-op, OK)`);
      return { ok: true, noop: true };
    }
    logErr(`confirmFinalEstimate ${erpId} -> ` + JSON.stringify(data));
    return { ok: false, errors: data.errors || data.message };
  } catch (e) { logErr(`confirmFinalEstimate ${erpId}`, e); return { ok: false, errors: e.message }; }
}

// ── Vegvesen ──────────────────────────────────────────────────

// === Peasy: car.info + elbilradar via fetch (for variant/utstyr) ===
async function getCarInfoFetch(regnr) {
  const url = `https://www.car.info/no-no/license-plate/N/${regnr.replace(/\s/g,'')}`;
  try {
    const r = await fetch(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
      'Accept': 'text/html'
    } });
    if (!r.ok) { log(`car.info ${r.status}`); return null; }
    const html = await r.text();
    const titleM = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleM ? titleM[1].trim() : '';
    let variant = '';
    if (title) {
      const beforeComma = title.split(',')[0].replace(/^[^-]*-\s*/, '');
      const words = beforeComma.trim().split(/\s+/);
      if (words.length >= 4) variant = words.slice(3).join(' ');
      else if (words.length >= 3) variant = words.slice(2).join(' ');
    }
    log(`car.info: title="${title}" variant="${variant}"`);
    return { title, variant };
  } catch(e) { log(`car.info FEIL: ${e.message}`); return null; }
}

// PEASY: ekstraherer label/value-felter fra elbilradar HTML
function parseElbilradarFields(html) {
  const out = {};
  // Strip tags og normaliser whitespace til linje-pr-element
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|li|td|th|dt|dd|h[1-6]|tr|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n");
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  // Label paa en linje, value paa neste
  const labelMap = {
    "Produsent:": "produsent",
    "\u00c5rsmodell:": "aarsmodell",
    "Produksjonssted:": "produksjonssted",
    "Merke:": "elbMerke",
    "Modell:": "elbModell",
    "Understellsnr. (VIN):": "vin",
    "Karosseri:": "karosseri",
    "Antall d\u00f8rer:": "doerer",
    "Antall seter:": "seter",
    "Drivstofftype:": "drivstoff",
    "Rekkevidde (WLTP):": "rekkevidde",
    "Energiforbruk (WLTP):": "forbruk",
    "Toppfart:": "toppfart",
    "Egenvekt:": "egenvekt",
    "1.motor maks. nettoeffekt:": "motorEffekt",
    "1.gangsregistrert i Norge:": "forsteRegNorge",
    // Felter som kan finnes for noen merker:
    "Spesifikasjon:": "spesifikasjon",
    "Drivlinje:": "drivlinje",
    "Batteri:": "batteri",
    "Farge:": "farge",
    "Antall eiere:": "eiere",
    "Bilen kommer fra:": "bruktimportertFra",
    "Garanti:": "garanti",
    "Pris:": "finnPris",
    "Kilometerstand:": "finnKm",
  };
  // PEASY: ekstraher Finn-link og tittel fra HTML
  const finnM = html.match(/finn\.no\/mobility\/item\/(\d+)/);
  if (finnM) out.finnId = finnM[1];
  for (let i = 0; i < lines.length - 1; i++) {
    const key = labelMap[lines[i]];
    if (key && !out[key]) out[key] = lines[i+1];
  }
  return out;
}
async function getElbilradarFetch(regnr, page) {
  const url = `https://elbilradar.com/elbil_data.php?regnr=${regnr.replace(/\s/g,'')}`;
  try {
    let html;
    if (page) {
      // v20.57: hent via browser-context (Cloudflare-clearance) -> unngaar 403
      html = await page.evaluate(async (u) => {
        const rr = await fetch(u, { headers: { 'Accept': 'text/html', 'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7' } });
        if (!rr.ok) return '__HTTP_' + rr.status + '__';
        return await rr.text();
      }, url);
      if (typeof html === 'string' && html.startsWith('__HTTP_')) { log(`elbilradar ${html.replace(/__/g,'').replace('HTTP_','')}`); return null; }
    } else {
      const r = await fetch(url, { headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        'Accept': 'text/html'
      } });
      if (!r.ok) { log(`elbilradar ${r.status}`); return null; }
      html = await r.text();
    }
    const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const variantMatch = decoded.match(/>([A-Z][A-Za-z0-9 -]+?(?: [A-Za-z0-9-]+){1,4}\/[^<>\n]+(?:\/[^<>\n]+){1,8})</);
    let variantRaw = variantMatch ? variantMatch[1].trim() : null;
    if (!variantRaw) {
      const fb = decoded.match(/([A-Z][A-Za-z0-9 ]+ [A-Za-z0-9-]+\/[^<>\n]+\/[^<>\n]+\/[^<>\n]+)/);
      variantRaw = fb ? fb[1].trim() : null;
    }
    const titleM = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleM ? titleM[1].trim() : '';

    let modelFull = null, pakke = null, equipment = [];
    if (variantRaw) {
      // Splitt på "/", trim, fjern trailing quote-rester
      const parts = variantRaw.split('/').map(s => s.trim().replace(/"+$/,'').trim()).filter(Boolean);
      // Første del: "BMW iX xDrive60 xDrive60 Supercharged" → dedupe gjentatte ord
      const first = parts[0] || '';
      const words = first.split(/\s+/);
      const deduped = [];
      for (let i = 0; i < words.length; i++) {
        if (i === 0 || words[i].toLowerCase() !== words[i-1].toLowerCase()) {
          deduped.push(words[i]);
        }
      }
      modelFull = deduped.join(' ');
      // Pakke = siste "ord" i modelFull hvis det matcher kjente pakker, ellers null
      const pakkeMatch = modelFull.match(/\b(Supercharged|Fully Charged|Long Range|Performance|Plus|Pro|Sport|Premium)\b/i);
      pakke = pakkeMatch ? pakkeMatch[1] : null;
      // Normaliser utstyrs-ord
      equipment = parts.slice(1).map(s => {
        let e = s;
        if (/^luft$/i.test(e)) e = 'Luftfjæring';
        if (/^bowers$/i.test(e)) e = 'Bowers & Wilkins';
        if (/^4 hjuls styring$/i.test(e)) e = '4-hjuls styring';
        if (/^22"?$/.test(e)) e = '22"';
        if (/^21"?$/.test(e)) e = '21"';
        if (/^20"?$/.test(e)) e = '20"';
        return e;
      });
    }

    const fields = parseElbilradarFields(html); return Object.assign({ title, variantLine: variantRaw, modelFull, pakke, equipment }, fields);
  } catch(e) { log(`elbilradar FEIL: ${e.message}`); return null; }
}

// PEASY: hent Finn-annonse-tittel for berikelse av modelFull
async function fetchFinnAdTitle(finnId) {
  try {
    const r = await fetch("https://www.finn.no/mobility/item/" + finnId, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36" }
    });
    if (!r.ok) return null;
    const html = await r.text();
    const t = html.match(/<title>([^<]+)<\/title>/i);
    return t ? t[1].trim() : null;
  } catch (e) { log("Finn-ad fetch FEIL: " + e.message); return null; }
}
async function getVegvesenData(regnr) {
  const res = await fetch(
    `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=${regnr.replace(/\s/g, '')}`,
    { headers: { 'Accept': 'application/json', 'SVV-Authorization': CONFIG.vegvesen.key } }
  );
  if (!res.ok) throw new Error(`Vegvesen ${res.status} for ${regnr}`);
  const data = await res.json();
  const k = data.kjoretoydataListe?.[0];
  if (!k) throw new Error(`Vegvesen: ingen data for ${regnr}`);

  const td = k.godkjenning?.tekniskGodkjenning?.tekniskeData;
  const motorer = td?.motorOgDrivverk?.motor || [];
  const motor = motorer[0];
  const drivstoff = motor?.drivstoff?.[0];
  const motorCount = motorer.length;
  const fuelDescs = [];
  let primaryKw = 0;
  let secondKw = 0;
  for (const mot of motorer) {
    for (const d of (mot.drivstoff || [])) {
      const desc = d.drivstoffKode?.kodeBeskrivelse || '';
      if (desc) fuelDescs.push(desc);
      const effekt = Number(d.maksNettoEffekt || d.maksEffektPrTime || 0) || 0;
      if (effekt >= primaryKw) { secondKw = primaryKw; primaryKw = effekt; }
      else if (effekt > secondKw) secondKw = effekt;
    }
  }
  let fuel = fuelDescs[0] || drivstoff?.drivstoffKode?.kodeBeskrivelse || 'Ukjent';
  const hybFuel = fuelDescs.find((f) => /\+elektr|hybrid/i.test(f));
  if (hybFuel) fuel = hybFuel;
  const miljo = td?.miljodata?.miljoOgdrivstoffGruppe?.[0];
  const utslipp = miljo?.forbrukOgUtslipp?.[0];
  const aksler = td?.akslinger?.akselGruppe || [];
  const drivAksler = aksler.filter(g => g.akselListe?.aksel?.some(a => a.drivAksel)).length;
  const generelt = td?.generelt;
  const firstRegStr = k.godkjenning?.forstegangsGodkjenning?.forstegangRegistrertDato || '';
  const firstRegMonth = firstRegStr ? parseInt(firstRegStr.split('-')[1] || '0') : 0;
  const firstRegYear  = firstRegStr ? parseInt(firstRegStr.split('-')[0] || '0') : 0;
  const kw = primaryKw || drivstoff?.maksNettoEffekt || drivstoff?.maksEffektPrTime || 0;
  const karosseri = td?.karosseri?.karosseritype?.kodeBeskrivelse || '';
  const klass = k?.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering?.tekniskKode || {};
  const avgiftsgruppe = klass.kodeBeskrivelse || '';
  const tekniskKode = klass.kodeVerdi || klass.kodeNavn || '';
  const bruktimport = k?.godkjenning?.forstegangsGodkjenning?.bruktimport || null;
  const forstegangNorgeDato = k?.forstegangsregistrering?.registrertForstegangNorgeDato || null;
  const opprinneligRegDato = k?.godkjenning?.forstegangsGodkjenning?.forstegangRegistrertDato || null;
  const range = utslipp?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring || null;
  let propulsion = 'FOSSIL';
  try {
    const { classifySisterPropulsion } = require('./finn-origin.js');
    propulsion = classifySisterPropulsion({
      fuel,
      motorCount,
      secondMotorKw: secondKw,
      electricRange: range || 0,
    }) || 'FOSSIL';
  } catch (_) {
    const f = String(fuel).toLowerCase();
    if (f.startsWith('elektri') && !f.includes('+') && !f.includes('hybrid')) propulsion = 'EV';
    else if (f.includes('+elektri') || f.includes('hybrid') || (range || 0) >= 25 || secondKw >= 15) propulsion = 'HYBRID';
  }

  return {
    make: generelt?.merke?.[0]?.merke || '',
    model: generelt?.handelsbetegnelse?.[0] || '',
    fuel,
    gearbox: td?.motorOgDrivverk?.girkassetype?.kodeBeskrivelse || 'Ukjent',
    kw,
    hk: Math.round(kw * 1.36),
    drive: drivAksler >= 2 ? '4WD' : '2WD',
    range,
    karosseri,
    avgiftsgruppe,
    tekniskKode,
    isVarebil: String(avgiftsgruppe).toLowerCase().includes('varebil') || false,
    firstRegMonth,
    firstRegYear,
    motorCount,
    secondMotorKw: secondKw,
    propulsion,
    isHybrid: propulsion === 'HYBRID',
    bruktimport,
    forstegangNorgeDato,
    opprinneligRegDato,
  };
}

// ── Segment-identifisering ────────────────────────────────────
// Returnerer segment, confidence og km/year for bruk i Finn-funnel og margin-math.
// Kriterier:
//   Old/worn  : alder >= 13 OR km >= 200 000
//   High-km   : km >= 150 000 OR (alder >= 6 AND km/year > 15 000)
//   Premium   : alder <= 5 AND km < 100 000
//   Mid       : alt annet (default)
//   Special   : settes av getFinnComps() hvis <5 comps etter funnel
// CA-01: criterion-felt lagt til per segment
function identifySegment(year, km) {
  const currentYear = new Date().getFullYear();
  const age = currentYear - (year || currentYear);
  const kmPerYear = age > 0 ? Math.round(km / age) : 0;

  let segment, label, confidence, criterion;

  if (km >= 100000 || kmPerYear > 25000) {
    segment = 'highkm'; label = 'Høy KM'; confidence = 'High';
    criterion = km >= 100000
      ? `km \u2265100 000 (${km.toLocaleString('nb-NO')} km)`
      : `${kmPerYear.toLocaleString('nb-NO')} km/år (>25 000)`;
  } else {
    segment = 'normal'; label = 'Normal'; confidence = 'High';
    criterion = `${km.toLocaleString('nb-NO')} km, ${kmPerYear.toLocaleString('nb-NO')} km/år`;
  }

  const _age = Math.max(1, new Date().getFullYear() - (year||new Date().getFullYear()));
  const _avvik = (km - _age*15000) / (_age*15000);
  let _kbp;
  if (_avvik < -0.20)      _kbp = 0.20;
  else if (_avvik < 0.20)  _kbp = 0.25;
  else if (_avvik < 0.40)  _kbp = 0.25;
  else                     _kbp = 0.30;
  const _kmBand = Math.max(10000, Math.round(km * _kbp / 1000) * 1000);
  return { segment, label, confidence, criterion, age, kmPerYear, kmBand: _kmBand };
}

// ── Finn URL-bygging ──────────────────────────────────────────

function cleanModelSeries(make, modelSeries) {
  if (!modelSeries) return '';
  let m = modelSeries.trim();
  // Strip ledende make-ord
  const makeFirst = (make || '').trim().split(' ')[0].toLowerCase();
  if (makeFirst && m.toLowerCase().startsWith(makeFirst + ' ')) {
    m = m.substring(makeFirst.length + 1).trim();
  }
  // v20.78: strip "NN kWh" (batteristørrelse) overalt i strengen
  m = m.replace(/\s*\d+(?:[.,]\d+)?\s*kWh\b/gi, '').trim();
  // Strip trailing tall + kW/KW (motorstyrke kW)
  m = m.replace(/\s+\d+\s*[kK][wW]\b.*$/, '').trim();
  // Strip trailing tall + hk/HK (motorstyrke hk)
  m = m.replace(/\s+\d{2,3}\s*[hH][kK]\b.*$/, '').trim();
  // Strip trailing girkasse-koder (EAT, EAT6, EAT8, AT, AT6, AT8, DSG, DSG7, S-Tronic, Tiptronic) + alt etter
  m = m.replace(/\s+(EAT[0-9]?|AT[0-9]?|DSG[0-9]?|S-?Tronic|Tiptronic|Multitronic|CVT|AMT)\b.*$/i, '').trim();
  // Strip trailing rene 2-3 sifrede tall (motorstyrke i hk uten suffix, f.eks. '110')
  m = m.replace(/\s+\d{2,3}$/, '').trim();
  // v20.78: dedupe etterfølgende like ord (case-insensitiv): "e-4ORCE e-4ORCE" → "e-4ORCE"
  const words = m.split(/\s+/).filter(Boolean);
  const dedup = [];
  for (let i = 0; i < words.length; i++) {
    if (i === 0 || words[i].toLowerCase() !== words[i-1].toLowerCase()) dedup.push(words[i]);
  }
  m = dedup.join(' ');
  // v20.95: slim til forste 2 ord for a matche Finn-titler (fjerner girkasse/trim/variant-terminologi)
  const _slim = m.split(/\s+/).filter(Boolean);
  if (_slim.length > 2) m = _slim.slice(0, 2).join(' ');
  return m;
}

function getFinnFuelCode(fuel) {
  const f = String(fuel || '').toLowerCase();
  if (f.includes('hybrid') || f.includes('+elektr')) return '3';
  if (f.includes('elektr')) return '4';
  if (f.includes('diesel')) return '2';
  return '1';
}

function getFinnGearCode(gearbox) {
  const g = (gearbox || '').toLowerCase();
  if (/cvt|automat|auto\b|dsg|tiptronic|tronic|dct|geartronic/.test(g)) return '2';
  if (g.includes('manuell') || g.includes('manual')) return '1';
  return null;
}

// Bygg Finn-URL med valgfrie filter-params
function getFinnGearCode(gearbox) {
  const g = (gearbox || '').toLowerCase();
  if (/cvt|automat|auto\b|dsg|tiptronic|tronic|dct|geartronic/.test(g)) return '2';
  if (g.includes('manuell') || g.includes('manual')) return '1';
  return null;
}

function buildFinnUrl(make, model, yearFrom, yearTo, vegData, opts = {}) {
  const regClass = vegData.isVarebil ? '2' : '1';
  const cleanMake = make
    .replace(/\s*MOTORS\s*/i, '')
    .replace(/JAGUAR LAND ROVER LIMITED/i, 'Land Rover')
    .trim();
  const pkgSuffix = opts.package ? ' ' + opts.package : '';
  // v20.58: rens modell for Finn-fritekst (fjern variant/girkasse-stoy som blokkerer treff)
  const modelForQ = cleanModelSeries(make, model || '');
  const q = encodeURIComponent((cleanMake + " " + modelForQ).trim());

  const hk = Number(vegData.hk) || Math.round((vegData.kw || 0) * 1.36);
  const hkFrom = hk > 0 ? Math.floor(hk * 0.85 / 10) * 10 : 0;
  const hkTo   = hk > 0 ? Math.ceil(hk  * 1.15 / 10) * 10 : 0;

  const params = [
    `sales_form=1`,
    `registration_class=${regClass}`,
    `q=${q}`,
    `year_from=${yearFrom}`,
    `year_to=${yearTo}`,
    `price_from=15000`,
    `sort=PRICE_ASC`,
    opts.kmTo   ? `mileage_to=${opts.kmTo}`                    : '',
    opts.kmFrom ? `mileage_from=${opts.kmFrom}`        : '',
    opts.hk     ? `power_from=${hkFrom}&power_to=${hkTo}`      : '',
    opts.drive  ? '' : '',
    opts.body   ? `body_type=${opts.body}`                      : '',
        opts.drive ? [...new Set(vegData.drive === '4WD' ? ['2'] : ['1', '3'])].map(d => `wheel_drive=${d}`).join('&') : '',
    opts.fuel   ? `fuel=${getFinnFuelCode(vegData.fuel)}`       : '',
    opts.gear   ? (getFinnGearCode(vegData.gearbox) ? `transmission=${getFinnGearCode(vegData.gearbox)}` : '') : '',
    opts.gear   ? (getFinnGearCode(vegData.gearbox) ? `transmission=${getFinnGearCode(vegData.gearbox)}` : '') : '',
    opts.kw     ? (vegData.kw > 0 ? `power_from=${Math.floor(vegData.kw * 0.85)}&power_to=${Math.ceil(vegData.kw * 1.15)}` : '') : '',
  ].filter(Boolean);

  return `https://www.finn.no/mobility/search/car?${params.join('&')}`;
}

// ── Finn scraping ─────────────────────────────────────────────
async function scrapeFinnUrl(url, page) {
  log(`Finn: scraper ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const totalCount = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d[\d\s]+)\s*treff/);
    return m ? parseInt(m[1].replace(/\s/g, '')) : 0;
  });

  const comps = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('article')).slice(0, 30).map(a => {
      const text = a.innerText || '';
      const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g, '')) || 0;
      const kmM = text.match(/\b(20\d{2}|19\d{2})\b.*?([\d\s]+)\s*km[^\w]/);
      const km = kmM ? parseInt(kmM[2].replace(/\s/g, '')) : 0;
      const currentYear = new Date().getFullYear();
      const year = (() => {
        const matches = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map(m => parseInt(m[1]));
        return matches.find(y => y <= currentYear) || 0;
      })();
      const link = a.querySelector('a')?.href || '';
      const heading = (a.querySelector('h2')?.textContent || a.querySelector('[class*="heading"]')?.textContent || text.split('\n')[0] || '').trim();
      const sold = /\bsolgt\b/i.test(text) && !/til salgs/i.test((heading + ' ' + text.slice(0, 80)));
      return { price, km, year, link, heading, sold };
    }).filter(c => c.price >= 5000 && c.price <= 2000000);
  });

  const seen = new Set();
  const unique = comps.filter(c => {
    const key = `${c.price}-${c.km}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  log(`Finn: ${totalCount} treff, scraped ${unique.length}`);
  return { comps: unique, totalCount };
}

// — Modell-filter via sidebar ————————————————————————
async function applyModelFilter(page, modelSeries) {
  try {
    // Steg A: klikk merke-label med flest treff (hopp over serie-labels)
    const merkeTxt = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      let best = null, bestN = 0;
      for (const l of labels) {
        const txt = l.textContent.trim();
        if (/serie/i.test(txt)) continue;
        const m = txt.match(/\((\d+)\)/);
        if (!m) continue;
        const n = parseInt(m[1]);
        if (n > bestN) { bestN = n; best = txt; }
      }
      return best;
    });
    if (!merkeTxt) { log('Finn modell-filter: ingen merke-label funnet'); return null; }
    log(`Finn modell-filter: klikker merke ${merkeTxt}`);
    await page.locator('label', { hasText: merkeTxt }).first().click();
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 6000 }).catch(() => {}),
      page.waitForTimeout(2500)
    ]);

    // Steg B: finn modell-label som matcher modelSeries med flest treff
    const modelTxt = await page.evaluate((ms) => {
      const labels = Array.from(document.querySelectorAll('label'));
      let best = null, bestN = 0;
      for (const l of labels) {
        const txt = l.textContent.trim();
        if (!txt.toLowerCase().includes(ms.toLowerCase())) continue;
        const m = txt.match(/\((\d+)\)/);
        if (!m) continue;
        const n = parseInt(m[1]);
        if (n > bestN) { bestN = n; best = txt; }
      }
      return best;
    }, modelSeries);

    if (!modelTxt) { log(`Finn modell-filter: ingen modell funnet for ${modelSeries}`); return null; }
    const modelCount = parseInt(modelTxt.match(/\((\d+)\)/)[1]);
    if (modelCount === 0) { log(`Finn modell-filter: ${modelSeries} har 0 treff - avbryter`); return null; }

    log(`Finn modell-filter: klikker modell ${modelTxt}`);
    await page.locator('label', { hasText: modelTxt }).first().click();
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 6000 }).catch(() => {}),
      page.waitForTimeout(2500)
    ]);

    const totalCount = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d[\d\s]+)\s*treff/);
      return m ? parseInt(m[1].replace(/\s/g, '')) : 0;
    });
    if (totalCount === 0) { log('Finn modell-filter: 0 treff etter klikk - avbryter'); return null; }

    const url = page.url();
    const modelName = modelTxt.replace(/\s*\(\d+\)$/, '').trim();
    log(`Finn modell-filter: ${modelName} valgt (${totalCount} treff)`);
    return { url, totalCount, modelName };
  } catch(e) {
    log(`Finn modell-filter feilet: ${e.message}`);
  }
  return null;
}

// ── Karosseri → Finn body_type mapping ───────────────────────
function getFinnBodyType(karosseri) {
  const k = (karosseri || '').toLowerCase();
  if (k.includes('stasjonsvogn')) return 4;
  if (k.includes('sedan'))        return 3;
  return null;
}

// CA-05: ny funnel — steg 1 (merke+modell+ar+varebil/personbil) ->
//   2a km -> 2b drivstoff (skip hybrid) -> 2c drivtype -> 2d karosseri -> 2e kW
//   Stopp funnel ved <5 treff. funnelSteps[] returnert.
//   finnUrl = URL til siste godkjente steg (comps-kilde).
async function getFinnComps(bil, vegData, page, overrideUrl = null, locked = null) {
  /* JR_DOSSIER_HOOK_COMPS */
  if (bil && bil._jrDossier && bil._jrDossier.ok && ((bil._jrDossier.comps || []).length >= 1 || bil._jrDossier.skipOwnSearch)) {
    var __d = bil._jrDossier;
    var __raw = (__d.comps || []).concat((__d.finn && __d.finn.ads) || []);
    var __pool = [];
    for (var __i = 0; __i < __raw.length; __i++) {
      var __c = __raw[__i] || {};
      var __price = Number(__c.price || __c.ask || __c.finn_price || __c.pris || 0);
      var __km = Number(__c.km || __c.mileage || 0);
      if (__price > 0) __pool.push({ price: __price, km: __km, year: __c.year, title: __c.title || __c.heading, url: __c.url, id: __c.id || __c.finn_id });
    }
    if (__pool.length >= 1) {
      var __seg = (typeof identifySegment === "function") ? identifySegment(bil.model_year || 0, bil.mileage || 0) : { segment: "jr", label: "jr-dossier" };
      if (typeof log === "function") log("Jr-dossier pool=" + __pool.length + " (hopper eget Finn-sok)");
      return { pool: __pool, finnUrl: (__d.finn && __d.finn.url) || "", totalCount: __pool.length, seg: __seg, funnelSteps: [{ label: "jr-dossier", treff: __pool.length, stopp: true }] };
    }
    if (typeof log === "function") log("Jr-dossier pool=0 — eget Finn-sok");
  }

  let _effModel = (bil && bil.model_series) || (vegData && vegData.model) || '';
  const _search = locked ? finnSearchFromIdent(locked) : null;
  if (_search && _search.modelQ) {
    _effModel = _search.modelQ;
    vegData = Object.assign({}, vegData, {
      fuel: _search.fuel || vegData.fuel,
      gearbox: (locked && locked.gir) || vegData.gearbox,
      drive: (locked && locked.drivlinje) || vegData.drive,
      hk: _search.hk || vegData.hk,
    });
    log('[finn-id] q="' + (_search.q || _effModel) + '" fuel=' + (_search.fuel || '—') + ' hk=' + (_search.hk || '—') + ' codes=' + JSON.stringify(_search.fuelCodes));
  } else {
    try {
      const _aiFinnModel = require('./ai-finn-model');
      const _aiSuggest = await _aiFinnModel.suggestFinnModel(bil, vegData);
      if (_aiSuggest) {
        const _regnrLog = (bil && (bil.registration_number || bil.reg_number)) || '';
        log(`[finn-ai] ${_regnrLog}: AI-modell="${_aiSuggest}" (Vegvesen: "${_effModel}")`);
        _effModel = _aiSuggest;
      }
    } catch (e) { logErr('AI-finn-modell', e); }
  }

  const erpYear = bil.model_year || 0;
  const vegYear = vegData.firstRegYear || 0;
  let yBase = erpYear;
  if (vegYear > 0 && erpYear > 0 && Math.abs(erpYear - vegYear) > 2) {
    log(`Arsmodell: ERP=${erpYear} avviker fra Vegvesen=${vegYear} — bruker Vegvesen-ar`);
    yBase = vegYear;
  }

  const seg = identifySegment(yBase, bil.mileage || 0);
  log(`Segment: ${seg.label} | alder=${seg.age}y | km/y=${seg.kmPerYear?.toLocaleString('nb-NO')}`);

  const MIN_POOL = 5;
  const KM_BAND  = { premium: 30000, mid: 40000, highkm: 50000, old: 80000, special: 80000 };
  const kmBand   = KM_BAND[seg.segment] || 50000;
  const kmTo     = (bil.mileage || 0) + kmBand;  const kmFrom   = Math.max(0, (bil.mileage || 0) - kmBand);

  if (overrideUrl) {
    log('Finn: QA-URL override -> scraper direkte: ' + overrideUrl);
    const ov = await scrapeFinnUrl(overrideUrl, page);
    const ovComps = (ov && ov.comps) || [];
    if (ovComps.length === 0) { log('Finn: QA-URL ga 0 comps'); return { pool: [], finnUrl: overrideUrl, totalCount: (ov && ov.totalCount) || 0, seg: seg, funnelSteps: [{ label: 'QA-URL override', treff: (ov && ov.totalCount) || 0, stopp: true }] }; }
    let ovPool = ovComps;
    for (const band of [kmBand, kmBand * 1.5, kmBand * 2, 999999]) {
      const f = ovComps.filter(c => Math.abs(c.km - (bil.mileage || 0)) <= band);
      if (f.length >= 3) { ovPool = f; break; }
    }
    ovPool.sort((a, b) => a.price - b.price);
    log('Finn: QA-URL pool = ' + ovPool.length + ' biler');
    return { pool: ovPool, finnUrl: overrideUrl, totalCount: (ov && ov.totalCount) || ovComps.length, seg: seg, funnelSteps: [{ label: 'QA-URL override', treff: (ov && ov.totalCount) || ovComps.length, stopp: false }] };
  }
    const bodyType = getFinnBodyType(vegData.karosseri);
  const propulsion = (_search && _search.isHybrid) ? 'HYBRID'
    : (_search && _search.isEv) ? 'EV'
    : (vegData.propulsion || (vegData.isHybrid ? 'HYBRID' : 'FOSSIL'));
  const isHybrid = propulsion === 'HYBRID';
  const isEv = propulsion === 'EV';
  const isFossil = propulsion === 'FOSSIL';

  const funnelSteps = [];

  async function fetchHits(url) {
    const { comps, totalCount } = await scrapeFinnUrl(url, page);
    return { comps, totalCount, url };
  }

  // STEG 1: merke + modell + eksakt ar + varebil/personbil
  let yFrom = yBase, yTo = vegData.firstRegMonth >= 9 ? yBase + 1 : yBase;
  let result = await fetchHits(buildFinnUrl(vegData.make, _effModel, yFrom, yTo, vegData));
  log(`Finn steg 1 (${yFrom}-${yTo}): ${result.totalCount} treff`);
  funnelSteps.push({
    label: `${vegData.make} ${_effModel} ${yFrom}${yTo !== yFrom ? '–' + yTo : ''} (${vegData.isVarebil ? 'varebil' : 'personbil'})`,
    treff: result.totalCount,
    stopp: false,
  });

  // STEG 1b: ar +-1 hvis under min
  if (result.totalCount < MIN_POOL) {
    const yFrom2 = yFrom - 1, yTo2 = yTo + 1;
    const r2 = await fetchHits(buildFinnUrl(vegData.make, _effModel, yFrom2, yTo2, vegData));
    log(`Finn steg 1b (+-1y ${yFrom2}-${yTo2}): ${r2.totalCount} treff`);
    funnelSteps.push({ label: `ar +-1 (${yFrom2}–${yTo2})`, treff: r2.totalCount, stopp: false });
    if (r2.totalCount > result.totalCount) {
      result = r2; yFrom = yFrom2; yTo = yTo2;
    }
    if (result.totalCount < MIN_POOL) {
      log(`Finn: ${result.totalCount} treff etter +-1y — setter segment til Special`);
      seg.segment = 'special'; seg.label = 'Special'; seg.confidence = 'Best effort';
      seg.criterion = 'for fa comps';
      funnelSteps[funnelSteps.length - 1].stopp = true;
    }
  }

  const seen = new Set();
  let allComps = [];
  for (const c of result.comps) {
    const key = `${c.price}-${c.km}`;
    if (!seen.has(key) && c.km <= 500000) { seen.add(key); allComps.push(c); }
  }

  let finnUrl       = result.url;
  let totalCount    = result.totalCount;
  let lastGoodUrl   = finnUrl;
  let lastGoodComps = [...allComps];

  if (seg.segment === 'special') {
    allComps.sort((a, b) => a.price - b.price);
    log(`Finn (Special): ${allComps.length} comps`);
    return { pool: allComps, finnUrl, totalCount, seg, funnelSteps };
  }

  // Akkumuler opts — hvert steg bygger pa alle godkjente tidligere filtre
  let activeOpts = {};

  async function tryFilter(newOpts, stepLabel, skipReason) {
    if (skipReason) {
      funnelSteps.push({ label: stepLabel, treff: totalCount, stopp: false, skipped: true, skipReason });
      log(`Finn steg '${stepLabel}': hoppet over (${skipReason})`);
      return true;
    }
    const testOpts = Object.assign({}, activeOpts, newOpts);
    const testUrl  = buildFinnUrl(vegData.make, _effModel, yFrom, yTo, vegData, testOpts);
    const r        = await fetchHits(testUrl);
    log(`Finn steg '${stepLabel}': ${r.totalCount} treff`);
    if (r.totalCount >= MIN_POOL) {
      activeOpts    = testOpts;
      lastGoodUrl   = testUrl;
      totalCount    = r.totalCount;
      finnUrl       = testUrl;
      lastGoodComps = r.comps.filter(c => c.km <= 500000);
      funnelSteps.push({ label: stepLabel, treff: r.totalCount, stopp: false });
      return true;
    } else {
      funnelSteps.push({ label: stepLabel, treff: r.totalCount, stopp: true });
      log(`Finn steg '${stepLabel}': ${r.totalCount} < ${MIN_POOL} — stopper funnel`);
      return false;
    }
  }

  // 2a–2e: kjor filtre sekvensielt, stopp ved false
  await (async () => {
    if (!await tryFilter({ kmFrom, kmTo }, `+km ${Math.round(kmFrom / 1000)}k–${Math.round(kmTo / 1000)}k (+/-${Math.round(kmBand / 1000)}k)`, null)) return;
    if (isHybrid) {
      if (!await tryFilter({ fuel: true }, '+hybrid (ikke bensin/diesel alene)', null)) return;
    } else if (isEv) {
      if (!await tryFilter({ fuel: true }, '+el', null)) return;
    } else {
      if (!await tryFilter({ fuel: true }, `+${vegData.fuel}`, null)) return;
    }
    if (!await tryFilter({ drive: true }, `+${vegData.drive}`, null)) return;
    if (!await tryFilter({ body: bodyType || undefined }, `+${vegData.karosseri || 'karosseri'}`, !bodyType ? 'ingen karosseri-mapping' : null)) return;
    if (_search && _search.hk) {
      if (!await tryFilter({ hk: true }, `+${_search.hk} hk +/-15%`, null)) return;
    } else if (isFossil) {
      await tryFilter({ kw: true }, `+${vegData.kw} kW +/-15%`, null);
    } else {
      funnelSteps.push({
        label: isEv ? '+kW hoppet over (EV: rekkevidde, ikke hk)' : '+kW hoppet over (hybrid uten hk i ID)',
        treff: totalCount,
        stopp: false,
        skipped: true,
        skipReason: propulsion,
      });
    }
  })();

  // Marker siste aktive steg som stopp-punkt
  const lastActive = [...funnelSteps].reverse().find(s => !s.skipped);
  if (lastActive && !lastActive.stopp) lastActive.stopp = true;

  // km-proksimitet pa final pool
  let finalPool = lastGoodComps;
  for (const band of [kmBand, kmBand * 1.5, kmBand * 2, 999999]) {
    const f = lastGoodComps.filter(c => Math.abs(c.km - (bil.mileage || 0)) <= band);
    if (f.length >= 3) { finalPool = f; log(`Finn: km-band ${Math.round(band)} gir ${f.length} comps`); break; }
  }
  // Kode-gate i origin-comps kaster det som ikke matcher ID. AI-filter kun uten låst ID.
  if (!_search && finalPool.length >= 2) {
    try {
      const _aiCompFilter = require('./ai-finn-comp-filter');
      const _filterResult = await _aiCompFilter.filterComps(bil, vegData, finalPool);
      if (_filterResult && Array.isArray(_filterResult.keep) && _filterResult.keep.length >= 1) {
        const _newPool = _filterResult.keep.map(function(i) { return finalPool[i]; }).filter(Boolean);
        if (_newPool.length >= 1) {
          const keptIdx = new Set(_filterResult.keep);
          if (_newPool.length < 3 && finalPool.length > _newPool.length) {
            for (let i = 0; i < finalPool.length && _newPool.length < 3; i++) {
              if (!keptIdx.has(i)) _newPool.push(finalPool[i]);
            }
            log('[finn-ai-filter] gulv 3: fylte til ' + _newPool.length + ' av ' + finalPool.length);
          }
          log('[finn-ai-filter] beholdt ' + _newPool.length + '/' + finalPool.length + ' comps. Ekskludert: ' + JSON.stringify(_filterResult.excluded));
          finalPool = _newPool;
        }
      }
    } catch (e) { logErr('AI-finn-comp-filter', e); }
  }
  finalPool.sort((a, b) => a.price - b.price);
  log(`Finn: endelig pool = ${finalPool.length} biler | URL=${lastGoodUrl}`);
  // v20.99: totalCount og finnUrl reflekterer FINAL pool (etter AI-filter)
  totalCount = finalPool.length;
  const _finalFinnUrl = (finalPool.length === 1 && finalPool[0] && finalPool[0].link) ? finalPool[0].link : lastGoodUrl;
  return { pool: finalPool, finnUrl: _finalFinnUrl, totalCount, seg, funnelSteps };
}


async function checkFinnListing(regnr, bil, page) {
  try {
    const { findFinnOrigin } = require('./finn-origin.js');
    const origin = await findFinnOrigin(regnr, {
      vin: (bil && (bil.vin || bil.chassis_number)) || null,
      valuation: bil && bil.carInfo && bil.carInfo.valuation,
      erpId: (bil && (bil.id || bil.erpId)) || null,
    });
    if (origin && origin.link) {
      log('Finn: ' + regnr + ' origin ' + origin.source + ' ' + (origin.price || '?') + ' kr ' + origin.link);
      return origin;
    }
  } catch (eFo) { logErr('checkFinnListing http ' + regnr, eFo); }
  try {
    if (!page) return null;
    await page.goto(
      `https://www.finn.no/mobility/search/car?q=${regnr}&registration_class=1`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => {
      const articles = Array.from(document.querySelectorAll('article'));
      if (articles.length !== 1) return { n: articles.length };
      const a = articles[0];
      const text = a.innerText || '';
      const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g, '')) || 0;
      const link = a.querySelector('a')?.href || '';
      const soldM = text.match(/solgt/i);
      return link ? { price: price || 0, link, status: soldM ? 'Solgt' : 'Til salgs', n: 1 } : { n: 1 };
    });
    if (result && result.link) {
      log('Finn: ' + regnr + ' origin playwright 1 treff ' + result.price + ' kr');
      return result;
    }
    log('Finn: ' + regnr + ' ingen origin (playwright n=' + ((result && result.n) || 0) + ')');
    return null;
  } catch (e) { logErr(`checkFinnListing ${regnr}`, e); return null; }
}

// ── Brreg ─────────────────────────────────────────────────────
async function checkBrreg(regnr, page) {
  try {
    await page.goto(
      `https://rettsstiftelser.brreg.no/nb/oppslag/motorvogn/${regnr.replace(/\s/g, '')}`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    if (text.toLowerCase().includes('ingen oppf'))
      return { anyDebts: false, text: 'Ingen heftelser' };
    if (text.includes('heftelse') || text.includes('pant') || text.includes('registrert'))
      return { anyDebts: true, text: 'Heftelser registrert - sjekk manuelt' };
    return { anyDebts: false, text: 'Ingen heftelser' };
  } catch (e) {
    logErr(`checkBrreg ${regnr}`, e);
    return { anyDebts: false, text: 'Kunne ikke sjekke heftelser' };
  }
}

// ── Anker-valg (ny ak-logikk — ingen Haiku) ──────────────────
// Anker = snitt av 5 billigste i poolen (eller snitt av alle hvis < 5).
// Ingen outlier-fjerning — Finn-filteret er godt nok.
// Begge designvalg gjenspeiler at selger ser hoy-til-lav, dealer ser gulvet.
// Ankeret er mellom gulv og midtpunkt i markedet.
// CA-02: snitt av 3 billigste (ikke 5), take returnert i objekt

// v19.30: AI velger 5 best-matchede komper basert paa origin
async function getAnchorAi(pool, seg, bil, vegData) {
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) { log('v30: ingen ANTHROPIC_API_KEY'); return null; }
  if (!pool || pool.length < 5) { log('v30: pool=' + (pool?pool.length:0) + ', fallback'); return null; }
  try {
    const ci = bil.carInfo || {};
    const origin = {
      brand: ci.brand || vegData.make,
      series: ci.series || bil.model_series,
      car_name: ci.car_name || '',
      engine: ci.engine || '',
      trim_package: ci.trim_package || bil.pakke || '',
      year: ci.model_year || bil.model_year,
      km: bil.mileage || 0,
      hp: vegData.kw ? Math.round(vegData.kw * 1.36) : null,
      fuel: vegData.fuel,
      drive: vegData.drive,
      rekkevidde_wltp: bil.elbRekkevidde || vegData.range || null,
      kw: vegData.kw || null,
      egenvekt: bil.egenvekt || null,
      toppfart: bil.toppfart || null,
      motoreffekt_kw: bil.motorEffekt || null
    };
    const lines = pool.map(function(c, i) {
      return (i+1) + '. ' + JSON.stringify({title:c.title||c.heading||'', price:c.price, year:c.year, km:c.km, fuel:c.fuel, hp:c.hp||c.power, drive:c.drive||c.wheelDrive});
    });
    const prop = vegData.propulsion || (vegData.isHybrid ? 'HYBRID' : ((vegData.fuel || '').toLowerCase().includes('elektr') ? 'EV' : 'FOSSIL'));
    const propRule = prop === 'FOSSIL'
      ? 'FOSSIL: effekt (hk/kW-baand) ER viktig — ikke bland 239 hk med 290 hk.'
      : (prop === 'EV'
        ? 'EV: rekkevidde/kWh styrer, ikke hk. Ikke forkast pga hk-avvik.'
        : 'HYBRID/PHEV: drivlinje (2WD/4WD) og hybrid vs bensin/diesel er hardt filter. Hk er IKKE viktig (Vegvesen-hk er ofte bare forbrenning; system-hk paa comps matcher ikke).');
    const prompt = 'Du er ekspert paa bruktbil-prising. Velg de 5 BEST sammenlignbare komp-bilene mot origin. Maalet er aa finne SOESTERBILEN. Propulsion=' + prop + '. ' + propRule + ' Vurder HELHETEN: motorfamilie, drivlinje, utstyrspakke, km naer origin, aarstall. Returner KUN et JSON-array med 5 valgte (1-indeksert): [{"i":N,"why":"kort"}]. ORIGIN:\n' + JSON.stringify(origin) + '\n\nKANDIDATER:\n' + lines.join('\n');
    const ctrl = new AbortController();
    const t = setTimeout(function() { ctrl.abort(); }, 12000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: {'Content-Type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'claude-sonnet-4-5', max_tokens:600, messages:[{role:'user',content:prompt}]})
    });
    clearTimeout(t);
    const j = await r.json();
    if (j.error) { log('v30 AI feil: ' + j.error.message); return null; }
    const txt = (j.content && j.content[0] && j.content[0].text || '').trim();
    const mm = txt.match(/\[[\s\S]*\]/);
    if (!mm) { log('v30 AI: ikke JSON'); return null; }
    const picks = JSON.parse(mm[0]);
    const valgte = picks.map(function(p) { return pool[(p.i||0)-1]; }).filter(Boolean);
    if (valgte.length < 3) { log('v30 AI: <3 valgte, fallback'); return null; }
    const anchorPrice = Math.round(valgte.reduce(function(s,c){return s+c.price;},0) / valgte.length / 1000) * 1000;
    const anchorIndices = valgte.map(function(c) { return pool.slice(0,30).findIndex(function(t){return t.price===c.price && t.km===c.km;}); }).filter(function(i){return i>=0;});
    const avgKm = Math.round(valgte.reduce(function(s,c){return s+(c.km||0);},0) / valgte.length);
    log('v30 AI Anker: ' + anchorPrice + ' kr (snitt ' + valgte.length + ' AI-valgte, avg km=' + avgKm + ' vs origin=' + (bil.mileage||0) + ')');
    return { price: anchorPrice, take: valgte.length, anchorIndices: anchorIndices, outliers: [], reason: 'v30: AI valgte ' + valgte.length + ' best-matchede (snitt km=' + avgKm + ')', aiPicks: picks };
  } catch (e) {
    log('v30 AI exception: ' + e.message);
    return null;
  }
}

function getAnchor(pool, seg) {
  const sorted = [...pool].sort((a, b) => a.price - b.price);
  const take   = Math.min(5, sorted.length); // 26.5: 3 -> 5 billigste
  const cheapest = sorted.slice(0, take);
  const anchorPrice = Math.round(
    cheapest.reduce((s, c) => s + c.price, 0) / take / 1000
  ) * 1000;

  const anchorIndices = cheapest
    .map(c => pool.slice(0, 5).findIndex(t => t.price === c.price && t.km === c.km))
    .filter(i => i >= 0);

  const reason = take < pool.length
    ? `Anker = snitt av ${take} billigste i filtert pool (${pool.length} comps). Segment: ${seg.label}.`
    : `Anker = snitt av alle ${take} comps (liten pool). Segment: ${seg.label}.`;

  log(`Anker: ${anchorPrice} kr (snitt av ${take} billigste) | ${seg.label}`);
  return { price: anchorPrice, take, anchorIndices, outliers: [], reason };
}

// ── Dynamisk xPct fra Pulse ───────────────────────────────────
let _brackets = null;

async function fetchBrackets() {
  try {
    const res = await fetch(`${CONFIG.bracketsUrl}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _brackets = await res.json();
    log('Brackets: lastet fra Pulse');
  } catch (e) {
    logErr('fetchBrackets: bruker PDEC1 fallback', e);
    _brackets = null;
  }
}

function getRecX(dMid) {
  const b = _brackets;
  if (dMid <= 100000) return { xPct: b?.lav        ?? CONFIG.pdec1.lav,     bracket: 'Lav' };
  if (dMid <= 250000) return { xPct: b?.mid        ?? CONFIG.pdec1.mid,     bracket: 'Mid' };
  if (dMid <= 400000) return { xPct: b?.hoy        ?? CONFIG.pdec1.hoy,     bracket: 'Hoy' };
  if (dMid <= 600000) return { xPct: b?.premiumLav ?? b?.premium ?? CONFIG.pdec1.premium, bracket: 'Premium-Lav' };
  return               { xPct: b?.premiumHoy ?? b?.premium ?? CONFIG.pdec1.premium, bracket: 'Premium-Hoy' };
}

// ── Prisformel — MARGIN_TABLE uendret fra aj ──────────────────
// Ny: segment-spesifikk spread pa D lav/hoy
// Bygger KALKYLE-blokk i samme format som hovedkortet. Brukt av Endre anker.
function formatKalkyleBlock(val, anker) {
  return ['KALKYLE'].concat(formatEasyTableLines(anker, val, '   ')).join('\n');
}

function formatEasyTableLines(anker, val, sp) {
  sp = sp || '   ';
  const nf = (n) => (n == null || n === '' || Number.isNaN(Number(n))) ? '?' : Math.round(Number(n)).toLocaleString('nb-NO');
  const a = Number(anker);
  const bd = (val && val.breakdown) || {};
  const feeLav = bd.feeLav != null ? bd.feeLav : bd.fee;
  const feeHoy = bd.feeHoy != null ? bd.feeHoy : bd.fee;
  return [
    sp + 'Finn-pris:       ' + nf(a) + ' kr',
    sp + 'Margin 8 %:      \u2212' + nf(bd.margin) + ' kr',
    sp + 'Omreg:           \u2212' + nf(bd.omreg) + ' kr',
    sp + 'Klargj\u00f8ring:     \u2212' + nf(bd.klargjoring) + ' kr',
    sp + 'P\u00e5kost:          \u2212' + nf(bd.paakostHoy) + ' kr',
    sp + 'T (bud):         ' + nf(bd.budLav) + ' \u2013 ' + nf(bd.budHoy) + ' kr',
    sp + 'Peasy-fee:       \u2212' + nf(feeLav) + ' / \u2212' + nf(feeHoy) + ' kr',
    sp + 'E Lav:           ' + nf(val && val.dLav) + ' kr',
    sp + 'E H\u00f8y:           ' + nf(val && val.dHoy) + ' kr',
  ];
}

// v20.88: segmentModifier styrer margin-storrelse per bil-segment.
// Konservativ (>1.0) for tap-magneter: mindre attraktiv eval -> filtrerer urealistiske kunder.
// Aggressiv (<1.0) for solide segmenter: mer attraktiv eval -> flere aksepterer.
function segmentModifier(ctx) {
  const year  = Number(ctx && ctx.year)  || 0;
  const km    = Number(ctx && ctx.km)    || 0;
  const anker = Number(ctx && ctx.anker) || 0;
  // v20.90: merke-noytralt + rule-tekst for KALKYLE-boks.
  if (anker > 500000)                               return { mult: 1.58, tag: 'konservativ', rule: 'anker > 500 000 kr' };
  if (year >= 2023 && km > 0 && km < 50000)         return { mult: 1.58, tag: 'konservativ', rule: 'nybilaktig (2023+ og km < 50k)' };
  if (year >= 2010 && year <= 2014 && km >= 100000) return { mult: 0.67, tag: 'aggressiv', rule: 'sweet-spot (2010-14 og km >= 100k)' };
  return { mult: 1.00, tag: 'standard', rule: 'ingen regel treffer' };
}

// Easy kostnadsmodell v7 — forhandler-perspektiv med skalert påkost + T/E.
// T = brutto bud, E = kunde-netto etter Peasy-fee.
const EASY_COST = {
  marginPct: 0.08,        // 8% brutto av Finn
  minMargin: 8000,        // absolutt min margin i kr
  klargjoring: 5000,      // forhandlers klargjøring til videresalg
  paakostPct: 0.15,       // påkost høy = 15% × Finn (skalert)
  paakostCap: 30000,      // absolutt tak for påkost
  vrakpantGulv: 3000,     // E aldri under dette
  minSpread: 5000,        // Høy − Lav ≥ 5 000
};

// Peasy-fee på faktisk bud T (fra peasy.no vilkår)
function peasyFee(bud) {
  if (bud <= 35000)  return 5900;
  if (bud <= 75000)  return 8900;
  if (bud <= 150000) return 9900;
  return 11900;
}

// Skatteetaten omreg 2026 (personbil × alder × egenvekt / varebil × alder)
function omreg(bilInfo) {
  const year = (bilInfo && bilInfo.year) || 2020;
  const vekt = (bilInfo && bilInfo.egenvekt) || 1500;
  const isVarebil = !!(bilInfo && (bilInfo.isVarebil === true || /varebil|lastebil|kombinert|campingbil/i.test(bilInfo.biltype || '')));
  if (isVarebil) {
    if (year >= 2023) return 2459;
    if (year >= 2015) return 1553;
    return 1296;
  }
  if (vekt <= 1200) {
    if (year >= 2023) return 4918;
    if (year >= 2015) return 3236;
    return 1942;
  }
  if (year >= 2023) return 7505;
  if (year >= 2015) return 4532;
  return 1942;
}

function easyKalkyle(anker, bilInfo) {
  const M = EASY_COST;
  const a = Number(anker);
  const margin = Math.max(M.minMargin, Math.round(a * M.marginPct));
  const omregKr = omreg(bilInfo || {});
  const paakostHoy = Math.min(M.paakostCap, a * M.paakostPct);

  // Forhandler-bud T: beste-fall (påkost 0) og verste-fall (påkost høy)
  const budHoy = a - margin - omregKr - M.klargjoring;              // Bud Høy (T)
  const budLav = a - margin - omregKr - M.klargjoring - paakostHoy; // Bud Lav (T)

  // Peasy-fee slås opp på hver av budene (klasser kan flippe)
  const feeHoy = peasyFee(budHoy);
  const feeLav = peasyFee(budLav);

  // E = kunde-netto etter Peasy-fee; vrakpant-gulv bare løft
  let dLav = budLav - feeLav;
  let dHoy = budHoy - feeHoy;
  if (!(dHoy > dLav)) dHoy = dLav + M.minSpread;
  const preLav = dLav, preHoy = dHoy;
  dLav = Math.max(dLav, 3000);
  dHoy = Math.max(dHoy, dLav + 2000, 5000);
  const vrakpant = dLav !== preLav || dHoy !== preHoy;

  return {
    dLav: Math.round(dLav / 1000) * 1000,
    dHoy: Math.round(dHoy / 1000) * 1000,
    model: 'easy-cost-v7',
    vrakpant,
    breakdown: {
      margin, omreg: omregKr, klargjoring: M.klargjoring, paakostHoy,
      budHoy, budLav, feeHoy, feeLav, fee: feeHoy
    }
  };
}

function calcValuation(anchorPrice, segment, pool, bilContext) {
  const anker = Math.round(Number(anchorPrice) / 1000) * 1000;
  const ctx = bilContext || {};
  let year = Number(ctx.year || ctx.firstRegYear) || 0;
  let egenvekt = Number(String(ctx.egenvekt == null ? '' : ctx.egenvekt).replace(/[^\d.]/g, ''));
  const isVarebil = !!(ctx.isVarebil || /varebil/i.test(ctx.avgiftsgruppe || ctx.biltype || ''));
  if (!year) {
    year = 2020;
    log('[easy-cost-v7] fallback år=2020' + (ctx.regnr ? ' ' + ctx.regnr : ''));
  }
  if (!Number.isFinite(egenvekt) || egenvekt <= 0) {
    egenvekt = 1500;
    log('[easy-cost-v7] fallback egenvekt=1500' + (ctx.regnr ? ' ' + ctx.regnr : ''));
  }
  const ek = easyKalkyle(anker, { year, egenvekt, isVarebil, biltype: ctx.biltype || ctx.avgiftsgruppe });
  const dLav = ek.dLav;
  let dHoy = ek.dHoy;
  if (Number.isFinite(anker) && dHoy > anker) dHoy = anker;
  if (!(dHoy > dLav)) dHoy = dLav + 5000;
  const expected = dLav;
  const spread = dHoy - dLav;
  const { xPct, bracket } = getRecX(anker);
  const E = Math.round(dLav * (1 + xPct) / 1000) * 1000;
  const auctionTypeId = dLav <= 35000 ? 2 : 1;
  const bd = ek.breakdown || {};
  const reg = ctx.regnr;
  log('Kalkyle [easy-cost-v7, bare sammenligning — ERP får fossefallet] [' + (segment || '') + ']: anker=' + anker + ' margin=' + bd.margin + ' omreg=' + bd.omreg + ' klarg=' + bd.klargjoring + ' paakost=' + bd.paakostHoy + ' T=' + Math.round(bd.budLav) + '-' + Math.round(bd.budHoy) + ' fee=' + bd.feeLav + '/' + bd.feeHoy + ' dLav=' + dLav + ' dHoy=' + dHoy + ' E=' + E + ' (' + bracket + ')' + (ek.vrakpant ? ' vrakpant' : '') + (reg ? ' ' + reg : ''));
  return {
    T: expected, t88: expected, minMarginUsed: false, margin: bd.margin, fee: (bd.feeHoy != null ? bd.feeHoy : bd.fee), dMid: expected,
    dLav, dHoy, E, xPct, bracket, auctionTypeId, spreadPct: anker ? spread / anker : 0, spread,
    compCapApplied: false, compCapFlag: null, lowestComp: null,
    model: 'easy-cost-v7', vrakpant: ek.vrakpant, breakdown: bd,
    segMod: { tag: 'kostnad', rule: 'easy-cost-v7' },
  };
}

// ── Formater eval-kort ────────────────────────────────────────
// Identisk med aj, men legger til segment + confidence-linje
function buildManualCard(regnr, erpId, bil, vegData, reason) {
  const make = (vegData && vegData.make) || (bil && bil.make) || '';
  const model = (bil && bil.model_series) || (vegData && vegData.model) || '';
  const yearV = (bil && bil.model_year) || (vegData && vegData.firstRegYear) || 0;
  const hkV = (bil && bil.hk) || (vegData && vegData.hk) || null;
  const vektV = (bil && bil.egenvekt) || null;
  const kmV = (bil && bil.mileage) || 0;
  const fuelV = (vegData && vegData.fuel) || '';
  let finnUrl = '';
  try { finnUrl = buildFinnUrl(make, model, yearV ? yearV-1 : 0, yearV ? yearV+1 : 0, vegData || {}, {}); } catch(e) { finnUrl=''; }
  let t = '❗ ' + regnr + ': MANUELL PRISING (' + (reason||'ingen anker') + ')\n';
  t += (make + ' ' + model).trim() + (yearV ? ' ' + yearV : '') + '\n';
  const parts = [];
  if (hkV) parts.push(hkV + ' hk');
  if (vektV) parts.push(vektV + ' kg');
  if (kmV) parts.push(kmV.toLocaleString('nb-NO') + ' km');
  if (fuelV) parts.push(fuelV);
  if (parts.length) t += parts.join(' | ') + '\n';
  if (finnUrl) t += '\n<a href="' + finnUrl + '">Åpne Finn-søk</a>';
  const kb = { inline_keyboard: [[{ text: '✅ Send eval', callback_data: 'confirm:' + erpId }, { text: '✏️ Endre anker', callback_data: 'editanchor:' + erpId }, { text: '🗑 Slett cache', callback_data: 'delcache:' + erpId }]] };
  return { text: t, kb: kb };
}

function formatEvalCard(p, forErp = false) {
  const source = (p.bil.source || '').toLowerCase() === 'driveno' ? 'DRIVE' : ((p.bil.source || '').toLowerCase() === 'ordna' ? 'ORDNA' : 'PEASY');
  const qaTag = p.qaOverride ? ' \u26a1 QA OVERRIDE' : '';
  const scopeGate = p.utenforScope || p.biltypeGate;
  const scopeBanner = (scopeGate && scopeGate.utenfor_scope)
    ? scopeHeadline(scopeGate)
    : '';
  // v20.70: km-override-linje (vises kun n\u00e5r oppgitt km ble overstyrt av EU-kontroll)
  const kmOverrideLine = p.kmOverride
    ? `\ud83d\udd04 Km endret: ${(p.kmOverride.from || 0).toLocaleString('nb-NO')} \u2192 ${(p.kmOverride.to || 0).toLocaleString('nb-NO')} (EU-kontroll)`
    : null;
  const seg = p.seg || {};
  const val = p.valuation || {};
  const isEl = (p.vegData.fuel || '').toLowerCase().includes('elektr');
  const hkStr = isEl
    ? (p.vegData.range ? `${p.vegData.range} km rekkevidde` : `${p.vegData.kw} kW`)
    : `${p.vegData.hk} hk`;

  // Bilinfo-linje
  const carLine = [
    p.bil.registration_number,
    `${p.vegData.make} ${p.bil.model_series || ''} ${p.bil.model_year || ''}`.trim(),
    `${(p.bil.mileage || 0).toLocaleString('nb-NO')} km | ${p.seg?.kmPerYear ? p.seg.kmPerYear.toLocaleString('nb-NO') + ' km/år' : ''}`,
    p.vegData.fuel, p.vegData.gearbox, p.vegData.drive, hkStr,
    p.vegData.karosseri || '', p.bil.karosseri_erp || '', (p.vegData.avgiftsgruppe || '').includes('Personbil') ? 'Personbil' : (p.vegData.avgiftsgruppe || '').toLowerCase().toLowerCase().includes('varebil') ? 'Varebil' : (p.vegData.avgiftsgruppe || ''),
    (p.imageCount && p.imageCount > 0) ? `🖼️ ${p.imageCount}` : '',
  ].filter(Boolean).join(' | ');
  // PEASY: Bilmodell-blokk fra elbilradar (pakke + utstyr)
  // PEASY: Bilmodell-blokk (alltid synlig, beriket fra Vegvesen + elbilradar)
  const _modelDisp = p.bil.modelFull || (((p.vegData.make || "") + " " + (p.vegData.model || "")).trim());
  const _hkVal = p.vegData.hk || Math.round((p.vegData.kw || 0) * 1.36) || 0;
  const _rangeVal = p.vegData.range || 0;
  const _yearVal = p.bil.model_year || p.vegData.firstRegYear || "";
  const _bmL1 = _modelDisp + (_hkVal ? " · " + _hkVal + " hk" : "") + (_rangeVal ? " · " + _rangeVal + " km rekkevidde" : "") + (_yearVal ? " · " + _yearVal : "");
  const _bmL2 = [p.vegData.fuel, p.vegData.gearbox, p.vegData.drive, p.vegData.karosseri].filter(Boolean).join(" · ");
  const _bmL3 = (p.bil.equipment && p.bil.equipment.length) ? p.bil.equipment.join(" · ") : "";
  const _bmL4parts = [];
  if (p.bil.farge) _bmL4parts.push("Farge: " + p.bil.farge);
  if (p.bil.batteri) _bmL4parts.push("Batteri: " + p.bil.batteri);
  if (p.bil.eiere) _bmL4parts.push("Eiere: " + p.bil.eiere);
  if (p.bil.bruktimportertFra) _bmL4parts.push("Bruktimport fra: " + p.bil.bruktimportertFra);
  if (p.bil.produksjonssted) _bmL4parts.push("Produksjon: " + p.bil.produksjonssted);
  if (p.bil.motorEffekt && !p.bil.batteri) _bmL4parts.push("Motor: " + p.bil.motorEffekt);
  if (p.bil.forbruk) _bmL4parts.push("Forbruk: " + p.bil.forbruk);
  if (p.bil.seter) _bmL4parts.push(p.bil.seter + " seter");
  if (p.bil.vin) _bmL4parts.push("VIN: " + p.bil.vin);
  const _bmL4 = _bmL4parts.join(" · ");
  const _bmL5 = p.bil.finnAdSummary ? ("📎 Tidl. Finn-annonse: " + p.bil.finnAdSummary) : "";
  const _bmL6 = p.bil.elbilradarFinnId ? ("🔗 https://www.finn.no/mobility/item/" + p.bil.elbilradarFinnId) : "";
  const bilmodellBlokk = p.bil.cv_text ? ("🚗 Bilmodell\n" + p.bil.cv_text) : ["🚗 Bilmodell", _bmL1, _bmL2, _bmL3, _bmL4, _bmL5, _bmL6].filter(Boolean).join("\n");

  // Segment-blokk
  const segSpread = val.spreadPct ? `\xb1${(val.spreadPct * 100).toFixed(1)}%` : '?';
  const segKmBand = seg.kmBand || 50000;
  const bracketLabel = val.bracket || '?';
  const segLine = [
    `Prisklasse: ${bracketLabel} (anker ${p.anchor?.price ? Math.round(p.anchor.price / 1000) + 'k' : '?'})`,
  ].filter(Boolean).join(' | ');
  const finnSokLine = `   Finn-søk: ${p.vegData.fuel} | ${(p.bil.carInfo && p.bil.carInfo.model_year) || p.bil.model_year || ''} | fra ${Math.max(0,(p.bil.mileage||0)-segKmBand).toLocaleString('nb-NO')} – maks ${((p.bil.mileage || 0) + segKmBand).toLocaleString('nb-NO')} km | Spread: ${segSpread} per side`;

  // CA-04: fix prevLine — bruker e.dato + e.dLavHoy
  const prevLine = p.prevEvals && p.prevEvals.length > 0
    ? `\ud83d\udd01 Tidligere registrert: ${p.prevEvals.map(e => `${e.dato}${e.dLavHoy ? ' (' + e.dLavHoy + ')' : ''}`).join(', ')}`
    : '\u2014 Ikke tidligere registrert';

  // CA-06: funnelSteps i eval-kort — riktig steg-prefix
  const funnelLines = (() => {
    const steps = p.funnelSteps || [];
    const has1b = steps.length > 1 && steps[1].label.startsWith('ar +-1');
    return steps.map((s, i) => {
      const steppMark = s.stopp && !s.skipped ? ' \u2713 stopp'
        : s.skipped ? ` \u23e9 (${s.skipReason || 'hoppet over'})` : '';
      let prefix;
      if (i === 0) prefix = 'Steg 1';
      else if (i === 1 && has1b) prefix = '  1b';
      else {
        const fi = has1b ? i - 2 : i - 1;
        prefix = '  2' + (['a','b','c','d','e'][fi] || String(fi+1));
      }
      return '   ' + prefix + '  ' + s.label + ' \u2192 ' + s.treff + ' treff' + steppMark;
    }).join('\n');
  })();

  // Comps
  // FIX v2: top brukes lenger ned (modellmix), behold den. Display og snitt bruker valgteComps.
  const top = (p.pool || []).slice(0, 5);
  const pool = p.pool || [];
  const idx = p.anchor?.anchorIndices || [];
  const valgteComps = idx.length ? idx.map(i => pool[i]).filter(Boolean) : top.slice(0, Math.min(3, top.length));
  const take = valgteComps.length;
  const compLines = valgteComps.map((c, i) => {
    return `   \u25b6 ${i + 1}. ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year}`;
  }).join('\n');
  const ankerSnittPris = take ? Math.round(valgteComps.reduce((s,c) => s + (c.price||0), 0) / take) : 0;
  const avgKm = take ? Math.round(valgteComps.reduce((s,c) => s + (c.km||0), 0) / take) : 0;
  const ankerLine = `   (Anker = snitt ${take} valgte: ${ankerSnittPris.toLocaleString('nb-NO')} kr | snitt ${avgKm.toLocaleString('nb-NO')} km)`;

  // Modell-mix i comps
  const topModelsForMix = {};
  top.forEach(c => {
    const m = (c.heading || '').replace(/^\S+\s+/,'').replace(/\s+\d{4}.*$/,'').trim() || 'Ukjent';
    topModelsForMix[m] = (topModelsForMix[m] || 0) + 1;
  });
  const modelEntries = Object.entries(topModelsForMix).sort((a,b) => b[1]-a[1]);
  const modelMix = modelEntries.map(([m,n]) => `${m} (${n})`).join(', ');
  const modelMixLine = modelEntries.length > 1
    ? `⚠️ Blandet i utvalg: ${modelMix}`
    : `✅ Modell: ${modelMix}`;

  // Sjekk om fremmede modeller er i comp-utvalget (top)
  const topModels = {};
  top.forEach(c => {
    const m = (c.heading || '').replace(/^\S+\s+/,'').replace(/\s+\d{4}.*$/,'').trim() || 'Ukjent';
    topModels[m] = (topModels[m] || 0) + 1;
  });
  const topModelEntries = Object.entries(topModels).sort((a,b) => b[1]-a[1]);
  const topMixLine = topModelEntries.length > 1
    ? `⚠️ Fremmed modell i utvalg: ${topModelEntries.map(([m,n]) => `${m} (${n})`).join(', ')}`
    : null;

  // Kalkyle-forklaring
  const marginPct = val.margin && p.anchor?.price ? (val.margin / p.anchor.price * 100).toFixed(1) : '?';
  const kalkyleBox = [
    `   Prisklasse ${bracketLabel} (anker ${p.anchor?.price ? Math.round(p.anchor.price / 1000) + 'k' : '?'}) \u2192 margin maks ${val.margin?.toLocaleString('nb-NO') || '?'} kr`,
    `   Est T = D lav \u00d7 (1 + recX ${bracketLabel}) = ${val.xPct !== undefined ? (val.xPct >= 0 ? '+' : '') + (val.xPct * 100).toFixed(1) + '%' : '?'}`,
  ].join('\n');

  const estimert = `   ${val.dLav?.toLocaleString('nb-NO') || '?'} \u2013 ${val.dHoy?.toLocaleString('nb-NO') || '?'} kr (${segSpread} ${seg.label || ''})`;
  const estT = `   Est T: ~${val.E?.toLocaleString('nb-NO') || '?'} kr (${val.xPct !== undefined ? (val.xPct >= 0 ? '+' : '') + (val.xPct * 100).toFixed(1) : '?'}% fra Pulse ${bracketLabel})`;

  // Finn-annonse
  const finnAnn = p.finnListing
    ? `   ${p.finnListing.price.toLocaleString('nb-NO')} kr (${p.finnListing.price - (p.anchor?.price || 0) > 0 ? '+' : ''}${(p.finnListing.price - (p.anchor?.price || 0)).toLocaleString('nb-NO')} kr vs anker)${p.finnListing.link ? ' | ' + p.finnListing.link : ''}`
    : '   Ikke funnet pa Finn';

  // ERP
  const _skipErp = p.erpSkipBy || null;
  const erpLines = [
    p.erpWritten ? '✅ D lav/hoy skrevet' : (_skipErp ? ('ERP: skrives av ' + _skipErp) : '❌ D lav/hoy FEILET'),
    p.erpWritten ? '✅ Auction type satt' : (_skipErp ? ('ERP: skrives av ' + _skipErp) : '❌ Auction type ikke satt'),
    '✅ Heftelser kontrollert',
    p.brreg?.anyDebts ? '✅ Finans? satt (heftelser funnet)' : '— Finans? ikke aktuelt',
    '✅ Eiere toglet',
    p.erpWritten ? '✅ Lagre data klikket' : (_skipErp ? ('ERP: skrives av ' + _skipErp) : '❌ Lagre data ikke klikket'),
    p.chatPosted ? '✅ Eval-kort postet til kommentar' : '— Chat: allerede postet',
  ].join('\n');

  const finnSokHeader = forErp
    ? `FINN-SOK ${p.vegData.fuel} | ${(p.bil.carInfo && p.bil.carInfo.model_year) || p.bil.model_year || ''} | ${p.totalCount} treff | ${p.finnUrl}`
    : `<b>FINN-SOK</b> ${p.vegData.fuel} | ${(p.bil.carInfo && p.bil.carInfo.model_year) || p.bil.model_year || ''} | ${p.totalCount} treff | <a href="${p.finnUrl}">Apne sok</a>`;

  const kalkyleCompact = forErp
    ? [
        ...formatEasyTableLines(p.anchor?.price, val, '   '),
      ].join('\n')
    : `<code>${formatEasyTableLines(p.anchor?.price, val, '').join('\n')}</code>`;

  const finnAnnDisplay = p.finnListing
    ? (forErp
        ? `   ${p.finnListing.price.toLocaleString('nb-NO')} kr (${p.finnListing.price - (p.anchor?.price || 0) > 0 ? '+' : ''}${(p.finnListing.price - (p.anchor?.price || 0)).toLocaleString('nb-NO')} kr vs anker)`
        : `   ${p.finnListing.price.toLocaleString('nb-NO')} kr <i>(${p.finnListing.price - (p.anchor?.price || 0) > 0 ? '+' : ''}${(p.finnListing.price - (p.anchor?.price || 0)).toLocaleString('nb-NO')} kr vs anker)</i>${p.finnListing.link ? ` | <a href="${p.finnListing.link}">Åpne annonse</a>` : ""}`)
    : '   Ikke funnet pa Finn';

  // CA-07: bygg lines med funnelLines etter finnSokHeader
  const lines = forErp ? [
    `${source} BIL TIL ESTIMERING${qaTag}`,
    ...(scopeBanner ? [scopeBanner, ''] : []),
    carLine,
    ...(kmOverrideLine ? [kmOverrideLine] : []),
    '',
    ...(bilmodellBlokk ? [bilmodellBlokk, ''] : []),
    segLine, finnSokLine, prevLine, '',
    `FINN-SOK ${p.vegData.fuel} | ${(p.bil.carInfo && p.bil.carInfo.model_year) || p.bil.model_year || ''} | ${p.totalCount} treff | ${p.finnUrl}`,
    ...(funnelLines ? [funnelLines] : []),
    compLines, ankerLine, modelMixLine, '',
    'KALKYLE', kalkyleCompact, '',
    'FINN-ANNONSE', finnAnnDisplay, '',
    'HEFTELSER', `   ${p.brreg?.text || 'Ingen heftelser'}`, '',
    ...(p.bil.id ? ['SELGERKOMMENTAR', '   ' + (p.sdComment || ''), ''] : []),
    ...(p.bil.id ? ['ERP', erpLines] : []),
    '',
    `--- Priset av peasy-auto ${BOT_STAMP()} ---`,
  ] : [
    `<b>${source} BIL TIL ESTIMERING${qaTag}</b>`,
    ...(scopeBanner ? [`<b>${scopeBanner}</b>`, ''] : []),
    `<i>${carLine}</i>`,
    ...(kmOverrideLine ? [kmOverrideLine] : []),
    '',
    ...(bilmodellBlokk ? [bilmodellBlokk, ''] : []),
    `<b>Finn-søk:</b> ${p.vegData.fuel} | ${(p.bil.carInfo && p.bil.carInfo.model_year) || p.bil.model_year || ''} | fra ${Math.max(0,(p.bil.mileage||0)-segKmBand).toLocaleString('nb-NO')} – maks ${((p.bil.mileage || 0) + segKmBand).toLocaleString('nb-NO')} km | spread ${segSpread}`,
    prevLine, '',
    finnSokHeader,
    ...(funnelLines ? [funnelLines] : []),
    compLines, ankerLine, modelMixLine, '',
    '<b>KALKYLE</b>', kalkyleCompact, '',
    '<b>FINN-ANNONSE</b>', finnAnnDisplay, '',
    `<b>HEFTELSER</b>   ${p.brreg?.text || 'Ingen heftelser'}`,
    ...(p.bil.id ? ['<b>SELGERKOMMENTAR</b>   ' + (p.sdComment || '—'), ''] : []),
    ...(p.bil.id ? ['<b>ERP</b>', erpLines] : []),
    '',
    `<i>Priset av peasy-auto ${BOT_STAMP()}</i>`,
  ];

  if (forErp) return lines.join('\n');

  const erpUrl = `https://biladministrasjon.no/cars_driveno/processing/final_estimate/${p.bil.id}`;
  if (p.bil.id) lines.push(`<a href="${erpUrl}">Apne i ERP</a>`);
  return lines.join('\n');
}

// ── Evaluer en bil ────────────────────────────────────────────
// PEASY v19.15: car.info API for Bilmodell-seksjon (kun /REGNR test-modus)
async function getCarInfoApi(regnr, km) {
  const KEY = process.env.CAR_INFO_KEY;
  if (!KEY) { log("car.info API: ingen CAR_INFO_KEY"); return null; }
  const { getOrFetch } = require("./carinfo-plate-cache.js");
  try {
    const got = await getOrFetch(regnr, km, async function (plate, mileage) {
      const url = "https://api.car.info/v2/app/autoringen/license-plate/N/" + plate + "/" + (mileage || 0);
      const r = await fetch(url, { headers: { "x-auth-identifier": "autoringen", "x-auth-key": KEY, "Accept": "application/json", "Accept-Language": "nb" } });
      if (!r.ok) { log("car.info API " + r.status + " for " + plate); return null; }
      const j = await r.json();
      if (!j.success) { log("car.info API success=false"); return null; }
      log("car.info API: " + (j.result && j.result.car_name || "OK"));
      return j;
    });
    if (!got.ok) return null;
    if (got.cached) log("car.info API cache " + String(regnr).toUpperCase());
    return (got.raw && got.raw.result) || got.raw || null;
  } catch (e) { log("car.info API FEIL: " + e.message); return null; }
}

// PEASY v19.14: AI-bygget cv_label for /REGNR test-modus
async function getCvLabelAi(regnr, vegData, elbilRad, finnAdSummary, carInfo) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) { log("AI cv_label: ingen ANTHROPIC_API_KEY"); return null; }
  const make = (vegData && vegData.make) || "";
  const model = (vegData && vegData.model) || "";
  const elbilStr = elbilRad ? JSON.stringify(elbilRad).slice(0, 1500) : "(ingen)";
  const carInfoStr = carInfo ? JSON.stringify({ brand: carInfo.brand, series: carInfo.series, generation: carInfo.generation, car_name: carInfo.car_name, engine: carInfo.engine, trim_package: carInfo.trim_package, packages: carInfo.packages }).slice(0, 800) : "(ingen)";
  const finnStr = finnAdSummary || "(ingen)";
  const prompt = [
    "Du er ekspert paa norske bruktbiler. Bygg en kort, riktig Finn-soeketekst for denne bilen som matcher hvordan annonser typisk er titulert paa Finn.",
    "",
    "Regel: Merke + Modell + Type/Variant (motorfamilie eller utstyrspakke). INGEN motorstyrke (110, 109 kW, 544 hk). INGEN girkasse-koder (EAT, DSG, AT, S-Tronic). INGEN aarstall. INGEN drivstoff.",
    "",
    "Eksempler paa riktig output:",
    "- BMW iX xDrive60 Supercharged",
    "- Tesla Model Y Performance",
    "- VW ID.4 PURE",
    "- Peugeot 2008 PureTech",
    "- Audi A4 35 TDI",
    "",
    "Raadata:",
    "Regnr: " + regnr,
    "Vegvesen merke: " + make,
    "Vegvesen modell/handelsbetegnelse: " + model,
    "Elbilradar: " + elbilStr,
    "Car.info API: " + carInfoStr,
    "Tidligere Finn-annonse-tittel: " + finnStr,
    "",
    "Svar med BARE selve soeketeksten, INGEN forklaring, INGEN anfoerselstegn."
  ].join("\n");
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 100, messages: [{ role: "user", content: prompt }] })
    });
    const j = await r.json();
    if (j.error) { log("AI cv_label FEIL: " + j.error.message); return null; }
    const txt = (j.content && j.content[0] && j.content[0].text || "").trim();
    log("AI cv_label: " + txt);
    return txt;
  } catch (e) { log("AI cv_label EXC: " + e.message); return null; }
}
// [auksjon-blocker] Master-XLSX historikk-cache + bypass-liste
const _AUKSJON_XLSX_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';
const _AUKSJON_BYPASS_FILE = require('path').join(__dirname, 'v2', 'auksjon-bypass.txt');
const _AUKSJON_MAX_AGE_DAYS = 90;
let _auksjonHistCache = null;
let _auksjonBypass = new Set();

function _loadAuksjonBypass() {
  try {
    const fs = require('fs');
    if (!fs.existsSync(_AUKSJON_BYPASS_FILE)) return new Set();
    const txt = fs.readFileSync(_AUKSJON_BYPASS_FILE, 'utf8');
    const s2 = new Set();
    txt.split(/\r?\n/).forEach(ln => {
      const m = ln.replace(/#.*$/, '').trim().toUpperCase().replace(/\s+/g,'');
      if (m && /^[A-Z]{2}\d{4,5}$/.test(m)) s2.add(m);
    });
    return s2;
  } catch (e) { logErr('auksjon-bypass-load', e); return new Set(); }
}

async function _refreshAuksjonHistorikk() {
  try {
    const XLSX = require('xlsx');
    const buf = await refreshXlsxCache(false);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const H = rows[0] || [];
    const iInternnr = H.indexOf('Internnr.');
    const iReg = H.indexOf('RegNr.');
    const iRegDato = H.indexOf('Registrert');
    const iSolgt = H.indexOf('Solgt p\u00e5');
    const iBud = H.indexOf('Bud');
    const iRet = H.indexOf('Returnert p\u00e5');
    const iHbud = H.indexOf('H\u00f8yeste bud');
    const iStatus = H.indexOf('Status');
    const map = new Map();
    for (let i=1; i<rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const reg = String(r[iReg]||'').toUpperCase().replace(/\s+/g,'');
      if (!reg) continue;
      const entry = { internnr: String(r[iInternnr]||''), reg_dato: r[iRegDato], solgt: r[iSolgt], ret: r[iRet], bud: Number(r[iBud])||0, hbud: Number(r[iHbud])||0, status: r[iStatus] };
      if (!map.has(reg)) map.set(reg, []);
      map.get(reg).push(entry);
    }
    _auksjonHistCache = { fetchedAt: Date.now(), map };
    _auksjonBypass = _loadAuksjonBypass();
    log('[auksjon] historikk: ' + map.size + ' unike regnr, ' + (rows.length-1) + ' rader; bypass: ' + _auksjonBypass.size + ' regnr');
  } catch (e) { logErr('auksjon-refresh', e); }
}

function _parseNorskDato(x) {
  if (!x) return null;
  const m = String(x).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));
}

function _hasRecentAuction(regnr, currentInternnr) {
  if (!_auksjonHistCache || !regnr) return null;
  const key = String(regnr).toUpperCase().replace(/\s+/g,'');
  const rows = _auksjonHistCache.map.get(key);
  if (!rows) return null;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - _AUKSJON_MAX_AGE_DAYS);
  let best = null;
  for (const r of rows) {
    if (String(r.internnr) === String(currentInternnr||'')) continue;
    const varPaaAuksjon = (r.bud > 0) || (r.hbud > 0);
    if (!varPaaAuksjon) continue;
    if (!r.ret) continue;
    const d = _parseNorskDato(r.ret) || _parseNorskDato(r.solgt) || _parseNorskDato(r.reg_dato);
    if (!d || d < cutoff) continue;
    if (!best || d > best._d) { best = Object.assign({}, r, { _d: d }); }
  }
  if (!best) return null;
  const dd = best._d.toISOString().slice(0,10);
  const tag = best.ret ? 'returnert' : (best.solgt ? 'solgt' : 'reg');
  return { dato: dd, hbud: best.hbud, bud: best.bud, status: best.status, tag };
}

async function evalCar(bil, page, cache, opts = {}) {
  /* JR_DOSSIER_HOOK */
  var __jrHit = null;
  try {
    var __jr = require("/Users/bot/peasy-auto/jr/read-dossier");
    var __chef = (process.env.PEASY_CHEF || "easy");
    __jrHit = __jr.loadForChef({ chef: __chef, internnr: bil.id, erpId: bil.id, regnr: bil.registration_number });
    if (__jrHit && __jrHit.ok) {
      bil._jrDossier = __jrHit;
      if (__jrHit.origin_cv && __jrHit.origin_cv.km != null) bil.mileage = __jrHit.origin_cv.km;
      if (typeof log === "function") log("Jr-dossier " + (__jrHit.path || "") + " km=" + bil.mileage);
    }
  } catch (__jrErr) {
    if (typeof log === "function") log("Jr-dossier hook: " + (__jrErr && __jrErr.message));
  }
  if (!(__jrHit && __jrHit.ok)) {
    if (typeof log === "function") {
      log("Jr-dossier mangler for " + (bil.registration_number || "?") +
        " erp=" + (bil.id || "?") + " — venter (ingen prising, ingen 0_comps-cache)");
    }
    return;
  }

  const { qaOverrideUrl = null } = opts;
  const regnr = bil.registration_number;
  const erpId = bil.id;
  try { require('./ai-usage').setContext({ bot: 'easy', regnr, erpId }); } catch (eAi) {}
  let originCV = null;
  try {
    originCV = await originCv(erpId);
    if (originCV && originCV.km != null) {
      if (Number(bil.mileage) !== Number(originCV.km)) {
        log('[origin-cv] ' + (originCV.regnr || regnr) + ' km drive_no_car_data.mileage=' + originCV.km + ' (list var ' + (bil.mileage || 0) + ')');
      }
      bil.mileage = originCV.km;
    }
  } catch (eCv) {
    logErr('origin-cv ' + regnr, eCv);
  }
  if (bil._jrDossier && bil._jrDossier.ok) {
    const jd = bil._jrDossier.dossier || {};
    const jid = jd.identity || (bil._jrDossier.origin_cv && bil._jrDossier.origin_cv.identity) || null;
    if (jid && typeof jid === 'object') {
      originCV = Object.assign({}, originCV || {}, {
        identity: jid,
        make: jid.make || (originCV && originCV.make) || null,
        model: jid.model || (originCV && originCV.model) || null,
      });
    }
  }
  // v19.30: send regnr+km til grok-bot for hver bil
  sendGrok(regnr, bil.mileage);
  // v20.53: ALLTID soek regnr paa FINN (vet om bilen er aktiv paa Finn)
  let finnSelf = null; try { finnSelf = await checkFinnListing(regnr, bil, page); } catch (eFs) { logErr(`finnSelf ${regnr}`, eFs); }
  writeFinnLink(erpId, finnSelf);
  // === v20.38 PRICING SAFETY VALVE ===

  const _kmSvindelWarned = {};
    // [vrakpant] Override dLav/dHoy hvis dLav under norsk vrakpant, send varsel, returner om override skjedde
  const VRAKPANT_MIN = 3000;
  const VRAKPANT_MAX = 5000;
  async function _maybeKmVarsel(kmSvindel) {
    if (!kmSvindel || _kmSvindelWarned[erpId]) return;
    _kmSvindelWarned[erpId] = true;
    const msg = kmSvindel.type === 'kunde_lavere_enn_eu'
      ? `Kunde oppga ${kmSvindel.kunde_km.toLocaleString('nb-NO')} km, siste EU-kontroll (${(kmSvindel.eu_dato||'').slice(0,10)}) registrerte ${kmSvindel.eu_km.toLocaleString('nb-NO')} km. Kunde-oppgitt er ${(kmSvindel.eu_km - kmSvindel.kunde_km).toLocaleString('nb-NO')} km LAVERE enn siste EU — sjekk kilometerteller ved takst.`
      : `EU-historikk hopper nedover: ${kmSvindel.prev_km.toLocaleString('nb-NO')} km (${(kmSvindel.prev_dato||'').slice(0,10)}) → ${kmSvindel.curr_km.toLocaleString('nb-NO')} km (${(kmSvindel.curr_dato||'').slice(0,10)}). Mulig kilometerteller-manipulasjon — sjekk ved takst.`;
    try {
      await sendTelegram(
        '⚠️ <b>KM-USIKKERHET</b>\n\n' +
        'Regnr: ' + regnr + '\nInternnr: ' + erpId + '\n\n' +
        msg + '\n\n' +
        '<a href="https://biladministrasjon.no/cars_driveno/processing/final_estimate/' + erpId + '">Åpne i ERP</a>',
        { parse_mode: 'HTML' }
      );
    } catch (e) { logErr('km-varsel', regnr, e); }
  }
    async function _maybeVrakpant(valuation) {
    const oLav = Number(valuation.dLav);
    const oHoy = Number(valuation.dHoy);
    if (!Number.isFinite(oLav) || !Number.isFinite(oHoy)) return false;
    const nLav = Math.max(oLav, VRAKPANT_MIN);
    const nHoy = Math.max(oHoy, nLav + 2000, VRAKPANT_MAX);
    if (nLav === oLav && nHoy === oHoy) return false;
    valuation.dLav = nLav;
    valuation.dHoy = nHoy;
    log('[vrakpant] ' + regnr + ': ' + oLav + '-' + oHoy + ' -> ' + nLav + '-' + nHoy + ' (bare l\u00f8ft)');
    try {
      await sendTelegram(
        '\u26a0\ufe0f <b>VRAKPANT-PRISING</b>\n\n' +
        'Regnr: ' + regnr + '\nInternnr: ' + erpId + '\n\n' +
        'AI foreslo: ' + oLav + ' \u2013 ' + oHoy + ' kr\n' +
        'L\u00f8ftet til gulv: ' + nLav + ' \u2013 ' + nHoy + ' kr\n\n' +
        '<a href="https://biladministrasjon.no/cars_driveno/processing/final_estimate/' + erpId + '">\u00c5pne i ERP</a>',
        { parse_mode: 'HTML' }
      );
    } catch (e) { logErr('vrakpant-alarm', regnr, e); }
    return true;
  }

  // [km-svindel] Sjekker om kunde-km < siste EU-km eller EU-historikk har hopp nedover
  function _detectKmSvindel(oppgittKm, history) {
    if (!oppgittKm || !Array.isArray(history)) return null;
    const insp = history.filter(h => h && h.type === 'inspection' && h.km);
    if (insp.length === 0) return null;
    // Siste EU-registrerte km
    const siste = insp.reduce((a, b) => (Number(b.km) > Number(a.km) ? b : a), insp[0]);
    const sisteKm = Number(siste.km);
    // 1) Kunde-km lavere enn siste EU
    if (Number(oppgittKm) < sisteKm - 500) {  // 500 km toleranse for avrunding
      return { type: 'kunde_lavere_enn_eu', eu_km: sisteKm, eu_dato: siste.date, kunde_km: Number(oppgittKm) };
    }
    // 2) EU-historikk har hopp nedover (kilometerteller skrudd ned mellom EU-kontroller)
    const sorted = insp.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let i = 1; i < sorted.length; i++) {
      const prev = Number(sorted[i-1].km), curr = Number(sorted[i].km);
      if (curr < prev - 500) {
        return { type: 'eu_historikk_hopp', prev_km: prev, prev_dato: sorted[i-1].date, curr_km: curr, curr_dato: sorted[i].date };
      }
    }
    return null;
  }
    function _computeBlockers(o) {
    const blockers = [];
    const cmt = (o.sdComment || '').toString();
    const kjorbar = /reparasjonsobjekt|starter ikke|motor.*defekt|delebil|motorstopp|registerreim|totalskade/i.test(cmt) ? 'nei' : (cmt ? 'usikker' : 'ja');
    /* v20.51: kjorbar-blokker fjernet (for aggressiv regex) */
    const oppgittKm = Number(o.oppgittKm) || 0;
    let euMaxKm = 0;
    try {
      const insp = (o.history || []).filter(h => h && h.type === 'inspection');
      euMaxKm = Math.max(0, ...insp.map(e => Number(e.km) || 0));
    } catch (e) {}
    // [km-varsel] Varsle om km-usikkerhet men IKKE blokk — takst verifiserer km fysisk
    const _kmSvindel = _detectKmSvindel(o.oppgittKm, o.history);
    if (_kmSvindel) {
      // Marker på objektet så evalCar kan sende Telegram-varsel etter prising
      o._kmVarsel = _kmSvindel;
    }
    // v20.70: km_konflikt-blokker fjernet — km-override gjøres oppstrøms i evalCar
    // [auksjon-blocker] blokker hvis bil har vaert paa auksjon siste 90 dager
  try {
    if (o.regnr) {
      const _regKey = String(o.regnr).toUpperCase().replace(/\s+/g,'');
      _auksjonBypass = _loadAuksjonBypass();
      const _ah = _hasRecentAuction(o.regnr, o.internnr);
      if (_ah && !_auksjonBypass.has(_regKey)) {
        o._auksjonHit = _ah;
        // Prises. QA skjuler SEND til ny runde er avtalt.
      }
    }
  } catch (e) { logErr('auksjon-blocker', e); }
  return blockers;
  }
  async function _maybeBlock(o) {
    const blockers = _computeBlockers(o);
    if (!blockers.length) return false;
    log('[v20.39] BLOKKERT skriving for ' + regnr + ' (' + erpId + '): ' + blockers.join(', '));
    try {
      await sendTelegram(
        '\u26A0\uFE0F <b>MANUELL VURDERING</b>\n\n' +
        'Regnr: ' + regnr + '\nInternnr: ' + erpId + '\n\n' +
        'Flagg:\n  \u2022 ' + blockers.join('\n  \u2022 ') + '\n\n' +
        'AI foreslo: ' + (o.dLav != null ? o.dLav : '?') + ' \u2013 ' + (o.dHoy != null ? o.dHoy : '?') + ' kr\n' +
        'Segment-confidence: ' + (o.segConfidence || '?') + '\n\n' +
        '<a href="https://biladministrasjon.no/cars_driveno/processing/final_estimate/' + erpId + '">\u00C5pne i ERP</a>',
        { parse_mode: 'HTML' }
      );
    } catch (e) { logErr('blocker-alarm', regnr, e); }
    // v20.47: ikke cache blokkerte biler (blocker-path cache-write fjernet)
    return true;
  }
  // === end safety valve ===

  log(`--- ${regnr} (ERP ${erpId}) ---`);

  if (!qaOverrideUrl && isInCache(cache, erpId)) {
    const skipWhy = cacheSkipReason(cache, erpId);
    const zeroSkip = !!(skipWhy && String(skipWhy).indexOf('0_comps') >= 0);
    const entry = cache[String(erpId)];
    // Fossefall-stempel: hopp over bare når komplett + samme FOSSEFALL_VERSION (locked scale).
    const ffStamp = entry && typeof entry === 'object' && (entry.fossefall || entry.tables_path || entry.complete != null);
    const ffFresh = ffStamp ? !!fossefallCard.cacheSkipsReprice(entry) : true;
    let jrReady = false;
    try {
      const rd = require("/Users/bot/peasy-auto/jr/read-dossier");
      jrReady = typeof rd.dossierHasMarket === "function" && rd.dossierHasMarket(bil._jrDossier);
    } catch (eJrM) {}
    if (zeroSkip && jrReady) {
      log(`Cache: ${regnr} 0_comps stale — Jr har marked, pris på nytt`);
      try { delete cache[String(erpId)]; saveJSON(CACHE_FILE, cache); } catch (eDel) {}
    } else if (ffStamp && !ffFresh) {
      log(`Cache: ${regnr} stale fossefall ${entry.fossefall || '?'} — pris på nytt`);
      try { delete cache[String(erpId)]; saveJSON(CACHE_FILE, cache); } catch (eDel) {}
    } else if (!ffStamp || ffFresh) {
      if (ffStamp && ffFresh) {
        log(`Cache: ${regnr} komplett fossefall — hopper over`);
        return;
      }
      if (!ffStamp) {
        log(skipWhy
          ? `Cache: ${regnr} ${skipWhy} — hopper over`
          : `Cache: ${regnr} allerede skrevet — hopper over`);
        return;
      }
    }
  }

  let vegData;
  let vegDataFallback = false;
  try {
    // 1. Vegvesen (primaer)
    vegData = await getVegvesenData(regnr);
  } catch (vegErr) {
    // FALLBACK: bygg vegData fra car.info naar Vegvesen er nede
    log(`Vegvesen feilet for ${regnr} — bygger fallback fra car.info`);
    const ci = await getCarInfoApi(regnr, bil.mileage || 0);
    if (!ci) {
      logErr(`Ingen car.info-data heller for ${regnr} — gir opp`, vegErr);
      await sendTelegram(`❌ Vegvesen + car.info begge feilet for ${regnr} — kan ikke prise`);
      return;
    }
    // Map car.info -> vegData-skjema som resten av evalCar forventer
    const ciHk = ci.horsepower || 0;
    const kwMatch = (ci.engine_name || '').match(/(\d+)\s*kW/i);
    const ciKw = kwMatch ? parseInt(kwMatch[1]) : Math.round(ciHk / 1.36);
    const isVarebilFromCi = ci.vehicle_type === 'truck' || ci.chassis === 'LCV' || /varebil/i.test(bil.body_type || '');
    const gearboxFromName = /Manual/i.test(ci.car_name || '') ? 'Manuell' : /Automatic|Auto/i.test(ci.car_name || '') ? 'Automat' : 'Ukjent';
    vegData = {
      make: ci.brand || bil.manufacturer || '',
      model: ci.series || bil.model_series || '',
      fuel: ci.engine_type || 'Bensin',
      gearbox: gearboxFromName,
      drive: '2WD',  // fallback default — vi vet ikke uten Vegvesen
      kw: ciKw,
      hk: ciHk,
      karosseri: ci.chassis || '',
      vehicle_type: ci.vehicle_type || '',
      chassis: ci.chassis || '',
      tekniskKode: '',
      isVarebil: isVarebilFromCi,
      isHybrid: /hybrid/i.test(ci.engine_type || ''),
      firstRegYear: ci.model_year || bil.model_year || 0,
      firstRegMonth: 1,
      forstegangNorgeDato: null,
      opprinneligRegDato: null,
      avregistrert: null,
      avregistrertDato: null,
      bruktimport: null,
      avgiftsgruppe: '',
      range: null,
      farge: '',
      _fallback: true
    };
    vegDataFallback = true;
    log(`Fallback vegData for ${regnr}: ${vegData.make} ${vegData.model} ${vegData.fuel} ${vegData.hk}hk ${vegData.isVarebil ? '(varebil)' : '(personbil)'}`);
  }

  async function stopUtenforScope(gate) {
    log(`[biltype-gate] ${regnr} UTENFOR SCOPE klasse=${gate.klasse} fant=${gate.fant}`);
    const scopeCard = formatScopeCard({
      regnr,
      erpId,
      make: vegData.make,
      model: vegData.model || bil.model_series,
      year: bil.model_year || vegData.firstRegYear,
      km: bil.mileage,
      gate: gate,
      html: true,
    });
    try { await sendTelegram(scopeCard); } catch (e) { logErr('biltype-gate telegram', e); }
    addScopeSkipToCache(cache, erpId, gate);
  }

  const biltypeGate = classifyBiltype({
    avgiftsgruppe: vegData.avgiftsgruppe,
    tekniskKode: vegData.tekniskKode,
    karosseri: vegData.karosseri,
    vehicle_type: vegData.vehicle_type,
    chassis: vegData.chassis || vegData.karosseri,
    body_type: bil.body_type || bil.karosseri_erp,
    make: vegData.make,
    model: vegData.model || bil.model_series,
  });
  if (!biltypeGate.ok) {
    await stopUtenforScope(biltypeGate);
    return;
  }

  try {
    // PEASY: hent variant fra car.info + elbilradar (for el)
    const carInfo = await getCarInfoFetch(regnr);
    const elbilRad = vegData.fuel && /^el/i.test(vegData.fuel) ? await getElbilradarFetch(regnr, page) : null;
    const peasyVariant = (carInfo?.variant || '').trim();
  // v20.77: elbilradar-cache for V2 (bypass 403). Skriver til delt fil etter vellykket fetch.
  if (elbilRad) {
    try {
      const _ecPath = '/Users/bot/peasy-auto/elbilradar-cache.json';
      let _ec = {};
      try { _ec = JSON.parse(fs.readFileSync(_ecPath, 'utf8')); } catch (e) {}
      _ec[regnr] = { data: elbilRad, ts: new Date().toISOString() };
      fs.writeFileSync(_ecPath, JSON.stringify(_ec, null, 2));
    } catch (e) { logErr('elbilradar-cache-write', e); }
  }
  // PEASY: lagre elbilradar pakke + utstyr paa bil (brukt i kort og Finn-soek)
  if (elbilRad) {
    bil.pakke = elbilRad.pakke || null;
    bil.equipment = elbilRad.equipment || [];
    bil.modelFull = elbilRad.modelFull || null;
    // PEASY: ekstra-felter fra parseElbilradarFields
    bil.spesifikasjon = elbilRad.spesifikasjon || null;
    // PEASY: bruk spesifikasjon som pakke for Finn-soek hvis pakke mangler
    if (!bil.pakke && bil.spesifikasjon) {
      bil.pakke = bil.spesifikasjon;
      log("Pakke berik fra spesifikasjon: " + bil.pakke);
    }
    bil.elbilradarFinnId = elbilRad.finnId || null;
    if (bil.elbilradarFinnId) {
      const finnAdTitle = await fetchFinnAdTitle(bil.elbilradarFinnId);
      if (finnAdTitle) {
        bil.finnAdTitle = finnAdTitle;
        const cleaned = finnAdTitle.replace(/^Bruktbil til salgs:\s*/i, "").replace(/\s*\|\s*FINN\.no\s*$/i, "").trim();
        bil.finnAdSummary = cleaned;
        log("Finn-ad fetched: " + cleaned);
      } else {
        log("Finn-ad fetch returnerte null for ID " + bil.elbilradarFinnId);
      }
    }
    bil.produksjonssted = elbilRad.produksjonssted || null;
    bil.karosseriElb = elbilRad.karosseri || null;
    bil.seter = elbilRad.seter || null;
    bil.doerer = elbilRad.doerer || null;
    bil.forbruk = elbilRad.forbruk || null;
    bil.toppfart = elbilRad.toppfart || null;
    bil.motorEffekt = elbilRad.motorEffekt || null;
    bil.forbruk = elbilRad.forbruk || null;
    bil.vin = elbilRad.vin || null;
    bil.toppfart = elbilRad.toppfart || null;
    bil.forsteRegNorge = elbilRad.forsteRegNorge || null;
    bil.farge = elbilRad.farge || null;
    bil.batteri = elbilRad.batteri || null;
    bil.eiere = elbilRad.eiere || null;
    bil.bruktimportertFra = elbilRad.bruktimportertFra || null;
    bil.elbDrivlinje = elbilRad.drivlinje || null;
    bil.egenvekt = elbilRad.egenvekt || null;
    bil.elbRekkevidde = elbilRad.rekkevidde || null;
    bil.garanti = elbilRad.garanti || null;
    // Hvis modelFull mangler men spesifikasjon finnes -> bruk vegData.make + model + spesifikasjon
    if (!bil.modelFull && elbilRad.spesifikasjon) {
      bil.modelFull = ((vegData.make||"") + " " + (vegData.model||"") + " " + elbilRad.spesifikasjon).trim().replace(/\s+/g, " ");
    }
    log(`elbilradar: modelFull="${bil.modelFull}" pakke="${bil.pakke}" eq=${(bil.equipment||[]).length}`);
  }
  // PEASY v19.18: hent car.info trim_package OG sett bil.pakke for Finn-soek
  try {
    const ciEarly = await getCarInfoApi(bil.registration_number, bil.mileage || 0);
    if (ciEarly) {
      bil.carInfo = ciEarly;
      if (ciEarly.vin && !bil.vin) bil.vin = ciEarly.vin;
      if (!finnSelf && (ciEarly.vin || bil.vin)) {
        try {
          const { findFinnOrigin } = require('./finn-origin.js');
          const again = await findFinnOrigin(regnr, {
            vin: ciEarly.vin || bil.vin,
            valuation: ciEarly.valuation,
            erpId: erpId,
          });
          if (again && again.link) {
            finnSelf = again;
            writeFinnLink(erpId, again);
            log('Finn: ' + regnr + ' origin via VIN ' + (again.price || '?') + ' kr ' + again.link);
          }
        } catch (eVin) { logErr('origin-vin ' + regnr, eVin); }
      }
      const gate2 = classifyBiltype({
        avgiftsgruppe: vegData.avgiftsgruppe,
        tekniskKode: vegData.tekniskKode,
        karosseri: vegData.karosseri,
        make: vegData.make || ciEarly.brand,
        model: vegData.model || ciEarly.series || bil.model_series,
        car_name: ciEarly.car_name,
        chassis: ciEarly.chassis,
        body_type: ciEarly.chassis,
      });
      if (!gate2.ok) {
        await stopUtenforScope(gate2);
        return;
      }
      if (ciEarly.trim_package) bil.pakke = ciEarly.trim_package;
      // v20.82: Finn-origin-fallback via car.info classifieds (fanger solgte historiske annonser)
      if (!finnSelf) {
        try {          // v20.86: KUN top-level classifieds. valuation.* er comps-pool der car.info setter same_car=1 paa ALLE.
          const _val = ciEarly.valuation || {};
          const _allAds = [
            ...(ciEarly.company_classifieds || []),
            ...(ciEarly.private_classifieds || []),
            ...(_val.company_classifieds || []),
            ...(_val.private_classifieds || [])
          ];
          const _norm = regnr.toUpperCase().replace(/\s/g, '');
          const _hit = _allAds.find(c => {
            const _pl = String(c.licence_plate || '').toUpperCase().replace(/\s/g, '');
            return _pl === _norm && !c.ca_sold_date && c.classified_url;
          });
          if (_hit && _hit.classified_url) {
            finnSelf = {
              link: _hit.classified_url,
              url: _hit.classified_url,
              price: Number(_hit.classified_price) || null,
              km: Number(_hit.mileage_km) || null,
              published: _hit.classified_published_date || null,
              sold: _hit.ca_sold_date || null,
              source: 'car.info-classifieds'
            };
            log('[origin-carinfo] ' + regnr + ' fant historisk annonse: ' + finnSelf.link + (_hit.ca_sold_date ? ' (solgt ' + _hit.ca_sold_date + ')' : ''));
            writeFinnLink(erpId, finnSelf);
          }
        } catch (_e) { logErr('origin-carinfo ' + regnr, _e); }
      }
    }
  } catch (e) { log('car.info early fetch FEIL: ' + e.message); }
  // PEASY v19.16: AI cv_label for /REGNR test-modus - utenfor elbilradar-if
  if (opts.aiCv) {
        try {
          log('CarInfo: starter for ' + bil.registration_number);
          const carInfo = await getCarInfoApi(bil.registration_number, bil.mileage || 0);
          bil.carInfo = carInfo;
          if (carInfo) {
            const r = carInfo;
            // PEASY v19.18: sett bil.pakke fra trim_package
            if (r.trim_package && !bil.pakke) bil.pakke = r.trim_package;
            const parts = [];
            // Linje 1: car_name eller brand+series+generation
            const tittel = r.car_name || [r.brand, r.series, r.generation].filter(Boolean).join(' ');
            if (tittel) parts.push(tittel);
            // Linje 2: trim_package
            if (r.trim_package) parts.push('Pakke: ' + r.trim_package);
            else if (r.packages && r.packages.trim && r.packages.trim.length) parts.push('Pakke: ' + r.packages.trim.join(', '));
            // Linje 3: motor
            if (r.engine_name) parts.push('Motor: ' + r.engine_name);
            else if (r.engine) parts.push('Motor: ' + r.engine);
            // Linje 4: drivstoff + hk + aar
            const dr = [r.engine_type, r.horsepower ? r.horsepower + ' hk' : null, r.model_year].filter(Boolean).join(' · ');
            if (dr) parts.push(dr);
            // Linje 5: chassis + vin
            if (r.chassis) parts.push('Karosseri: ' + r.chassis);
            if (r.vin) parts.push('VIN: ' + r.vin);
            // Linje 6: history (servicehistorikk)
            if (r.history && r.history.length) {
              const hist = r.history.map(h => (h.km ? h.km.toLocaleString('no') + ' km' : '?') + ' (' + (h.date || '?').slice(0,4) + ')').reverse().join(' → ');
              parts.push('Service: ' + hist);
            }
            // Linje 7: valuation (estimat)
            if (r.valuation && r.valuation.result) {
              const v = r.valuation.result;
              const valLine = [];
              if (v.price) valLine.push('Estimat: ' + Math.round(v.price).toLocaleString('no') + ' kr');
              if (v.classifieds_avg_price) valLine.push('Snitt comps: ' + Math.round(v.classifieds_avg_price).toLocaleString('no') + ' kr');
              if (v.classifieds_used_count) valLine.push('(' + v.classifieds_used_count + ' stk');
              if (v.classified_min_price && v.classified_max_price) valLine.push(Math.round(v.classified_min_price).toLocaleString('no') + '–' + Math.round(v.classified_max_price).toLocaleString('no') + ' kr)');
              if (valLine.length) parts.push(valLine.join(' | '));
            }
            // Linje 8: tidligere annonse
            if (r.company_classifieds && r.company_classifieds.length) {
              const c = r.company_classifieds[0];
              if (c.classified_title) {
                const ttl = c.classified_title.replace(/^Bruktbil til salgs:\s*/i, '').replace(/\s*\|\s*FINN\.no$/i, '').trim();
                let prevLine = 'Tidl.: ' + ttl;
                if (c.classified_price) prevLine += ' – ' + Math.round(c.classified_price).toLocaleString('no') + ' kr';
                if (c.ca_sold_date) prevLine += ' (solgt ' + c.ca_sold_date + ')';
                parts.push(prevLine);
              }
            }
            // PEASY v19.18: utvidet bil-info fra Vegvesen + car.info
          // Bruktimport fra Vegvesen
          if (vegData && vegData.bruktimport) {
            const land = vegData.bruktimport.importland && vegData.bruktimport.importland.landNavn;
            const kmImport = vegData.bruktimport.kilometerstand;
            let importLine = 'Bruktimport: ja';
            if (land) importLine += ' (fra ' + land.charAt(0).toUpperCase() + land.slice(1).toLowerCase();
            if (kmImport) importLine += ', ' + kmImport.toLocaleString('no') + ' km ved import';
            if (land) importLine += ')';
            parts.push(importLine);
            if (vegData.opprinneligRegDato) parts.push('Opprinnelig reg: ' + vegData.opprinneligRegDato);
          }
          if (vegData && vegData.forstegangNorgeDato) parts.push('Forste reg Norge: ' + vegData.forstegangNorgeDato);
          // Farge
          const colorAttr = (r.attributes || []).find(a => a.name && (a.name === 'Colour' || a.name === 'Color' || a.name === 'Farge' || a.name === 'Farg'));
          if (colorAttr && colorAttr.values && colorAttr.values[0]) parts.push('Farge: ' + colorAttr.values[0]);
          // EU-kontroll fra history
          if (Array.isArray(r.history)) {
            const insp = r.history.filter(h2 => h2.type === 'inspection').slice(0, 3);
            if (insp.length) {
              const lines = insp.map(i => i.date + (i.km ? ' (' + i.km.toLocaleString('no') + ' km)' : ''));
              parts.push('EU-kontroll: ' + lines.join(', '));
            }
          }
          // Ekstrautstyr fra packages.equip
          if (r.packages && Array.isArray(r.packages.equip) && r.packages.equip.length) {
            parts.push('Utstyr: ' + r.packages.equip.slice(0, 10).join(', '));
          }
          bil.cv_text = parts.join('\n');
            log('CV bygd: ' + parts.length + ' linjer');
            if (parts[0] && parts[0].length < 150) bil.modelFull = parts[0];
          } else {
            log('CarInfo: ingen data');
          }
        } catch (e) { log('CV-blokk EXC: ' + e.message); }
      }

  // PEASY: testmodus - berik stub-bil fra vegData
  if (!bil.id) {
    if (!bil.model_year && vegData.firstRegYear) bil.model_year = vegData.firstRegYear;
    if (!bil.model_series && vegData.model) bil.model_series = vegData.model;
    log(`testmodus enrich: model_year=${bil.model_year} model_series="${bil.model_series}"`);
  }
    if (peasyVariant) {
      const origMS = bil.model_series || '';
      if (!origMS.toLowerCase().includes(peasyVariant.toLowerCase())) {
        bil.model_series = (origMS + ' ' + peasyVariant).trim();
        log(`PEASY: bil.model_series "${origMS}" -> "${bil.model_series}"`);
      }
    }
    log(`Vegvesen: ${vegData.fuel} | ${vegData.gearbox} | ${vegData.drive} | ${vegData.kw}kW | karosseri hentes fra ERP`);

    // v20.70: km-override fra EU-kontroll — EU-km autoritativ (Statens vegvesen)
    const _oppgittKm = Number(bil.mileage) || 0;
    let _euMaxKm = 0;
    try {
      const _insp = ((bil.carInfo && bil.carInfo.history) || []).filter(h => h && h.type === 'inspection');
      _euMaxKm = Math.max(0, ..._insp.map(e => Number(e.km) || 0));
    } catch (e) {}
    let kmOverride = null;  // v20.96: alltid null — INGEN auto-korrigering av km
    if (_euMaxKm > 0 && _oppgittKm > 0 && _euMaxKm > _oppgittKm) {
      log(`[km-mistanke] ${regnr}: EU ${_euMaxKm} > oppgitt ${_oppgittKm} — beholder kunde-oppgitt (ingen auto-rette)`);
      sendTelegram(`\u26a0\ufe0f [km-mistanke] ${regnr}: EU-km ${_euMaxKm} > kunde-oppgitt ${_oppgittKm} km — beholder kunde-oppgitt`).catch(function(){});
    }
    // kjorbar: les felt + kommentar FØR comps (ellers prises wrecker som kjørende bil)
    let sdComment = null;
    let imageCount = 0;
    let token = null;
    let kjorbarInfo = { kjorbar: 'ja', wrecker: false, reason: 'ikke lest' };
    try {
      token = await getErpToken();
      if (originCV) {
        sdComment = originCV.seller_comment || null;
        kjorbarInfo = resolveKjorbar({ is_drivable: originCV.is_drivable, sd_comment: sdComment });
        if (originCV.vegvesen && originCV.vegvesen.karosseri && !vegData.karosseri) vegData.karosseri = originCV.vegvesen.karosseri;
      }
      const detail = await getErpCarDetail(erpId, token);
      if (!sdComment) {
        var carDescEarly = detail?.car?.description || null;
        var sdSelfEarly = detail?.car?.self_declaration?.comment || detail?.self_declaration?.comment || null;
        var sdIsDrivable = detail?.car?.self_declaration?.is_drivable ?? detail?.self_declaration?.is_drivable ?? null;
        if (carDescEarly && sdSelfEarly && carDescEarly.trim() === sdSelfEarly.trim()) sdComment = sdSelfEarly;
        else if (carDescEarly && sdSelfEarly) sdComment = sdSelfEarly + '\n\nBILBESKRIVELSE: ' + carDescEarly;
        else sdComment = sdSelfEarly || carDescEarly || null;
        kjorbarInfo = resolveKjorbar({ is_drivable: sdIsDrivable, sd_comment: sdComment });
      }
      imageCount = (detail && detail.car && Array.isArray(detail.car.files)) ? detail.car.files.length : 0;
      const bodyTypeIdEarly = detail?.car?.driveNoCarData?.body_type_id;
      if (bodyTypeIdEarly) vegData.karosseri = BODY_TYPE_MAP[bodyTypeIdEarly] || '';
      log('[kjorbar] ' + regnr + ' ' + kjorbarInfo.kjorbar + (kjorbarInfo.wrecker ? ' WRECKER' : '') + ' — ' + (kjorbarInfo.reason || ''));
    } catch (eKb) { logErr('kjorbar-early ' + regnr, eKb); }
    try {
      const sigPath = '/Users/bot/peasy-auto/signaler-data.json';
      let sig = {};
      try { sig = JSON.parse(fs.readFileSync(sigPath, 'utf8')); } catch (e) {}
      sig[String(bil.id)] = {
        regnr: regnr,
        hasComment: !!sdComment,
        comment: String(sdComment || '').slice(0, 500),
        imageCount: imageCount || 0,
        kjorbar: kjorbarInfo.kjorbar,
        updated: new Date().toISOString()
      };
      fs.writeFileSync(sigPath, JSON.stringify(sig, null, 2));
    } catch (eSigW) { try { logErr('signaler-write', regnr, eSigW); } catch (e2) {} }

    // 2-5. V2 prisemotor (erstatter Finn-scrape + gammelt anker)
    const seg = identifySegment(bil.model_year || vegData.firstRegYear || 0, bil.mileage || 0);
    log(`Segment: ${seg.label} | alder=${seg.age}y | km/y=${seg.kmPerYear ? seg.kmPerYear.toLocaleString('nb-NO') : '?'}`);

    let v2 = null, v2feil = null;
    let ankerKilde = null;
    let easyConfidence = null, easyBegr = null; // v20.50: Easys egen confidence til shadow-feed
    let collected = { comps: [], data: null, origin: [], activeComps: [], deduped: [] };
    let stripped = { comps: [], ekskluderte: [] };
    try {
      const ciSrc = (bil && bil.carInfo) || null;
      const locked = lockOriginIdentity({
        vegvesen: {
          make: vegData && vegData.make,
          model: vegData && vegData.model,
          modelYear: vegData && vegData.firstRegYear,
          fuel: vegData && (vegData.fuel || vegData.propulsion),
          drive: vegData && vegData.drive,
          karosseri: vegData && vegData.karosseri,
          gearbox: vegData && vegData.gearbox,
          hk: vegData && vegData.hk,
        },
        origin_cv: originCV,
        carInfo: ciSrc,
      });
      log('origin-id ' + (locked.car_name || locked.model || '?') + ' fuel=' + (locked.fuel || '—') + ' hk=' + (locked.hk || '—') + ' gir=' + (locked.gir || '—') + ' src=' + (locked.source || ''));
      let jrPool = null;
      if (bil && bil._jrDossier && bil._jrDossier.ok) {
        const jrRaw = (bil._jrDossier.comps || []).concat((bil._jrDossier.finn && bil._jrDossier.finn.ads) || []);
        if (jrRaw.length >= 1) jrPool = jrRaw;
      }
      const buildSold = (anchorObj) => {
        const begMap = new Map();
        for (const v of [...((anchorObj && anchorObj.valgte_comps) || []), ...((anchorObj && anchorObj.ekskluderte_comps) || [])]) {
          const plate = String(v.licence_plate || '').toUpperCase().replace(/\s/g, '');
          if (plate && v.begrunnelse && !begMap.has(plate)) begMap.set(plate, v.begrunnelse);
        }
        const withBeg = (c) => { const p = String(c.licence_plate || '').toUpperCase().replace(/\s/g, ''); const b = begMap.get(p); return b ? { ...c, begrunnelse: b } : c; };
        const soldSort = (a, b) => String(b.sold_date || '').localeCompare(String(a.sold_date || ''));
        const dd = collected.deduped || [];
        return {
          soldForhandler: dd.filter(c => c.type === 'forhandler' && c.sold_date).sort(soldSort).slice(0, 10).map(withBeg),
          soldPrivat: dd.filter(c => c.type === 'privat' && c.sold_date).sort(soldSort).slice(0, 10).map(withBeg),
        };
      };

      let originUsed = false;
      try {
        let originRec = await originComps.ensure({
          erpId: erpId,
          regnr: regnr,
          km: bil.mileage || 0,
          carInfo: ciSrc,
          finnPool: jrPool,
          originFinn: finnSelf,
          origin_cv: originCV,
          locked: locked,
          klasse: (vegData && (vegData.isVarebil || /varebil/i.test(vegData.avgiftsgruppe || ''))) ? 'varebil' : 'personbil',
          ident: identForComps(locked, {
            make: (vegData && vegData.make) || (bil && bil.make) || '',
            model: (vegData && vegData.model) || (bil && bil.model_series) || '',
            year: (vegData && vegData.firstRegYear) || (bil && bil.model_year) || null,
            fuel: (vegData && (vegData.fuel || vegData.propulsion)) || '',
            karosseri: (vegData && vegData.karosseri) || '',
            drive: (vegData && vegData.drive) || '',
            gir: (vegData && vegData.gearbox) || '',
          }),
        });
        stripped = {
          comps: originComps.toValgte(originRec),
          ekskluderte: originComps.toOwnExcluded(originRec),
        };
        const wreckerNow = !!(kjorbarInfo && kjorbarInfo.wrecker);
        if (originRec && !originRec.skip_put && !wreckerNow) {
          const kunAnnonse = (originRec.finn_utpris_kilde === 'kun_kundens_annonse')
            || (originRec.finn_utpris_grunn === 'kun kundens annonse');
          if (!kunAnnonse) {
            originRec = await originChefs.price(originRec, {
              origin_cv: originCV,
              originFinn: finnSelf,
              km: bil.mileage || 0,
              erpId: erpId,
              regnr: regnr,
            });
          } else {
            log('Finn-utpris ' + regnr + ': kun kundens annonse — hopper over chefs, beholder '
              + originRec.finn_utpris + ' (lav confidence, alltid QA, skriver ERP)');
            originRec.low_confidence = true;
            originRec.confidence = 'lav';
            originRec.always_qa = true;
            originRec.force_qa = true;
            bil._kunKundensAnnonse = true;
            bil._originSkipPut = false;
          }
        }
        if (originRec && originRec.skip_put && !wreckerNow) {
          bil._originSkipPut = true;
          const ownEx = originComps.toOwnExcluded(originRec);
          v2 = {
            anchor: {
              anker_beregning: { anker: null },
              finn_utpris: null,
              begrunnelse_kort: '0 eksterne origin-comps',
              valgte_comps: [],
              ekskluderte_comps: (stripped.ekskluderte || []).concat(ownEx).concat(originComps.toRejected(originRec)),
            },
            activeComps: collected.activeComps || [],
            soldForhandler: [], soldPrivat: [],
            errors: [],
            finn_utpris: {
              finn_utpris: null, origin_cap: null, grunn: '0 eksterne origin-comps',
              valgte_comps: [], ekskluderte: (stripped.ekskluderte || []).concat(ownEx).concat(originComps.toRejected(originRec)),
              skip_put: true, n_external: 0, n_sold: originRec.n_sold, n_ask: originRec.n_ask,
              kilde: null, origin_on_finn: !!(originRec.listings && originRec.listings.origin_on_finn),
            },
          };
          ankerKilde = 'origin-comps';
          easyBegr = '0 eksterne origin-comps';
          originUsed = true;
          log('Finn-utpris ' + regnr + ': SKIP_PUT 0 eksterne origin-comps');
        } else if (originRec && originRec.finn_utpris > 0 && !wreckerNow) {
          const valgte = originComps.toValgte(originRec);
          const ownEx = originComps.toOwnExcluded(originRec);
          const originCap = /origin95/.test(originRec.finn_utpris_kilde || '') ? 0.95 : null;
          v2 = {
            anchor: {
              anker_beregning: { anker: originRec.finn_utpris },
              finn_utpris: originRec.finn_utpris,
              begrunnelse_kort: originRec.finn_utpris_kilde,
              valgte_comps: valgte,
              ekskluderte_comps: (stripped.ekskluderte || []).concat(ownEx).concat(originComps.toRejected(originRec)),
            },
            activeComps: collected.activeComps || [],
            soldForhandler: valgte.filter(function (c) { return c.status === 'solgt'; }),
            soldPrivat: [],
            errors: [],
            finn_utpris: {
              finn_utpris: originRec.finn_utpris,
              origin_cap: originCap,
              grunn: originRec.finn_utpris_grunn || (originRec.finn_utpris_kilde === 'kun_kundens_annonse' ? 'kun kundens annonse' : originRec.finn_utpris_kilde),
              valgte_comps: valgte,
              ekskluderte: (stripped.ekskluderte || []).concat(ownEx).concat(originComps.toRejected(originRec)),
              skip_put: false,
              n_external: originRec.n_external,
              n_sold: originRec.n_sold,
              n_ask: originRec.n_ask,
              n_rejected: originRec.n_rejected,
              ident_label: originRec.ident_label || '',
              kilde: originRec.finn_utpris_kilde,
              finn_utpris_grunn: originRec.finn_utpris_grunn || (originRec.finn_utpris_kilde === 'kun_kundens_annonse' ? 'kun kundens annonse' : null),
              annonsepris: originRec.annonsepris != null ? originRec.annonsepris : null,
              low_confidence: !!originRec.low_confidence || originRec.finn_utpris_kilde === 'kun_kundens_annonse',
              always_qa: !!originRec.always_qa || originRec.finn_utpris_kilde === 'kun_kundens_annonse',
              origin_on_finn: !!(originRec.listings && originRec.listings.origin_on_finn),
              origin_auction: !!(originRec.listings && originRec.listings.origin_on_finn && originRec.listings.origin_on_finn.auction),
              chefs: originRec.chefs || null,
            },
          };
          ankerKilde = originRec.finn_utpris_kilde || 'origin-chefs';
          easyBegr = originRec.finn_utpris_kilde;
          originUsed = true;
          log('Finn-utpris ' + regnr + ': ' + originRec.finn_utpris + ' (' + originRec.finn_utpris_kilde + ') n_ext=' + originRec.n_external + ' sold=' + originRec.n_sold + ' ask=' + originRec.n_ask);
        }
      } catch (eOc) {
        logErr('origin-comps ' + regnr, eOc);
      }

      if (originUsed && v2 && v2.anchor && v2.anchor.finn_utpris > 0) {
        const capResOc = capFinnUtpris(v2.anchor.finn_utpris, finnSelf);
        if (capResOc.origin_cap != null) {
          const fuCap = Math.round(Number(capResOc.finn_utpris) / 1000) * 1000;
          v2.anchor.finn_utpris = fuCap;
          if (v2.anchor.anker_beregning) v2.anchor.anker_beregning.anker = fuCap;
          if (v2.finn_utpris) {
            v2.finn_utpris.finn_utpris = fuCap;
            v2.finn_utpris.origin_cap = capResOc.origin_cap;
            if (v2.finn_utpris.grunn && !/origin95/.test(String(v2.finn_utpris.grunn))) {
              v2.finn_utpris.grunn += '+origin95';
            }
            if (v2.finn_utpris.kilde && !/origin95/.test(String(v2.finn_utpris.kilde))) {
              v2.finn_utpris.kilde += '+origin95';
            }
          }
          if (v2.anchor.begrunnelse_kort && !/origin95/.test(String(v2.anchor.begrunnelse_kort))) {
            v2.anchor.begrunnelse_kort += '+origin95';
          }
          easyBegr = (v2.anchor && v2.anchor.begrunnelse_kort) || easyBegr;
          log('origin_cap ' + regnr + ': ask ' + capResOc.originPrice + ' utpris ' + capResOc.from + ' → ' + fuCap);
        }
      }
      if (originUsed) {
        /* origin-chefs merge — hopper Easy AI / analog fallback */
      } else {
      if (!collected.data) {
        collected = await collectOnly(regnr, bil.mileage || 0);
        const originSpecFb = { plate: regnr, finn_url: finnSelf && finnSelf.link };
        const strippedFb = stripOriginFromMarket(collected.comps || [], originSpecFb);
        collected.comps = strippedFb.comps;
        stripped = { comps: strippedFb.comps, ekskluderte: (stripped.ekskluderte || []).concat(strippedFb.ekskluderte || []) };
      }
      const easyAnchor = await easy.chooseAnchor({
        data: collected.data, origin: collected.origin, comps: collected.comps,
        sdComment: sdComment, origin_cv: originCV,
      });
      const sold = buildSold(easyAnchor);
      let fuPris = easyAnchor && easyAnchor.finn_utpris != null ? easyAnchor.finn_utpris : null;
      if (!(fuPris > 0)) {
        const ciRes = collected.data && collected.data.sources && collected.data.sources.car_info && collected.data.sources.car_info.result;
        const cval = (ciRes && ciRes.valuation) || {};
        const cv = (cval.company_valuation && cval.company_valuation.result) || {};
        fuPris = ensureFinnUtpris(null, collected.comps, {
          valgte: easyAnchor && easyAnchor.valgte_comps,
          origin: finnSelf,
          carinfo: { price: cv.price, classifieds_avg_price: cv.classifieds_avg_price },
        });
        if (fuPris > 0 && easyAnchor) {
          easyAnchor.finn_utpris = fuPris;
          if (easyAnchor.anker_beregning) easyAnchor.anker_beregning.anker = fuPris;
        }
      }
      let originCap = null;
      const capRes = capFinnUtpris(fuPris, finnSelf);
      if (capRes.finn_utpris != null) fuPris = capRes.finn_utpris;
      if (capRes.origin_cap != null) {
        originCap = capRes.origin_cap;
        if (easyAnchor) {
          easyAnchor.finn_utpris = fuPris;
          if (easyAnchor.anker_beregning) easyAnchor.anker_beregning.anker = fuPris;
        }
        log('origin_cap ' + regnr + ': ask ' + capRes.originPrice + ' utpris ' + capRes.from + ' → ' + fuPris);
      }
      v2 = {
        anchor: easyAnchor, activeComps: collected.activeComps || [],
        soldForhandler: sold.soldForhandler, soldPrivat: sold.soldPrivat,
        errors: (collected.data && collected.data.errors) || [],
        finn_utpris: {
          finn_utpris: fuPris,
          origin_cap: originCap,
          grunn: easyAnchor && easyAnchor.finn_utpris_grunn || null,
          valgte_comps: (easyAnchor && easyAnchor.valgte_comps) || [],
          ekskluderte: ((easyAnchor && easyAnchor.ekskluderte_comps) || []).concat(stripped.ekskluderte),
        },
      };
      ankerKilde = 'easy';
      easyConfidence = (easyAnchor && easyAnchor.confidence != null) ? easyAnchor.confidence : null;
      if (v2 && v2.finn_utpris && (v2.finn_utpris.low_confidence || v2.finn_utpris.kilde === 'kun_kundens_annonse' || v2.finn_utpris.grunn === 'kun kundens annonse')) {
        easyConfidence = 'lav';
      }
      easyBegr = (easyAnchor && (easyAnchor.finn_utpris_grunn || easyAnchor.begrunnelse_kort)) || null;
      log('Finn-utpris ' + regnr + ': ' + fuPris + (easyBegr ? ' (' + easyBegr + ')' : '') + ' n=' + ((easyAnchor.valgte_comps || []).length));
      }
    } catch (e2) {
      v2feil = e2.message || 'ukjent';
      logErr('v2-prising ' + regnr, e2);
      if (collected) {
        const ciRes = collected.data && collected.data.sources && collected.data.sources.car_info && collected.data.sources.car_info.result;
        const cval = (ciRes && ciRes.valuation) || {};
        const cv = (cval.company_valuation && cval.company_valuation.result) || {};
        const fb = ensureFinnUtpris(null, collected.comps, {
          origin: finnSelf,
          carinfo: { price: cv.price, classifieds_avg_price: cv.classifieds_avg_price },
        });
        if (fb > 0) {
          v2feil = null;
          v2 = {
            anchor: { anker_beregning: { anker: fb }, finn_utpris: fb, begrunnelse_kort: e2.message, valgte_comps: [], ekskluderte_comps: [] },
            activeComps: collected.activeComps || [],
            soldForhandler: [], soldPrivat: [],
            errors: (collected.data && collected.data.errors) || [],
            finn_utpris: { finn_utpris: fb, origin_cap: null, grunn: e2.message, valgte_comps: [], ekskluderte: [] },
          };
          ankerKilde = 'easy-fallback';
          easyBegr = e2.message;
          log('Finn-utpris ' + regnr + ': ' + fb + ' (fallback etter ' + e2.message + ')');
        }
      }
    }
    let v2anker = v2 && v2.anchor && v2.anchor.anker_beregning ? v2.anchor.anker_beregning.anker : null;
    if (!v2feil && !(kjorbarInfo && kjorbarInfo.wrecker) && (!Number.isFinite(v2anker) || v2anker <= 0)) {
      v2feil = (v2 && v2.errors && v2.errors.length) ? v2.errors.join(' | ') : (easyBegr || 'ingen markedsevidens');
    }
    if (v2feil) {
      log('Finn-utpris feilet ' + regnr + ': ' + v2feil);
      const fuHad = (v2 && v2.finn_utpris) || {};
      const mc = buildManualCard(regnr, erpId, bil, vegData, v2feil);
      await sendTelegram(mc.text, mc.kb);
      try {
        var scB = scoreEasyIdentComps(vegData, bil, finnSelf, (fuHad.valgte_comps) || [], (collected && collected.comps) || fuHad.valgte_comps || []);
        if (scB) log('ident/comps ' + regnr + ' ident=' + scB.ident + ' comps=' + scB.comps + ' n=' + scB.n + ' match=' + scB.nMatch);
        var v2PayloadB = JSON.stringify({
          registration_number: regnr, id: erpId, model_year: bil.model_year,
          mileage: bil.mileage, model_series: bil.model_series,
          make: vegData ? vegData.make : (bil.make || ''),
          origin_cv: originCV || null,
          easy_eval: Object.assign({
            anker: fuHad.finn_utpris != null ? fuHad.finn_utpris : null, dLav: null, dHoy: null, bracket: null,
            confidence: 0, begrunnelse_kort: v2feil, anker_kilde: 'easy',
            km_override: kmOverride,
            finn_link: (finnSelf && finnSelf.link) || null,
            finn_price: (finnSelf && Number(finnSelf.price)) || null,
            finn_sold: (finnSelf && finnSelf.sold) || null,
            finn_source: (finnSelf && finnSelf.source) || null,
            valgte_comps: fuHad.valgte_comps || [],
            ekskluderte: fuHad.ekskluderte || [],
          }, scB ? { ident_score: scB.ident, comps_score: scB.comps, combined_score: scB.combined, comps_count: scB.n } : {})
        });
        writeEasyMeasurement(regnr, erpId, bil, originCV, v2PayloadB);
        fs.appendFileSync('/Users/bot/peasy-pricing-v2-queue.txt', v2PayloadB + '\n');
        log('[easy->v2] Matet shadow for ' + regnr);
      } catch (eFeedB) { logErr('easy->v2 feed', eFeedB); }
      log('--- ' + regnr + ' ferdig (ingen markedsevidens) ---');
      if (bil._originSkipPut || /0 eksterne origin-comps/.test(String(v2feil || easyBegr || ''))) {
        let jrReadyZ = false;
        try {
          const rdZ = require("/Users/bot/peasy-auto/jr/read-dossier");
          jrReadyZ = typeof rdZ.dossierHasMarket === "function" && rdZ.dossierHasMarket(bil._jrDossier);
        } catch (eJrZ) {}
        if (jrReadyZ) {
          log("0_comps men Jr har marked — cacher ikke skip " + regnr);
        } else if (bil._jrDossier && bil._jrDossier.ok) {
          addZeroCompsSkipToCache(cache, erpId);
        } else {
          log("0_comps uten Jr-dossier — cacher ikke skip " + regnr);
        }
      }
      return;
    }

    const wpEasy = kjorbarInfo.wrecker ? wreckerPricing(kjorbarInfo.reason) : null;
    const anchor = wpEasy
      ? { price: wpEasy.anker, reason: wpEasy.begrunnelse }
      : { price: v2anker, reason: (v2.anchor && v2.anchor.begrunnelse_kort) || 'finn-utpris' };

    // Comp-cap er AV for v2 (anker bygger paa realiserte salg, ikke asking-priser).
    // Sett PEASY_V2_COMPCAP=1 for aa reaktivere Easy sin comp-cap.
    const compCapPool = process.env.PEASY_V2_COMPCAP === '1'
      ? (v2.anchor.valgte_comps || []).map(c => ({ price: Number(c.price) || 0 })).filter(c => c.price > 0)
      : [];
    const valuation = wpEasy
      ? { T: wpEasy.anker, t88: wpEasy.anker, minMarginUsed: false, margin: 0, fee: 0, dMid: wpEasy.dLav, dLav: wpEasy.dLav, dHoy: wpEasy.dHoy, E: wpEasy.dLav, xPct: 0, bracket: 'Lav', auctionTypeId: 2, spreadPct: 0, compCapApplied: false, compCapFlag: null, lowestComp: null, wrecker: true }
      : calcValuation(anchor.price, seg.segment, _filterOldComps(compCapPool, 6), {
        regnr: regnr,
        make: (bil.drive_no_car_data && bil.drive_no_car_data.make) || bil.make || '',
        year: (vegData && vegData.firstRegYear) || bil.model_year || 0,
        km: bil.mileage || 0,
        egenvekt: bil.egenvekt,
        isVarebil: !!(vegData && (vegData.isVarebil || /varebil/i.test(vegData.avgiftsgruppe || ''))),
        avgiftsgruppe: vegData && vegData.avgiftsgruppe
      });

    // 6. Brreg
    const brreg = await checkBrreg(regnr, page);

    // 7. Selgerkommentar allerede hentet før comps (kjorbar). Token gjenbrukes.
    if (!token) {
      try { token = await getErpToken(); } catch (eTok) { logErr('getErpToken', eTok); }
    }

    // 8. Fossefall først (locked scale), så ERP-lav = writing arm's fossefall lav.
    let _ffCard = null;
    let _writeArm = 'A';
    let _fuAvvik = null;
    try {
      const { liveOwner } = require('./ab-arm.js');
      const owner = liveOwner(erpId, bil && bil.source);
      _writeArm = owner === 'ORDNA' ? 'O' : (owner === 'B' ? 'B' : 'A');
      const { buildFossefall, extractSoldDays, loadFossefallSatser } = require('./fossefall');
      try { await loadFossefallSatser(); } catch (eLoadFf) { logErr('loadFossefallSatser', eLoadFf); }
      const _fu = (v2 && v2.finn_utpris && v2.finn_utpris.finn_utpris != null)
        ? Number(v2.finn_utpris.finn_utpris)
        : (Number.isFinite(Number(anchor && anchor.price)) ? Number(anchor.price) : null);
      const _lagret = {};
      const _hints = {};
      // v20.167: valuation her er før fossefallet (gammel kalkyle). Avviket settes etter ERP-skriv,
      // mot armen som eier bilen (_writeArm), med tallet som faktisk ble skrevet.
      _fuAvvik = _fu;
      let _soldDaysCard = [];
      try {
        const vc = (v2 && v2.anchor && v2.anchor.valgte_comps)
          || (v2 && v2.soldForhandler)
          || [];
        _soldDaysCard = extractSoldDays(vc);
      } catch (_) {}
      const _built = buildFossefall({
        finnUtpris: _fu,
        km: bil.mileage || 0,
        modelYear: (vegData && vegData.firstRegYear) || bil.model_year || 0,
        bilInfo: {
          year: (vegData && vegData.firstRegYear) || bil.model_year || 0,
          egenvekt: bil.egenvekt,
          isVarebil: !!(vegData && (vegData.isVarebil || /varebil/i.test(vegData.avgiftsgruppe || ''))),
        },
        lagret: _lagret,
        hints: _hints,
        soldDays: _soldDaysCard,
        annonsepris: (finnSelf && (finnSelf.price || finnSelf.pris)) || (v2 && v2.finn_price) || null,
        chefsUtprisBeforeCap: (function(){
          var m = v2 && v2.finn_utpris && v2.finn_utpris.chefs && v2.finn_utpris.chefs.merge;
          if (m && m.raw != null) return Number(m.raw);
          if (m && m.finn_utpris != null && m.cap) return null;
          return null;
        })(),
        originCapTak: (function(){
          var ask = Number(finnSelf && (finnSelf.price || finnSelf.pris));
          if (Number.isFinite(ask) && ask > 0) return Math.round((ask * 0.95) / 1000) * 1000;
          return null;
        })(),
      });
      _ffCard = fossefallCard.cardFromBuilt(_built) || _built;
      const plan = fossefallCard.planErpWrite({
        erpId: erpId,
        source: bil && bil.source,
        card: _ffCard,
        legacyLav: valuation.dLav,
        legacyHoy: valuation.dHoy,
      });
      if (plan && Number.isFinite(Number(plan.dLav)) && Number.isFinite(Number(plan.dHoy))) {
        valuation.dLav = Number(plan.dLav);
        valuation.dHoy = Number(plan.dHoy);
        log(`Fossefall ${regnr} scenario ${_writeArm}: Finn-utpris ${_fu} celle ${(_ffCard && _ffCard.celleId) || '?'} → lav–høy ${valuation.dLav}–${valuation.dHoy} (dette skrives til ERP)`);
        if (Number.isFinite(Number(valuation.dLav))) {
          valuation.auctionTypeId = Number(valuation.dLav) <= 35000 ? 2 : 1;
        }
      }
    } catch (eFfCard) { logErr('fossefall-card', eFfCard); }

    // 9. Skriv til ERP
    await _maybeVrakpant(valuation);
    try { await _maybeKmVarsel(_detectKmSvindel(bil.mileage, (bil.carInfo && bil.carInfo.history) || [])); } catch(e) {}
    if (await _maybeBlock({ regnr: regnr, internnr: erpId, sdComment: sdComment, oppgittKm: bil.mileage, history: (bil.carInfo && bil.carInfo.history) || [], valgteComps: (v2 && v2.anchor && v2.anchor.valgte_comps) || [], segConfidence: seg && seg.confidence, dLav: valuation.dLav, dHoy: valuation.dHoy })) return;
    const erpWrite = await maybeWriteToERP(bil, erpId, valuation.dLav, valuation.dHoy, valuation.auctionTypeId, brreg.anyDebts, brreg, token, anchor.price);
    const erpWritten = !!(erpWrite && erpWrite.written);
    const erpSkipBy = (erpWrite && erpWrite.skipBy) || null;

    // 9. Verifiser ERP
    const erpVerify = await maybeVerifyErp(bil, erpId, token);

    // v20.102: AI-bygget QA-URL for eval-kortet (kun QA-visning, ikke prising)
    const _ffKmBand = 50000;
    const _ffYBase = bil.model_year || vegData.firstRegYear || 0;
    const _ffYTo = (vegData.firstRegMonth >= 9 ? _ffYBase + 1 : _ffYBase);
    const _urlBuilder = require('./ai-finn-url-builder');
    const _urlCtx = {
      make: vegData.make,
      model_series: bil.model_series,
      model_year: _ffYBase,
      mileage: bil.mileage,
      hk: vegData.hk,
      karosseri: vegData.karosseri,
      fuel: vegData.fuel,
      drive: vegData.drive,
      isHybrid: vegData.isHybrid,
      isElectric: /^el/i.test(vegData.fuel || ''),
      car_info_title: bil.carInfo && bil.carInfo.title
    };
    const _urlResult = await _urlBuilder.buildQAUrl(_urlCtx, function(url){ return scrapeFinnUrl(url, page); });
    const finnFunnelTightUrl = (_urlResult && _urlResult.finnUrl) || buildFinnUrl(vegData.make, bil.model_series || '', _ffYBase, _ffYTo, vegData, {
      kmTo: (bil.mileage || 0) + _ffKmBand,
      fuel: !(vegData.isHybrid || false),
      kw: false
    });
    // v20.167: avvik = tallet som ble skrevet (valuation) mot formelen på eier-armen. Andre armer: ikke avvik.
    try {
      require('./fossefall').settAvvikForEier(_ffCard, _writeArm,
        { dLav: valuation.dLav, dHoy: valuation.dHoy },
        { anker_lagret: _fuAvvik, egenvekt_mangler: !bil.egenvekt },
        { year: (vegData && vegData.firstRegYear) || bil.model_year || 0, egenvekt: bil.egenvekt,
          isVarebil: !!(vegData && (vegData.isVarebil || /varebil/i.test(vegData.avgiftsgruppe || ''))) });
    } catch (eAvvik) { logErr('fossefall-avvik', eAvvik); }
    // 10. Bygg eval-kort (hybrid: Easy topp/bunn + v2 comps/anker/risiko)
    // Fossefall allerede bygget før ERP-skriv (v20.150).
    const cardParams = {
      finnListing: finnSelf,
      finnUrl: finnFunnelTightUrl,
      bil, vegData, seg, valuation, imageCount, sdComment, brreg,
      anchor: v2.anchor,
      activeComps: (v2.activeComps || []),
      soldForhandler: (v2.soldForhandler || []), soldPrivat: (v2.soldPrivat || []),
      prevEvals: getPrevEvals(regnr, erpId),
      erpWritten, erpSkipBy, erpVerify, chatPosted: false, qaOverride: !!qaOverrideUrl,
      kmOverride,
      fossefall: _ffCard,
      writeArm: _writeArm,
    };
    const erpText = formatEvalCardHybrid(cardParams, true);
    const chatPosted = await maybePostToChat(bil, erpId, erpText, token);

    // 10. Send Telegram
    _evalRegnrMap[erpId] = regnr;
    _evalDataMap[erpId] = { regnr, segment: seg.segment, lowestComp: valuation.lowestComp, anyDebts: brreg.anyDebts, brreg, bil };
    persistEvalData();
    let tgKort = formatEvalCardHybrid({ ...cardParams, chatPosted }, false);
    if (ankerKilde === 'v2') tgKort = '\u26a0\ufe0f Finn-utpris fallback\n' + tgKort;
    await sendTelegram(
      tgKort,
      (bil.id ? { inline_keyboard: [[
        { text: '✅ Send eval', callback_data: `confirm:${erpId}` },
        { text: '✏️ Endre anker', callback_data: `editanchor:${erpId}` }, { text: '🗑 Slett cache', callback_data: `delcache:${erpId}` }
      ]] } : undefined)
    );

    // 11b. Trigger grok-bot (fire-and-forget, paavirker ikke v18.11)
    try {
      const grokPayload = JSON.stringify({
        registration_number: regnr,
        id: erpId,
        model_year: bil.model_year,
        mileage: bil.mileage,
        model_series: bil.model_series,
        make: vegData ? vegData.make : (bil.make || '')
      });
    // const fs = require('fs');
    // fs.appendFileSync('/Users/bot/peasy-auto-grok/queue.txt', grokPayload + '\n');
    //   log(`[v18->grok] Triggered grok-bot for ${regnr}`);
    // } catch(e) { log(`[v18->grok] Trigger feilet: ${e.message}`); }
    } catch(e) { /* grok deaktivert */ }
    // 11c. Mat standalone-v2 shadow (sammenligning)
    try {
      if (!qaOverrideUrl && !bil.testMode) { /* TESTMODE-GUARD */
        var v2Payload = JSON.stringify({
          registration_number: regnr, id: erpId, model_year: bil.model_year,
          mileage: bil.mileage, model_series: bil.model_series,
          make: vegData ? vegData.make : (bil.make || ''),
          origin_cv: originCV || null,
          easy_eval: Object.assign({ anker: (anchor && Number.isFinite(Number(anchor.price))) ? Number(anchor.price) : null, dLav: (valuation && Number.isFinite(Number(valuation.dLav))) ? Number(valuation.dLav) : null, dHoy: (valuation && Number.isFinite(Number(valuation.dHoy))) ? Number(valuation.dHoy) : null, bracket: (valuation && valuation.bracket) || null, model: (valuation && valuation.model) || null, vrakpant: !!(valuation && valuation.vrakpant), breakdown: (valuation && valuation.breakdown) || null, confidence: (easyConfidence != null ? easyConfidence : ((v2 && v2.anchor && v2.anchor.confidence != null) ? v2.anchor.confidence : null)), begrunnelse_kort: (easyBegr || ((v2 && v2.anchor && v2.anchor.begrunnelse_kort) || null)), anker_kilde: ankerKilde, km_override: kmOverride, kjorbar: kjorbarInfo.kjorbar, wrecker: !!kjorbarInfo.wrecker, finn_link: (finnSelf && finnSelf.link) || null, finn_price: (finnSelf && Number(finnSelf.price)) || null, finn_sold: (finnSelf && finnSelf.sold) || null, finn_source: (finnSelf && finnSelf.source) || null, finn_utpris: (v2 && v2.finn_utpris && v2.finn_utpris.finn_utpris != null) ? v2.finn_utpris.finn_utpris : ((anchor && Number.isFinite(Number(anchor.price))) ? Number(anchor.price) : null), origin_cap: (v2 && v2.finn_utpris && v2.finn_utpris.origin_cap != null) ? v2.finn_utpris.origin_cap : null, finn_utpris_grunn: (v2 && v2.finn_utpris && (v2.finn_utpris.finn_utpris_grunn || (v2.finn_utpris.kilde === 'kun_kundens_annonse' || v2.finn_utpris.grunn === 'kun_kundens_annonse' ? 'kun kundens annonse' : v2.finn_utpris.grunn))) || null, annonsepris: (v2 && v2.finn_utpris && v2.finn_utpris.annonsepris != null) ? v2.finn_utpris.annonsepris : ((finnSelf && Number(finnSelf.price)) || null), always_qa: !!(v2 && v2.finn_utpris && v2.finn_utpris.always_qa), low_confidence: !!(v2 && v2.finn_utpris && v2.finn_utpris.low_confidence) || easyConfidence === 'lav', valgte_comps: (v2 && v2.finn_utpris && v2.finn_utpris.valgte_comps) || (v2 && v2.anchor && v2.anchor.valgte_comps) || [], ekskluderte: (v2 && v2.finn_utpris && v2.finn_utpris.ekskluderte) || [] }, (function(){ var own = (v2 && v2.finn_utpris && v2.finn_utpris.valgte_comps) || (v2 && v2.anchor && v2.anchor.valgte_comps) || []; var sc = scoreEasyIdentComps(vegData, bil, finnSelf, own, (collected && collected.comps) || own); if (sc) log('ident/comps ' + regnr + ' ident=' + sc.ident + ' comps=' + sc.comps + ' n=' + sc.n + ' match=' + sc.nMatch); return sc ? { ident_score: sc.ident, comps_score: sc.comps, combined_score: sc.combined, comps_count: sc.n, ident_label: (v2 && v2.finn_utpris && v2.finn_utpris.ident_label) || ((vegData && vegData.make || '') + ' ' + ((vegData && vegData.model) || (bil && bil.model_series) || '')).trim(), n_rejected: (v2 && v2.finn_utpris && v2.finn_utpris.n_rejected) || 0, comps_n_sold: (v2 && v2.finn_utpris && v2.finn_utpris.n_sold) || 0, comps_n_ask: (v2 && v2.finn_utpris && v2.finn_utpris.n_ask) || 0, chefs: (v2 && v2.finn_utpris && v2.finn_utpris.chefs) || null } : {}; })())
        });
        writeEasyMeasurement(regnr, erpId, bil, originCV, v2Payload);
        fs.appendFileSync('/Users/bot/peasy-pricing-v2-queue.txt', v2Payload + '\n');
        log('[easy->v2] Matet shadow for ' + regnr);
      }
    } catch (eFeed) { logErr('easy->v2 feed', eFeed); }

    // bot4 arkivert 2026-09-11 — ingen SEND-avhengighet, ikke spawn.

    // 12. Cache — fossefall-stempel når kort er komplett; ellers ERP-ferdig-cache.
    try {
      if (_ffCard) {
        const stamp = fossefallCard.cacheStamp(_ffCard);
        if (stamp && stamp.complete) {
          cache[String(erpId)] = stamp;
          saveJSON(CACHE_FILE, cache);
          log(`Cache: ${erpId} fossefall ${stamp.fossefall} komplett`);
        } else {
          cacheIfPriced(cache, erpId, erpWritten, bil, pickSharedUtpris(v2, anchor));
        }
      } else {
        cacheIfPriced(cache, erpId, erpWritten, bil, pickSharedUtpris(v2, anchor));
      }
    } catch (eCacheFf) {
      cacheIfPriced(cache, erpId, erpWritten, bil, pickSharedUtpris(v2, anchor));
    }

    const erpLog = erpWritten ? 'OK' : (erpSkipBy ? ('skrives av ' + erpSkipBy) : 'FEIL');
    log(`--- ${regnr} ferdig | ERP: ${erpLog} | Chat: ${chatPosted ? 'OK' : 'skip'} ---`);

  } catch (err) {
    logErr(`evalCar ${regnr}`, err);
    await sendTelegram(`❌ Feil ved evaluering av ${regnr}: ${err.message}`);
  }
}

// ── Kjoring ───────────────────────────────────────────────────
const nodemailer = require('nodemailer');
const FLUSH_MAIL_TO = 'mike@autoringen.no';
async function sendMail(subject, body, opts = {}) {
  try {
    const user = process.env.IMAP_USER || process.env.EMAIL_USER;
    const t = nodemailer.createTransport({ host: 'exchange.tornado.email', port: 587, secure: false, auth: { user, pass: process.env.IMAP_PASS }, connectionTimeout: 10000, greetingTimeout: 10000 });
    const mailOpts = { from: 'Peasy Bot <' + user + '>', to: FLUSH_MAIL_TO, subject, text: body };
    if (opts.cc) mailOpts.cc = opts.cc;
    const info = await t.sendMail(mailOpts);
    log('mail sendt til ' + FLUSH_MAIL_TO + (opts.cc ? ' (cc: ' + opts.cc + ')' : '') + ': ' + info.response);
    return true;
  } catch (e) { logErr('sendMail', e); return false; }
}
// Aktive biler i pipe (liste 2-13), EKSKLUDERER new_cars. Kilde: driveno_* tellere fra ERP.
const FLUSH_ACTIVE_STATUSES = ['on_auction','on_the_way','order_delivery','ready_for_auction','waiting_for_preparation'];
async function getActivePipeCount() {
  const token = await getErpToken();
  const res = await fetch(`${CONFIG.erp.base}/c2b_module/peasy/processing/sd_received?per_page=99`, { headers: authH(token) });
  const j = await res.json();
  let counts = null;
  (function find(o){ if(counts||typeof o!=='object'||!o) return; if('driveno_sold' in o){counts=o;return;} for(const k in o) find(o[k]); })(j);
  if(!counts) return null;
  let total = 0;
  for(const st of FLUSH_ACTIVE_STATUSES) total += (counts['driveno_'+st]||0);
  return total;
}
const FLUSH_WATCH_FILE = '/Users/bot/peasy-auto/flush-watch.json';
function loadFlushWatch() {
  try { return JSON.parse(fs.readFileSync(FLUSH_WATCH_FILE, 'utf8')); }
  catch (e) { return { active: false, snapshotIds: [], notified: false, startedAt: null }; }
}
function saveFlushWatch(w) {
  try { fs.writeFileSync(FLUSH_WATCH_FILE, JSON.stringify(w, null, 2)); } catch (e) { logErr('flush-watch save', e); }
}
// Returnerer { total, remaining, remainingIds } for snapshotet mot cache
function flushWatchProgress(w, cache) {
  const ids = (w && w.snapshotIds) || [];
  const remainingIds = ids.filter(id => !cache[id]);
  return { total: ids.length, remaining: remainingIds.length, remainingIds };
}
// Kalles hver kjoring fra pushPulseStatus. Varsler EN gang naar pipe er flushet (aktive=0, ekskl. new_cars).
async function checkFlushWatch(cache) {
  const w = loadFlushWatch();
  if (!w.active || w.notified) return;
  let active;
  try { active = await getActivePipeCount(); } catch(e){ logErr('flush-watch count', e); return; }
  if (active === null) { log('flush-watch: kunne ikke lese aktive tellere'); return; }
  const baseline = w.baseline || 0;
  log('flush-watch: ' + (baseline - active) + '/' + baseline + ' flushet, ' + active + ' aktive igjen');
  if (active === 0) {
    w.notified = true; w.active = false; w.finishedAt = new Date().toISOString();
    saveFlushWatch(w);
    await sendTelegram('\u2705 <b>VILKAR-FLUSH FERDIG</b>\n\nAlle ' + baseline + ' biler registrert under gamle vilkar er ferdigbehandlet (flushet gjennom).\n\nDu kan na trygt aktivere de nye prisene/vilkarene.', false);
    await sendMail('VILKAR-FLUSH FERDIG - alle gamle biler gjennom', 'Alle ' + baseline + ' biler registrert under gamle vilkar er ferdigbehandlet (flushet gjennom).\n\nDu kan na trygt aktivere de nye prisene/vilkarene.');
    log('flush-watch: FERDIG - varsel sendt');
  }
}

async function pushPulseStatus(biler, cache) {
  const venter = (biler || []).filter(b => !cache[b.id]).length;
  const rec = { liste3: (biler || []).length, venter: venter, timestamp: new Date().toISOString() };
  const TOKEN = process.env.GITHUB_TOKEN;
  if (!TOKEN) { log('pulse-status: GITHUB_TOKEN mangler i .env'); return; }
  const REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
  const URL = 'https://api.github.com/repos/' + REPO + '/contents/pulse-status.json';
  const HDR = { 'Authorization': 'token ' + TOKEN, 'Accept': 'application/vnd.github.v3+json' };
  const shaRes = await fetch(URL, { headers: HDR });
  const shaData = await shaRes.json();
  const body = { message: 'pulse-status ' + rec.timestamp.slice(0, 16), content: Buffer.from(JSON.stringify(rec)).toString('base64') };
  if (shaData && shaData.sha) body.sha = shaData.sha;
  const putRes = await fetch(URL, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, HDR), body: JSON.stringify(body) });
  const putData = await putRes.json();
  if (putData.content) log('pulse-status: liste3=' + rec.liste3 + ' venter=' + venter + ' pushet');
  else logErr('pulse-status push', putData);
  try { await checkFlushWatch(cache); } catch (e) { logErr('flush-watch check', e); }
}

async function runOnce(cache, force = false) {
  const now = new Date();
  try {
    const { isNightQuiet } = require('./bot-schedule.js');
    if (!force && isNightQuiet(now)) {
      log('natt 22–05 Oslo — hopper over'); return;
    }
  } catch (eSch) {}

  log('=== Starter kjoring ===');
  reloadCacheFromDisk(cache);
  await fetchBrackets();
  // Last karosseri-typer fra ERP
  try {
    const btToken = await getErpToken();
    const btRes = await fetch(`${CONFIG.erp.base}/body_types/all`, { headers: authH(btToken) });
    const btData = await btRes.json();
    (btData.data?.body_types || []).forEach(bt => { CONFIG.bodyTypes[bt.id] = bt.name; });
    log(`Body types: ${Object.keys(CONFIG.bodyTypes).length} typer lastet`);
  } catch (e) { logErr('loadBodyTypes', e); }
  _kmCacheLoaded = false; // Last XLSX pa nytt for ferske biler

  const biler = await getListe3();
  if (biler.length === 0) { log('Ingen biler pa liste 3 — sjekker liste 2 likevel'); }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });

    const liste2 = await getListe2();
    if (liste2.length > 0) {
      log(`Liste 2: ${liste2.length} biler klar`);
      const promoteToken = await getErpToken();
      for (const bil of liste2) {
        await promoteToListe3(bil.id, promoteToken);
        await new Promise(r => setTimeout(r, 2000));
      }
      const ny = await getListe3();
      for (const b of ny) { if (!biler.find(x => x.id === b.id)) biler.push(b); }
    }

    try { await pushPulseStatus(biler, cache); } catch (eP) { logErr('pushPulseStatus start', eP); }
    const { hasReevalLock } = require('./qa-clear-cache');
    for (const bil of biler) {
      if (hasReevalLock(bil.registration_number, bil.id)) {
        log('[qa-reeval] lock — hopper over ' + (bil.registration_number || '?') + ' i runOnce');
        continue;
      }
      // v20.69: frisk side per bil -> egen Cloudflare-clearance for elbilradar (unngaar 403)
      const pgBil = await browser.newPage();
      await pgBil.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });
      try {
        await evalCar(bil, pgBil, cache, { aiCv: true });
      } finally {
        try { await pgBil.close(); } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    logErr('runOnce', err);
    await sendTelegram(`❌ peasy-auto fatal feil: ${err.message}`);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }

  // Stuck-watch: sjekk biler som har staat for lenge fra Mottatt -> ready_for_auction
  try { const rest = await getListe3(); await pushPulseStatus(rest, cache); } catch (eP2) { logErr('pushPulseStatus slutt', eP2); }
  try { await checkStuckCars(); } catch (e) { logErr('checkStuckCars in runOnce', e); }

  log('=== Kjoring ferdig ===');
}

// ── Telegram polling ──────────────────────────────────────────
let _lastUpdateId = 0;

function acquireTelegramPollLock() {
  const lockPath = require('path').join(__dirname, 'logs.nosync', 'telegram-poll.lock');
  try { fs.mkdirSync(require('path').dirname(lockPath), { recursive: true }); } catch (e) {}
  const pid = String(process.pid);
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, pid);
    fs.closeSync(fd);
  } catch (e) {
    if (e.code === 'EEXIST') {
      let old = 0;
      try { old = parseInt(fs.readFileSync(lockPath, 'utf8'), 10) || 0; } catch (e2) {}
      if (old && old !== process.pid) {
        try {
          process.kill(old, 0);
          log('Telegram-poll: pid ' + old + ' eier lasen — hopper over getUpdates');
          return false;
        } catch (e3) {
          try { fs.unlinkSync(lockPath); } catch (e4) {}
          return acquireTelegramPollLock();
        }
      }
    } else {
      logErr('telegram-poll-lock', e);
      return false;
    }
  }
  const release = function () {
    try { if (String(fs.readFileSync(lockPath, 'utf8')).trim() === pid) fs.unlinkSync(lockPath); } catch (e) {}
  };
  process.on('exit', release);
  return true;
}

async function pollTelegramCommands(cache) {
  if (!acquireTelegramPollLock()) return;
  log('Telegram-poll: long-poll 25s, en forbindelse, backoff ved feil');
  let backoffMs = 0;
  (async function telegramPollLoop() {
    while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${CONFIG.telegram.token}/getUpdates?offset=${_lastUpdateId + 1}&timeout=25&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`,
        { signal: AbortSignal.timeout(35000) }
      );
      const data = await res.json();
      if (!data || data.ok === false) throw new Error((data && data.description) || ('getUpdates HTTP ' + (res && res.status)));
      backoffMs = 0;
      for (const update of data.result || []) {
        _lastUpdateId = update.update_id;

        // v18.04.b: callback_query for inline-button "Send eval"
        if (update.callback_query) {
          const cb = update.callback_query;
          const cbData = cb.data || '';
          const cbChatId = cb.message?.chat?.id;
          if (String(cbChatId) !== String(CONFIG.telegram.chatId)) {
            await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/answerCallbackQuery`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: cb.id, text: 'Ikke autorisert', show_alert: true }),
            });
            continue;
          }
          // v20.54: Slett fra cache -> bilen prises paa nytt
        if (cbData.startsWith('delcache:')) {
          const idC = cbData.split(':')[1];
          const cacheD = loadJSON(CACHE_FILE);
          const had = String(idC) in cacheD;
          const regnrForV3 = _evalRegnrMap[idC] || (cacheD[String(idC)] && cacheD[String(idC)].regnr) || null;
          delete cacheD[String(idC)]; delete cache[String(idC)];
          saveJSON(CACHE_FILE, cacheD);
          log(`Cache: ${idC} slettet via knapp (hadde=${had})`);
          if (regnrForV3) {
            fetch('http://localhost:7780/trigger-eval?force=true', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + (process.env.EASY_WEBHOOK_TOKEN||''), 'Content-Type': 'application/json' },
              body: JSON.stringify({ regnr: regnrForV3, internnr: idC })
            }).then(r => log(`V3 reprice: ${regnrForV3} HTTP ${r.status}`))
              .catch(e => logErr('v3-reprice', e));
          }
          await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/answerCallbackQuery`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cb.id, text: had ? ('🗑 Slettet fra cache: ' + idC + ' - prises paa nytt') : ('Ikke i cache: ' + idC), show_alert: true }),
          });
          continue;
        }
        if (cbData.startsWith('confirm:')) {
            const erpIdCb = cbData.split(':')[1];
            log(`callback confirm: ${erpIdCb}`);
            await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/answerCallbackQuery`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: cb.id, text: 'Sender...' }),
            });
            const tok = await getErpToken();
            let result = await confirmFinalEstimate(erpIdCb, tok);
            if (!result.ok) {
              log('confirm feilet for ' + erpIdCb + ' - retry om 3s');
              await new Promise(r => setTimeout(r, 3000));
              result = await confirmFinalEstimate(erpIdCb, tok);
            }
            if (result.ok) {
              const r = _evalRegnrMap[erpIdCb] || `ERP-ID ${erpIdCb}`;
              const now = new Date();
              const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
              const ddmm = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;
              await sendTelegram(`✅ Eval sendt for ${r} ${hhmm} ${ddmm}`);
            } else {
              let diagC = '';
              try {
                const vC = await verifyErpStatus(erpIdCb, tok);
                diagC = '\nERP-status: D lav/hoy=' + (vC.dLavHoy ? 'OK' : 'MANGLER') + ' | auctionType=' + (vC.auctionType ? 'OK' : 'MANGLER') + ' | heftelser=' + (vC.encumbrances ? 'OK' : 'MANGLER') + ' | eiere=' + (vC.owners ? 'OK' : 'MANGLER');
              } catch (eVc) {}
              await sendTelegram('\u274c Confirm feilet for ' + erpIdCb + ' (2 forsok): ' + JSON.stringify(result.errors).slice(0, 200) + diagC);
            }
          }
          if (cbData.startsWith('editanchor:')) {
            const erpIdCb = cbData.split(':')[1];
            const r = _evalRegnrMap[erpIdCb] || `ERP-ID ${erpIdCb}`;
            _awaitingAnchor = { erpId: erpIdCb, regnr: r };
            await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/answerCallbackQuery`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: cb.id, text: 'Skriv ny anker' }),
            });
            await sendTelegram(`✏️ Skriv ny anker for ${r} (kun tall, f.eks. 220000):`);
          }
          continue;
        }

        const text = (update.message?.text || '').trim();
        const msgTime = update.message?.date || 0;
        if (Date.now() / 1000 - msgTime > 60) continue;
        // Endre anker: venter vi paa et tall?
        if (_awaitingAnchor && /^\d{4,8}$/.test(text.replace(/\s/g, ''))) {
          const { erpId: aId, regnr: aRegnr } = _awaitingAnchor;
          const nyAnker = parseInt(text.replace(/\s/g, ''), 10);
          _awaitingAnchor = null;
          const d = _evalDataMap[aId];
          if (!d) { await sendTelegram(`❌ Mangler kalkyle-data for ${aRegnr}, kjor eval paa nytt.`); continue; }
          try {
            // Ingen comp-cap ved manuell overstyring — tom pool gir ren spread fra ditt anker
            const nyVal = calcValuation(nyAnker, d.segment, [], {
              regnr: aRegnr,
              year: (d.vegData && d.vegData.firstRegYear) || (d.bil && d.bil.model_year) || 0,
              egenvekt: d.bil && d.bil.egenvekt,
              isVarebil: !!(d.vegData && (d.vegData.isVarebil || /varebil/i.test((d.vegData && d.vegData.avgiftsgruppe) || ''))),
              avgiftsgruppe: d.vegData && d.vegData.avgiftsgruppe
            });
            const tok = await getErpToken();
            try {
              const { easyShouldSkipWrite } = require('./ab-arm.js');
              const why = easyShouldSkipWrite(aId, d.bil && d.bil.source);
              if (why === 'ordna') {
                await sendTelegram(`Ordna: ${aRegnr} eies av V3G. Easy endrer ikke ERP-pris.`);
                continue;
              }
              if (why === 'arm-B') {
                await sendTelegram(`A/B: ${aRegnr} er arm B (V3G). Easy endrer ikke ERP-pris.`);
                continue;
              }
            } catch (eAb) {}
            await writeToERP(aId, nyVal.dLav, nyVal.dHoy, nyVal.auctionTypeId, d.anyDebts, d.brreg, tok, nyAnker);
            try { await pushEasyOverride(aRegnr, aId, nyAnker, nyVal); } catch (eOv) { logErr('pushEasyOverride', eOv); }
            const kalkyle = formatKalkyleBlock(nyVal, nyAnker);
            const nowStr = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' });
            const fullKortTekst = `🔄 ENDRE ANKER ${aRegnr} — ${nowStr}\n\n${kalkyle}`;
            try {
              await maybePostToChat(d.bil, aId, fullKortTekst, tok);
              log(`Endre anker ${aRegnr}: ERP-kommentar skrevet`);
            } catch(eC) { logErr('editanchor postToChat', eC); }
            await sendTelegram(
              `${fullKortTekst}\n\n✅ ERP oppdatert + dokumentert. Klar til sending.`,
              { inline_keyboard: [[
                { text: '✅ Send eval', callback_data: `confirm:${aId}` },
                { text: '✏️ Endre anker', callback_data: `editanchor:${aId}` }, { text: '🗑 Slett cache', callback_data: `delcache:${aId}` }
              ]] }
            );
            log(`Endre anker ${aRegnr}: ${nyAnker} -> dLav ${nyVal.dLav} dHoy ${nyVal.dHoy}`);
          } catch (e) {
            logErr('editanchor', e);
            await sendTelegram(`❌ Feil ved ny kalkyle for ${aRegnr}: ${e.message}`);
          }
          continue;
        }

        if (text === '/run') {
          log('/run mottatt');
          await sendTelegram(`▶️ Kjoring startet... (${VERSION})`);
          runOnce(cache, true);
        }

        // /stuck [N] — sett threshold (arbeidsdager) eller vis status
        if (text.startsWith('/liste16')) {
            try {
              await sendTelegram('🔍 Henter liste 16 (avvist)…');
              const pack = await getListe16Siste(15);
              const linjer = (pack.biler || []).map(b => {
                const st = (b.status_entity && b.status_entity.status) || b.status || '';
                const arsak = b.reject_reason || reasonLabel(b.reject_reason_id) || '—';
                const when = String((b.process_milestones && b.process_milestones.rejected_at) || '').slice(0, 10);
                return '  ' + (b.registration_number || '?') + ' | ' + st + ' | ' + arsak + (when ? ' | ' + when : '');
              });
              await sendTelegram(
                '📋 <b>Liste 16 AVVIST</b> — viser ' + linjer.length + ' av ' + (pack.total || '?') +
                '\nValgt årsak = reject_reason_id\n\n' + (linjer.join('\n') || 'tom')
              );
            } catch (e16) { await sendTelegram('❌ Liste 16: ' + e16.message); }
            continue;
          }
        if (text.startsWith('/liste8')) {
            try {
              _liste8Varslet.clear();
              await sendTelegram('🔍 Sjekker liste 8 nå...');
              await checkListeWatch();
              await sendTelegram('✅ Liste 8-sjekk ferdig');
            } catch(e) { await sendTelegram('❌ Feil: '+e.message); }
            continue;
          }
          if (text.startsWith('/stuck')) {
          const parts = text.split(/\s+/);
          if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
            const newT = parseInt(parts[1], 10);
            setStuckThreshold(newT);
            await sendTelegram(`✅ Stuck-watch threshold satt til ${newT} arbeidsdager.\nVarsel sendes ved neste kjoring.`);
            log(`/stuck threshold satt til ${newT}`);
          } else {
            // /stuck uten arg - vis status og kjor sjekk na
            const t = getStuckThreshold();
            await sendTelegram(`📋 Stuck-watch threshold: ${t} arbeidsdager.\nKjorer sjekk na...`);
            log('/stuck status mottatt');
            const result = await checkStuckCars(true);
            if (result) {
              await sendTelegram(
                `✅ Stuck-sjekk ferdig:\n` +
                `• ${result.newStuck} nye stuck\n` +
                `• ${result.reminders} pamninnelser\n` +
                `• ${result.cleared} biler ferdige (fjernet fra liste)`
              );
            } else {
              await sendTelegram(`❌ Stuck-sjekk feilet — sjekk loggene.`);
            }
          }
        }

        if (text === '/status') {
          await sendTelegram(
            `✅ Peasy Auto ${VERSION}\n` +
            `Brackets: ${_brackets ? 'dynamisk fra Pulse' : 'PDEC1 fallback'}\n` +
            `Cache: ${Object.keys(cache).length} biler\n` +
            `Tidspunkt: ${new Date().toLocaleTimeString('nb-NO')}`
          );
        }

        // PEASY: /REGNR - manuelt eval uten ERP-skriving
      const regnrMatch = text.match(/^[/]([A-Z]{2}[0-9]{4,5})(?:[ ]+([0-9]+))?$/i);
      if (regnrMatch) {
        const regnr = regnrMatch[1].toUpperCase();
        log('/REGNR mottatt: ' + regnr);
        await sendTelegram(String.fromCharCode(55357, 56960) + ' Henter data for ' + regnr + ' (TEST-modus - ingen ERP-skriving)...');
        try {
          await fetchBrackets();
          let br;
          try {
            br = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
            const pg = await br.newPage();
            await pg.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });
            const kmArg = (regnrMatch[2] && parseInt(regnrMatch[2], 10)) || 0; const bil = { testMode: true, registration_number: regnr, id: null, mileage: kmArg, model_year: null, model_series: null };
            await evalCar(bil, pg, cache, { aiCv: true });
          } finally {
            if (br) { try { await br.close(); } catch (e) {} }
          }
        } catch (err) {
          logErr('/REGNR', err);
          await sendTelegram(String.fromCharCode(10060) + ' /REGNR feil: ' + err.message);
        }
      }
      if (text.startsWith('/flushwatch')) {
      const arg = text.replace('/flushwatch', '').trim().toLowerCase();
      try {
        if (arg === 'on' || arg === 'start') {
          const active = await getActivePipeCount();
          if (active === null) { await sendTelegram('\u274c Kunne ikke lese aktive tellere fra ERP.', false); continue; }
          const w = { active: true, notified: false, startedAt: new Date().toISOString(), baseline: active };
          saveFlushWatch(w);
          await sendTelegram('\u2705 <b>Vilkar-flush-vakt startet</b>\n\nOvervaaker ' + active + ' aktive biler i pipe (liste 2-13, ekskl. nye usolgte).\nDu faar varsel naar ALLE er ferdigbehandlet (aktive = 0).\n\nBruk /flushwatch for status, /flushwatch off for aa stoppe.', false);
        } else if (arg === 'off' || arg === 'stop') {
          const w = loadFlushWatch(); w.active = false; saveFlushWatch(w);
          await sendTelegram('\ud83d\uded1 Vilkar-flush-vakt stoppet.', false);
        } else {
          const w = loadFlushWatch();
          if (!w.active && !w.baseline) {
            await sendTelegram('\u2139\ufe0f Ingen vilkar-flush-vakt aktiv.\nStart med /flushwatch on.', false);
          } else {
            const active = await getActivePipeCount();
            const baseline = w.baseline || 0;
            const done = active === null ? '?' : (baseline - active);
            await sendTelegram('\ud83d\udcca <b>Vilkar-flush status</b>\n\nBaseline: ' + baseline + ' aktive\nFlushet: ' + done + '\nGjenstaar: ' + (active === null ? '?' : active) + (w.active ? '' : ' (vakt AV)') + ((active === 0) ? '\n\n\u2705 Alle ferdige!' : ''), false);
          }
        }
      } catch (e) { await sendTelegram('\u274c /flushwatch feil: ' + e.message, false); }
      continue;
      }
      if (text.startsWith('/auksjonok ')) {
        const arg = text.replace('/auksjonok ','').trim().toUpperCase().replace(/\s+/g,'');
        if (!/^[A-Z]{2}\d{4,5}$/.test(arg)) { await sendTelegram('\u26a0\ufe0f Format: /auksjonok REGNR', false); continue; }
        try {
          const fs = require('fs');
          const existing = fs.existsSync(_AUKSJON_BYPASS_FILE) ? fs.readFileSync(_AUKSJON_BYPASS_FILE,'utf8') : '';
          const already = existing.split(/\r?\n/).some(l => l.replace(/#.*$/,'').trim().toUpperCase().replace(/\s+/g,'') === arg);
          if (!already) {
            fs.appendFileSync(_AUKSJON_BYPASS_FILE, (existing && !existing.endsWith('\n') ? '\n' : '') + arg + '  # lagt til ' + new Date().toISOString().slice(0,10) + '\n');
          }
          _auksjonBypass = _loadAuksjonBypass();
          await sendTelegram('\u2705 /auksjonok: ' + arg + ' i bypass (' + _auksjonBypass.size + ' totalt). Triggrer reprice \u2026', false);
          try {
            await fetch('http://localhost:7780/trigger-eval?force=true', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + (process.env.EASY_WEBHOOK_TOKEN||''), 'Content-Type': 'application/json' },
              body: JSON.stringify({ regnr: arg })
            });
          } catch (e) { logErr('auksjonok-reprice', e); }
        } catch (e) { await sendTelegram('\u274c /auksjonok feil: ' + (e.message||e), false); }
        continue;
      }
      if (text.startsWith('/finn ')) {
          log('/finn mottatt: ' + text);
          const parts = text.replace('/finn ', '').trim().split(/\s+/);
          const regnr = parts[0]?.toUpperCase();
          let qaUrl = parts.slice(1).join(' ') || null;
          if (qaUrl && !qaUrl.startsWith('http')) qaUrl = 'https://' + qaUrl.replace(/^\/+/, '');

          if (!regnr) { await sendTelegram('⚠️ Format: /finn REGNR [finn-url]'); continue; }

          await sendTelegram(`🔍 Henter data for ${regnr}...`);
          try {
            const liste3 = await getListe3();
            const bil = liste3.find(b => b.registration_number?.toUpperCase() === regnr);
            if (!bil) { await sendTelegram(`⚠️ ${regnr}: ikke funnet pa liste 3`); continue; }

            await fetchBrackets();
            let br;
            try {
              br = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
              const pg = await br.newPage();
              await pg.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });
              await evalCar(bil, pg, cache, { qaOverrideUrl: qaUrl, aiCv: true });
            } finally {
              if (br) { try { await br.close(); } catch (e) {} }
            }
          } catch (err) {
            logErr('/finn', err);
            await sendTelegram(`❌ /finn feil: ${err.message}`);
          }
        }
      }


          } catch (e) {
            logErr('pollTelegramCommands', e);
            backoffMs = backoffMs ? Math.min(backoffMs * 2, 60000) : 5000;
            await new Promise(r => setTimeout(r, backoffMs));
          }
    }
  })();
}

// Dagspuls/kveldspuls-mail avviklet 19.08.2026 — dagsanalyse overtar.
// Kl 23:30 oppdateres kun peasy-brackets.json.
async function refreshBracketsNightly() {
  log('Brackets nattlig: henter XLSX...');
  try {
    const XLSX = require('xlsx');
    const buf = await refreshXlsxCache(true);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const all = rows.slice(1).filter(r => r[1]);
    await updateBracketsJson(all);
    // v20.159: takst-celler fra faktiske AR-bud → peasy-cells.json (heatmap i Pulse). Kaster aldri.
    try { await require('./takst-celler.js').oppdaterTakstCeller({ rows: all, getToken: getErpToken, log, logErr }); }
    catch (eTc) { logErr('takst-celler', eTc); }
    // v20.163: lav i ERP mot fossefallet for bilens scenario (A/B/Ordna). E-post til Mike bare ved avvik.
    try { await require('./ab-kontroll.js').kjorABKontroll({ rows: all, log, logErr, sendVarsel: (emne, tekst) => sendMail(emne, tekst) }); }
    catch (eAb) { logErr('ab-kontroll', eAb); }
    // v20.164: nye målinger fra A → v2-measurements.jsonl på Pages (bare tillegg). v2-boten gjorde dette før.
    try { require('./publiser-maalinger.js').publiserMaalinger({ log }); }
    catch (ePm) { logErr('publiser-maalinger', ePm); }
  } catch (err) {
    logErr('refreshBracketsNightly', err);
  }
}

// ── Easy-anker-overstyring -> easy-overrides.jsonl (lokalt + GitHub) ───
const EASY_OVERRIDES_FILE = path.join(__dirname, 'easy-overrides.jsonl');
async function pushEasyOverride(regnr, erpId, nyAnker, nyVal) {
  const rec = {
    regnr, erpId, anker: nyAnker,
    dLav: nyVal ? nyVal.dLav : null,
    dHoy: nyVal ? nyVal.dHoy : null,
    timestamp: new Date().toISOString(),
  };
  try { fs.appendFileSync(EASY_OVERRIDES_FILE, JSON.stringify(rec) + '\n'); }
  catch (e) { logErr('easy-overrides lokal', e); }

  const TOKEN = process.env.GITHUB_TOKEN;
  if (!TOKEN) { log('easy-overrides: GITHUB_TOKEN mangler i .env — kun lokal logg'); return; }
  const REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
  const GHFILE = 'easy-overrides.jsonl';
  try {
    const content = Buffer.from(fs.readFileSync(EASY_OVERRIDES_FILE)).toString('base64');
    const shaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${GHFILE}`, {
      headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    const shaData = await shaRes.json();
    const body = { message: `easy-override ${regnr} ${new Date().toISOString().slice(0,10)}`, content };
    if (shaData && shaData.sha) body.sha = shaData.sha;
    const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${GHFILE}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const putData = await putRes.json();
    if (putData.content) log(`easy-overrides: pushet ${regnr} (${nyAnker}) til GitHub`);
    else logErr('easy-overrides push', putData);
  } catch (e) { logErr('easy-overrides push', e); }
}

async function updateBracketsJson(rows) {
  try {
    // v20.158: token fra .env (var hardkodet og utløpt → «Bad credentials» hver natt siden 15.06).
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) { log('Brackets: GITHUB_TOKEN mangler i .env — hopper over'); return; }
    const REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
    const FILE = 'peasy-brackets.json';

    // Beregn Avg Bud/Pris lav per bracket fra solgte biler
    // Col 3 = D lav/høy (format "123000-145000"), Col 4 = Høyeste bud, Col 12 = Status, Col 18 = Solgt dato
    function getBracket(dLav) {
      if (dLav <= 100000) return 'lav';
      if (dLav <= 250000) return 'mid';
      if (dLav <= 400000) return 'hoy';
      if (dLav <= 600000) return 'premiumLav';
      return 'premiumHoy';
    }

    const buckets = { lav: [], mid: [], hoy: [], premiumLav: [], premiumHoy: [] };

    for (const row of rows) {
      const dlStr = String(row[3] || '').trim();
      const bud = parseFloat(row[19]) || 0;
      const solgt = String(row[18] || '').trim();
      if (!dlStr || !bud || !solgt) continue;
      const parts = dlStr.split('-');
      const dLav = parseFloat(parts[0]);
      if (!dLav || dLav <= 0) continue;
      const xPct = (bud - dLav) / dLav;
      if (Math.abs(xPct) > 0.5) continue; // filtrer ekstreme outliers
      const bracket = getBracket(dLav);
      buckets[bracket].push(xPct);
    }

    function avg(arr) {
      if (arr.length === 0) return null;
      return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 1000) / 1000;
    }
    function median(arr) {
      if (arr.length === 0) return null;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return Math.round((s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2) * 1000) / 1000;
    }

    const lav         = median(buckets.lav);
    const mid         = median(buckets.mid);
    const hoy         = median(buckets.hoy);
    const premiumLav  = median(buckets.premiumLav);
    const premiumHoy  = median(buckets.premiumHoy);

    // Vektet snitt av Premium-Lav og Premium-Hoy for bot-bruk (premium-key)
    const nPL = buckets.premiumLav.length;
    const nPH = buckets.premiumHoy.length;
    const premium = (nPL + nPH > 0)
      ? Math.round(((premiumLav || 0) * nPL + (premiumHoy || 0) * nPH) / (nPL + nPH) * 1000) / 1000
      : null;

    log(`Brackets beregnet: lav=${lav} mid=${mid} hoy=${hoy} premiumLav=${premiumLav} premiumHoy=${premiumHoy} premium=${premium} (n: ${buckets.lav.length}/${buckets.mid.length}/${buckets.hoy.length}/${nPL}/${nPH})`);

    // Kun oppdater hvis vi har nok data
    if (!lav || !mid || !hoy || !premium) {
      log('Brackets: for lite data — beholder eksisterende verdier');
      return;
    }

    const newData = { lav, mid, hoy, premium, premiumLav, premiumHoy, updated: new Date().toISOString() };
    const content = Buffer.from(JSON.stringify(newData, null, 2)).toString('base64');

    // Hent nåværende SHA
    const shaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    const shaData = await shaRes.json();
    const sha = shaData.sha;

    // Push oppdatert fil
    const pushRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Auto-update brackets ${new Date().toISOString().slice(0,10)}`, content, sha })
    });
    const pushData = await pushRes.json();
    if (pushData.content) {
      log('Brackets: peasy-brackets.json oppdatert OK');
      log(`Brackets oppdatert: Lav ${(lav*100).toFixed(1)}% | Mid ${(mid*100).toFixed(1)}% | Høy ${(hoy*100).toFixed(1)}% | Premium ${(premium*100).toFixed(1)}%`);
    } else {
      logErr('updateBracketsJson push', pushData);
    }
  } catch (err) {
    logErr('updateBracketsJson', err);
  }
}

// ── Main ──────────────────────────────────────────────────────

// — Liste-watch (8, 9, 10, 11) varsler kl 12 og 15 ——————————————
// LW-01..LW-06 (v18.06)
let _liste8Varslet  = new Set();
let _liste9Varslet  = new Set();
let _liste10Varslet = new Set();
let _liste11Varslet = new Set();
// v20.76: persister liste-watch-key til disk så stuck-mail ikke sendes på nytt etter restart
const LISTE_WATCH_STATE_FILE = path.join(__dirname, 'liste-watch-state.json');
let _listeWatchSistSjekket = '';
try {
  if (fs.existsSync(LISTE_WATCH_STATE_FILE)) {
    const _lws = JSON.parse(fs.readFileSync(LISTE_WATCH_STATE_FILE, 'utf8'));
    _listeWatchSistSjekket = _lws.lastKey || '';
  }
} catch (e) { _listeWatchSistSjekket = ''; }
function _saveListeWatchKey(k) {
  try { fs.writeFileSync(LISTE_WATCH_STATE_FILE, JSON.stringify({ lastKey: k, savedAt: new Date().toISOString() })); }
  catch (e) { logErr('save liste-watch-state', e); }
}

const LISTE_DEFS = [
  { nr: 2,  navn: 'SD MOTTATT',              emoji: '📥', endpoint: 'sd_received',        vis_bud: false },
  { nr: 3,  navn: 'TIL AI-PRISING',          emoji: '🤖', endpoint: 'final_estimate',     vis_bud: false },
  { nr: 4,  navn: 'PÅ VEI',                   emoji: '🚛', endpoint: 'on_the_way',         vis_bud: false }, // v20.85
  { nr: 6,  navn: 'PÅ AUKSJON',               emoji: '🔨', endpoint: 'on_auction',         vis_bud: true  }, // v20.85
  { nr: 8,  navn: 'AUKSJON AVSLUTTET',       emoji: '🏁', endpoint: 'auction_finished',   set: () => _liste8Varslet, vis_bud: true  },
  { nr: 9,  navn: 'VENT PÅ BUDAKSEPT',        emoji: '⏳', endpoint: 'wait_for_bid_accept',vis_bud: true  }, // v20.85
  { nr: 10, navn: 'UFERDIGE KONTRAKTER',     emoji: '📝', endpoint: 'incomplete_contract',set: () => _liste11Varslet, vis_bud: false },
  { nr: 11, navn: 'VENTER PÅ SIGNERING',       emoji: '✍️', endpoint: 'wait_for_signing',   vis_bud: false },
  { nr: 12, navn: 'KONTRAKT SIGNERT',        emoji: '📄', endpoint: 'contract_signed',    vis_bud: false },
  { nr: 13, navn: 'VENTER PÅ SALGSMELDING',    emoji: '📮', endpoint: 'wait_for_sales_note',vis_bud: false },
];

async function checkListeWatch(force = false) {
  const now = new Date();
  const oslo = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const h = oslo.getHours();
  const key = oslo.toISOString().slice(0,10) + 'h' + h;
  if (!force) {
    if ((h !== 12 && h !== 15) || _listeWatchSistSjekket === key) return;
    _listeWatchSistSjekket = key;
    _saveListeWatchKey(key);
  }

  const { buildStuckOversikt, shouldSendStuck } = require('./stuck-oversikt');
  try {
    const token = await getErpToken();
    const digest = await buildStuckOversikt({
      now,
      log: log,
      fetchJson: async function (path) {
        const res = await fetch(CONFIG.erp.base + path, { headers: authH(token) });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
        return res.json();
      },
    });
    log('Stuck-oversikt: ' + digest.totalt + ' biler (terskel ' + digest.terskel + ')');
    if (!digest.totalt) return;
    if (!shouldSendStuck()) {
      log('STUCK_SEND av — hopper send. Emne: ' + digest.emne);
      return;
    }
    await sendTelegram('📋 <b>' + digest.emne.replace(/</g,'') + '</b>\n\n' + digest.seksjoner.join('\n\n'));
    log('Stuck-oversikt sendt: ' + digest.totalt + ' biler');
    await sendMail(digest.emne, digest.kropp, { cc: 'post@peasy.no' });
  } catch(e) { logErr('checkListeWatch', e); }
}

// checkStuckCars: kjorer liste-watch (2/3/4/6/8/9/10/11/12/13). Returnerer tomt resultat for /stuck-kommandoen.
async function checkStuckCars(force = false) {
  await checkListeWatch(force);
  return { newStuck: 0, reminders: 0, cleared: 0 };
}
// Bakoverkompatibilitet — main() kaller fortsatt checkAuksjonAvsluttet
async function checkAuksjonAvsluttet() {
  return checkListeWatch();
}

async function main() {
  log(`Peasy Auto ${VERSION} starter`);

  const required = ['TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID', 'ERP_USER', 'ERP_PASS', 'ANTHROPIC_API_KEY', 'VEGVESEN_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`FEIL: Mangler .env-variabler: ${missing.join(', ')}`);
    process.exit(1);
  }

  const cache = loadJSON(CACHE_FILE);
  log(`Cache: ${Object.keys(cache).length} biler allerede skrevet`);

  // Webhook for Send eval-knapp fra Pulse - kaller promoteToListe3
  try {
    const wh = require('./webhook-server');
    wh.setTriggerFn(async function(payload) {
      const regnr = String(payload.regnr||'').toUpperCase().replace(/\s/g,'');
      log('[send-eval] mottatt regnr='+regnr+' internnr='+(payload.internnr||'-'));
      const kmBlock = require('./km-qa-block').findKmBlock(regnr);
      if (kmBlock && kmBlock.blocked) {
        log('[send-eval] '+regnr+' blokkert: '+kmBlock.message);
        throw new Error(kmBlock.message);
      }
      const tok = await getErpToken();
      const liste3 = await getListe3();
      const innStr = String(payload.internnr||'').trim();
      // Primaer: match pa internnr (siden samme regnr kan ha flere instanser)
      let target = innStr ? (liste3 || []).find(b => String(b.inner_number||b.internal_number||b.stock_number||'').trim() === innStr) : null;
      // Fallback: regnr
      if (!target) target = (liste3 || []).find(b => String(b.registration_number||b.regnr||'').replace(/\s/g,'').toUpperCase() === regnr);
      if (!target) { log('[send-eval] '+regnr+' (inn='+innStr+') ikke i liste 3'); throw new Error('Bil ikke i liste 3 (final_estimate)'); }
      const erpId = target.id;
      if (!erpId) throw new Error('Bil mangler id');
      const result = await confirmFinalEstimate(erpId, tok);
      if (!result || !result.ok) {
        log('[send-eval] '+regnr+' confirm feilet: '+JSON.stringify(result&&result.errors||result));
        throw new Error('confirmFinalEstimate feilet');
      }
      log('[send-eval] '+regnr+' confirm OK (erpId='+erpId+')');
    });
    wh.setAnkerFn(async function(payload) {
      const regnr = String(payload.regnr || '').toUpperCase().replace(/\s/g, '');
      // v20.166: ståtid-haken sender bilens eksisterende Finn-utpris — den rundes ikke av på nytt.
      const _harStatid = payload.statidKr != null && payload.statidKr !== '';
      const anker = _harStatid ? Math.round(parseInt(payload.anker, 10)) : Math.round(parseInt(payload.anker, 10) / 1000) * 1000;
      if (!regnr || !Number.isFinite(anker) || anker < 5000) throw new Error('regnr og anker kreves');
      const kmAnkerBlock = require('./km-qa-block').findKmBlock(regnr);
      if (kmAnkerBlock && kmAnkerBlock.blocked) throw new Error(kmAnkerBlock.message);
      const tok = await getErpToken();
      const liste3 = await getListe3();
      const innStr = String(payload.internnr || '').trim();
      let target = innStr ? (liste3 || []).find(b => String(b.id) === innStr) : null;
      if (!target && innStr) {
        target = (liste3 || []).find(b => String(b.inner_number || b.internal_number || b.stock_number || '').trim() === innStr);
      }
      if (!target) target = (liste3 || []).find(b => String(b.registration_number || b.regnr || '').replace(/\s/g, '').toUpperCase() === regnr);
      if (!target || !target.id) throw new Error('Bil ikke i liste 3 (final_estimate)');
      const erpId = target.id;
      const source = target.source || payload.source || null;
      const { liveOwner } = require('./ab-arm.js');
      const km = Number(target.mileage || payload.km || 0) || 0;
      const year = Number(target.model_year || (target.drive_no_car_data && target.drive_no_car_data.model_year) || 0) || 0;
      const d = _evalDataMap[erpId];
      const egenvekt = (d && d.bil && d.bil.egenvekt) || target.egenvekt || null;
      // v20.154: manuell Finn-utpris går gjennom fossefallet (tabellene) for A, B og Ordna.
      // Før: calcValuation (A) og setV3gAnker (B/Ordna), og målingen manglet årsmodell → omreg for 2020 → PRIS MANUELT i Pulse.
      const { planQaAnker } = require('./qa-anker-plan');
      const plan = await planQaAnker({ anker, km, year, egenvekt, erpId, source, statidKr: payload.statidKr,
        isVarebil: !!(d && d.vegData && (d.vegData.isVarebil || /varebil/i.test(d.vegData.avgiftsgruppe || ''))) });
      if (!plan.ok) {
        log('[qa-anker] ' + regnr + ' anker=' + anker + ' PRIS MANUELT: ' + plan.grunn);
        return { ok: false, err: 'PRIS MANUELT — ' + plan.grunn, regnr, erpId, anker, arm: plan.arm || null };
      }
      const nyVal = { dLav: plan.dLav, dHoy: plan.dHoy, auctionTypeId: plan.auctionTypeId };
      const anyDebts = d && d.anyDebts;
      const brreg = (d && d.brreg) || { anyDebts: !!anyDebts, text: '' };
      const ok = await writeToERP(erpId, nyVal.dLav, nyVal.dHoy, nyVal.auctionTypeId, !!anyDebts, brreg, tok, anker);
      if (!ok) throw new Error('ERP-skriv feilet');
      try { originComps.persistQaUtpris({ regnr, internnr: erpId, anker }); } catch (eP) { logErr('qa-anker persist', eP); }
      try {
        writeEasyMeasurement(regnr, erpId, target, null, {
          easy_eval: {
            anker,
            finn_utpris: anker,
            dLav: nyVal.dLav,
            dHoy: nyVal.dHoy,
            model_year: year || null,
            egenvekt: egenvekt,
            source: source,
            anker_kilde: 'qa',
            begrunnelse_kort: plan.statidKr ? 'QA manuell Finn-utpris + ståtid ' + plan.statidKr : 'QA manuell Finn-utpris',
            statid_qa_kr: plan.statidKr || 0,
            statid_qa_kilde: payload.statidKilde || null,
            chefs: { merge: { finn_utpris: anker, method: 'qa', begrunnelse: 'QA manuell Finn-utpris' } },
          },
        });
      } catch (eM) { logErr('qa-anker meas', eM); }
      try { addToCache(cache, erpId); } catch (eCch) { logErr('qa-anker cache', eCch); }
      try { if (typeof _bilCache !== 'undefined' && _bilCache) _bilCache.delete(regnr); } catch (_) {}
      try { await pushEasyOverride(regnr, erpId, anker, nyVal); } catch (eOv) { logErr('qa-anker override', eOv); }
      try {
        await maybePostToChat(target, erpId, 'ENDRE ANKER FRA QA ' + regnr + '\nANKER ' + anker + (plan.statidKr ? '\nSTÅTID ' + plan.statidKr + ' (godkjent i QA, kilde carinfo)' : '') + '\nD lav ' + nyVal.dLav + '\nD høy ' + nyVal.dHoy, tok);
      } catch (eC) { logErr('qa-anker kort', eC); }
      log('[qa-anker] fossefall ' + plan.arm + ' ' + regnr + ' anker=' + anker + (plan.statidKr ? ' ståtid=' + plan.statidKr : '') + ' dLav=' + nyVal.dLav + ' dHoy=' + nyVal.dHoy);
      return {
        ok: true,
        regnr,
        erpId,
        owner: liveOwner(erpId, source),
        arm: plan.arm,
        anker,
        dLav: nyVal.dLav,
        dHoy: nyVal.dHoy,
        statidKr: plan.statidKr || 0,
        kalkyle: 'fossefall',
      };
    });
    wh.setReevalFn(async function(payload) {
      const { lastQueueEasy, clearReevalLock, setReevalLock } = require('./qa-clear-cache');
      const regnr = String(payload.regnr || '').toUpperCase().replace(/\s/g, '');
      const innStr = String(payload.internnr || '').trim();
      if (innStr) delete cache[String(innStr)];
      log('[qa-reeval] blank slate ' + regnr + ' inn=' + (innStr || '-'));
      const liste3 = await getListe3();
      let bil = innStr ? (liste3 || []).find(b => String(b.id) === innStr) : null;
      if (!bil && innStr) {
        bil = (liste3 || []).find(b => String(b.inner_number || b.internal_number || b.stock_number || '').trim() === innStr);
      }
      if (!bil) {
        bil = (liste3 || []).find(b => String(b.registration_number || b.regnr || '').replace(/\s/g, '').toUpperCase() === regnr);
      }
      if (!bil || !bil.id) throw new Error('Bil ikke i liste 3 (final_estimate)');
      delete cache[String(bil.id)];
      const plate = bil.registration_number || regnr;
      const km = Number(bil.mileage || 0) || null;
      setReevalLock(plate, bil.id);
      try {
        await fetchBrackets();
        let br;
        try {
          br = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
          const pg = await br.newPage();
          await pg.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });
          await evalCar(bil, pg, cache, { aiCv: true, qaReeval: true });
          log('[qa-reeval] Easy ferdig ' + plate + ' erpId=' + bil.id);
        } catch (eEasy) {
          logErr('[qa-reeval] Easy', eEasy);
        } finally {
          if (br) { try { await br.close(); } catch (e) {} }
        }
        const easyEval = lastQueueEasy(plate);
        await Promise.all([
          (async () => {
            const { evalRegnr: evalV3 } = await import('./v3-eval-runner.mjs');
            await evalV3(plate, km, { erpId: bil.id, easyEval: easyEval || null });
            log('[qa-reeval] V3 ferdig ' + plate);
          })().catch((e) => logErr('[qa-reeval] V3', e)),
          (async () => {
            const { evalRegnr: evalV3g } = await import('./v3g/v3g-eval.js');
            await evalV3g(plate, km, { erpId: bil.id });
            log('[qa-reeval] V3G ferdig ' + plate + ' erpId=' + bil.id);
          })().catch((e) => logErr('[qa-reeval] V3G', e)),
        ]);
        log('[qa-reeval] ferdig Easy+V3+V3G ' + plate);
      } finally {
        clearReevalLock(plate);
      }
    });
    var _bilCache = new Map();
    wh.setListFetcher(async function(endpoint, opts) {
      opts = opts || {};
      var page = Math.max(1, parseInt(opts.page, 10) || 1);
      var perPage = Math.min(100, Math.max(1, parseInt(opts.per_page, 10) || 100));
      var url = CONFIG.erp.base + '/c2b_module/peasy/processing/' + endpoint + '?per_page=' + perPage + '&page=' + page;
      var res = await erpFetch(url);
      if (!res.ok) throw new Error('ERP ' + res.status + ' for ' + endpoint);
      var data = await res.json();
      var pag = data && data.data && data.data.data;
      var biler = (pag && Array.isArray(pag.data) ? pag.data : null)
        || (data && data.data && data.data.data && data.data.data.data)
        || (data && data.data && data.data.data)
        || (data && data.data) || [];
      var _arr = Array.isArray(biler) ? biler : [];
      // Bakoverkompat: uten eksplisitt page på rejected, hent siste 2 sider
      if (endpoint === 'rejected' && opts.page == null && opts.per_page == null) {
        var pagMeta = (data && data.data && data.data.data) || {};
        var lastPage = Number(pagMeta.last_page) || 1;
        var merged = [];
        var fromPage = Math.max(1, lastPage - 1);
        for (var lp = fromPage; lp <= lastPage; lp++) {
          var urlLast = CONFIG.erp.base + '/c2b_module/peasy/processing/rejected?per_page=100&page=' + lp;
          var resLast = await erpFetch(urlLast);
          if (!resLast.ok) continue;
          var dataLast = await resLast.json();
          var pagL = dataLast && dataLast.data && dataLast.data.data;
          var chunk = (pagL && Array.isArray(pagL.data) ? pagL.data : []);
          merged = merged.concat(chunk);
        }
        if (merged.length) _arr = merged;
      }
      if (endpoint === 'rejected') {
        _arr = _arr.map(function (b) { return enrichRejected(b); });
      }
      try {
        var _fs = require('fs');
        var _fl = JSON.parse(_fs.readFileSync('/Users/bot/peasy-auto/finn-links.json','utf8')) || {};
        _arr.forEach(function(b){ if (b && b.id != null) { var _k = String(b.id); if (_fl[_k]) b.finn_link = _fl[_k]; } });
      } catch (e) {}
      var total = (pag && pag.total != null) ? pag.total : _arr.length;
      var last_page = (pag && pag.last_page != null) ? pag.last_page : 1;
      var cur = (pag && pag.current_page != null) ? pag.current_page : page;
      var pp = (pag && pag.per_page != null) ? pag.per_page : perPage;
      return { biler: _arr, page: cur, per_page: pp, total: total, last_page: last_page };
    });

    if (typeof wh.setBilLookup === 'function') wh.setBilLookup(async function(regnr) {
      var plate = String(regnr || '').toUpperCase().replace(/[\s-]/g, '');
      if (!_bilCache) _bilCache = new Map();
      var cached = _bilCache.get(plate);
      if (cached && (Date.now() - cached.at) < 5 * 60 * 1000) return cached.payload;

      var LISTS = [
        // Før estimering først (liste 2/3)
        'sd_received', 'final_estimate',
        'order_delivery', 'on_the_way', 'received', 'car_received', 'waiting_for_preparation',
        'ready_for_auction', 'on_auction', 'auction_finished', 'wait_for_bid_accept',
        'incomplete_contract', 'wait_sign_contract', 'wait_for_signing', 'contract_signed', 'wait_for_sales_note',
        'sold', 'returned', 'rejected'
      ];
      var hit = null;
      var hitListe = null;
      for (var i = 0; i < LISTS.length; i++) {
        var liste = LISTS[i];
        var url = CONFIG.erp.base + '/c2b_module/peasy/processing/' + liste +
          '?per_page=20&filter[registration_number]=' + encodeURIComponent(plate);
        var res;
        try { res = await erpFetch(url); } catch (eAuth) { throw eAuth; }
        if (res.status === 404) continue;
        if (!res.ok) continue;
        var data = await res.json();
        var pag = data && data.data && data.data.data;
        var arr = (pag && Array.isArray(pag.data) ? pag.data : []) || [];
        for (var j = 0; j < arr.length; j++) {
          var b = arr[j];
          var r = String((b && b.registration_number) || '').toUpperCase().replace(/[\s-]/g, '');
          if (r === plate) { hit = b; hitListe = liste; break; }
        }
        if (hit) break;
      }
      if (!hit) {
        var miss = { regnr: plate, funnet: false };
        _bilCache.set(plate, { at: Date.now(), payload: miss });
        return miss;
      }

      var dnc = hit.drive_no_car_data || {};
      var user = hit.user || {};
      var km = null;
      var drivstoff = null;
      try {
        var cres = await erpFetch(CONFIG.erp.base + '/c2b_module/peasy/cars/' + hit.id);
        if (cres.ok) {
          var cj = await cres.json();
          var car = (cj && cj.data && cj.data.car) || (cj && cj.data) || {};
          if (car.mileage != null) km = car.mileage;
          drivstoff = car.fuel_type || car.fuel || car.engine_type || null;
        }
      } catch (_) {}

      var measurements = [];
      try {
        var fs = require('fs');
        var lines = fs.readFileSync('/Users/bot/peasy-auto/v2/logs.nosync/measurements.jsonl', 'utf8').split('\n');
        var rows = [];
        for (var li = 0; li < lines.length; li++) {
          if (!lines[li]) continue;
          try {
            var row = JSON.parse(lines[li]);
            if (String(row.regnr || '').toUpperCase().replace(/[\s-]/g, '') === plate) rows.push(row);
          } catch (_) {}
        }
        rows = rows.slice(-3);
        measurements = rows.map(function(row) {
          var easy = row.easy || {};
          var v2 = row.v2 || {};
          return {
            timestamp: row.timestamp || null,
            writer: row.writer || row.log_file || null,
            easy: {
              finn_utpris: easy.finn_utpris != null ? easy.finn_utpris : (easy.T != null ? easy.T : null),
              dLav: easy.dLav != null ? easy.dLav : null,
              dHoy: easy.dHoy != null ? easy.dHoy : null,
              model: easy.model || easy.bracket || null,
              breakdown: easy.breakdown || easy.anchor_reason || null,
            },
            v2: {
              anker: v2.anker != null ? v2.anker : null,
              dLav: v2.dLav != null ? v2.dLav : null,
              dHoy: v2.dHoy != null ? v2.dHoy : null,
              segment: v2.segment || null,
            },
            fossefall: row.fossefall || null,
          };
        });
      } catch (_) {}

      var status = (hit.status_entity && hit.status_entity.status) || hit.workflow_state || hit.status || null;
      var payload = {
        regnr: plate,
        liste: hitListe,
        id: hit.id,
        source: hit.source || null,
        status: status,
        estimat_sendt: {
          min: hit.price_final_min != null ? hit.price_final_min : hit.price_temp_min,
          max: hit.price_final_max != null ? hit.price_final_max : hit.price_temp_max,
          tid: (hit.process_milestones && hit.process_milestones.fe_created_at) || null,
        },
        hoyeste_bud: hit.highest_bid != null ? hit.highest_bid : null,
        milestones: hit.process_milestones || {},
        avvisning: {
          reason_id: hit.reject_reason_id != null ? hit.reject_reason_id : null,
          kommentar: hit.reject_comment || hit.reject_reason || null,
        },
        bil: {
          merke: dnc.manufacturer_name || hit.manufacturer || dnc.brand || null,
          modell: dnc.model_series || dnc.model || null,
          aar: dnc.model_year != null ? dnc.model_year : null,
          km: km,
          drivstoff: drivstoff,
        },
        postnr: (user && user.zip) || null,
        measurements: measurements,
        fossefall: (function(){
          for (var mi = measurements.length - 1; mi >= 0; mi--) {
            if (measurements[mi] && measurements[mi].fossefall) return measurements[mi].fossefall;
          }
          return null;
        })(),
      };
      _bilCache.set(plate, { at: Date.now(), payload: payload });
      return payload;
    });


  wh.setCarFetcher(async function(carId) {
    const tok = await getErpToken();
    const url = `${CONFIG.erp.base}/cars/${carId}`;
    const res = await fetch(url, { headers: authH(tok) });
    if (!res.ok) throw new Error(`ERP ${res.status} for car ${carId}`);
    const data = await res.json();
    const bil = (data && data.data) ? data.data : data;
    return bil;
  });
  if (typeof wh.setAuctionDatesFn === "function") wh.setAuctionDatesFn(async function() {
    const fs = require("fs");
    const cachePath = require("path").join(__dirname, "logs.nosync", "auction-dates.json");
    let dates = {};
    try { dates = (JSON.parse(fs.readFileSync(cachePath, "utf8")) || {}).dates || {}; } catch (e) { dates = {}; }
    const tok = await getErpToken();
    const lists = ["wait_for_bid_accept", "on_auction", "auction_finished"];
    for (const ep of lists) {
      let arr = [];
      try {
        const url = CONFIG.erp.base + "/c2b_module/peasy/processing/" + ep + "?per_page=100";
        const res = await fetch(url, { headers: authH(tok) });
        if (!res.ok) continue;
        const data = await res.json();
        const pag = data && data.data && data.data.data;
        arr = (pag && Array.isArray(pag.data) ? pag.data : null) || [];
        if (!Array.isArray(arr)) arr = [];
      } catch (eL) { continue; }
      for (const b of arr) {
        const id = b && b.id;
        if (id == null) continue;
        try {
          const curl = CONFIG.erp.base + "/c2b_module/peasy/cars/" + id;
          const cres = await fetch(curl, { headers: authH(tok) });
          if (!cres.ok) continue;
          const cj = await cres.json();
          const car = cj && cj.data && cj.data.car;
          const ad = car && car.auction_date;
          if (ad) {
            dates[String(id)] = String(ad).split(" ")[0];
            const reg = String((car.registration_number || b.registration_number || "")).toUpperCase().replace(/\s/g, "");
            if (reg) dates[reg] = dates[String(id)];
          }
        } catch (eC) {}
      }
    }
    const out = { ok: true, dates: dates, updatedAt: new Date().toISOString() };
    try { fs.writeFileSync(cachePath, JSON.stringify(out)); } catch (eW) {}
    return out;
  });
    wh.start(log);
  } catch(e) { log('[webhook] start-feil: '+(e&&e.message||e)); }

  await sendTelegram(`🚀 Peasy Auto ${VERSION} startet — liste-watch 2/3/4/6/8/9/10/11/12/13 kl 12 og 15`);
  runOnce(cache).catch(e => logErr('runOnce init', e));

  // [auksjon-blocker] initial refresh + hver 30 min
  _refreshAuksjonHistorikk();
  setInterval(_refreshAuksjonHistorikk, 30 * 60 * 1000);
  refreshXlsxCache(false).catch(function(e){ logErr('xlsx-cache init', e); });
  setInterval(function(){ refreshXlsxCache(true).catch(function(e){ logErr('xlsx-cache interval', e); }); }, 10 * 60 * 1000);
  pollTelegramCommands(cache);

  setInterval(async () => {
    await checkAuksjonAvsluttet();
        const now = new Date();
    if (now.getMinutes() % 5 === 0) {
      await runOnce(cache);
      if (now.getHours() === 23 && now.getMinutes() === 30) await refreshBracketsNightly();
    }
  }, 60000);

  process.on('SIGINT', () => { log('Stopper...'); process.exit(0); });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

