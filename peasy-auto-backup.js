require('dotenv').config();
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const fs = require('fs');

// Config
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const VEGVESEN_API_KEY = process.env.VEGVESEN_API_KEY;
const REPORT_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';
const PROCESSED_FILE = 'processed-cars.json';
const TESLA_CACHE_FILE = 'tesla-prices.json';
const MARGIN = 0.12, TILLEGG = 0.00, MOTIVATION = 0.03, SPREAD = 0.05;

const PAINT_NO = {
  'WHITE': 'Perlemorshvit', 'BLACK': 'Enfargert svart', 'SILVER': 'Sølv',
  'BLUE': 'Dypblå metallic', 'RED': 'Rød multi-coat', 'GRAY': 'Middagsgrå',
  'STEALTH_GREY': 'Stealth Grey', 'ULTRA_RED': 'Ultra Red', 'QUICKSILVER': 'Quicksilver',
};

// ─── HELPERS ───────────────────────────────────────────────────────────────

function shouldRun() {
  const now = new Date();
  return now.getDay() >= 1 && now.getDay() <= 5 && now.getHours() >= 6 && now.getHours() < 18;
}

function loadJSON(file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return {};
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function formatNOK(num) {
  return Math.round(num).toLocaleString('nb-NO') + ' kr';
}

async function sendTelegram(message) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (err) { console.error('Telegram error:', err.message); }
}

// ─── TESLA WATCHER ─────────────────────────────────────────────────────────

function getTeslaRange(car) {
  const specs = car.OptionCodeData || [];
  const r = specs.find(s => s.group === 'SPECS_RANGE');
  return r ? `${r.value} km` : '';
}

async function fetchTeslaInventory() {
  const query = encodeURIComponent(JSON.stringify({
    query: { model: 'm3', condition: 'new', options: {}, arrangeby: 'Price', order: 'asc', market: 'NO', language: 'no', super_region: 'europe', zip: '0001', range: 0, region: 'NO' },
    offset: 0, count: 50, outsideOffset: 0, outsideSearch: false
  }));
  const res = await fetch(`https://www.tesla.com/inventory/api/v4/inventory-results?query=${query}`, {
    headers: {
      'User-Agent': 'Tesla/4.30.6 CFNetwork/1410.0.3 Darwin/22.6.0',
      'X-Tesla-User-Agent': 'TeslaApp/4.30.6',
      'Accept': 'application/json',
      'Accept-Language': 'nb-NO',
    }
  });
  if (!res.ok) throw new Error(`Tesla API ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

async function checkTeslaPrices() {
  console.log('⚡ Checking Tesla Model 3 inventory...');
  const results = await fetchTeslaInventory();
  console.log(`  Found ${results.length} cars`);

  const cache = loadJSON(TESLA_CACHE_FILE);
  const newCache = {};
  const alerts = [];

  for (const car of results) {
    const vin = car.VIN;
    if (!vin) continue;

    const basePrice = Math.round(car.CashDetails?.cash?.inventoryPriceWithoutDiscounts || 0);
    const discount = Math.round(car.CashDetails?.cash?.inventoryDiscountWithTax || 0);
    const finalPrice = basePrice - discount;
    const originalPrice = basePrice;
    const trimName = car.TrimName || car.TRIM?.[0] || 'Model 3';
    const color = PAINT_NO[car.PAINT?.[0]] || car.PAINT?.[0] || 'Ukjent';
    const range = getTeslaRange(car);
    const inTransit = car.InTransit ? '🚢 I transit' : '📍 På lager';

    newCache[vin] = { finalPrice, trimName, color, discount };

    if (cache[vin]) {
      const oldPrice = cache[vin].finalPrice;
      if (finalPrice < oldPrice) {
        alerts.push({ vin, trimName, color, range, inTransit, oldPrice, finalPrice, drop: oldPrice - finalPrice, discount, isNew: false });
      }
    } else if (discount > 0) {
      alerts.push({ vin, trimName, color, range, inTransit, oldPrice: null, finalPrice, drop: discount, discount, isNew: true });
    }
  }

  saveJSON(TESLA_CACHE_FILE, newCache);

  if (alerts.length > 0) {
    let msg = `⚡️ <b>TESLA MODEL 3 — PRISREDUKSJON!</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const a of alerts) {
      msg += `🚗 <b>Model 3 ${a.trimName}</b>\n`;
      msg += `🎨 ${a.color} | 🔋 ${a.range} | ${a.inTransit}\n`;
      if (!a.isNew) {
        msg += `📉 Senket med <b>${formatNOK(a.drop)}</b>\n`;
        msg += `Før: ${formatNOK(a.oldPrice)}\n`;
      } else {
        msg += `🆕 Ny i inventar med rabatt!\n`;
      }
      if (a.originalPrice && a.discount > 0) {
        msg += `🏷 Redusert fra ${formatNOK(a.originalPrice)} → <b>${formatNOK(a.finalPrice)}</b>
`;
        msg += `💸 Rabatt: ${formatNOK(a.discount)}
`;
      } else {
        msg += `💰 <b>Pris nå: ${formatNOK(a.finalPrice)}</b>
`;
      }
      msg += `\n`;
    }
    msg += `🔗 <a href="https://www.tesla.com/no_NO/inventory/new/m3?arrangeby=plh&PaymentType=cash">Se alle Model 3 →</a>`;
    await sendTelegram(msg);
    console.log(`  📱 Sent ${alerts.length} Tesla alert(s)`);
  } else {
    console.log('  ✅ Ingen Tesla prisendringer');
  }
}

// ─── CAR VALUATION ─────────────────────────────────────────────────────────

function markProcessed(regNr, result) {
  const p = loadJSON(PROCESSED_FILE);
  p[regNr] = { timestamp: new Date().toISOString(), ...result };
  saveJSON(PROCESSED_FILE, p);
}

async function fetchPendingCars() {
  console.log('📊 Fetching Excel report...');
  const res = await fetch(REPORT_URL);
  if (!res.ok) throw new Error(`Report fetch failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = json[0].map(h => String(h).trim());
  const rows = json.slice(1);
  const col = names => { for (const n of (Array.isArray(names)?names:[names])) { const i = headers.findIndex(h => h.toLowerCase().includes(n.toLowerCase())); if (i !== -1) return i; } return -1; };
  const sdCol = col(['SD mottatt']), arCol = col(['Endelig AR verdi']);
  const statusCol = col(['Status']), regCol = col(['RegNr','Reg nr']);
  const merkeCol = col(['Merke']), modellCol = col(['Modell']);
  const yearCol = col(['År','Årgang']), kmCol = col(['KM','Kilometer','Kjørelengde']);
  const processed = loadJSON(PROCESSED_FILE);
  return rows.filter(row => {
    const sd = String(row[sdCol]||'').trim(), ar = String(row[arCol]||'').trim();
    const status = String(row[statusCol]||'').trim().toLowerCase();
    const reg = String(row[regCol]||'').trim();
    return sd !== '' && ['-','–','—',''].includes(ar) && (status.includes('endelig estimat')||status.includes('sd mottatt')) && reg !== '' && !processed[reg];
  }).map(row => ({
    regNr: String(row[regCol]||'').trim(), make: String(row[merkeCol]||'').trim(),
    model: String(row[modellCol]||'').trim(), year: parseInt(row[yearCol])||0,
    km: parseInt(String(row[kmCol]||'0').replace(/\D/g,''))||0,
  }));
}

async function getVegvesenData(regNr) {
  const res = await fetch(`https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=${regNr.replace(/\s/g,'')}`,
    { headers: { 'Accept': 'application/json', 'SVV-Authorization': VEGVESEN_API_KEY } });
  if (!res.ok) throw new Error(`Vegvesen ${res.status}`);
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
  return {
    fuel: drivstoff?.drivstoffKode?.kodeBeskrivelse || 'Ukjent',
    gearbox: td?.motorOgDrivverk?.girkassetype?.kodeBeskrivelse || 'Ukjent',
    kw: drivstoff?.maksNettoEffekt || drivstoff?.maksEffektPrTime || 0,
    drive: drivAksler >= 2 ? '4WD' : '2WD',
    range: utslipp?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring || null,
    color: td?.karosseriOgLasteplan?.rFarge?.[0]?.kodeNavn || 'Ukjent',
  };
}

async function searchFinnComps(car, specs, page) {
  const { make, model, year, km } = car;
  const delta = km < 50000 ? 10000 : km <= 100000 ? 20000 : 30000;
  const q = encodeURIComponent(`${make} ${model}`);
  const transmission = specs.gearbox.toLowerCase().includes('automat') ? '2' : '1';
  const fuelParam = specs.fuel.toLowerCase().includes('elektr') ? '&fuel=2' : specs.fuel.toLowerCase().includes('diesel') ? '&fuel=3' : '&fuel=1';
  const wheelParam = specs.drive === '4WD' ? '&wheel_drive=2' : '';
  const finnUrl = `https://www.finn.no/mobility/search/car?q=${q}&registration_class=1&sales_form=1&sort=PRICE_ASC&year_from=${year}&year_to=${year}&mileage_from=${Math.max(0,km-delta)}&mileage_to=${km+delta}&transmission=${transmission}${fuelParam}${wheelParam}`;
  console.log(`  🔍 ${finnUrl}`);
  await page.goto(finnUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const comps = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('article')).slice(0,8).map(article => {
      const priceText = (article.querySelector('[class*="price"]') || article.querySelector('span[data-testid*="price"]'))?.innerText || '';
      const price = parseInt(priceText.replace(/\D/g,'')) || 0;
      const text = article.innerText || '';
      const kmMatch = text.match(/(\d[\d\s]{2,})\s*km/i);
      const kmVal = kmMatch ? parseInt(kmMatch[1].replace(/\s/g,'')) : 0;
      const yearMatch = text.match(/\b(20\d{2}|19\d{2})\b/);
      const yearVal = yearMatch ? parseInt(yearMatch[1]) : 0;
      return { price, km: kmVal, year: yearVal };
    }).filter(c => c.price > 50000);
  });
  return { comps, finnUrl };
}

function calculateValuation(finnAvg) {
  let mid = finnAvg * (1 - MARGIN - TILLEGG);
  mid += mid * MOTIVATION;
  return { low: Math.round(mid*(1-SPREAD)), high: Math.round(mid*(1+SPREAD)), likelyBid: Math.round(mid*(1-SPREAD)) };
}

function formatCarSummary(results, runTime) {
  const time = runTime.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  let msg = `🤖 <b>PEASY-AUTO | ${time} | ${results.length} bil(er) behandlet</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  for (const r of results) {
    if (r.status === 'error') { msg += `❌ <b>${r.regNr}</b> — ${r.error}\n\n`; continue; }
    const { car, specs, comps, finnUrl, valuation, finnAvg } = r;
    msg += `🚗 <b>${r.regNr} — ${car.make} ${car.model} ${car.year}</b>\n`;
    msg += `📍 ${car.km.toLocaleString('nb-NO')}km | ${specs.color} | ${specs.fuel} | ${specs.gearbox} | ${specs.drive} | ${specs.kw}kW`;
    if (specs.range) msg += ` | ${specs.range}km`;
    msg += `\n\n<b>📊 FINN KOMPS:</b>\n`;
    comps.forEach((c,i) => {
      const yearFlag = c.year && c.year !== car.year ? ` ⚠️${c.year}` : '';
      msg += `${i+1}. ${c.price.toLocaleString('nb-NO')} kr${c.km ? ' | '+c.km.toLocaleString('nb-NO')+'km' : ''}${yearFlag}\n`;
    });
    msg += `<b>Snitt: ${formatNOK(finnAvg)}</b>\n\n`;
    msg += `<b>💰 VERDSETTELSE:</b>\n`;
    msg += `Fra: ${formatNOK(valuation.low)} | Til: ${formatNOK(valuation.high)}\n`;
    msg += `✅ <b>Sannsynlig bud: ${formatNOK(valuation.likelyBid)}</b>\n`;
    msg += `🔗 <a href="${finnUrl}">Åpne Finn-søk</a>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }
  const ok = results.filter(r=>r.status==='ok').length;
  const fail = results.filter(r=>r.status==='error').length;
  msg += `✅ ${ok} fullført | ❌ ${fail} feil | Neste kjøring: om 1 time`;
  return msg;
}

// ─── MAIN RUN ──────────────────────────────────────────────────────────────

async function run() {
  const runTime = new Date();
  console.log(`\n[${runTime.toLocaleString('nb-NO')}] 🚀 Starting run...`);
  if (!shouldRun()) { console.log('⏰ Outside work hours. Skipping.'); return; }

  // 1. Tesla price check (always runs, no browser needed)
  try { await checkTeslaPrices(); } catch(err) { console.error('Tesla check failed:', err.message); }

  // 2. Car valuations
  let browser;
  const results = [];
  try {
    const pendingCars = await fetchPendingCars();
    console.log(`📋 ${pendingCars.length} pending car(s)`);
    if (pendingCars.length === 0) { console.log('✅ No pending cars.'); return; }

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });

    for (const car of pendingCars) {
      console.log(`\n🚗 ${car.regNr} — ${car.make} ${car.model} ${car.year}`);
      try {
        const specs = await getVegvesenData(car.regNr);
        console.log(`  ✅ ${specs.fuel} | ${specs.gearbox} | ${specs.drive} | ${specs.kw}kW`);
        const { comps, finnUrl } = await searchFinnComps(car, specs, page);
        if (comps.length < 2) throw new Error(`For få Finn-treff (${comps.length})`);
        const topComps = comps.slice(0, Math.min(5, comps.length));
        const finnAvg = topComps.reduce((s,c) => s+c.price, 0) / topComps.length;
        const valuation = calculateValuation(finnAvg);
        console.log(`  💰 Fra: ${formatNOK(valuation.low)} | Til: ${formatNOK(valuation.high)}`);
        markProcessed(car.regNr, { make: car.make, model: car.model, year: car.year, finnAvg, ...valuation });
        results.push({ status: 'ok', regNr: car.regNr, car, specs, comps: topComps, finnUrl, finnAvg, valuation });
      } catch (err) {
        console.error(`  ❌ ${err.message}`);
        results.push({ status: 'error', regNr: car.regNr, error: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error('Fatal:', err.message);
    await sendTelegram(`❌ peasy-auto feil: ${err.message}`);
  } finally { if (browser) await browser.close(); }

  if (results.length > 0) {
    await sendTelegram(formatCarSummary(results, runTime));
    console.log('📱 Telegram sent');
  }
  console.log(`✅ Done.`);
}

// ─── SCHEDULER ─────────────────────────────────────────────────────────────

async function startScheduler() {
  console.log('🚀 peasy-auto started — Mon-Fri 06:00-18:00 hourly + Tesla always on');
  console.log('Ctrl+C to stop\n');
  await run();
  setInterval(async () => { if (new Date().getMinutes() === 0) await run(); }, 60000);
  process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); process.exit(0); });
}

startScheduler();
