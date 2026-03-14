// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// PEASY â PRISLOGIKK & FORRETNINGSFORSTÃELSE
// Kjerndokument. Endres aldri uten godkjenning.
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//
// GRUNNLEGGENDE INNSIKT:
//   Selger er emosjonell. Markedet er rasjonelt. Vi mÃ¥ bygge en bro.
//   Selger sorterer Finn hÃ¸yâlav og ser de dyreste annonsene.
//   Peasy sorterer lavâhÃ¸y og ser markedets gulv â det er ankeret.
//
// MÃLSETNINGER:
//   Evaluering â Mottatt (aksept av D lav/hÃ¸y) : mÃ¥l 20%
//   Mottatt    â Solgt   (aksept av bud T)     : mÃ¥l 70%
//
// FINN-SÃKESTEG:
//   Steg 1 â Ãr    : firstReg fra Vegvesen. MÃ¥ned â¥ 9 â year og year+1. Ellers year.
//                    Utvid Â±1/Â±2/Â±3 Ã¥r hvis < 5 treff.
//   Steg 2 â Filter: fuel + wheel_drive fra Vegvesen pÃ¥ Finn URL.
//   Steg 3 â Km    : behold kun Â±30k km (utvid til Â±50k/Â±80k hvis < 5).
//   Steg 4 â Sjekk : er mÃ¥lbil til salgs pÃ¥ Finn?
//                    Pris < anker â mÃ¥lbil blir nytt anker.
//                    Pris â¥ anker â ignorer. Finn-lenke alltid i eval-kort.
//
// AI-ANKER (Claude Haiku):
//   15 billigste fra km-filtrert pool. Haiku velger billigste reelle alternativ.
//
// PRISFORMEL:
//   T      = anker Ã 0.88  (min 10 000 kr margin)
//   U      = Peasy-gebyr: T<75kâ5900, T 75-125kâ7900, T>125kâ9900
//   D mid  = T â U         (hva selger faktisk mottar)
//   D lav  = D mid Ã 0.95
//   D hÃ¸y  = D mid Ã 1.05
//   T vises IKKE til selger. D lav/hÃ¸y er det selger ser.
//
// TILSTANDSTEST:
//   T lander ofte under D lav â normalt og forventet. Ikke en feil.
//   Selger vet ikke alltid at bilen er i dÃ¥rligere stand enn antatt.
//
// LIVSSYKLUS PER BIL (boten logger alle steg):
//   1. Eval-kort sendt   â D lav, D hÃ¸y, T, anker, Finn-URL
//   2. Selger aksepterer â R-dato (mottatt)
//   3. Tilstandstest     â hÃ¸yeste bud T faktisk
//   4. Solgt (S) eller Returnert (V)
//
// FREMTIDIG DYNAMISK PRISMODELL:
//   Pulse-data siste 30 dager per bracket â justere X% dynamisk.
//
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
  'BLUE': 'Dypbla metallic', 'RED': 'Rod multi-coat', 'GRAY': 'MiddagsgrÃ¥',
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
      if (!a.isNew) { msg += 'Senket med ' + fmtNOKstr(a.drop) + ' | FÃ¸r: ' + fmtNOKstr(a.oldPrice) + '\n'; }
      msg += 'Pris nÃ¥: ' + fmtNOKstr(a.finalPrice) + '\n\n';
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
    seats: td?.persontall?.sitteplasserTotalt || null,
    isVarebil: k?.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering?.tekniskKode?.kodeBeskrivelse?.toLowerCase().includes('varebil') || false,
    fuel: drivstoff?.drivstoffKode?.kodeBeskrivelse || 'Ukjent',
    gearbox: td?.motorOgDrivverk?.girkassetype?.kodeBeskrivelse || 'Ukjent',
    kw: drivstoff?.maksNettoEffekt || drivstoff?.maksEffektPrTime || 0,
    hybrid: td?.motorOgDrivverk?.hybridKategori?.kodeVerdi || 'INGEN',
    drive: drivAksler >= 2 ? '4WD' : '2WD',
    range: utslipp?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring || null,
    color: td?.karosseriOgLasteplan?.rFarge?.[0]?.kodeNavn || 'Ukjent',
    bodyType: td?.karosseriOgLasteplan?.karosseritype?.kodeVerdi || '',
    firstReg: k?.forstegangsregistrering?.registrertForstegangNorgeDato || null,
  };
}

async function checkHeftelser(regNr, page) {
  try {
    await page.goto('https://rettsstiftelser.brreg.no/nb/oppslag/motorvogn/' + regNr.replace(/\s/g, ''), { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes('ingen oppforinger') || text.includes('Ingen oppforinger') || text.includes('ingen oppfÃ¸ringer') || text.includes('Ingen oppfÃ¸ringer')) return 'Ingen heftelser';
    if (text.includes('heftelse') || text.includes('pant') || text.includes('registrert')) return 'Heftelser registrert - sjekk manuelt';
    return 'Ingen heftelser';
  } catch(e) { return 'Kunne ikke sjekke heftelser'; }
}

// âââ FINN URL HELPERS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// body_type: 1=SUV 2=Stasjonsvogn 3=Sedan 4=Coupe 5=Cabriolet 7=Varebil
// wheel_drive: 1=2WD 2=4WD | fuel: 1=Bensin 2=Diesel 3=Hybrid 4=Elektrisk
// transmission: 1=Manuell 2=Automat

function getFinnBodyType(specs) {
  if (specs.isVarebil) return '7';
  const k = specs.bodyType || '';
  if (k === 'AA') return '3'; // Sedan
  if (k === 'AB') return '2'; // Stasjonsvogn/Touring
  if (k === 'AC') return '5'; // Cabriolet
  if (k === 'AF') return '4'; // Coupe
  if (['BA','BB','BC'].includes(k)) return '1'; // SUV/Crossover
  return '';
}

function getFinnFuel(specs) {
  const f = specs.fuel.toLowerCase();
  if (f.includes('elektr')) return '4';
  if (f.includes('diesel')) return '2';
  if (f.includes('hybrid')) return '3';
  return '1';
}

function getFinnDrive(specs) { return specs.drive === '4WD' ? '2' : '1'; }
function getFinnTrans(specs) { return specs.gearbox.toLowerCase().includes('automat') ? '2' : '1'; }

function buildFinnUrl(q, yFrom, yTo, kmFrom, kmTo, fuel, trans, drive, bodyType) {
  let url = 'https://www.finn.no/mobility/search/car?sales_form=1&sort=PRICE_ASC&registration_class=1';
  url += '&q=' + encodeURIComponent(q);
  url += '&year_from=' + yFrom + '&year_to=' + yTo;
  if (kmFrom > 0) url += '&mileage_from=' + kmFrom;
  if (kmTo   > 0) url += '&mileage_to='   + kmTo;
  if (fuel)       url += '&fuel='          + fuel;
  if (trans)      url += '&transmission='  + trans;
  if (drive)      url += '&wheel_drive='   + drive;
  if (bodyType)   url += '&body_type='     + bodyType;
  return url;
}

async function scrapeFinn(url, targetKm, page) {
  console.log('  Finn: ' + url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const pageTotal = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d[\d\s]+)\s*treff/);
    return m ? parseInt(m[1].replace(/\s/g, '')) : 0;
  });
  const comps = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('article')).slice(0, 30).map(a => {
      const text  = a.innerText || '';
      const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g, '')) || 0;
      const kmM   = text.match(/\b(20\d{2}|19\d{2})\b.*?([\d\s]+)\s*km[^\w]/);
      const km    = kmM ? parseInt(kmM[2].replace(/\s/g, '')) : 0;
      const year  = parseInt((text.match(/\b(19\d{2}|20\d{2})\b/) || [])[1]) || 0;
      const hkM   = text.match(/(\d{2,3})\s*hk/i);
      const hk    = hkM ? parseInt(hkM[1]) : null;
      return { price, km, year, hk, text };
    }).filter(c => {
      const cy = new Date().getFullYear();
      return c.price >= 20000 && c.price <= 2000000 && (c.year === 0 || (c.year >= 1990 && c.year <= cy));
    });
  });
  const seen = new Set();
  const unique = comps.filter(c => {
    const key = c.price + '-' + c.km;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  unique._total = pageTotal || unique.length;
  console.log('     ' + unique._total + ' treff (scraped ' + unique.length + ')');
  return unique;
}

function qaCheckComps(car, specs, comps, valuation) {
  if (comps.length < 2) return { approved: false, reason: 'For fÃ¥ Finn-treff (' + comps.length + ')' };
  if (!valuation || !valuation.dLow) return { approved: false, reason: 'Valuation mangler' };
  if (valuation.dMid < 5000) return { approved: false, reason: 'D mid under 5 000 kr â vurder manuelt' };
  return { approved: true, reason: 'OK' };
}

async function searchFinnComps(car, specs, page) {
  const { make, model, km } = car;
  const cleanMake = make.replace(/\s*MOTORS\s*/i, '').replace(/JAGUAR LAND ROVER LIMITED/i, 'Land Rover').trim();
  const q        = cleanMake + ' ' + model;
  const regClass = specs.isVarebil ? '2' : '1';

  // ââ STEG 1: Ãrsregel basert pÃ¥ firstReg fra Vegvesen ââââââââââââââââââââââ
  // Hvis bilen ble registrert etter august (mÃ¥ned â¥ 9): bruk firstRegYear og firstRegYear+1
  // Hvis registrert januarâaugust: bruk firstRegYear kun
  const firstRegDate = specs.firstReg ? new Date(specs.firstReg) : null;
  const firstRegYear = firstRegDate ? firstRegDate.getFullYear() : car.year;
  const firstRegMonth = firstRegDate ? firstRegDate.getMonth() + 1 : 1;
  const yearFrom0 = firstRegYear;
  const yearTo0   = firstRegMonth >= 9 ? firstRegYear + 1 : firstRegYear;

  console.log('  Steg 1 Ã¥r: firstReg=' + (specs.firstReg||'ukjent') + ' â year_from=' + yearFrom0 + ' year_to=' + yearTo0);

  // ââ STEG 2: Drivstoff fra Vegvesen pÃ¥ Finn URL âââââââââââââââââââââââââââââââ
  // wheel_drive utelates â Finn klassifiserer ikke alltid el-biler som 2WD/4WD
  // fuel alene er nok til Ã¥ eliminere feil varianter (diesel vs elektrisk osv)
  const fuel = getFinnFuel(specs);

  const baseUrl  = 'https://www.finn.no/mobility/search/car?sales_form=1&registration_class=' + regClass + '&q=' + encodeURIComponent(q) + '&fuel=' + fuel;
  const finnUrl  = baseUrl + '&year_from=' + yearFrom0 + '&year_to=' + yearTo0 + '&sort=MILEAGE_ASC';

  console.log('  Steg 2 filter: fuel=' + fuel);

  const seen     = new Set();
  let allComps   = [];
  let totalCount = 0;

  // Scrape step 1 URL (both sort directions to get full km spread)
  for (const sort of ['MILEAGE_ASC', 'MILEAGE_DESC']) {
    const url = baseUrl + '&year_from=' + yearFrom0 + '&year_to=' + yearTo0 + '&sort=' + sort;
    const raw = await scrapeFinn(url, km, page);
    if (raw._total > totalCount) totalCount = raw._total;
    for (const c of raw) {
      const key = c.price + '-' + c.km;
      if (!seen.has(key) && c.price >= 10000 && c.km <= 500000) {
        seen.add(key);
        allComps.push(c);
      }
    }
  }

  // Sort by km proximity
  allComps.sort((a, b) => Math.abs(a.km - km) - Math.abs(b.km - km));
  console.log('  Raw comps: ' + allComps.length + ' (closest km: ' + (allComps[0]?.km || 0).toLocaleString('nb-NO') + ')');
  return { comps: allComps, finnUrl: finnUrl, totalCount: totalCount };
}

// Claude picks the best anchor comp from raw Finn listings
async function aiPickAnchor(car, specs, comps) {
  if (comps.length === 0) return null;

  // Pre-filter to cars within km band â Claude only sees comparable cars
  // Â±30k first, widen to Â±50k, then Â±80k if needed
  let pool = [];
  for (const band of [30000, 50000, 80000, 150000]) {
    pool = comps.filter(c => Math.abs(c.km - car.km) <= band);
    if (pool.length >= 3) break;
  }
  if (pool.length === 0) pool = comps; // last resort

  // Sort by price ASC within pool â Claude picks cheapest comparable
  pool.sort((a, b) => a.price - b.price);
  const top15 = pool.slice(0, 15);

  const listings = top15.map(function(c, i) {
    return (i+1) + '. ' + c.price.toLocaleString('nb-NO') + ' kr | ' + c.km.toLocaleString('nb-NO') + ' km | ' + c.year + ' | ' + (c.text ? c.text.substring(0, 80) : '');
  }).join('\n');

  const prompt = 'Du er en bruktbilekspert i Norge for Peasy (C2B auksjon).\n\n'
    + 'Bilen som skal prises: ' + car.year + ' ' + car.make + ' ' + car.model + ', ' + car.km.toLocaleString('nb-NO') + ' km, ' + specs.fuel + ', ' + Math.round((specs.kw||0)*1.36) + ' hk\n\n'
    + 'Sammenlignbare biler pÃ¥ Finn (lignende km, sortert billigst fÃ¸rst):\n'
    + listings + '\n\n'
    + 'Velg den billigste bilen som er et reelt alternativ til vÃ¥r bil. Ignorer Ã¥penbart feil data.\n'
    + 'Svar KUN med JSON: {"index": N, "price": PRIS, "reason": "en setning pÃ¥ norsk"}';

  try {
    const res  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const text = data.content && data.content[0] ? data.content[0].text : '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    const anchor = top15[json.index - 1];
    if (!anchor) return null;
    console.log('  AI anchor: #' + json.index + ' â ' + json.price.toLocaleString('nb-NO') + ' kr | ' + json.reason);
    return { anchor: Object.assign({}, anchor, { aiReason: json.reason }), pool: top15 };
  } catch(e) {
    console.error('  AI anchor failed:', e.message);
    const fallback = pool.slice().sort(function(a, b) { return a.price - b.price; })[0] || comps[0];
    return { anchor: fallback, pool: pool };
  }
}
// âââ VALUATION âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// xPct = acceptance buffer â update as auction data accumulates
const BRACKETS = [
  { max: 100000,   dealerMarginPct: 0,    minMargin: 10000, xPct: 0.03 },
  { max: 250000,   dealerMarginPct: 0.12, minMargin: 10000, xPct: 0.01 },
  { max: 400000,   dealerMarginPct: 0.12, minMargin: 10000, xPct: 0.01 },
  { max: Infinity, dealerMarginPct: 0.12, minMargin: 10000, xPct: 0.00 },
];

function getBracket(price) { return BRACKETS.find(b => price <= b.max); }

function calcValuation(lowestComp) {
  // Sannsynlig bud (intern, vises ikke til selger):
  // anker x 0.88, minimum 10 000 kr margin fra anker
  const raw = Math.round(lowestComp * 0.88);
  const sannsynligBud = (lowestComp - raw) >= 10000 ? raw : lowestComp - 10000;

  // Peasy-gebyr (U) basert pÃ¥ sannsynlig bud
  const fee = sannsynligBud >= 125000 ? 9900 : sannsynligBud >= 75000 ? 7900 : 5900;

  // D mid = sannsynlig bud minus U (hva selger faktisk mottar)
  const dMid = sannsynligBud - fee;

  // D lav / D hÃ¸y â det selger ser
  const dLow  = formatNOK(Math.round(dMid * 0.95));
  const dHigh = formatNOK(Math.round(dMid * 1.05));

  return { dLow, dHigh, dMid: formatNOK(dMid), fee, sannsynligBud };
}

function formatSingleResult(r) {
  let msg = '';
  const results = [r];
  for (const r of results) {
    if (r.status === 'error') { msg += '<b>' + r.regNr + '</b> â ' + r.error + '\n\n'; continue; }
    const { car, specs, comps, finnUrl, valuation, finnAvg, lowestComp, qa } = r;

    // Section 1: Origin car
    msg += 'ââââââââââââââââââââ\n';
    msg += 'ð <b>' + r.regNr + ' â ' + car.make + ' ' + car.model + ' ' + car.year + '</b>\n';
    msg += car.km.toLocaleString('nb-NO') + 'km | ' + specs.fuel + ' | ' + specs.gearbox + ' | ' + specs.drive + ' | ' + Math.round(specs.kw * 1.36) + 'hk\n';
    msg += 'ââââââââââââââââââââ\n\n';

    // Section 2: Finn search params
    msg += 'ð <b>FINN-SÃK</b>\n';
    msg += specs.fuel + ' | ' + specs.gearbox + ' | ' + specs.drive + ' | ' + car.year + '\n';
    msg += (r.totalCount || comps.length) + ' treff | <a href="' + finnUrl + '">Ãpne sÃ¸k</a>\n';
    msg += 'ââââââââââââââââââââ\n\n';

    // Section 3: Finn comps
    msg += 'ð <b>FINN KOMPS</b>\n';
    comps.sort((a, b) => a.price - b.price).slice(0, 5).forEach((c, i) => {
      const isAnchor = r.anchor && c.price === r.anchor.price && c.km === r.anchor.km;
      msg += (i + 1) + '. ' + c.price.toLocaleString('nb-NO') + ' kr | ' + c.km.toLocaleString('nb-NO') + 'km | ' + (c.year || '?') + (isAnchor ? ' â anker' : '') + '\n';
    });
    msg += 'Snitt: <b>' + fmtNOKstr(finnAvg) + '</b>\n';
    if (r.anchor && r.anchor.aiReason) msg += 'ð¤ ' + r.anchor.aiReason + '\n';
    msg += 'ââââââââââââââââââââ\n\n';

    // Section 4: Valuation
    msg += 'ð° <b>KALKYLE</b>\n';
    msg += 'Finn anker:       <b>' + r.lowestComp.toLocaleString('nb-NO') + ' kr</b>\n';
    msg += 'Ã 0.88 (12%):     ' + valuation.sannsynligBud.toLocaleString('nb-NO') + ' kr\n';
    msg += 'Peasy fee (U):  â ' + valuation.fee.toLocaleString('nb-NO') + ' kr\n';
    msg += 'D mid:            ' + valuation.dMid.toLocaleString('nb-NO') + ' kr\n';
    msg += '<b>D lav: ' + valuation.dLow.toLocaleString('nb-NO') + ' â D hÃ¸y: ' + valuation.dHigh.toLocaleString('nb-NO') + ' kr</b>\n';
    msg += 'Sannsynlig bud:   ~' + valuation.sannsynligBud.toLocaleString('nb-NO') + ' kr\n\n';
    if (r.finnListing) {
      const gap = r.finnListing.price - r.lowestComp;
      const gapStr = gap > 0 ? '+' + Math.round(gap/1000) + 'k over' : Math.round(gap/1000) + 'k under';
      msg += 'Finn-annonse: â <a href="https://www.finn.no/mobility/search/car?q=' + car.regNr + '">' + r.finnListing.price.toLocaleString('nb-NO') + ' kr (' + gapStr + ' anker)</a>\n';
    } else {
      msg += 'Finn-annonse: â Ikke funnet\n';
    }
    msg += 'Heftelser: ' + r.heftelser + '\n';
    if (valuation.dMid < 10000) msg += 'â ï¸ Lav Ã¸konomi â vurder manuelt\n';
    if (r.sdComment) msg += 'Kundekommentar: ' + r.sdComment.substring(0, 300) + '\n';
    msg += 'ââââââââââââââââââââ\n\n';

    // Section 5: ERP status
    msg += 'ð <b>ERP</b>\n';
    const hasHeftelser = r.heftelser && r.heftelser.includes('registrert');
    if (r.finnListing) {
      msg += 'â ï¸ Ikke skrevet â bil annonsert pÃ¥ Finn\n';
    } else if (hasHeftelser) {
      msg += 'â ï¸ Ikke skrevet â heftelser registrert\n';
    } else if (qa && !qa.approved) {
      msg += 'â ï¸ Ikke skrevet â manuell gjennomgang\n';
      msg += 'QA: ' + qa.reason + '\n';
    } else {
      msg += 'â Skrevet til ERP\n';
      if (qa) msg += 'QA: ' + qa.reason + '\n';
    }
    msg += '\n';
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
      console.log('\n' + car.regNr + ' â ' + car.make + ' ' + car.model + ' ' + car.year + ' ' + car.km + 'km');
      try {
        const specs = await getVegvesenData(car.regNr);
        console.log('  ' + specs.fuel + ' | ' + specs.gearbox + ' | ' + specs.drive + ' | ' + specs.kw + 'kW | bodyType:' + specs.bodyType);
        const heftelser = await checkHeftelser(car.regNr, page);
        const finnListing = await checkFinnListing(car.regNr, page);
        const { comps, finnUrl, totalCount } = await searchFinnComps(car, specs, page);
        if (comps.length < 1) throw new Error('Ingen Finn-treff funnet');
        // Remove own listing from comps before passing to AI
        const sansOwn = finnListing ? comps.filter(c => !(Math.abs(c.price - finnListing.price) < 1000 && Math.abs(c.km - car.km) < 2000)) : comps;
        const { anchor, pool } = await aiPickAnchor(car, specs, sansOwn);
        if (!anchor) throw new Error('AI fant ingen sammenlignbar bil');
        const lowestComp = anchor.price;
        const finnAvg    = Math.round(pool.reduce((s, c) => s + c.price, 0) / pool.length);
        const valuation  = calcValuation(lowestComp);
        console.log('  D lav: ' + fmtNOKstr(valuation.dLow) + ' | D hÃ¸y: ' + fmtNOKstr(valuation.dHigh));
        let sdComment = null;
        if (car.hasSdComment && car.erpId) {
          const erpToken = await getERPToken();
          sdComment = await getERPCarComment(car.erpId, erpToken);
        }
        const qa = qaCheckComps(car, specs, pool, valuation);
        console.log('  QA:', qa.approved ? 'GODKJENT' : 'FLAGGET', '-', qa.reason);
        const hasHeftelser = heftelser && heftelser.includes('registrert');
        if (car.erpId && !finnListing && !hasHeftelser && qa.approved) {
          const erpToken = await getERPToken();
          await writeARValueToERP(car.erpId, valuation.dLow, valuation.dHigh, heftelser, erpToken);
          markProcessed(car.regNr, { make: car.make, model: car.model, year: car.year, finnAvg, lowestComp, dLow: valuation.dLow, dHigh: valuation.dHigh });
        } else if (finnListing) {
          console.log('  SKIP ERP: Car listed on Finn at ' + finnListing.price + ' kr');
        } else if (hasHeftelser) {
          console.log('  SKIP ERP: Heftelser registrert');
        } else if (!qa.approved) {
          console.log('  SKIP ERP: QA flagget - ' + qa.reason);
        }
        results.push({ status: 'ok', regNr: car.regNr, car, specs, comps: pool, anchor, finnUrl, totalCount, finnAvg, lowestComp, valuation, heftelser, sdComment, finnListing, qa });
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
    const time = runTime.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    await sendTelegram('<b>PEASY-AUTO | ' + time + '</b>');
    for (const r of results) {
      await sendTelegram(formatSingleResult(r));
    }
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
            if (regNr && !erpCar) { await sendTelegram('â ï¸ ' + regNr + ' ikke funnet i ERP-koen. Bilen er allerede behandlet eller ikke registrert.'); return; }
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
            const fakeSpecs = { fuel: carInfo ? carInfo.fuel : ' ', gearbox: carInfo ? carInfo.gearbox : ' ', drive: carInfo ? carInfo.drive : ' ', kw: carInfo ? carInfo.kw : 0 };
            heftelser = await checkHeftelser(regNr, pg);
            let finnListing = null;
            if (regNr) finnListing = await checkFinnListing(regNr, pg);
            if (finnListing) { comps.splice(0, comps.length, ...comps.filter(c => !(Math.abs(c.price - finnListing.price) < 1000 && Math.abs(c.km - fakeCar.km) < 2000))); }
            await br.close();
            if (comps.length === 0) {
              await sendTelegram('Ingen resultater funnet.');
            } else {
              const anchor = await aiPickAnchor(fakeCar, fakeSpecs, comps);
              const carKm = erpCar?.km || 0;
              const carYear = erpCar?.year || 0;
              const top5 = comps.slice().sort((a,b) => a.price - b.price).slice(0, 5);
              const avg  = Math.round(comps.reduce((s, c) => s + c.price, 0) / comps.length);
              const lowest = anchor ? anchor.price : Math.min(...comps.map(c => c.price));
              const val  = calcValuation(lowest);
              const hk = Math.round((carInfo?.kw || 0) * 1.36);
              let reply = 'ââââââââââââââââââââ\n';
              reply += 'ð <b>' + (regNr || '') + ' â ' + (carInfo?.make || '') + ' ' + (carInfo?.model || '') + ' ' + carYear + '</b>\n';
              reply += (carKm ? carKm.toLocaleString('nb-NO') : '0') + 'km | ' + (carInfo?.fuel || '') + ' | ' + (carInfo?.gearbox || '') + ' | ' + (carInfo?.drive || '') + ' | ' + hk + 'hk\n';
              reply += 'ââââââââââââââââââââ\n\n';
              reply += 'ð <b>FINN-SÃK (MANUELL)</b>\n';
              reply += comps.length + ' treff | <a href="' + finnUrl + '">Ãpne sÃ¸k</a>\n';
              reply += 'ââââââââââââââââââââ\n\n';
              reply += 'ð <b>FINN KOMPS</b>\n';
              top5.forEach((c, i) => {
                const isAnker = anchor && c.price === anchor.price && c.km === anchor.km;
                reply += (i + 1) + '. ' + c.price.toLocaleString('nb-NO') + ' kr | ' + c.km.toLocaleString('nb-NO') + 'km | ' + c.year + (isAnker ? ' â anker' : '') + '\n';
              });
              reply += 'Snitt: <b>' + fmtNOKstr(avg) + '</b>\n';
              if (anchor && anchor.aiReason) reply += 'ð¤ ' + anchor.aiReason + '\n';
              reply += 'ââââââââââââââââââââ\n\n';
              reply += 'ð° <b>KALKYLE</b>\n';
              reply += 'Finn anker:       <b>' + lowest.toLocaleString('nb-NO') + ' kr</b>\n';
              reply += 'Ã 0.88 (12%):     ' + val.sannsynligBud.toLocaleString('nb-NO') + ' kr\n';
              reply += 'Peasy fee (U):  â ' + val.fee.toLocaleString('nb-NO') + ' kr\n';
              reply += 'D mid:            ' + val.dMid.toLocaleString('nb-NO') + ' kr\n';
              reply += '<b>D lav: ' + val.dLow.toLocaleString('nb-NO') + ' â D hÃ¸y: ' + val.dHigh.toLocaleString('nb-NO') + ' kr</b>\n';
              reply += 'Sannsynlig bud:   ~' + val.sannsynligBud.toLocaleString('nb-NO') + ' kr\n\n';
              if (finnListing) reply += 'Finn-annonse: â <a href="https://www.finn.no/mobility/search/car?q=' + regNr + '">' + finnListing.price.toLocaleString('nb-NO') + ' kr (' + finnListing.km.toLocaleString('nb-NO') + ' km)</a>\n';

              else reply += 'Finn-annonse: â Ikke funnet\n';
              if (heftelser) reply += 'Heftelser: ' + heftelser + '\n';
              if (erpCar?.comment) reply += 'Kundekommentar: ' + erpCar.comment.substring(0, 300) + '\n';
              reply += 'ââââââââââââââââââââ\n\n';
              reply += 'ð <b>ERP</b>\n';
              reply += 'â ï¸ Ikke skrevet â manuell gjennomgang\n';
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
