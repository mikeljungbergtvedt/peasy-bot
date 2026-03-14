require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const VEGVESEN_API_KEY = process.env.VEGVESEN_API_KEY;
const PROCESSED_FILE = 'processed-cars.json';
const TESLA_CACHE_FILE = 'tesla-prices.json';

const PAINT_NO = {
  'WHITE': 'Perlemorshvit', 'BLACK': 'Enfargert svart', 'SILVER': 'Solv',
  'BLUE': 'Dypbla metallic', 'RED': 'Rod multi-coat', 'GRAY': 'Middagsgrå',
  'STEALTH_GREY': 'Stealth Grey', 'ULTRA_RED': 'Ultra Red', 'QUICKSILVER': 'Quicksilver',
};

function shouldRun() {
  const h = new Date().getHours();
  return h >= 6 && h < 22;
}

function loadJSON(file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return {};
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function formatNOK(num) {
  return Math.round(num / 1000) * 1000;
}

function fmtNOKstr(num) {
  return formatNOK(num).toLocaleString('nb-NO') + ' kr';
}

async function sendTelegram(message) {
  try {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (err) { console.error('Telegram error:', err.message); }
}

function getTeslaRange(car) {
  const specs = car.OptionCodeData || [];
  const r = specs.find(s => s.group === 'SPECS_RANGE');
  return r ? r.value + ' km' : '';
}

async function fetchTeslaInventory() {
  const query = encodeURIComponent(JSON.stringify({
    query: { model: 'm3', condition: 'new', options: {}, arrangeby: 'Price', order: 'asc', market: 'NO', language: 'no', super_region: 'europe', zip: '0001', range: 0, region: 'NO' },
    offset: 0, count: 50, outsideOffset: 0, outsideSearch: false
  }));
  const res = await fetch('https://www.tesla.com/inventory/api/v4/inventory-results?query=' + query, {
    headers: { 'User-Agent': 'Tesla/4.30.6 CFNetwork/1410.0.3 Darwin/22.6.0', 'X-Tesla-User-Agent': 'TeslaApp/4.30.6', 'Accept': 'application/json', 'Accept-Language': 'nb-NO' }
  });
  if (!res.ok) throw new Error('Tesla API ' + res.status);
  const data = await res.json();
  return data.results || [];
}

async function checkTeslaPrices() {
  console.log('Checking Tesla Model 3 inventory...');
  const results = await fetchTeslaInventory();
  console.log('  Found ' + results.length + ' cars');
  const cache = loadJSON(TESLA_CACHE_FILE);
  const newCache = {};
  const alerts = [];
  for (const car of results) {
    const vin = car.VIN;
    if (!vin) continue;
    const basePrice = Math.round(car.CashDetails?.cash?.inventoryPriceWithoutDiscounts || 0);
    const discount = Math.round(car.CashDetails?.cash?.inventoryDiscountWithTax || 0);
    const finalPrice = basePrice - discount;
    const trimName = car.TrimName || car.TRIM?.[0] || 'Model 3';
    const color = PAINT_NO[car.PAINT?.[0]] || car.PAINT?.[0] || 'Ukjent';
    const range = getTeslaRange(car);
    const inTransit = car.InTransit ? 'I transit' : 'Pa lager';
    newCache[vin] = { finalPrice, trimName, color, discount };
    if (cache[vin]) {
      if (finalPrice < cache[vin].finalPrice) {
        alerts.push({ trimName, color, range, inTransit, oldPrice: cache[vin].finalPrice, finalPrice, drop: cache[vin].finalPrice - finalPrice, isNew: false });
      }
    } else if (discount > 0) {
      alerts.push({ trimName, color, range, inTransit, finalPrice, drop: discount, isNew: true });
    }
  }
  saveJSON(TESLA_CACHE_FILE, newCache);
  if (alerts.length > 0) {
    let msg = 'TESLA MODEL 3 PRISREDUKSJON\n\n';
    for (const a of alerts) {
      msg += 'Model 3 ' + a.trimName + ' | ' + a.color + ' | ' + a.range + ' | ' + a.inTransit + '\n';
      if (!a.isNew) { msg += 'Senket med ' + fmtNOKstr(a.drop) + ' | Før: ' + fmtNOKstr(a.oldPrice) + '\n'; }
      msg += 'Pris nå: ' + fmtNOKstr(a.finalPrice) + '\n\n';
    }
    await sendTelegram(msg);
  } else {
    console.log('  Ingen Tesla prisendringer');
  }
}

let _erpToken = null;
let _erpTokenExpiry = null;

async function getERPToken() {
  if (_erpToken && _erpTokenExpiry && new Date() < _erpTokenExpiry) return _erpToken;
  console.log('Logging in to ERP...');
  const res = await fetch('https://api.biladministrasjon.no/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS })
  });
  const data = await res.json();
  if (!data.success) throw new Error('ERP login failed');
  _erpToken = data.data.token.token;
  _erpTokenExpiry = new Date(data.data.token.expires_at);
  return _erpToken;
}

async function getERPCarComment(erpId, token) {
  try {
    const res = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/' + erpId, { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    return data.data?.car?.self_declaration?.comment || null;
  } catch(e) { return null; }
}

async function writeARValueToERP(erpId, priceMin, priceMax, heftelser, token) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const hasDebt = heftelser && heftelser.includes('registrert');
    const payload = {
      price_final_min: formatNOK(priceMin),
      price_final_max: formatNOK(priceMax),
      encumbrance: { is_checked: true, has_debt: hasDebt, comment: heftelser || 'Ingen heftelser', date: today },
      owners_check_date: today,
      owners_check_comment: null,
      owners_is_checked: true,
    };
    const res = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/' + erpId, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      console.log('  ERP updated: ' + formatNOK(priceMin).toLocaleString('nb-NO') + ' - ' + formatNOK(priceMax).toLocaleString('nb-NO') + ' kr');
      return true;
    } else {
      console.error('  ERP write failed:', JSON.stringify(data));
      return false;
    }
  } catch(e) { console.error('  ERP write error:', e.message); return false; }
}

async function fetchPendingCars() {
  console.log('Fetching pending cars from ERP...');
  const token = await getERPToken();
  const processed = loadJSON(PROCESSED_FILE);
  const cars = [];
  for (const endpoint of ['estimating_ar_final', 'estimating_ar_temp']) {
    const res = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/processing/' + endpoint + '?per_page=50', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) { console.error('ERP ' + endpoint + ' failed: ' + res.status); continue; }
    const data = await res.json();
    const list = data.data?.data?.data || [];
    for (const c of list) {
      if (!c.registration_number || processed[c.registration_number]) continue;
      cars.push({ erpId: c.id, regNr: c.registration_number, make: c.manufacturer || '', model: c.model_series || '', year: c.model_year || 0, km: c.mileage || 0, hasSdComment: c.has_sd_comment === 1 });
    }
  }
  const seen = new Set();
  const unique = cars.filter(c => { if (seen.has(c.regNr)) return false; seen.add(c.regNr); return true; });
  console.log('  Found ' + unique.length + ' unprocessed car(s)');
  return unique;
}

async function getVegvesenData(regNr) {
  const res = await fetch('https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=' + regNr.replace(/\s/g, ''), { headers: { 'Accept': 'application/json', 'SVV-Authorization': VEGVESEN_API_KEY } });
  if (!res.ok) throw new Error('Vegvesen ' + res.status);
  const data = await res.json();
  const k = data.kjoretoydataListe?.[0];
  if (!k) throw new Error('No vegvesen data');
  const td = k.godkjenning?.tekniskGodkjenning?.tekniskeData;
  const motor = td?.motorOgDrivverk?.motor?.[0];
  const drivstoff = motor?.drivstoff?.[0];
  const miljo = td?.miljodata?.miljoOgdrivstoffGruppe?.[0];
  const utslipp = miljo?.forbrukOgUtslipp?.[0];
  const aksler = td?.akslinger?.akselGruppe || [];
  const drivAksler = aksler.filter(g => g.akselListe?.aksel?.some(a => a.drivAksel)).length;
  const generelt = k.godkjenning?.tekniskGodkjenning?.tekniskeData?.generelt;
  return {
    make: generelt?.merke?.[0]?.merke || '',
    model: generelt?.handelsbetegnelse?.[0] || '',
    fuel: drivstoff?.drivstoffKode?.kodeBeskrivelse || 'Ukjent',
    gearbox: td?.motorOgDrivverk?.girkassetype?.kodeBeskrivelse || 'Ukjent',
    kw: drivstoff?.maksNettoEffekt || drivstoff?.maksEffektPrTime || 0,
    drive: drivAksler >= 2 ? '4WD' : '2WD',
    range: utslipp?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring || null,
    color: td?.karosseriOgLasteplan?.rFarge?.[0]?.kodeNavn || 'Ukjent',
  };
}

async function checkHeftelser(regNr, page) {
  try {
    await page.goto('https://rettsstiftelser.brreg.no/nb/oppslag/motorvogn/' + regNr.replace(/\s/g, ''), { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes('ingen oppforinger') || text.includes('Ingen oppforinger') || text.includes('ingen oppføringer') || text.includes('Ingen oppføringer')) return 'Ingen heftelser';
    if (text.includes('heftelse') || text.includes('pant') || text.includes('registrert')) return 'Heftelser registrert - sjekk manuelt';
    return 'Ingen heftelser';
  } catch(e) { return 'Kunne ikke sjekke heftelser'; }
}

async function scrapeFinn(url, targetKm, page) {
  console.log('  Finn: ' + url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const comps = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('article')).slice(0, 30).map(a => {
      const text = a.innerText || '';
      const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g, '')) || 0;
      const kmMatch = text.match(/\b(20\d{2}|19\d{2})\b.*?([\d\s]+)\s*km[^\w]/); const km = kmMatch ? parseInt(kmMatch[2].replace(/\s/g,'')) : 0;
      const year = parseInt((text.match(/\b(19\d{2}|20\d{2})\b/) || [])[1]) || 0;
      return { price, km, year };
    }).filter(c => { const cy = new Date().getFullYear(); return c.price >= 20000 && c.price <= 2000000 && (c.year === 0 || (c.year >= 1990 && c.year <= cy)); });
  });
  const seen = new Set();
  const unique = comps.filter(c => { const key = c.price + '-' + c.km; if (seen.has(key)) return false; seen.add(key); return true; });
  unique.sort((a, b) => Math.abs(a.km - targetKm) - Math.abs(b.km - targetKm));
  console.log('     ' + unique.length + ' results');
  return unique;
}

async function searchFinnComps(car, specs, page) {
  const { make, model, year, km } = car;
  const cleanMake = make.replace(/\s*MOTORS\s*/i, '').trim();
  const q = encodeURIComponent(cleanMake + ' ' + model);
  const base = 'https://www.finn.no/mobility/search/car?registration_class=1&sales_form=1&sort=PRICE_ASC';
  const isElectric = specs.fuel.toLowerCase().includes('elektr');
  const isDiesel = specs.fuel.toLowerCase().includes('diesel');
  const isAuto = specs.gearbox.toLowerCase().includes('automat');
  const is4WD = specs.drive === '4WD';
  const fuel = isElectric ? '&fuel=2' : isDiesel ? '&fuel=3' : '&fuel=1';
  const trans = isAuto ? '&transmission=2' : '&transmission=1';
  const drive = is4WD ? '&wheel_drive=2' : '&wheel_drive=3';
  const kmFrom = '&mileage_from=' + Math.max(0, Math.round(km * 0.5));
  const kmTo = '&mileage_to=' + Math.round(km * 1.5);
  const kwTo = specs.kw > 0 ? '&engine_effect_to=' + Math.ceil(specs.kw * 1.3) : '';
  const url = (yFrom, yTo, filters) => base + '&year_from=' + yFrom + '&year_to=' + yTo + filters + '&q=' + q;
  let comps;
  comps = await scrapeFinn(url(year, year, fuel + trans + drive + kmFrom + kmTo + kwTo), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel + trans + drive + kmFrom + kmTo + kwTo) };
  comps = await scrapeFinn(url(year, year, fuel + trans + drive), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel + trans + drive) };
  comps = await scrapeFinn(url(year, year, fuel + trans), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel + trans) };
  comps = await scrapeFinn(url(year, year, fuel), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year, year, fuel) };
  comps = await scrapeFinn(url(year - 1, year + 1, fuel + trans), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year - 1, year + 1, fuel + trans) };
  comps = await scrapeFinn(url(year - 1, year + 1, fuel), km, page);
  if (comps.length >= 5) return { comps: comps.slice(0, 10), finnUrl: url(year - 1, year + 1, fuel) };
  comps = await scrapeFinn(url(year - 2, year + 2, ''), km, page);
  return { comps: comps.slice(0, 10), finnUrl: url(year - 2, year + 2, '') };
}

async function aiFilterComps(car, specs, comps) {
  try {
    const prompt = 'You are a used car appraiser in Norway. I need to value a ' + car.year + ' ' + car.make + ' ' + car.model + ' with ' + car.km.toLocaleString() + ' km, ' + specs.fuel + ', ' + specs.gearbox + '.\n\nHere are comparable cars found on Finn.no:\n' +
      comps.map((c, i) => (i+1) + '. ' + c.price.toLocaleString('nb-NO') + ' kr | ' + c.km.toLocaleString('nb-NO') + ' km | year: ' + c.year).join('\n') +
      '\n\nRemove any cars that are clearly not comparable (wrong price range, obvious errors, unrealistic prices). Return ONLY a JSON array of the indices (1-based) to KEEP. Example: [1,2,3,4,5]. Return nothing else.';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\[[\d,\s]+\]/);
    if (!match) return comps;
    const keep = JSON.parse(match[0]);
    const filtered = keep.map(i => comps[i-1]).filter(Boolean);
    if (filtered.length < 2) return comps;
    const removed = comps.length - filtered.length;
    if (removed > 0) console.log('  AI removed ' + removed + ' outlier(s)');
    return filtered;
  } catch(e) { return comps; }
}

function calcValuation(finnAvg) {
  const mid = finnAvg * (1 - 0.12) * (1 + 0.03);
  return {
    low: formatNOK(mid * (1 - 0.05)),
    high: formatNOK(mid * (1 + 0.05)),
    likelyBid: formatNOK(mid * (1 - 0.05) * (1 - 0.033)),
  };
}

function formatResults(results, runTime) {
  const time = runTime.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  let msg = '<b>PEASY-AUTO | ' + time + ' | ' + results.length + ' bil(er)</b>\n\n';
  for (const r of results) {
    if (r.status === 'error') { msg += '<b>' + r.regNr + '</b> — ' + r.error + '\n\n'; continue; }
    const { car, specs, comps, finnUrl, valuation, finnAvg } = r;
    msg += '<b>' + r.regNr + ' — ' + car.make + ' ' + car.model + ' ' + car.year + '</b>\n';
    msg += car.km.toLocaleString('nb-NO') + 'km | ' + specs.fuel + ' | ' + specs.gearbox + ' | ' + specs.drive + ' | ' + specs.kw + 'kW\n\n';
    msg += '<b>FINN KOMPS:</b>\n';
    comps.sort((a, b) => a.price - b.price).slice(0, 5).forEach((c, i) => {
      const flag = c.year && c.year !== car.year ? ' (' + c.year + ')' : '';
      msg += (i + 1) + '. ' + c.price.toLocaleString('nb-NO') + ' kr | ' + c.km.toLocaleString('nb-NO') + 'km' + flag + '\n';
    });
    msg += '<b>Snitt: ' + fmtNOKstr(finnAvg) + '</b>\n\n';
    msg += 'Fra: ' + valuation.low.toLocaleString('nb-NO') + ' — Til: ' + valuation.high.toLocaleString('nb-NO') + ' kr\n';
    if (r.finnListing) msg += '⚠️ Finn-annonse: ' + r.finnListing.price.toLocaleString('nb-NO') + ' kr (' + r.finnListing.km.toLocaleString('nb-NO') + ' km) — Sendt til manuell gjennomgang\n';
    else msg += 'Finn-annonse: ❌ Ikke funnet\n';
    msg += 'Heftelser: ' + r.heftelser + '\n';
    if (r.sdComment) msg += r.sdComment.substring(0, 300) + '\n';
    msg += '<a href="' + finnUrl + '">Apne Finn-sok</a>\n' + finnUrl + '\n\n';
  }
  return msg;
}

function markProcessed(regNr, result) {
  const p = loadJSON(PROCESSED_FILE);
  p[regNr] = { timestamp: new Date().toISOString(), ...result };
  saveJSON(PROCESSED_FILE, p);
}

async function run(force) {
  const runTime = new Date();
  console.log('\n[' + runTime.toLocaleString('nb-NO') + '] Starting run...');
  if (!force && !shouldRun()) { console.log('Outside hours. Skipping.'); return; }
  try { await checkTeslaPrices(); } catch(err) { console.error('Tesla check failed:', err.message); }
  let browser;
  const results = [];
  try {
    const pendingCars = await fetchPendingCars();
    if (pendingCars.length === 0) { console.log('No pending cars.'); return; }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });
    for (const car of pendingCars) {
      console.log('\n' + car.regNr + ' — ' + car.make + ' ' + car.model + ' ' + car.year + ' ' + car.km + 'km');
      try {
        const specs = await getVegvesenData(car.regNr);
        console.log('  ' + specs.fuel + ' | ' + specs.gearbox + ' | ' + specs.drive + ' | ' + specs.kw + 'kW');
        const heftelser = await checkHeftelser(car.regNr, page);
        const finnListing = await checkFinnListing(car.regNr, page);
        const { comps, finnUrl } = await searchFinnComps(car, specs, page);
        if (comps.length < 2) throw new Error('For fa Finn-treff (' + comps.length + ')');
        const filteredComps = await aiFilterComps(car, specs, comps);
        const topComps = filteredComps.slice(0, 5);
        const finnAvg = topComps.reduce((s, c) => s + c.price, 0) / topComps.length;
        const valuation = calcValuation(finnAvg);
        console.log('  Fra: ' + fmtNOKstr(valuation.low) + ' | Til: ' + fmtNOKstr(valuation.high));
        markProcessed(car.regNr, { make: car.make, model: car.model, year: car.year, finnAvg, ...valuation });
        let sdComment = null;
        if (car.hasSdComment && car.erpId) {
          const erpToken = await getERPToken();
          sdComment = await getERPCarComment(car.erpId, erpToken);
        }
        if (car.erpId && !finnListing) {
          const erpToken = await getERPToken();
          await writeARValueToERP(car.erpId, valuation.low, valuation.high, heftelser, erpToken);
        } else if (finnListing) {
          console.log('  SKIP ERP: Car listed on Finn at ' + finnListing.price + ' kr');
        }
        results.push({ status: 'ok', regNr: car.regNr, car, specs, comps: topComps, finnUrl, finnAvg, valuation, heftelser, sdComment, finnListing });
      } catch (err) {
        console.error('  ERROR: ' + err.message);
        results.push({ status: 'error', regNr: car.regNr, error: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error('Fatal:', err.message);
    await sendTelegram('peasy-auto feil: ' + err.message);
  } finally { if (browser) await browser.close(); }
  if (results.length > 0) {
    await sendTelegram(formatResults(results, runTime));
    console.log('Telegram sent');
  }
  console.log('Done.');
}


async function checkFinnListing(regNr, page) {
  try {
    await page.goto('https://www.finn.no/mobility/search/car?q=' + regNr + '&registration_class=1&sales_form=1', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => {
      const a = document.querySelector('article');
      if (!a) return null;
      const text = a.innerText || '';
      const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g, '')) || 0;
      const km = parseInt((text.match(/\b(20\d{2}|19\d{2})\b.*?([\d\s]+)\s*km[^\w]/) || [])[2]?.replace(/\s/g,'')) || 0;
      return price > 0 ? { price, km } : null;
    });
    return result;
  } catch(e) { return null; }
}
async function pollTelegramCommands() {
  let offset = 0;
  setInterval(async () => {
    try {
      const res = await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getUpdates?offset=' + offset + '&timeout=0');
      const data = await res.json();
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        const msgTime = update.message?.date || 0;
        const text0 = update.message?.text?.trim() || "";
        const isFinn = text0.startsWith("/finn ");
        if (!isFinn && Date.now() / 1000 - msgTime > 60) continue;
        const text = update.message?.text?.trim();
        if (text === '/run') {
          console.log('/run received');
          await sendTelegram('Kjoring startet...');
          run(true);
        }
        if (text === '/rerun') {
          console.log('/rerun received');
          const pendingCars = await fetchPendingCars();
          if (pendingCars.length === 0) {
            await sendTelegram('Ingen biler i koen.');
          } else {
            const processed = loadJSON(PROCESSED_FILE);
            pendingCars.forEach(c => delete processed[c.regNr]);
            saveJSON(PROCESSED_FILE, processed);
            await sendTelegram('Kjorer om igjen ' + pendingCars.length + ' bil(er)...');
            run(true);
          }
        }
        if (text === '/status') {
          const processed = loadJSON(PROCESSED_FILE);
          await sendTelegram('Bot kjorer | ' + Object.keys(processed).length + ' biler behandlet');
        }
        if (text && text.startsWith('/finn ')) {
          const parts = text.replace('/finn ', '').trim().split(' ');
          const hasReg = parts[0].match(/^[A-Z]{2}\d{5}$/);
          const regNr = hasReg ? parts[0] : null;
          const finnUrl = hasReg ? parts.slice(1).join(' ') : parts.join(' ');
          console.log('/finn received');
          await sendTelegram('Henter Finn-data...');
          let carInfo = null;
          let erpCar = null;
          let heftelser = null;
          if (regNr) {
            try { carInfo = await getVegvesenData(regNr); } catch(e) {}
            try {
              const erpToken = await getERPToken();
              const erpRes = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/processing/estimating_ar_final?per_page=50', { headers: { 'Authorization': 'Bearer ' + erpToken } });
              const erpData = await erpRes.json();
              const allCars = erpData.data?.data?.data || [];
              const erpRes2 = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/processing/estimating_ar_temp?per_page=50', { headers: { 'Authorization': 'Bearer ' + erpToken } });
              const erpData2 = await erpRes2.json();
              const allCars2 = erpData2.data?.data?.data || [];
              const found = [...allCars, ...allCars2].find(c => c.registration_number === regNr);
              if (found) erpCar = { km: found.mileage || 0, year: found.model_year || 0, erpId: found.id, hasSdComment: found.has_sd_comment === 1 };
            } catch(e) {}
            if (regNr && !erpCar) { await sendTelegram('⚠️ ' + regNr + ' ikke funnet i ERP-koen. Bilen er allerede behandlet eller ikke registrert.'); return; }
            if (erpCar?.erpId) { try { const t = await getERPToken(); erpCar.comment = await getERPCarComment(erpCar.erpId, t); } catch(e) {} }
          }
          let br;
          try {
            br = await chromium.launch({ headless: true });
            const pg = await br.newPage();
            await pg.goto(finnUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await pg.waitForTimeout(2000);
            const comps = await pg.evaluate(() => {
              return Array.from(document.querySelectorAll('article')).slice(0, 30).map(a => {
                const text = a.innerText || '';
                const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g, '')) || 0;
                const kmMatch = text.match(/\b(20\d{2}|19\d{2})\b.*?([\d\s]+)\s*km[^\w]/); const km = kmMatch ? parseInt(kmMatch[2].replace(/\s/g,'')) : 0;
                const year = parseInt((text.match(/\b(19\d{2}|20\d{2})\b/) || [])[1]) || 0;
                const title = a.querySelector('h2')?.innerText || '';
                return { title, price, km, year };
              }).filter(c => c.price >= 20000 && c.price <= 2000000);
            });
            const seen2 = new Set();
            const compsUniq = comps.filter(c => { const k = c.price+'-'+c.km; if(seen2.has(k)) return false; seen2.add(k); return true; });
            comps.length = 0; compsUniq.forEach(c => comps.push(c));
            const fakeCar = { make: carInfo ? carInfo.make : 'ukjent', model: carInfo ? carInfo.model : '', year: erpCar ? erpCar.year : 0, km: erpCar ? erpCar.km : 0 };
            const fakeSpecs = { fuel: carInfo ? carInfo.fuel : ' ', gearbox: carInfo ? carInfo.gearbox : ' ' };
            const aiFiltered = await aiFilterComps(fakeCar, fakeSpecs, comps.slice());
            heftelser = await checkHeftelser(regNr, pg);
            let finnListing = null;
            if (regNr) finnListing = await checkFinnListing(regNr, pg);
            comps.length = 0; aiFiltered.forEach(c => comps.push(c));
            if (finnListing) { comps.splice(0, comps.length, ...comps.filter(c => c.km !== finnListing.km)); }
            const qParam = finnUrl.match(/[?&]q=([^&]+)/); const qWords = qParam ? decodeURIComponent(qParam[1]).replace(/\+/g," ").toLowerCase().split(" ") : []; if (qWords.length > 1) { const modelWord = qWords[qWords.length-1]; const titleFiltered = comps.filter(c => c.title.toLowerCase().includes(modelWord)); if (titleFiltered.length >= 3) { comps.length=0; titleFiltered.forEach(c=>comps.push(c)); } }
            await br.close();
            if (comps.length === 0) {
              await sendTelegram('Ingen resultater funnet.');
            } else {
              const carKm = erpCar?.km || 0;
              const carYear = erpCar?.year || 0;
              comps.sort((a,b) => Math.abs(a.km - carKm) - Math.abs(b.km - carKm));
              const top5 = comps.slice(0, 5);
              const avg = Math.round(top5.reduce((s, c) => s + c.price, 0) / top5.length);
              const val = calcValuation(avg);
              const midVal = Math.round(avg * (1 - 0.12) * (1 + 0.03));
              let reply = '<b>MANUELL FINN-SOK</b>\n';
              if (regNr && carInfo) reply += '<b>' + regNr + ' — ' + carInfo.make + ' ' + carInfo.model + ' ' + carYear + '</b>\n' + (carKm ? carKm.toLocaleString('nb-NO') + 'km | ' : '') + carInfo.fuel + ' | ' + carInfo.gearbox + ' | ' + carInfo.drive + ' | ' + carInfo.kw + 'kW\n';
              reply += top5.length + ' biler | snitt: ' + avg.toLocaleString('nb-NO') + ' kr\n\n';
              reply += '<b>FINN KOMPS:</b>\n';
              top5.forEach((c, i) => {
                reply += (i + 1) + '. ' + c.price.toLocaleString('nb-NO') + ' kr | ' + c.km.toLocaleString('nb-NO') + ' km | ' + c.year + '\n';
              });
              reply += '\n<b>AUKSJONSPRIS</b>\n';
              reply += 'Finn snitt: ' + avg.toLocaleString('nb-NO') + ' kr\n';
              reply += 'Etter margin (12% + 3%): ' + midVal.toLocaleString('nb-NO') + ' kr\n';
              reply += 'Intervall (\u00b15%): ' + val.low.toLocaleString('nb-NO') + ' — ' + val.high.toLocaleString('nb-NO') + ' kr\n';
              reply += 'Sannsynlig bud: ' + val.likelyBid.toLocaleString('nb-NO') + ' kr\n';
              if (finnListing) reply += '\n⚠️ Finn-annonse: ' + finnListing.price.toLocaleString('nb-NO') + ' kr (' + finnListing.km.toLocaleString('nb-NO') + ' km) — Krever manuell gjennomgang\n';
              else reply += '\nFinn-annonse: ❌ Ikke funnet\n';
              if (erpCar?.comment) reply += 'Kundekommentar: ' + erpCar.comment.substring(0, 300) + '\n';
              if (heftelser) reply += 'Heftelser: ' + heftelser + '\n';
              reply += '<a href="' + finnUrl + '">Apne Finn-sok</a>\n' + finnUrl + '\n';
              await sendTelegram(reply);
            }
          } catch(e) {
            if (br) await br.close();
            await sendTelegram('Feil: ' + e.message);
          }
        }
      }
    } catch(e) {}
  }, 5000);
}

async function startScheduler() {
  console.log('peasy-auto started');
  await run();
  pollTelegramCommands();
  setInterval(async () => { if (new Date().getMinutes() === 0) await run(); }, 60000);
  process.on('SIGINT', () => process.exit(0));
}

startScheduler();
