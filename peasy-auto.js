// ============================================================
// peasy-auto.js v18.03.ae
// Peasy C2B Bruktbil â Automatisk evaluering
//
// Kjorer: Liste 3 (estimating_ar_final), 1x per time 07-17
// Design: peasy-system-reference.html v2.0
//
// Moduler:
//   main()             â starter scheduler og Telegram-polling
//   runOnce()          â henter liste 3, looper biler
//   evalCar()          â koordinator per bil
//   getVegvesenData()  â henter bildata fra Vegvesen
//   getFinnComps()     â Finn-sok med km-filter (Playwright)
//   getAnchor()        â AI-ankervalg via Claude Haiku
//   calcValuation()    â prisformel (T, fee, D mid, D lav/hoy, E)
//   checkFinnListing() â sjekker om bilen er pa Finn
//   checkBrreg()       â heftelsessjekk via Playwright
//   writeToERP()       â PUT med alle EC-24 felter
//   postToChat()       â POST til intern kommentar, kun 1 gang
//   sendTelegram()     â sender eval-kort
//   checkTeslaPrices() â Tesla prisovervaking (aktiv ut mars 2026)
// ============================================================

'use strict';

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VERSION = 'v18.03.ad';
const CACHE_FILE = path.join(__dirname, 'peasy-cache.json');
const TESLA_CACHE_FILE = path.join(__dirname, 'tesla-prices.json');
const LOCK_FILE = '/tmp/peasy.lock';

// ââ Enkelt-instans las ââââââââââââââââââââââââââââââââââââââââ
try {
  const old = fs.existsSync(LOCK_FILE) && parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
  if (old && old !== process.pid) {
    try { process.kill(old, 'SIGKILL'); } catch (e) {}
  }
} catch (e) {}
fs.writeFileSync(LOCK_FILE, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch (e) {} });

// ââ Konfigurasjon âââââââââââââââââââââââââââââââââââââââââââââ
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

// ââ Logging âââââââââââââââââââââââââââââââââââââââââââââââââââ
function log(msg) {
  console.log(`[${new Date().toISOString()}] [${VERSION}] ${msg}`);
}
function logErr(ctx, err) {
  console.error(`[${new Date().toISOString()}] [${VERSION}] FEIL [${ctx}]`, err?.message || err || '');
}

// ââ Filhjelp ââââââââââââââââââââââââââââââââââââââââââââââââââ
function loadJSON(file) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { logErr('loadJSON', e); }
  return {};
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { logErr('saveJSON', e); }
}

// ââ Cache âââââââââââââââââââââââââââââââââââââââââââââââââââââ
function isInCache(cache, erpId) { return !!cache[String(erpId)]; }
function addToCache(cache, erpId) {
  cache[String(erpId)] = new Date().toISOString();
  saveJSON(CACHE_FILE, cache);
  log(`Cache: ${erpId} lagt til`);
}

// ââ ERP Auth ââââââââââââââââââââââââââââââââââââââââââââââââââ
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

// ââ ERP: Hent liste 3 âââââââââââââââââââââââââââââââââââââââââ
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

// ERP: Hent liste 2
async function getListe2() {
  const token = await getErpToken();
  const res = await fetch(
    `${CONFIG.erp.base}/c2b_module/driveno/processing/estimating_ar_temp?per_page=100`,
    { headers: authH(token) }
  );
  const data = await res.json();
  const biler = data.data?.data?.data || [];
  log(`ERP: ${biler.length} biler pa liste 2`);
  return biler;
}

// ERP: Flytt bil fra liste 2 til liste 3 via Playwright (egen browser + login)
async function promoteToListe3(erpId) {
  log(`Liste 2: promoterer bil ${erpId}...`);
  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Logg inn
    await page.goto('https://biladministrasjon.no/login', { waitUntil: 'networkidle', timeout: 20000 });
    await page.fill('input[name="email"]', process.env.ERP_USER);
    await page.fill('input[name="password"]', process.env.ERP_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Naviger til bilen
    await page.goto(
      `https://biladministrasjon.no/cars_driveno/processing/estimating_temp/${erpId}`,
      { waitUntil: 'networkidle', timeout: 20000 }
    );
    await page.waitForTimeout(2000);

    // Fyll inn forelÃ¸pig AR verdi 1/1
    const tempInputs = await page.$$('input[name="price_temp_min"]');
    if (tempInputs.length >= 2) {
      await tempInputs[0].fill('1');
      await tempInputs[1].fill('1');
    } else if (tempInputs.length === 1) {
      await tempInputs[0].fill('1');
    }

    // Lagre og endre status
    await page.click('button:has-text("Lagre data og endre status")');
    await page.waitForTimeout(3000);
    log(`Liste 2: bil ${erpId} promotert OK`);
    return true;
  } catch (err) {
    logErr(`promoteToListe3 ${erpId}`, err);
    return false;
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
}

// ââ ERP: Hent bildetaljer âââââââââââââââââââââââââââââââââââââ
async function getErpCarDetail(erpId, token) {
  const res = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}`, {
    headers: authH(token),
  });
  const data = await res.json();
  return data.data?.car || null;
}

// ââ ERP: Fyll inn felt via Playwright UI ââââââââââââââââââââââ
async function fillErpViaBrowser(erpId, auctionTypeId, anyDebts, brreg) {
  log(`ERP UI: oppdaterer bil ${erpId}...`);
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Logg inn
    await page.goto('https://biladministrasjon.no/login', { waitUntil: 'networkidle', timeout: 20000 });
    await page.fill('input[name="email"]', process.env.ERP_USER);
    await page.fill('input[name="password"]', process.env.ERP_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    log('ERP UI: innlogget');

    // Naviger til bilen
    await page.goto(`https://biladministrasjon.no/cars_driveno/processing/estimating_final/${erpId}`, {
      waitUntil: 'networkidle', timeout: 20000
    });
    await page.waitForTimeout(2000);

    // Auction type
    await page.selectOption('#auction_price_type_id', String(auctionTypeId));
    await page.waitForTimeout(500);

    // Heftelser kontrollert (alltid pÃ¥)
    const encumbrance = page.locator('#encumbrances');
    if (!await encumbrance.isChecked()) {
      await encumbrance.click();
      await page.waitForTimeout(500);
    }

    // Finans kun hvis heftelser
    if (anyDebts) {
      const anyDebtsEl = page.locator('#encumbrances_any_debts');
      if (!await anyDebtsEl.isChecked()) {
        await anyDebtsEl.click();
        await page.waitForTimeout(500);
      }
    }

    // Eiere sjekket (alltid pÃ¥)
    const owners = page.locator('#owners\\.checked_hint');
    if (!await owners.isChecked()) {
      await owners.click();
      await page.waitForTimeout(500);
    }

    // Lagre data
    await page.click('button.btn-primary:has-text("Lagre data")');
    await page.waitForTimeout(2000);

    log(`ERP UI: bil ${erpId} lagret OK`);
    return true;
  } catch (err) {
    logErr(`fillErpViaBrowser ${erpId}`, err);
    return false;
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
}

// ââ ERP: Skriv D lav/hÃ¸y via API + fyll UI via Playwright âââââ
async function writeToERP(erpId, dLav, dHoy, auctionTypeId, anyDebts, brreg, token) {
  log(`ERP: PUT D lav/hoy for bil ${erpId}...`);
  const payload = { price_final_min: dLav, price_final_max: dHoy };
  const res = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}`, {
    method: 'PUT',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.success) { logErr(`writeToERP PUT ${erpId}`, data); return false; }
  log(`ERP: D lav/hoy OK`);
  return await fillErpViaBrowser(erpId, auctionTypeId, anyDebts, brreg);
}

// ââ ERP: Post eval-kort til intern kommentar (kun 1 gang) âââââ
async function postToChat(erpId, evalText, token) {
  const checkRes = await fetch(`${CONFIG.erp.base}/c2b_module/driveno/${erpId}/comments/all`, {
    headers: authH(token),
  });
  const checkData = await checkRes.json();
  const existing = Array.isArray(checkData.data) ? checkData.data : [];

  if (existing.some(c => (c.comment || '').includes('BIL TIL ESTIMERING'))) {
    log(`Kommentar: bil ${erpId} har allerede eval-kort â skipper`);
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

// ââ Telegram ââââââââââââââââââââââââââââââââââââââââââââââââââ
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

// ââ Vegvesen ââââââââââââââââââââââââââââââââââââââââââââââââââ
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
  const firstRegYear  = firstRegStr ? parseInt(firstRegStr.split('-')[0] || '0') : 0;
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
    firstRegYear,
  };
}

// ââ Finn ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function getFinnFuelCode(fuel) {
  const f = fuel.toLowerCase();
  if (f.includes('elektr')) return '4';
  if (f.includes('diesel')) return '2';
  if (f.includes('hybrid')) return '3';
  return '1';
}

function getFinnGearCode(gearbox) {
  const g = (gearbox || '').toLowerCase();
  if (g.includes('automat')) return '2';
  if (g.includes('manuell') || g.includes('manual')) return '1';
  return null; // ingen filter
}

function buildFinnUrl(make, model, yearFrom, yearTo, vegData, noFuel = false, kmFrom = 0, kmTo = 0, noGear = false, noHk = false) {
  const regClass = vegData.isVarebil ? '2' : '1';
  const cleanMake = make
    .replace(/\s*MOTORS\s*/i, '')
    .replace(/JAGUAR LAND ROVER LIMITED/i, 'Land Rover')
    .trim();
  const q = `${cleanMake} ${model}`;
  const fuelParam = noFuel ? '' : `&fuel=${getFinnFuelCode(vegData.fuel)}`;
  const kmFromParam = kmFrom > 0 ? `&mileage_from=${kmFrom}` : '';
  const kmToParam = kmTo > 0 ? `&mileage_to=${kmTo}` : '';
  const gearCode = getFinnGearCode(vegData.gearbox);
  const gearParam = (!noGear && gearCode) ? `&transmission=${gearCode}` : '';
  const hk = Math.round((vegData.kw || 0) * 1.36);
  const hkFrom = hk > 0 ? Math.floor(hk * 0.85 / 10) * 10 : 0;
  const hkTo   = hk > 0 ? Math.ceil(hk  * 1.15 / 10) * 10 : 0;
  const hkParam = (!noHk && hk > 0) ? `&power_from=${hkFrom}&power_to=${hkTo}` : '';
  return `https://www.finn.no/mobility/search/car?sales_form=1&registration_class=${regClass}&q=${encodeURIComponent(q)}${fuelParam}&year_from=${yearFrom}&year_to=${yearTo}&price_from=15000&sort=PRICE_ASC${kmFromParam}${kmToParam}${gearParam}${hkParam}`;
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
  // Ãrsmodell-validering: hvis ERP-Ã¥r avviker > 2 Ã¥r fra Vegvesens registreringsÃ¥r, bruk Vegvesens Ã¥r
  const erpYear = bil.model_year || 0;
  const vegYear = vegData.firstRegYear || 0;
  let yBase = erpYear;
  if (vegYear > 0 && erpYear > 0 && Math.abs(erpYear - vegYear) > 2) {
    log(`Ãrsmodell: ERP=${erpYear} avviker fra Vegvesen=${vegYear} â bruker Vegvesen-Ã¥r`);
    yBase = vegYear;
  }
  const yFrom = yBase;
  const yTo = vegData.firstRegMonth >= 9 ? yBase + 1 : yBase;

  const bands = [30000, 50000, 80000, 150000];

  // Fallback-rekkefÃ¸lge: fuel+gear+hk â fuel+gear â fuel â ingen filter
  const variantSets = [
    { noFuel: false, noGear: false, noHk: false, label: 'fuel+gear+hk' },
    { noFuel: false, noGear: false, noHk: true,  label: 'fuel+gear' },
    { noFuel: false, noGear: true,  noHk: true,  label: 'fuel' },
    { noFuel: true,  noGear: true,  noHk: true,  label: 'ingen filter' },
  ];

  const seen = new Set();
  let allComps = [];
  let totalCount = 0;
  let finnUrl = '';

  for (const v of variantSets) {
    const variants = bands.slice(0, 3).map((band, i) => {
      const yr = i === 0 ? [yFrom, yTo] : i === 1 ? [yFrom - 1, yTo + 1] : [yFrom - 2, yTo + 2];
      const kmFrom = Math.max(0, bil.mileage - band);
      const kmTo = bil.mileage + band;
      return buildFinnUrl(vegData.make, bil.model_series || '', yr[0], yr[1], vegData, v.noFuel, kmFrom, kmTo, v.noGear, v.noHk);
    });
    if (!finnUrl) finnUrl = variants[0];

    const batchComps = [];
    for (const url of variants) {
      const { comps, totalCount: tc } = await scrapeFinnUrl(url, page);
      if (tc > totalCount) { totalCount = tc; finnUrl = url; }
      for (const c of comps) {
        const key = `${c.price}-${c.km}`;
        if (!seen.has(key) && c.km <= 500000) { seen.add(key); batchComps.push(c); allComps.push(c); }
      }
      if (allComps.length >= 10) break;
    }

    // Km-filter sjekk â har vi â¥3 i rimelig km-band?
    const poolCheck = allComps.filter(c => Math.abs(c.km - bil.mileage) <= 80000);
    if (poolCheck.length >= 3) {
      log(`Finn: nok treff med ${v.label} â stopper`);
      break;
    }
    if (v.label !== 'ingen filter') log(`Finn: for fÃ¥ treff med ${v.label} â prover bredere filter`);
  }

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

// ââ Brreg âââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

// ââ AI-anker ââââââââââââââââââââââââââââââââââââââââââââââââââ
async function getAnchor(pool, bil, vegData) {
  const top5 = pool.slice(0, 5);

  // Km-avvik filter: ekskluder biler med > 50 000 km avvik fra bilen som prises
  const bilKm = bil.mileage || 0;
  const kmFiltered = top5.filter(c => Math.abs(c.km - bilKm) <= 50000);
  const kmPool = kmFiltered.length >= 2 ? kmFiltered : top5;

  // Outlier-filter: forkast biler med mer enn 20% prisavvik fra snitt
  const snittAll = kmPool.reduce((s, c) => s + c.price, 0) / kmPool.length;
  const kmOutliers = top5.filter(c => Math.abs(c.km - bilKm) > 50000)
    .map(c => ({ ...c, reason: `${Math.round(Math.abs(c.km - bilKm)/1000)}k km avvik` }));
  const priceOutliers = kmPool.filter(c => c.price < snittAll * 0.80)
    .map(c => ({ ...c, reason: `${Math.round((1 - c.price/snittAll)*100)}% under snitt` }));
  // Dedup: en bil kan bare havne i Ã©n kategori
  const kmOutlierKeys = new Set(kmOutliers.map(c => `${c.price}-${c.km}`));
  const outliers = [...kmOutliers, ...priceOutliers.filter(c => !kmOutlierKeys.has(`${c.price}-${c.km}`))];
  const priceFiltered = kmPool.filter(c => c.price >= snittAll * 0.80);
  const working = priceFiltered;
  const safeWorking = working.length >= 2 ? working : kmPool;

  // Matematisk anker: snitt av 3 billigste etter filter (eller fÃ¦rre)
  const nAvg = Math.min(3, safeWorking.length);
  const cheapest = safeWorking.slice(0, nAvg);
  const anchorPrice = Math.round(cheapest.reduce((s, c) => s + c.price, 0) / nAvg / 1000) * 1000;

  // Indeksene til de 3 â¶-bilene i top5
  const anchorIndices = cheapest.map(c => top5.indexOf(c));

  log(`Anker: snitt av ${nAvg} biler = ${anchorPrice} kr | ${outliers.length} forkastet`);

  const hk = Math.round((vegData.kw || 0) * 1.36);
  const listings = top5.map((c, i) =>
    `${i + 1}. ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year}`
  ).join('\n');

  const outlierText = outliers.length > 0
    ? `\nForkastede biler (>20% under snitt ${Math.round(snittAll).toLocaleString('nb-NO')} kr):\n` +
      outliers.map((c, i) => {
        const avvik = Math.round((1 - c.price / snittAll) * 100);
        return `  - ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year} (${avvik}% under snitt)`;
      }).join('\n')
    : '';

  const prompt = `Du er bruktbilekspert i Norge for Peasy (C2B auksjon).
Bilen som prises: ${bil.model_year || ''} ${vegData.make} ${bil.model_series || ''}, ${(bil.mileage || 0).toLocaleString('nb-NO')} km, ${vegData.fuel}, ${hk} hk

Sammenlignbare biler fra Finn (sortert billigst):
${listings}

Ankerpris er matematisk satt til snitt av de ${nAvg} billigste godkjente: ${anchorPrice.toLocaleString('nb-NO')} kr.${outlierText}

Kommenter kort (1-2 setninger pa norsk) om ankerpris virker representativt.
Hvis biler ble forkastet, bekreft eller utfordre om eksklusjonen virker riktig.
Svar KUN med JSON: {"reason": "kommentar pa norsk"}`;

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
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    log(`Haiku: ${json.reason}`);
    return { price: anchorPrice, anchorIndices, outliers, reason: json.reason };
  } catch (e) {
    logErr('getAnchor', e);
    return { price: anchorPrice, anchorIndices, outliers, reason: `Snitt av ${nAvg} billigste (AI fallback)` };
  }
}

// ââ Dynamisk xPct fra Pulse âââââââââââââââââââââââââââââââââââ
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

// ââ Prisformel â v18.03.ad: 12% med min/maks per bracket âââââ
function calcValuation(anchorPrice) {
  // Margin: 12% av anker, begrenset av min og maks per bracket
  const MARGIN_TABLE = [
    { maxAnker: 100000,   min:  8000, maks: 12000 },  // Lav
    { maxAnker: 250000,   min: 12000, maks: 22000 },  // Mid
    { maxAnker: 400000,   min: 22000, maks: 35000 },  // HÃ¸y
    { maxAnker: Infinity, min: 35000, maks: 50000 },  // Premium
  ];
  const mb = MARGIN_TABLE.find(b => anchorPrice <= b.maxAnker);
  const margin = Math.min(mb.maks, Math.max(mb.min, Math.round(anchorPrice * 0.12 / 1000) * 1000));
  const T = anchorPrice - margin;
  const minMarginUsed = false;

  const feeEntry = CONFIG.fee.find(f => T < f.maxT);
  const fee = feeEntry.fee;

  const dMid = T - fee;
  // Spread-logikk: fast minimum basert pÃ¥ D lav-bracket
  const dLavRaw = Math.round(dMid * 0.95 / 1000) * 1000;
  let spread;
  if (dLavRaw < 30000)       spread = 2500;   // < 30k: Â±2 500 kr
  else if (dLavRaw < 100000) spread = 5000;   // 30kâ100k: Â±5 000 kr
  else                       spread = Math.round(dMid * 0.05 / 1000) * 1000; // > 100k: 5%
  const dLav = Math.round((dMid - spread) / 1000) * 1000;
  const dHoy = Math.round((dMid + spread) / 1000) * 1000;

  const { xPct, bracket } = getRecX(dMid);
  const E = Math.round(dLav * (1 + xPct) / 1000) * 1000;
  const auctionTypeId = dLav <= 35000 ? 2 : 1;

  log(`Kalkyle: anker=${anchorPrice} T=${T} fee=${fee} dMid=${dMid} dLav=${dLav} dHoy=${dHoy} E=${E} (${bracket} ${(xPct * 100).toFixed(1)}%)`);
  return { T, t88: T, minMarginUsed, margin, fee, dMid, dLav, dHoy, E, xPct, bracket, auctionTypeId };
}

// ââ Formater eval-kort ââââââââââââââââââââââââââââââââââââââââ
// ENDRING 2: forErp=true â klartekst URL. forErp=false â HTML + ERP-lenke nederst.
function formatEvalCard(p, forErp = false) {
  const source = (p.bil.source || '').toLowerCase() === 'driveno' ? 'DRIVE' : 'PEASY';
  const qaTag = p.qaOverride ? ' â¡ QA OVERRIDE' : '';
  const isEl = p.vegData.fuel.toLowerCase().includes('elektr');
  const hkStr = isEl
    ? (p.vegData.range ? `${p.vegData.range} km rekkevidde` : `${p.vegData.kw} kW`)
    : `${p.vegData.hk} hk`;

  const top5 = p.pool.slice(0, 5);
  const anchorIndices = p.anchor.anchorIndices || [];
  const compLines = top5.map((c, i) => {
    const isAnker = anchorIndices.includes(i);
    const line = `${i + 1}. ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year}`;
    return isAnker ? `<b>â¶ ${line}</b>` : `   ${line}`;
  }).join('\n');
  const snitt = Math.round(top5.reduce((s, c) => s + c.price, 0) / top5.length);
  const anchorCars = top5.filter((_, i) => anchorIndices.includes(i));
  const anchorAvgKm = anchorCars.length > 0 ? Math.round(anchorCars.reduce((s,c)=>s+c.km,0)/anchorCars.length) : 0;
  const ankerNote = `   (Anker = snitt av â¶-merkede biler: ${p.anchor.price.toLocaleString('nb-NO')} kr | snitt ${anchorAvgKm.toLocaleString('nb-NO')} km)`;

  // FORKASTET-seksjon
  const outliers = p.anchor.outliers || [];
  const forkastetLines = outliers.map(c =>
    `   ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year} (${c.reason})`
  );

  // EC-04 Finn-sÃ¸k linje
  const finnSokLine = forErp
    ? `FINN-SOK ${p.vegData.fuel} | ${p.bil.model_year || ''} | ${p.totalCount} treff\n   ${p.finnUrl}`
    : `FINN-SOK ${p.vegData.fuel} | ${p.bil.model_year || ''} | ${p.totalCount} treff | <a href="${p.finnUrl}">Apne sok</a>`;

  // EC-17/18 Finn-annonse
  let finnAnnonse;
  if (p.finnListing) {
    const d = p.finnListing.price - p.anchor.price;
    const diffStr = d <= 0
      ? `${Math.abs(d).toLocaleString('nb-NO')} kr under anker`
      : `${d.toLocaleString('nb-NO')} kr over anker`;
    finnAnnonse = forErp
      ? `${p.finnListing.price.toLocaleString('nb-NO')} kr (${diffStr})\n   ${p.finnListing.url}`
      : `<a href="${p.finnListing.url}">${p.finnListing.price.toLocaleString('nb-NO')} kr</a> (${diffStr})`;
  } else {
    finnAnnonse = 'Ikke funnet pa Finn';
  }

  // EC-24
  const erpLines = [
    p.erpWritten ? 'â D lav/hoy skrevet' : 'â D lav/hoy FEILET',
    p.erpWritten ? `â Auction type: ${p.valuation.auctionTypeId === 2 ? '2 Lower price (â¤35k)' : '1 Regular (>35k)'}` : 'â Auction type ikke satt',
    p.erpWritten ? 'â Heftelser kontrollert' : 'â Heftelser ikke toglet',
    p.brreg.anyDebts
      ? (p.erpWritten ? 'â Finans? satt (heftelser funnet)' : 'â Finans? ikke satt')
      : 'â Finans? ikke aktuelt',
    p.erpWritten ? 'â Eiere sjekket' : 'â Eiere ikke toglet',
    p.erpWritten ? 'â Lagre data klikket' : 'â Lagre data ikke klikket',
    p.chatPosted ? 'â Eval-kort postet til kommentar' : 'â Kommentar: allerede postet',
  ].join('\n');

  const tittel = forErp
    ? `${source} BIL TIL ESTIMERING${qaTag}`
    : `<b>${source} BIL TIL ESTIMERING${qaTag}</b>`;

  const estimert = forErp
    ? `   Estimert:     ${p.valuation.dLav.toLocaleString('nb-NO')} - ${p.valuation.dHoy.toLocaleString('nb-NO')} kr`
    : `<b>   Estimert:     ${p.valuation.dLav.toLocaleString('nb-NO')} - ${p.valuation.dHoy.toLocaleString('nb-NO')} kr</b>`;

  const lines = [
    tittel,
    `${p.bil.registration_number} | ${p.vegData.make} ${p.bil.model_series || ''} ${p.bil.model_year || ''} | ${(p.bil.mileage || 0).toLocaleString('nb-NO')} km | ${p.vegData.fuel} | ${p.vegData.gearbox} | ${p.vegData.drive} | ${hkStr}`,
    '',
    finnSokLine,
    compLines,
    `   Snitt: ${snitt.toLocaleString('nb-NO')} kr | ${Math.round(top5.reduce((s,c)=>s+c.km,0)/top5.length).toLocaleString('nb-NO')} km (pool snitt)`,
    ankerNote,
    ...(forkastetLines.length > 0 ? ['', 'FORKASTET', ...forkastetLines] : []),
    '',
    'AI KOMMENTAR',
    `   ${p.anchor.reason}`,
    '',
    'KALKYLE',
    `   Anker:        ${p.anchor.price.toLocaleString('nb-NO')} kr`,
    `   Margin (${p.valuation.margin ? p.valuation.margin.toLocaleString('nb-NO') : '?'} kr): ${p.valuation.T.toLocaleString('nb-NO')} kr`,
    `   Peasy fee:   -${p.valuation.fee.toLocaleString('nb-NO')} kr`,
    `   D mid:        ${p.valuation.dMid.toLocaleString('nb-NO')} kr`,
    estimert,
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
  ];

  // ERP-lenke kun i Telegram-versjon
  if (!forErp) {
    const erpUrl = `https://biladministrasjon.no/cars_driveno/processing/estimating_final/${p.bil.id}`;
    lines.push(`<a href="${erpUrl}">Apne i ERP</a>`);
  }

  return lines.join('\n');
}

// ââ Evaluer en bil ââââââââââââââââââââââââââââââââââââââââââââ
async function evalCar(bil, page, cache, opts = {}) {
  const { qaOverrideUrl = null } = opts;
  const regnr = bil.registration_number;
  const erpId = bil.id;

  log(`--- ${regnr} (ERP ${erpId}) ---`);

  if (!qaOverrideUrl && isInCache(cache, erpId)) {
    log(`Cache: ${regnr} allerede skrevet â hopper over`);
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
      await sendTelegram(`â ï¸ ${regnr}: Ingen Finn-komper funnet\n<a href="${finnUrl}">Ãpne Finn-sÃ¸k</a>`);
      return;
    }

    // 3. Sjekk om bilen er pa Finn
    const finnListing = await checkFinnListing(regnr, page);

    // 4. AI-anker
    const anchor = await getAnchor(pool, bil, vegData);

    // Finn < pool-anker â bruk Finn-pris
    // Finn-pris < anker â bruk som nytt anker (anker kan aldri vÃ¦re hÃ¸yere enn bilen er annonsert for)
    if (finnListing && finnListing.price < anchor.price) {
      log(`Finn-pris (${finnListing.price}) < anker (${anchor.price}) â bruker Finn som anker`);
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

    // 9. Bygg eval-kort â ENDRING 3: ERP fÃ¥r klartekst-URL, Telegram fÃ¥r HTML
    const cardParams = {
      bil, vegData, pool, anchor, finnUrl, totalCount,
      finnListing, brreg, valuation, sdComment,
      erpWritten, chatPosted: false, qaOverride: !!qaOverrideUrl,
    };
    const erpText = formatEvalCard(cardParams, true);
    const chatPosted = await postToChat(erpId, erpText, token);

    // 10. Send Telegram med HTML og ERP-lenke
    await sendTelegram(formatEvalCard({ ...cardParams, chatPosted }, false));

    // 11. Cache
    if (erpWritten) addToCache(cache, erpId);

    log(`--- ${regnr} ferdig | ERP: ${erpWritten ? 'OK' : 'FEIL'} | Chat: ${chatPosted ? 'OK' : 'skip'} ---`);

  } catch (err) {
    logErr(`evalCar ${regnr}`, err);
    await sendTelegram(`â Feil ved evaluering av ${regnr}: ${err.message}`);
  }
}

// ââ Tesla prisovervaking (aktiv ut mars 2026) âââââââââââââââââ
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
      let msg = 'ð TESLA MODEL 3 PRISREDUKSJON\n\n';
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

// ââ Kjoring âââââââââââââââââââââââââââââââââââââââââââââââââââ
async function runOnce(cache, force = false) {
  const hour = new Date().getHours();
  if (!force && (hour < CONFIG.schedule.startHour || hour >= CONFIG.schedule.endHour)) {
    log(`Utenfor arbeidstid (${hour}:xx)`); return;
  }

  log('=== Starter kjoring ===');
  await fetchBrackets();
  try { await checkTeslaPrices(); } catch (e) { logErr('Tesla', e); }

  const biler = await getListe3();
  if (biler.length === 0) { log('Ingen biler pa liste 3 â sjekker liste 2 likevel'); }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });

    const liste2 = await getListe2();
    if (liste2.length > 0) {
      log(`Liste 2: ${liste2.length} biler klar`);
      for (const bil of liste2) {
        await promoteToListe3(bil.id);
        await new Promise(r => setTimeout(r, 2000));
      }
      const ny = await getListe3();
      for (const b of ny) { if (!biler.find(x => x.id === b.id)) biler.push(b); }
    }

    for (const bil of biler) {
      await evalCar(bil, page, cache);
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    logErr('runOnce', err);
    await sendTelegram(`â peasy-auto fatal feil: ${err.message}`);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
  log('=== Kjoring ferdig ===');
}

// ââ Telegram polling ââââââââââââââââââââââââââââââââââââââââââ
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
          await sendTelegram(`â¶ï¸ Kjoring startet... (${VERSION})`);
          runOnce(cache, true);
        }

        if (text === '/status') {
          await sendTelegram(
            `â Peasy Auto ${VERSION}\n` +
            `Brackets: ${_brackets ? 'dynamisk fra Pulse' : 'PDEC1 fallback'}\n` +
            `Cache: ${Object.keys(cache).length} biler\n` +
            `Tidspunkt: ${new Date().toLocaleTimeString('nb-NO')}`
          );
        }

        if (text === '/monitor') {
          log('/monitor mottatt');
          sendTelegram('ð Kjorer monitor...');
          const { exec } = require('child_process');
          exec('/Users/bot/.nvm/versions/node/v24.14.0/bin/node /Users/bot/kartverket-monitor/monitor.js', (err) => {
            if (err) sendTelegram('â Monitor feil: ' + err.message.slice(0, 200));
            else sendTelegram('â Monitor kjort');
          });
        }

        if (text.startsWith('/finn ')) {
          log('/finn mottatt: ' + text);
          const parts = text.replace('/finn ', '').trim().split(/\s+/);
          const regnr = parts[0]?.toUpperCase();
          const qaUrl = parts.slice(1).join(' ') || null;

          if (!regnr) { await sendTelegram('â ï¸ Format: /finn REGNR [finn-url]'); continue; }

          await sendTelegram(`ð Henter data for ${regnr}...`);
          try {
            const liste3 = await getListe3();
            const bil = liste3.find(b => b.registration_number?.toUpperCase() === regnr);
            if (!bil) { await sendTelegram(`â ï¸ ${regnr}: ikke funnet pa liste 3`); continue; }

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
            await sendTelegram(`â /finn feil: ${err.message}`);
          }
        }
      }
    } catch (e) { logErr('pollTelegramCommands', e); }
  }, 5000);
}

// ââ Start âââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

  await sendTelegram(`ð Peasy Auto ${VERSION} startet`);
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
