// ============================================================
// peasy-auto.js v18.03.j
// Peasy C2B Bruktbil — Automatisk evaluering
//
// Kjorer: Liste 3 (estimating_ar_final), 1x per time 07-17
// Design: peasy-system-reference.html v2.0
//
// Moduler:
//   main()             — starter scheduler og Telegram-polling
//   runOnce()          — henter liste 3, looper biler
//   evalCar()          — koordinator per bil
//   getVegvesenData()  — henter bildata fra Vegvesen
//   getFinnComps()     — Finn-sok med km-filter (Playwright)
//   getAnchor()        — AI-ankervalg via Claude Haiku
//   calcValuation()    — prisformel (T, fee, D mid, D lav/hoy, E)
//   checkFinnListing() — sjekker om bilen er pa Finn
//   checkBrreg()       — heftelsessjekk via Playwright
//   writeToERP()       — PUT med alle EC-24 felter
//   postToChat()       — POST til intern kommentar, kun 1 gang
//   sendTelegram()     — sender eval-kort
//   checkTeslaPrices() — Tesla prisovervaking (aktiv ut mars 2026)
// ============================================================

'use strict';

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VERSION = 'v18.03.j';
const CACHE_FILE = path.join(__dirname, 'peasy-cache.json');
const TESLA_CACHE_FILE = path.join(__dirname, 'tesla-prices.json');
const LOCK_FILE = '/tmp/peasy.lock';

// ── Enkelt-instans las ────────────────────────────────────────
try {
  const old = fs.existsSync(LOCK_FILE) && parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
  if (old && old !== process.pid) {
    try { process.kill(old, 'SIGKILL'); } catch (e) {}
  }
} catch (e) {}
fs.writeFileSync(LOCK_FILE, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch (e) {} });

// ── Konfigurasjon ─────────────────────────────────────────────
const CONFIG = {
  version: VERSION,
  schedule: { startHour: 7, endHour: 17 },
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
  pdec1: { lav: 0.102, mid: -0.089, hoy: -0.046, premium: -0.073 },
  fee: [
    { maxT: 75000,    fee: 5900 },
    { maxT: 125000,   fee: 7900 },
    { maxT: Infinity, fee: 9900 },
  ],
};

// ── Logging ───────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] [${VERSION}] ${msg}`);
}
function logErr(ctx, err) {
  console.error(`[${new Date().toISOString()}] [${VERSION}] FEIL [${ctx}]`, err?.message || err || '');
}

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
function addToCache(cache, erpId) {
  cache[String(erpId)] = new Date().toISOString();
  saveJSON(CACHE_FILE, cache);
  log(`Cache: ${erpId} lagt til`);
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

function authH(token) { return { 'Authorization': `Bearer ${token}` }; }

// ── ERP: Hent liste 3 ─────────────────────────────────────────
async function getListe3() {
  log('ERP: henter liste 3...');
  const token = await getErpToken();
  const res = await fetch(
    `${CONFIG.erp.base}/c2b_module/driveno/processing/estimating_ar_final?per_page=100`,
    { headers: authH(token) }
  );
  const data = await res.json();
  const biler = data.data?.data?.data || [];
  log(`ERP: ${biler.length} biler pa liste 3`);
  return biler;
}

// ── ERP: Hent bildetaljer ─────────────────────────────────────
async function getErpCarDetail(erpId, token) {
  const res = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}`, {
    headers: authH(token),
  });
  const data = await res.json();
  return data.data?.car || null;
}

// ── ERP: Skriv alle felt via API PUT ─────────────────────────
async function writeToERP(erpId, dLav, dHoy, auctionTypeId, anyDebts, brreg, token) {
  log(`ERP: PUT bil ${erpId}...`);
  const today = new Date().toISOString().split('T')[0];

  const payload = {
    price_final_min: dLav,
    price_final_max: dHoy,
    auction_price_type_id: auctionTypeId,
    encumbrance: {
      is_checked: true,
      has_debt: anyDebts,
      comment: brreg.text || 'Ingen heftelser',
      date: today,
    },
    owners_is_checked: true,
    owners_check_date: today,
  };
  if (anyDebts) payload.finance = { has_finance: true };

  const res = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}`, {
    method: 'PUT',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (data.success) {
    log(`ERP: bil ${erpId} OK — dLav=${dLav}, dHoy=${dHoy}, type=${auctionTypeId}, heftelser=${anyDebts}`);
    return true;
  }
  logErr(`writeToERP ${erpId}`, data);
  return false;
}

// ── ERP: Post eval-kort til intern kommentar (kun 1 gang) ─────
async function postToChat(erpId, evalText, token) {
  // Sjekk eksisterende kommentarer
  const checkRes = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}/comments/all`, {
    headers: authH(token),
  });
  const checkData = await checkRes.json();
  const existing = Array.isArray(checkData.data) ? checkData.data : [];

  // Hopp over hvis Peasy-kommentar allerede finnes
  if (existing.some(c => (c.comment || '').includes('BIL TIL ESTIMERING'))) {
    log(`Kommentar: bil ${erpId} har allerede eval-kort — skipper`);
    return false;
  }

  const plain = evalText.replace(/<[^>]+>/g, '');
  const res = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}/comments`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: plain }),
  });
  const data = await res.json();

  if (data.success) { log(`Kommentar: postet for bil ${erpId}`); return true; }
  logErr(`postToChat ${erpId}`, data);
  return false;
}

// ── Telegram ──────────────────────────────────────────────────
async function sendTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegram.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) { logErr('sendTelegram', e); }
}

// ── Vegvesen ──────────────────────────────────────────────────
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
  const motor = td?.motorOgDrivverk?.motor?.[0];
  const drivstoff = motor?.drivstoff?.[0];
  const miljo = td?.miljodata?.miljoOgdrivstoffGruppe?.[0];
  const utslipp = miljo?.forbrukOgUtslipp?.[0];
  const aksler = td?.akslinger?.akselGruppe || [];
  const drivAksler = aksler.filter(g => g.akselListe?.aksel?.some(a => a.drivAksel)).length;
  const generelt = td?.generelt;
  const firstRegStr = k.godkjenning?.forstegangsGodkjenning?.forstegangRegistrertDato || '';
  const firstRegMonth = firstRegStr ? parseInt(firstRegStr.split('-')[1] || '0') : 0;
  const kw = drivstoff?.maksNettoEffekt || drivstoff?.maksEffektPrTime || 0;

  return {
    make: generelt?.merke?.[0]?.merke || '',
    model: generelt?.handelsbetegnelse?.[0] || '',
    fuel: drivstoff?.drivstoffKode?.kodeBeskrivelse || 'Ukjent',
    gearbox: td?.motorOgDrivverk?.girkassetype?.kodeBeskrivelse || 'Ukjent',
    kw,
    hk: Math.round(kw * 1.36),
    drive: drivAksler >= 2 ? '4WD' : '2WD',
    range: utslipp?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring || null,
    isVarebil: k?.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering
      ?.tekniskKode?.kodeBeskrivelse?.toLowerCase().includes('varebil') || false,
    firstRegMonth,
  };
}

// ── Finn ──────────────────────────────────────────────────────
function getFinnFuelCode(fuel) {
  const f = fuel.toLowerCase();
  if (f.includes('elektr')) return '4';
  if (f.includes('diesel')) return '2';
  if (f.includes('hybrid')) return '3';
  return '1';
}

function buildFinnUrl(make, model, yearFrom, yearTo, vegData, noFuel = false) {
  const regClass = vegData.isVarebil ? '2' : '1';
  const cleanMake = make
    .replace(/\s*MOTORS\s*/i, '')
    .replace(/JAGUAR LAND ROVER LIMITED/i, 'Land Rover')
    .trim();
  const q = `${cleanMake} ${model}`;
  const fuelParam = noFuel ? '' : `&fuel=${getFinnFuelCode(vegData.fuel)}`;
  return `https://www.finn.no/mobility/search/car?sales_form=1&registration_class=${regClass}&q=${encodeURIComponent(q)}${fuelParam}&year_from=${yearFrom}&year_to=${yearTo}&sort=MILEAGE_ASC`;
}

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
      const year = parseInt((text.match(/\b(19\d{2}|20\d{2})\b/) || [])[1]) || 0;
      const link = a.querySelector('a')?.href || '';
      return { price, km, year, link };
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

async function getFinnComps(bil, vegData, page) {
  const yBase = bil.model_year || 0;
  const yFrom = yBase;
  const yTo = vegData.firstRegMonth >= 9 ? yBase + 1 : yBase;

  // Steg 1: søk med fuel-filter
  const urlVariants = [
    buildFinnUrl(vegData.make, bil.model_series || '', yFrom,     yTo,     vegData),
    buildFinnUrl(vegData.make, bil.model_series || '', yFrom - 1, yTo + 1, vegData),
    buildFinnUrl(vegData.make, bil.model_series || '', yFrom - 2, yTo + 2, vegData),
  ];

  // Steg 2: hvis 0 treff på alle — prøv uten fuel-filter
  const noFuelVariants = [
    buildFinnUrl(vegData.make, bil.model_series || '', yFrom,     yTo,     vegData, true),
    buildFinnUrl(vegData.make, bil.model_series || '', yFrom - 1, yTo + 1, vegData, true),
    buildFinnUrl(vegData.make, bil.model_series || '', yFrom - 2, yTo + 2, vegData, true),
  ];

  const seen = new Set();
  let allComps = [];
  let totalCount = 0;
  let finnUrl = urlVariants[0];

  for (const variants of [urlVariants, noFuelVariants]) {
    for (const url of variants) {
      const { comps, totalCount: tc } = await scrapeFinnUrl(url, page);
      if (tc > totalCount) { totalCount = tc; finnUrl = url; }
      for (const c of comps) {
        const key = `${c.price}-${c.km}`;
        if (!seen.has(key) && c.km <= 500000) { seen.add(key); allComps.push(c); }
      }
      if (allComps.length >= 10) break;
    }
    if (allComps.length > 0) break; // fant noe — ikke prøv no-fuel
    log('Finn: 0 treff med fuel-filter — prover uten fuel');
  }

  // Km-filter
  let pool = allComps;
  for (const band of [30000, 50000, 80000, 150000]) {
    const f = allComps.filter(c => Math.abs(c.km - bil.mileage) <= band);
    if (f.length >= 3) { pool = f; break; }
  }
  pool.sort((a, b) => a.price - b.price);
  log(`Finn: pool = ${pool.length} biler`);
  return { pool, finnUrl, totalCount };
}

async function checkFinnListing(regnr, page) {
  try {
    await page.goto(
      `https://www.finn.no/mobility/search/car?q=${regnr}&registration_class=1&sales_form=1`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => {
      const a = document.querySelector('article');
      if (!a) return null;
      const text = a.innerText || '';
      const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g, '')) || 0;
      const link = a.querySelector('a')?.href || '';
      return price > 0 ? { price, url: link } : null;
    });
    if (result) log(`Finn: ${regnr} funnet til ${result.price} kr`);
    return result;
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

// ── AI-anker ──────────────────────────────────────────────────
async function getAnchor(pool, bil, vegData) {
  const top5 = pool.slice(0, 5);
  const hk = Math.round((vegData.kw || 0) * 1.36);
  const listings = top5.map((c, i) =>
    `${i + 1}. ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year}`
  ).join('\n');

  const prompt = `Du er bruktbilekspert i Norge for Peasy (C2B auksjon).
Bilen som prises: ${bil.model_year || ''} ${vegData.make} ${bil.model_series || ''}, ${(bil.mileage || 0).toLocaleString('nb-NO')} km, ${vegData.fuel}, ${hk} hk

Sammenlignbare biler (sortert billigst):
${listings}

Velg billigste reelle alternativ. Ignorer skadet, demo, feil variant.
Svar KUN med JSON: {"index": N, "price": PRIS, "reason": "en setning pa norsk"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.anthropic.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    const chosen = top5[json.index - 1] || top5[0];

    // Anchor bug fix: bruk Math.min fra pool
    const lowestPrice = Math.min(...top5.map(c => c.price));
    const anchorPrice = Math.min(chosen.price, lowestPrice);
    const anchorIndex = top5.findIndex(c => c.price === anchorPrice);

    log(`Haiku: anker = ${anchorPrice} kr (index ${anchorIndex + 1}) | ${json.reason}`);
    return { price: anchorPrice, index: anchorIndex, reason: json.reason, car: top5[anchorIndex] };
  } catch (e) {
    logErr('getAnchor', e);
    return { price: top5[0].price, index: 0, reason: 'Billigste i pool (AI fallback)', car: top5[0] };
  }
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
  if (dMid <= 100000) return { xPct: b?.lav     ?? CONFIG.pdec1.lav,     bracket: 'Lav' };
  if (dMid <= 250000) return { xPct: b?.mid     ?? CONFIG.pdec1.mid,     bracket: 'Mid' };
  if (dMid <= 400000) return { xPct: b?.hoy     ?? CONFIG.pdec1.hoy,     bracket: 'Hoy' };
  return               { xPct: b?.premium ?? CONFIG.pdec1.premium, bracket: 'Premium' };
}

// ── Prisformel ────────────────────────────────────────────────
function calcValuation(anchorPrice) {
  const t88 = Math.round(anchorPrice * 0.88 / 1000) * 1000;
  const tFloor = anchorPrice - 10000;
  const T = Math.max(t88, tFloor);
  const minMarginUsed = T > t88;

  const feeEntry = CONFIG.fee.find(f => T < f.maxT);
  const fee = feeEntry.fee;

  const dMid = T - fee;
  const dLav = Math.round(dMid * 0.95 / 1000) * 1000;
  const dHoy = Math.round(dMid * 1.05 / 1000) * 1000;

  const { xPct, bracket } = getRecX(dMid);
  const E = Math.round(dLav * (1 + xPct) / 1000) * 1000;
  const auctionTypeId = dLav <= 35000 ? 2 : 1;

  log(`Kalkyle: anker=${anchorPrice} T=${T} fee=${fee} dMid=${dMid} dLav=${dLav} dHoy=${dHoy} E=${E} (${bracket} ${(xPct * 100).toFixed(1)}%)`);
  return { T, t88, minMarginUsed, fee, dMid, dLav, dHoy, E, xPct, bracket, auctionTypeId };
}

// ── Formater eval-kort ────────────────────────────────────────
function formatEvalCard(p) {
  const source = (p.bil.source || '').toLowerCase() === 'driveno' ? 'DRIVE' : 'PEASY';
  const qaTag = p.qaOverride ? ' ⚡ QA OVERRIDE' : '';
  const isEl = p.vegData.fuel.toLowerCase().includes('elektr');
  const hkStr = isEl
    ? (p.vegData.range ? `${p.vegData.range} km rekkevidde` : `${p.vegData.kw} kW`)
    : `${p.vegData.hk} hk`;

  const top5 = p.pool.slice(0, 5);
  const compLines = top5.map((c, i) => {
    const isAnker = i === p.anchor.index;
    const line = `${i + 1}. ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year}`;
    return isAnker ? `<b>▶ ${line} ← anker</b>` : `   ${line}`;
  }).join('\n');
  const snitt = Math.round(top5.reduce((s, c) => s + c.price, 0) / top5.length);

  // EC-17/18
  let finnAnnonse;
  if (p.finnListing) {
    const d = p.finnListing.price - p.anchor.price;
    const diffStr = d <= 0
      ? `${Math.abs(d).toLocaleString('nb-NO')} kr under anker`
      : `${d.toLocaleString('nb-NO')} kr over anker`;
    finnAnnonse = `<a href="${p.finnListing.url}">${p.finnListing.price.toLocaleString('nb-NO')} kr</a> (${diffStr})`;
  } else {
    finnAnnonse = 'Ikke funnet pa Finn';
  }

  // EC-24
  const erpLines = [
    p.erpWritten ? '✅ D lav/hoy skrevet' : '❌ D lav/hoy FEILET',
    p.erpWritten ? `✅ Auction type: ${p.valuation.auctionTypeId === 2 ? '2 Lower price (≤35k)' : '1 Regular (>35k)'}` : '❌ Auction type ikke satt',
    p.erpWritten ? '✅ Heftelser kontrollert' : '❌ Heftelser ikke toglet',
    p.brreg.anyDebts
      ? (p.erpWritten ? '✅ Finans? satt (heftelser funnet)' : '❌ Finans? ikke satt')
      : '— Finans? ikke aktuelt',
    p.erpWritten ? '✅ Eiere sjekket' : '❌ Eiere ikke toglet',
    p.erpWritten ? '✅ Lagre data klikket' : '❌ Lagre data ikke klikket',
    p.chatPosted ? '✅ Eval-kort postet til kommentar' : '— Kommentar: allerede postet',
  ].join('\n');

  return [
    `<b>${source} BIL TIL ESTIMERING${qaTag}</b>`,
    `${p.bil.registration_number} | ${p.vegData.make} ${p.bil.model_series || ''} ${p.bil.model_year || ''} | ${(p.bil.mileage || 0).toLocaleString('nb-NO')} km | ${p.vegData.fuel} | ${p.vegData.gearbox} | ${p.vegData.drive} | ${hkStr}`,
    '',
    `FINN-SOK ${p.vegData.fuel} | ${p.bil.model_year || ''} | ${p.totalCount} treff | <a href="${p.finnUrl}">Apne sok</a>`,
    compLines,
    `   Snitt: ${snitt.toLocaleString('nb-NO')} kr`,
    '',
    'AI KOMMENTAR',
    `   ${p.anchor.reason}`,
    '',
    'KALKYLE',
    `   Anker:        ${p.anchor.price.toLocaleString('nb-NO')} kr`,
    `   12% margin:   ${p.valuation.T.toLocaleString('nb-NO')} kr${p.valuation.minMarginUsed ? ' (min 10k margin)' : ''}`,
    `   Peasy fee:   -${p.valuation.fee.toLocaleString('nb-NO')} kr`,
    `   D mid:        ${p.valuation.dMid.toLocaleString('nb-NO')} kr`,
    `<b>   Estimert:     ${p.valuation.dLav.toLocaleString('nb-NO')} - ${p.valuation.dHoy.toLocaleString('nb-NO')} kr</b>`,
    `   Est. bud (E): ~${p.valuation.E.toLocaleString('nb-NO')} kr (${p.valuation.xPct >= 0 ? '+' : ''}${(p.valuation.xPct * 100).toFixed(1)}% fra Pulse ${p.valuation.bracket})`,
    '',
    'FINN-ANNONSE',
    `   ${finnAnnonse}`,
    '',
    'HEFTELSER',
    `   ${p.brreg.text}`,
    '',
    'SELGERKOMMENTAR',
    `   ${p.sdComment || ''}`,
    '',
    'ERP',
    erpLines,
  ].join('\n');
}

// ── Evaluer en bil ────────────────────────────────────────────
async function evalCar(bil, page, cache, opts = {}) {
  const { qaOverrideUrl = null } = opts;
  const regnr = bil.registration_number;
  const erpId = bil.id;

  log(`--- ${regnr} (ERP ${erpId}) ---`);

  if (!qaOverrideUrl && isInCache(cache, erpId)) {
    log(`Cache: ${regnr} allerede skrevet — hopper over`);
    return;
  }

  try {
    // 1. Vegvesen
    const vegData = await getVegvesenData(regnr);
    log(`Vegvesen: ${vegData.fuel} | ${vegData.gearbox} | ${vegData.drive} | ${vegData.kw}kW`);

    // 2. Finn komp-pool
    let pool, finnUrl, totalCount;
    if (qaOverrideUrl) {
      log(`QA Override: scraper ${qaOverrideUrl}`);
      const { comps, totalCount: tc } = await scrapeFinnUrl(qaOverrideUrl, page);
      let filtered = comps;
      for (const band of [30000, 50000, 80000, 150000]) {
        const f = comps.filter(c => Math.abs(c.km - bil.mileage) <= band);
        if (f.length >= 3) { filtered = f; break; }
      }
      filtered.sort((a, b) => a.price - b.price);
      pool = filtered; finnUrl = qaOverrideUrl; totalCount = tc;
    } else {
      const r = await getFinnComps(bil, vegData, page);
      pool = r.pool; finnUrl = r.finnUrl; totalCount = r.totalCount;
    }

    if (pool.length === 0) {
      await sendTelegram(`⚠️ ${regnr}: Ingen Finn-komper funnet\n<a href="${finnUrl}">Åpne Finn-søk</a>`);
      return;
    }

    // 3. Sjekk om bilen er pa Finn
    const finnListing = await checkFinnListing(regnr, page);

    // 4. AI-anker
    const anchor = await getAnchor(pool, bil, vegData);

    // Finn < pool-anker → bruk Finn-pris
    const lowestPool = Math.min(...pool.map(c => c.price));
    if (finnListing && finnListing.price < lowestPool) {
      log(`Finn-pris (${finnListing.price}) < pool-anker (${lowestPool}) → bruker Finn som anker`);
      anchor.price = finnListing.price;
    }

    // 5. Kalkyle
    const valuation = calcValuation(anchor.price);

    // 6. Brreg
    const brreg = await checkBrreg(regnr, page);

    // 7. Selgerkommentar
    const token = await getErpToken();
    let sdComment = null;
    try {
      const detail = await getErpCarDetail(erpId, token);
      sdComment = detail?.self_declaration?.comment || null;
    } catch (e) { logErr('getErpCarDetail', e); }

    // 8. Skriv til ERP (EC-24)
    const erpWritten = await writeToERP(
      erpId, valuation.dLav, valuation.dHoy,
      valuation.auctionTypeId, brreg.anyDebts, brreg, token
    );

    // 9. Bygg eval-kort og post til chat (EC-24 steg 6)
    const cardParams = {
      bil, vegData, pool, anchor, finnUrl, totalCount,
      finnListing, brreg, valuation, sdComment,
      erpWritten, chatPosted: false, qaOverride: !!qaOverrideUrl,
    };
    const evalText = formatEvalCard(cardParams);
    const chatPosted = await postToChat(erpId, evalText, token);

    // 10. Send Telegram med oppdatert chatPosted-status
    await sendTelegram(formatEvalCard({ ...cardParams, chatPosted }));

    // 11. Cache
    if (erpWritten) addToCache(cache, erpId);

    log(`--- ${regnr} ferdig | ERP: ${erpWritten ? 'OK' : 'FEIL'} | Chat: ${chatPosted ? 'OK' : 'skip'} ---`);

  } catch (err) {
    logErr(`evalCar ${regnr}`, err);
    await sendTelegram(`❌ Feil ved evaluering av ${regnr}: ${err.message}`);
  }
}

// ── Tesla prisovervaking (aktiv ut mars 2026) ─────────────────
async function checkTeslaPrices() {
  const now = new Date();
  if (now.getFullYear() > 2026 || (now.getFullYear() === 2026 && now.getMonth() > 2)) {
    log('Tesla: deaktivert etter mars 2026');
    return;
  }
  log('Tesla: sjekker priser...');
  try {
    const query = encodeURIComponent(JSON.stringify({
      query: { model: 'm3', condition: 'new', options: {}, arrangeby: 'Price', order: 'asc', market: 'NO', language: 'no', super_region: 'europe', zip: '0001', range: 0, region: 'NO' },
      offset: 0, count: 50, outsideOffset: 0, outsideSearch: false,
    }));
    const res = await fetch(`https://www.tesla.com/inventory/api/v4/inventory-results?query=${query}`, {
      headers: { 'User-Agent': 'Tesla/4.30.6 CFNetwork/1410.0.3 Darwin/22.6.0', 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Tesla API ${res.status}`);
    const data = await res.json();
    const results = data.results || [];
    const cache = loadJSON(TESLA_CACHE_FILE);
    const newCache = {};
    const alerts = [];

    for (const car of results) {
      const vin = car.VIN;
      if (!vin) continue;
      const basePrice = Math.round(car.CashDetails?.cash?.inventoryPriceWithoutDiscounts || 0);
      const discount = Math.round(car.CashDetails?.cash?.inventoryDiscountWithTax || 0);
      const finalPrice = basePrice - discount;
      const trimName = car.TrimName || 'Model 3';
      newCache[vin] = { finalPrice, trimName, discount };
      if (cache[vin] && finalPrice < cache[vin].finalPrice) {
        alerts.push({ trimName, oldPrice: cache[vin].finalPrice, finalPrice, drop: cache[vin].finalPrice - finalPrice });
      } else if (!cache[vin] && discount > 0) {
        alerts.push({ trimName, finalPrice, drop: discount, isNew: true });
      }
    }

    saveJSON(TESLA_CACHE_FILE, newCache);

    if (alerts.length > 0) {
      let msg = '🚗 TESLA MODEL 3 PRISREDUKSJON\n\n';
      for (const a of alerts) {
        msg += `Model 3 ${a.trimName}\n`;
        if (!a.isNew) msg += `Senket med ${a.drop.toLocaleString('nb-NO')} kr | Var: ${a.oldPrice.toLocaleString('nb-NO')} kr\n`;
        msg += `Na: ${a.finalPrice.toLocaleString('nb-NO')} kr\n\n`;
      }
      await sendTelegram(msg);
    } else {
      log('Tesla: ingen prisendringer');
    }
  } catch (e) { logErr('checkTeslaPrices', e); }
}

// ── Kjoring ───────────────────────────────────────────────────
async function runOnce(cache, force = false) {
  const hour = new Date().getHours();
  if (!force && (hour < CONFIG.schedule.startHour || hour >= CONFIG.schedule.endHour)) {
    log(`Utenfor arbeidstid (${hour}:xx)`); return;
  }

  log('=== Starter kjoring ===');
  await fetchBrackets();
  try { await checkTeslaPrices(); } catch (e) { logErr('Tesla', e); }

  const biler = await getListe3();
  if (biler.length === 0) { log('Ingen biler pa liste 3'); return; }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });

    for (const bil of biler) {
      await evalCar(bil, page, cache);
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    logErr('runOnce', err);
    await sendTelegram(`❌ peasy-auto fatal feil: ${err.message}`);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
  log('=== Kjoring ferdig ===');
}

// ── Telegram polling ──────────────────────────────────────────
let _lastUpdateId = 0;

async function pollTelegramCommands(cache) {
  setInterval(async () => {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${CONFIG.telegram.token}/getUpdates?offset=${_lastUpdateId + 1}&timeout=0`
      );
      const data = await res.json();
      for (const update of data.result || []) {
        _lastUpdateId = update.update_id;
        const text = (update.message?.text || '').trim();
        const msgTime = update.message?.date || 0;
        if (Date.now() / 1000 - msgTime > 60) continue;

        if (text === '/run') {
          log('/run mottatt');
          await sendTelegram('▶️ Kjoring startet...');
          runOnce(cache, true);
        }

        if (text === '/status') {
          await sendTelegram(
            `✅ Peasy Auto ${VERSION}\n` +
            `Brackets: ${_brackets ? 'dynamisk fra Pulse' : 'PDEC1 fallback'}\n` +
            `Cache: ${Object.keys(cache).length} biler\n` +
            `Tidspunkt: ${new Date().toLocaleTimeString('nb-NO')}`
          );
        }

        if (text.startsWith('/finn ')) {
          log('/finn mottatt: ' + text);
          const parts = text.replace('/finn ', '').trim().split(/\s+/);
          const regnr = parts[0]?.toUpperCase();
          const qaUrl = parts.slice(1).join(' ') || null;

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
              await evalCar(bil, pg, cache, { qaOverrideUrl: qaUrl });
            } finally {
              if (br) { try { await br.close(); } catch (e) {} }
            }
          } catch (err) {
            logErr('/finn', err);
            await sendTelegram(`❌ /finn feil: ${err.message}`);
          }
        }
      }
    } catch (e) { logErr('pollTelegramCommands', e); }
  }, 5000);
}

// ── Start ─────────────────────────────────────────────────────
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

  await sendTelegram(`🚀 Peasy Auto ${VERSION} startet`);
  await runOnce(cache);

  pollTelegramCommands(cache);

  setInterval(async () => {
    if (new Date().getMinutes() === 0) await runOnce(cache);
  }, 60000);

  process.on('SIGINT', () => { log('Stopper...'); process.exit(0); });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
