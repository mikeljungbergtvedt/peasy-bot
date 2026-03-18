// ============================================================
// peasy-auto.js — Peasy C2B Prisbot
// Versjon: v19.03.a — komplett omskriving
//
// Kjernefunksjon:
//   - Henter biler fra ERP (liste 2+3)
//   - Søker Finn.no for sammenlignbare biler
//   - AI (Claude Haiku) velger anker
//   - Beregner D lav/høy og E (estimert bud)
//   - Sender eval-kort til Telegram
//   - Skriver alltid til ERP (PUT pris + POST kommentar)
//
// /finn kommando:
//   - Bruker manuell Finn-URL som komp-pool
//   - Identisk eval-kort og ERP-skriving
//
// Prisformel (PDEC1):
//   T = max(anker × 0.88, anker − 10000)
//   fee = T < 75k → 5900, T < 125k → 7900, ellers → 9900
//   D mid = T − fee
//   D lav = D mid × 0.95, D høy = D mid × 1.05
//   E = D lav × xPct (fra peasy-brackets.json, fallback PDEC1)
// ============================================================

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');

// ── Enkelt-instans lås ──────────────────────────────────────
const LOCK = '/tmp/peasy.lock';
try {
  const old = fs.existsSync(LOCK) && parseInt(fs.readFileSync(LOCK, 'utf8'));
  if (old && old !== process.pid) { try { process.kill(old, 'SIGKILL'); } catch(e){} }
} catch(e){}
fs.writeFileSync(LOCK, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(LOCK); } catch(e){} });

// ── Miljøvariabler ──────────────────────────────────────────
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const VEGVESEN_API_KEY = process.env.VEGVESEN_API_KEY;

// ── Kjøretid: 06-22 ────────────────────────────────────────
function shouldRun() {
  const h = new Date().getHours();
  return h >= 6 && h < 22;
}

// ── Hjelpefunksjoner ────────────────────────────────────────
function formatNOK(num) { return Math.round(num / 1000) * 1000; }
function fmtNOKstr(num) { return formatNOK(num).toLocaleString('nb-NO') + ' kr'; }
function loadJSON(file) { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); return {}; }
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// ── Telegram ────────────────────────────────────────────────
async function sendTelegram(message) {
  try {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
    });
  } catch(err) { console.error('Telegram feil:', err.message); }
}

// ── ERP Auth ────────────────────────────────────────────────
let _erpToken = null;
let _erpTokenExpiry = null;
async function getERPToken() {
  if (_erpToken && _erpTokenExpiry && new Date() < _erpTokenExpiry) return _erpToken;
  console.log('Logger inn i ERP...');
  const res = await fetch('https://api.biladministrasjon.no/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS })
  });
  const data = await res.json();
  if (!data.success) throw new Error('ERP login feilet');
  _erpToken = data.data.token.token;
  _erpTokenExpiry = new Date(data.data.token.expires_at);
  return _erpToken;
}

// ── ERP: Hent selgerkommentar ───────────────────────────────
async function getERPCarComment(erpId, token) {
  try {
    const res = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/' + erpId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    return data.data?.car?.self_declaration?.comment || null;
  } catch(e) { return null; }
}

// ── ERP: Skriv AR-verdi (PUT) — alltid, ingen unntak ───────
// auction_price_type_id: 1 = Regular (D lav > 35k), 2 = Lower (D lav <= 35k)
async function writeARValueToERP(erpId, dLow, dHigh, heftelser, token) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const hasDebt = heftelser && heftelser.includes('registrert');
    const auctionType = dLow <= 35000 ? 2 : 1;

    const payload = {
      price_final_min:        formatNOK(dLow),
      price_final_max:        formatNOK(dHigh),
      auction_price_type_id:  auctionType,
      encumbrance: {
        is_checked: true,
        has_debt:   hasDebt,
        comment:    heftelser || 'Ingen heftelser',
        date:       today
      },
      owners_check_date:    today,
      owners_check_comment: null,
      owners_is_checked:    true,
    };

    const res = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/' + erpId, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      console.log('  ERP PUT OK: ' + formatNOK(dLow).toLocaleString('nb-NO') + ' - ' + formatNOK(dHigh).toLocaleString('nb-NO') + ' kr | auksjon type ' + auctionType);
      return true;
    } else {
      console.error('  ERP PUT feilet:', JSON.stringify(data));
      return false;
    }
  } catch(e) {
    console.error('  ERP PUT feil:', e.message);
    return false;
  }
}

// ── ERP: Post eval-kort som kommentar (POST) — alltid ───────
async function postERPComment(erpId, evalText, token) {
  try {
    const res = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/' + erpId + '/comments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: evalText })
    });
    const data = await res.json();
    if (data.success) {
      console.log('  ERP kommentar POST OK');
      return true;
    } else {
      console.error('  ERP kommentar POST feilet:', JSON.stringify(data));
      return false;
    }
  } catch(e) {
    console.error('  ERP kommentar feil:', e.message);
    return false;
  }
}

// ── ERP: Hent biler i kø (liste 2+3) ───────────────────────
async function fetchPendingCars() {
  console.log('Henter biler fra ERP...');
  const token = await getERPToken();
  const cars = [];
  for (const endpoint of ['estimating_ar_final', 'estimating_ar_temp']) {
    const res = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/processing/' + endpoint + '?per_page=100', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { console.error('ERP ' + endpoint + ' feilet: ' + res.status); continue; }
    const data = await res.json();
    const list = data.data?.data?.data || [];
    for (const c of list) {
      if (!c.registration_number) continue;
      cars.push({
        erpId:        c.id,
        regNr:        c.registration_number,
        make:         c.manufacturer || '',
        model:        c.model_series || '',
        year:         c.model_year || 0,
        km:           c.mileage || 0,
        hasSdComment: c.has_sd_comment === 1,
        source:       c.source || ''
      });
    }
  }
  const seen = new Set();
  const unique = cars.filter(c => { if (seen.has(c.regNr)) return false; seen.add(c.regNr); return true; });
  console.log('  Fant ' + unique.length + ' bil(er)');
  return unique;
}

// ── Vegvesen ────────────────────────────────────────────────
async function getVegvesenData(regNr) {
  const res = await fetch('https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=' + regNr.replace(/\s/g, ''), {
    headers: { 'Accept': 'application/json', 'SVV-Authorization': VEGVESEN_API_KEY }
  });
  if (!res.ok) throw new Error('Vegvesen ' + res.status);
  const data = await res.json();
  const k = data.kjoretoydataListe?.[0];
  if (!k) throw new Error('Ingen Vegvesen-data');
  const td       = k.godkjenning?.tekniskGodkjenning?.tekniskeData;
  const motor    = td?.motorOgDrivverk?.motor?.[0];
  const drivstoff= motor?.drivstoff?.[0];
  const miljo    = td?.miljodata?.miljoOgdrivstoffGruppe?.[0];
  const utslipp  = miljo?.forbrukOgUtslipp?.[0];
  const aksler   = td?.akslinger?.akselGruppe || [];
  const drivAksler = aksler.filter(g => g.akselListe?.aksel?.some(a => a.drivAksel)).length;
  const generelt = k.godkjenning?.tekniskGodkjenning?.tekniskeData?.generelt;

  // Hent førstegangsregistrering for årsregel
  const firstRegStr = k.godkjenning?.forstegangsGodkjenning?.forstegangRegistrertDato || '';
  const firstRegMonth = firstRegStr ? parseInt(firstRegStr.split('-')[1] || '0') : 0;

  return {
    make:           generelt?.merke?.[0]?.merke || '',
    model:          generelt?.handelsbetegnelse?.[0] || '',
    isVarebil:      k?.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering?.tekniskKode?.kodeBeskrivelse?.toLowerCase().includes('varebil') || false,
    fuel:           drivstoff?.drivstoffKode?.kodeBeskrivelse || 'Ukjent',
    gearbox:        td?.motorOgDrivverk?.girkassetype?.kodeBeskrivelse || 'Ukjent',
    kw:             drivstoff?.maksNettoEffekt || drivstoff?.maksEffektPrTime || 0,
    drive:          drivAksler >= 2 ? '4WD' : '2WD',
    range:          utslipp?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring || null,
    bodyType:       td?.karosseriOgLasteplan?.karosseritype?.kodeVerdi || '',
    firstRegMonth,
  };
}

// ── Heftelser (Brreg) ───────────────────────────────────────
async function checkHeftelser(regNr, page) {
  try {
    await page.goto('https://rettsstiftelser.brreg.no/nb/oppslag/motorvogn/' + regNr.replace(/\s/g, ''), {
      waitUntil: 'networkidle', timeout: 15000
    });
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    if (text.toLowerCase().includes('ingen oppf')) return 'Ingen heftelser';
    if (text.includes('heftelse') || text.includes('pant') || text.includes('registrert')) return 'Heftelser registrert - sjekk manuelt';
    return 'Ingen heftelser';
  } catch(e) { return 'Kunne ikke sjekke heftelser'; }
}

// ── Finn-URL bygger ─────────────────────────────────────────
function getFinnFuel(specs) {
  const f = specs.fuel.toLowerCase();
  if (f.includes('elektr')) return '4';
  if (f.includes('diesel')) return '2';
  if (f.includes('hybrid')) return '3';
  return '1';
}

// ── Finn: Sjekk om bilen selv er annonsert ──────────────────
async function checkFinnListing(regNr, page) {
  try {
    await page.goto('https://www.finn.no/mobility/search/car?q=' + regNr + '&registration_class=1&sales_form=1', {
      waitUntil: 'networkidle', timeout: 15000
    });
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

// ── Finn: Skrap komp-pool fra URL ───────────────────────────
async function scrapeFinnUrl(url, page) {
  console.log('  Finn: ' + url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const pageTotal = await page.evaluate(() => {
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
      return { price, km, year, text };
    }).filter(c => c.price >= 5000 && c.price <= 2000000);
  });
  const seen = new Set();
  const unique = comps.filter(c => {
    const key = c.price + '-' + c.km;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  unique._total = pageTotal || unique.length;
  console.log('  ' + unique._total + ' treff, scraped ' + unique.length);
  return unique;
}

// ── Finn: Auto-søk med årsregel og km-filter ───────────────
async function searchFinnComps(car, specs, page) {
  const cleanMake = car.make.replace(/\s*MOTORS\s*/i, '').replace(/JAGUAR LAND ROVER LIMITED/i, 'Land Rover').trim();
  const q = cleanMake + ' ' + car.model;
  const regClass = specs.isVarebil ? '2' : '1';
  const fuel = getFinnFuel(specs);

  // Årsregel: registrert etter august → inkluder neste år
  const yFrom = car.year;
  const yTo   = specs.firstRegMonth >= 9 ? car.year + 1 : car.year;

  const base = 'https://www.finn.no/mobility/search/car?sales_form=1&registration_class=' + regClass +
    '&q=' + encodeURIComponent(q) + '&fuel=' + fuel +
    '&year_from=' + yFrom + '&year_to=' + yTo;

  const searches = [
    base + '&sort=MILEAGE_ASC',
    base + '&sort=MILEAGE_DESC',
    'https://www.finn.no/mobility/search/car?sales_form=1&registration_class=' + regClass +
      '&q=' + encodeURIComponent(q) + '&fuel=' + fuel +
      '&year_from=' + (yFrom-1) + '&year_to=' + (yTo+1) + '&sort=MILEAGE_ASC',
  ];

  const seen = new Set();
  let comps = [];
  let totalCount = 0;
  const finnUrl = base + '&sort=MILEAGE_ASC';

  for (const url of searches) {
    const raw = await scrapeFinnUrl(url, page);
    if (raw._total > totalCount) totalCount = raw._total;
    for (const c of raw) {
      const key = c.price + '-' + c.km;
      if (!seen.has(key) && c.price >= 5000 && c.km <= 500000) {
        seen.add(key); comps.push(c);
      }
    }
    if (comps.length >= 10) break;
  }

  // Km-filter: ±30k, utvid til ±50k, ±80k, ±150k hvis for få
  let pool = comps;
  for (const band of [30000, 50000, 80000, 150000]) {
    const filtered = comps.filter(c => Math.abs(c.km - car.km) <= band);
    if (filtered.length >= 3) { pool = filtered; break; }
  }

  pool.sort((a, b) => a.price - b.price);
  console.log('  Pool: ' + pool.length + ' biler etter km-filter');
  return { comps: pool, finnUrl, totalCount };
}

// ── AI: Velg anker (Claude Haiku) ──────────────────────────
async function aiPickAnchor(car, specs, pool) {
  if (pool.length === 0) return null;
  const top = pool.slice(0, 5);
  const listings = top.map((c, i) =>
    (i+1) + '. ' + c.price.toLocaleString('nb-NO') + ' kr | ' + c.km.toLocaleString('nb-NO') + ' km | ' + c.year +
    (c.text ? ' | ' + c.text.substring(0, 80) : '')
  ).join('\n');

  const hk = Math.round((specs.kw || 0) * 1.36);
  const prompt =
    'Du er bruktbilekspert i Norge for Peasy (C2B auksjon).\n\n' +
    'Bilen som prises: ' + car.year + ' ' + car.make + ' ' + car.model + ', ' +
    car.km.toLocaleString('nb-NO') + ' km, ' + specs.fuel + ', ' + hk + ' hk\n\n' +
    'Sammenlignbare biler (sortert billigst):\n' + listings + '\n\n' +
    'Velg billigste reelle alternativ. Ignorer skadet, demo, feil variant.\n' +
    'Svar KUN med JSON: {"index": N, "price": PRIS, "reason": "en setning pa norsk"}';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    const anchor = top[json.index - 1];
    if (!anchor) throw new Error('Ugyldig index fra AI');
    console.log('  AI anker: #' + json.index + ' - ' + anchor.price.toLocaleString('nb-NO') + ' kr | ' + json.reason);
    return { anchor: { ...anchor, aiReason: json.reason }, pool: top };
  } catch(e) {
    console.error('  AI anker feilet:', e.message, '- bruker billigste');
    const fallback = top[0];
    return { anchor: { ...fallback, aiReason: 'Billigste i pool (AI fallback)' }, pool: top };
  }
}

// ── Dynamisk xPct fra Pulse feedback loop ──────────────────
// Pulse skriver peasy-brackets.json til GH Pages etter datahenting
// Boten henter dette ved run() og bruker i E-beregning
// Fallback til PDEC1-verdier hvis fetch feiler
let _dynamicXPct = null;
async function fetchDynamicXPct() {
  try {
    const res = await fetch('https://mikeljungbergtvedt.github.io/peasy-brackets.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _dynamicXPct = await res.json();
    console.log('  Dynamic xPct lastet:', JSON.stringify(_dynamicXPct));
  } catch(e) {
    console.log('  Dynamic xPct utilgjengelig, bruker PDEC1 fallback:', e.message);
    _dynamicXPct = null;
  }
}

// ── Prisberegning ───────────────────────────────────────────
function calcValuation(anchorPrice) {
  // T = anker × 0.88, minimum 10k margin
  const raw88 = formatNOK(anchorPrice * 0.88);
  const T     = (anchorPrice - raw88) >= 10000 ? raw88 : anchorPrice - 10000;
  const minMarginUsed = T < raw88;

  // Peasy-gebyr basert på T
  const fee = T >= 125000 ? 9900 : T >= 75000 ? 7900 : 5900;

  // D mid, D lav, D høy
  const dMid  = T - fee;
  const dLow  = formatNOK(dMid * 0.95);
  const dHigh = formatNOK(dMid * 1.05);

  // xPct: dynamisk fra Pulse, fallback til PDEC1
  const pdec1 = dMid <= 100000 ? 0.102 : dMid <= 250000 ? -0.089 : dMid <= 400000 ? -0.046 : -0.073;
  let xPct = pdec1;
  if (_dynamicXPct) {
    if (dMid <= 100000)      xPct = _dynamicXPct.lav     ?? pdec1;
    else if (dMid <= 250000) xPct = _dynamicXPct.mid     ?? pdec1;
    else if (dMid <= 400000) xPct = _dynamicXPct.hoy     ?? pdec1;
    else                     xPct = _dynamicXPct.premium ?? pdec1;
  }
  const eBud = formatNOK(dLow * (1 + xPct));

  return { T, raw88, minMarginUsed, fee, dMid, dLow, dHigh, xPct, eBud };
}

// ── Bygg eval-korttekst (plain text for Telegram HTML) ─────
// Brukes til både Telegram og ERP-kommentar
function buildEvalText(r) {
  const { car, specs, pool, anchor, finnUrl, totalCount, finnAvg, anchorPrice, valuation, heftelser, sdComment, finnListing, source } = r;

  const title = (source || '').toLowerCase() === 'driveno' ? 'DRIVE BIL TIL ESTIMERING' : 'PEASY BIL TIL ESTIMERING';
  const isEl  = specs.fuel.toLowerCase().includes('elektr');
  const hkStr = isEl ? (specs.range ? specs.range + ' km rekkevidde' : specs.kw + ' kW') : Math.round((specs.kw||0)*1.36) + ' hk';

  let msg = '';

  // ── Tittel og bilinfo ──
  msg += title + '\n';
  msg += car.regNr + ' | ' + car.make + ' ' + car.model + ' ' + car.year + ' | ' + car.km.toLocaleString('nb-NO') + ' km | ' + specs.fuel + ' | ' + specs.gearbox + ' | ' + specs.drive + ' | ' + hkStr + '\n\n';

  // ── FINN-SOK ──
  msg += 'FINN-SOK ' + specs.fuel + ' | ' + car.year + ' | ' + totalCount + ' treff\n';

  // ── Finn-annonse (egen bil) ──
  if (finnListing) {
    const gap = finnListing.price - anchorPrice;
    const gapStr = gap >= 0 ? '+' + Math.round(gap/1000) + 'k over anker' : Math.abs(Math.round(gap/1000)) + 'k under anker';
    msg += 'Finn-annonse: ' + finnListing.price.toLocaleString('nb-NO') + ' kr (' + gapStr + ')\n';
  } else {
    msg += 'Finn-annonse: Ikke funnet\n';
  }
  msg += '\n';

  // ── Komp-liste (1-5), anker i bold ──
  pool.slice(0, 5).forEach((comp, i) => {
    const isAnker = anchor && comp.price === anchor.price && comp.km === anchor.km;
    const line = '  ' + (i+1) + '. ' + comp.price.toLocaleString('nb-NO') + ' kr  ' + comp.km.toLocaleString('nb-NO') + ' km  ' + (comp.year||'');
    if (isAnker) msg += '<b>' + line + '  <-- ANKER</b>\n';
    else msg += line + '\n';
  });
  msg += '  Snitt: ' + fmtNOKstr(finnAvg) + '\n\n';

  // ── AI-kommentar ──
  msg += 'AI KOMMENTAR\n';
  msg += '  ' + (anchor?.aiReason || 'Ingen AI-begrunnelse') + '\n\n';

  // ── Kalkyle ──
  msg += 'KALKYLE\n';
  msg += '  Anker:          ' + anchorPrice.toLocaleString('nb-NO') + ' kr\n';
  msg += '  x 0.88:         ' + valuation.raw88.toLocaleString('nb-NO') + ' kr\n';
  if (valuation.minMarginUsed) {
    msg += '  (min.margin):   ' + valuation.T.toLocaleString('nb-NO') + ' kr  <- min 10k margin\n';
  }
  msg += '  Peasy fee (U): -' + valuation.fee.toLocaleString('nb-NO') + ' kr\n';
  msg += '  D mid:          ' + valuation.dMid.toLocaleString('nb-NO') + ' kr\n';
  msg += '  Estimert:       ' + valuation.dLow.toLocaleString('nb-NO') + ' - ' + valuation.dHigh.toLocaleString('nb-NO') + ' kr\n';
  msg += '  Est. bud (E):  ~' + valuation.eBud.toLocaleString('nb-NO') + ' kr (' + (valuation.xPct >= 0 ? '+' : '') + (valuation.xPct * 100).toFixed(1) + '%)\n\n';

  // ── Heftelser ──
  msg += 'HEFTELSER\n';
  msg += '  ' + heftelser + '\n\n';

  // ── Selgerkommentar — alltid synlig ──
  msg += 'KOMMENTAR FRA SELGER\n';
  msg += '  ' + (sdComment || 'Ingen selgerkommentar') + '\n\n';

  // ── ERP-status ──
  msg += 'ERP\n';
  const auctionType = valuation.dLow <= 35000 ? '2 (Lower price)' : '1 (Regular)';
  msg += '  Skrevet: D lav ' + valuation.dLow.toLocaleString('nb-NO') + ' - D hoy ' + valuation.dHigh.toLocaleString('nb-NO') + ' kr | Auksjon type ' + auctionType + '\n';

  return msg;
}

// ── Telegram-versjon med bold på tittel og estimert ─────────
function buildTelegramText(r) {
  let msg = buildEvalText(r);
  // Wrap title i bold for Telegram
  const title = (r.source || '').toLowerCase() === 'driveno' ? 'DRIVE BIL TIL ESTIMERING' : 'PEASY BIL TIL ESTIMERING';
  msg = msg.replace(title, '<b>' + title + '</b>');
  // Wrap estimert-linje i bold
  msg = msg.replace('  Estimert:       ', '<b>  Estimert:       ');
  msg = msg.replace(r.valuation.dHigh.toLocaleString('nb-NO') + ' kr\n', r.valuation.dHigh.toLocaleString('nb-NO') + ' kr</b>\n');
  // Finn-lenke
  msg = msg.replace('FINN-SOK ' + r.specs.fuel + ' | ' + r.car.year + ' | ' + r.totalCount + ' treff\n',
    'FINN-SOK ' + r.specs.fuel + ' | ' + r.car.year + ' | ' + r.totalCount + ' treff | <a href="' + r.finnUrl + '">Apne sok</a>\n');
  return msg;
}

// ── Prosesser én bil ────────────────────────────────────────
async function processCar(car, page, finnUrlOverride) {
  console.log('\n' + car.regNr + ' - ' + car.make + ' ' + car.model + ' ' + car.year + ' ' + car.km + 'km' + (finnUrlOverride ? ' [/finn manuell]' : ''));

  const specs     = await getVegvesenData(car.regNr);
  console.log('  ' + specs.fuel + ' | ' + specs.gearbox + ' | ' + specs.drive + ' | ' + specs.kw + 'kW');

  const heftelser = await checkHeftelser(car.regNr, page);
  const finnListing = await checkFinnListing(car.regNr, page);

  // Komp-pool: manuell URL (/finn) eller auto-søk
  let pool, finnUrl, totalCount;
  if (finnUrlOverride) {
    const raw = await scrapeFinnUrl(finnUrlOverride, page);
    // Km-filter
    let filtered = raw;
    for (const band of [30000, 50000, 80000, 150000]) {
      const f = raw.filter(c => Math.abs(c.km - car.km) <= band);
      if (f.length >= 3) { filtered = f; break; }
    }
    filtered.sort((a, b) => a.price - b.price);
    pool = filtered;
    finnUrl = finnUrlOverride;
    totalCount = raw._total || raw.length;
  } else {
    const result = await searchFinnComps(car, specs, page);
    pool = result.comps;
    finnUrl = result.finnUrl;
    totalCount = result.totalCount;
  }

  if (pool.length < 1) throw new Error('Ingen Finn-treff funnet');

  // Fjern egen bil fra pool
  const sansOwn = finnListing
    ? pool.filter(c => !(Math.abs(c.price - finnListing.price) < 1000 && Math.abs(c.km - car.km) < 2000))
    : pool;

  // AI velger anker
  const { anchor, pool: top5 } = await aiPickAnchor(car, specs, sansOwn);
  if (!anchor) throw new Error('AI fant ingen sammenlignbar bil');

  // Ankerprinsipp: hvis Finn-annonse < billigste komp → bruk Finn-pris som anker
  let anchorPrice = anchor.price;
  const lowestInPool = Math.min(...sansOwn.map(c => c.price));
  if (finnListing && finnListing.price < lowestInPool) {
    anchorPrice = finnListing.price;
    console.log('  Finn-annonse < pool anker — bruker Finn-pris som anker: ' + anchorPrice.toLocaleString('nb-NO') + ' kr');
  }

  const finnAvg   = Math.round(top5.reduce((s, c) => s + c.price, 0) / top5.length);
  const valuation = calcValuation(anchorPrice);
  console.log('  D lav: ' + fmtNOKstr(valuation.dLow) + ' | D hoy: ' + fmtNOKstr(valuation.dHigh) + ' | E: ' + fmtNOKstr(valuation.eBud));

  // Selgerkommentar fra ERP
  let sdComment = null;
  if (car.hasSdComment && car.erpId) {
    const token = await getERPToken();
    sdComment = await getERPCarComment(car.erpId, token);
  }

  const result = {
    car, specs, pool: top5, anchor, finnUrl, totalCount, finnAvg,
    anchorPrice, valuation, heftelser, sdComment, finnListing,
    source: car.source || ''
  };

  // ── ERP: Skriv alltid ───────────────────────────────────
  if (car.erpId) {
    const token = await getERPToken();
    // PUT: D lav/høy + auksjon type + heftelser + eiere
    await writeARValueToERP(car.erpId, valuation.dLow, valuation.dHigh, heftelser, token);
    // POST: eval-kort som kommentar (plain text uten HTML-tags)
    const evalPlain = buildEvalText(result).replace(/<[^>]+>/g, '');
    await postERPComment(car.erpId, evalPlain, token);
  }

  return result;
}

// ── Hovedkjøring ────────────────────────────────────────────
async function run(force) {
  const runTime = new Date();
  console.log('\n[' + runTime.toLocaleString('nb-NO') + '] Starter kjoring...');
  if (!force && !shouldRun()) { console.log('Utenfor kjøretid. Hopper over.'); return; }

  // Hent dynamisk xPct fra Pulse
  await fetchDynamicXPct();

  // Tesla-sjekk
  try { await checkTeslaPrices(); } catch(err) { console.error('Tesla feil:', err.message); }

  const pendingCars = await fetchPendingCars();
  if (pendingCars.length === 0) { console.log('Ingen biler i ko.'); return; }

  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });

    for (const car of pendingCars) {
      try {
        const result = await processCar(car, page, null);
        results.push({ status: 'ok', regNr: car.regNr, ...result });
      } catch(err) {
        console.error('  FEIL:', err.message);
        results.push({ status: 'error', regNr: car.regNr, error: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch(err) {
    console.error('Fatal:', err.message);
    await sendTelegram('peasy-auto feil: ' + err.message);
  } finally {
    if (browser) await browser.close();
  }

  if (results.length > 0) {
    const time = runTime.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    await sendTelegram('<b>PEASY-AUTO | ' + time + '</b>');
    for (const r of results) {
      if (r.status === 'error') {
        await sendTelegram('<b>' + r.regNr + '</b> - FEIL: ' + r.error);
      } else {
        await sendTelegram(buildTelegramText(r));
      }
    }
    console.log('Telegram sendt');
  }
  console.log('Ferdig.');
}

// ── Tesla prisovervåking ────────────────────────────────────
async function checkTeslaPrices() {
  const TESLA_CACHE = 'tesla-prices.json';
  const query = encodeURIComponent(JSON.stringify({
    query: { model: 'm3', condition: 'new', options: {}, arrangeby: 'Price', order: 'asc', market: 'NO', language: 'no', super_region: 'europe', zip: '0001', range: 0, region: 'NO' },
    offset: 0, count: 50, outsideOffset: 0, outsideSearch: false
  }));
  const res = await fetch('https://www.tesla.com/inventory/api/v4/inventory-results?query=' + query, {
    headers: { 'User-Agent': 'Tesla/4.30.6 CFNetwork/1410.0.3 Darwin/22.6.0', 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('Tesla API ' + res.status);
  const data = await fetch('https://www.tesla.com/inventory/api/v4/inventory-results?query=' + query, {
    headers: { 'User-Agent': 'Tesla/4.30.6 CFNetwork/1410.0.3 Darwin/22.6.0', 'Accept': 'application/json' }
  }).then(r => r.json()).catch(() => ({ results: [] }));
  const results = data.results || [];
  const cache = loadJSON(TESLA_CACHE);
  const newCache = {};
  const alerts = [];
  for (const car of results) {
    const vin = car.VIN; if (!vin) continue;
    const basePrice  = Math.round(car.CashDetails?.cash?.inventoryPriceWithoutDiscounts || 0);
    const discount   = Math.round(car.CashDetails?.cash?.inventoryDiscountWithTax || 0);
    const finalPrice = basePrice - discount;
    const trimName   = car.TrimName || 'Model 3';
    newCache[vin] = { finalPrice, trimName, discount };
    if (cache[vin] && finalPrice < cache[vin].finalPrice) {
      alerts.push({ trimName, oldPrice: cache[vin].finalPrice, finalPrice, drop: cache[vin].finalPrice - finalPrice });
    } else if (!cache[vin] && discount > 0) {
      alerts.push({ trimName, finalPrice, drop: discount, isNew: true });
    }
  }
  saveJSON(TESLA_CACHE, newCache);
  if (alerts.length > 0) {
    let msg = 'TESLA MODEL 3 PRISREDUKSJON\n\n';
    for (const a of alerts) {
      msg += 'Model 3 ' + a.trimName + '\n';
      if (!a.isNew) msg += 'Senket med ' + fmtNOKstr(a.drop) + ' | Var: ' + fmtNOKstr(a.oldPrice) + '\n';
      msg += 'Na: ' + fmtNOKstr(a.finalPrice) + '\n\n';
    }
    await sendTelegram(msg);
  } else {
    console.log('  Ingen Tesla prisendringer');
  }
}

// ── Telegram kommandoer ─────────────────────────────────────
async function pollTelegramCommands() {
  let offset = 0;
  setInterval(async () => {
    try {
      const res = await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getUpdates?offset=' + offset + '&timeout=0');
      const data = await res.json();
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        const msgTime = update.message?.date || 0;
        const text = update.message?.text?.trim() || '';
        const isFinn = text.startsWith('/finn ');
        if (!isFinn && Date.now() / 1000 - msgTime > 60) continue;

        // /run — tving kjøring
        if (text === '/run') {
          console.log('/run mottatt');
          await sendTelegram('Kjoring startet...');
          run(true);
        }

        // /status
        if (text === '/status') {
          await sendTelegram('Bot kjorer | Dynamic xPct: ' + (_dynamicXPct ? 'lastet' : 'PDEC1 fallback'));
        }

        // /finn REGNR URL — manuell komp-liste, identisk eval-kort og ERP-skriving
        if (isFinn) {
          console.log('/finn mottatt');
          const parts = text.replace('/finn ', '').trim().split(' ');
          const hasReg = parts[0].match(/^[A-Z]{2}\d{5}$/);
          const regNr  = hasReg ? parts[0] : null;
          const finnUrl = hasReg ? parts.slice(1).join(' ') : parts.join(' ');

          if (!regNr || !finnUrl) {
            await sendTelegram('Format: /finn REGNR https://finn.no/...');
            continue;
          }

          await sendTelegram('Henter data for ' + regNr + '...');

          try {
            // Hent bildata fra ERP-kø
            const token = await getERPToken();
            let erpCar = null;
            for (const ep of ['estimating_ar_final', 'estimating_ar_temp']) {
              const r = await fetch('https://api.biladministrasjon.no/c2b_module/driveno/processing/' + ep + '?per_page=100', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              const d = await r.json();
              const found = (d.data?.data?.data || []).find(c => c.registration_number === regNr);
              if (found) {
                erpCar = { erpId: found.id, regNr, make: found.manufacturer || '', model: found.model_series || '', year: found.model_year || 0, km: found.mileage || 0, hasSdComment: found.has_sd_comment === 1, source: found.source || '' };
                break;
              }
            }
            if (!erpCar) {
              await sendTelegram(regNr + ' ikke funnet i ERP-ko. Allerede behandlet?');
              continue;
            }

            await fetchDynamicXPct();

            let br;
            try {
              br = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
              const pg = await br.newPage();
              await pg.setExtraHTTPHeaders({ 'Accept-Language': 'nb-NO,nb;q=0.9' });
              const result = await processCar(erpCar, pg, finnUrl);
              await sendTelegram(buildTelegramText({ ...result, regNr, car: erpCar }));
            } finally {
              if (br) { try { await br.close(); } catch(e){} }
            }
          } catch(e) {
            await sendTelegram('/finn feil: ' + e.message);
          }
        }
      }
    } catch(e) {}
  }, 5000);
}

// ── Start ───────────────────────────────────────────────────
async function startScheduler() {
  console.log('peasy-auto startet');
  await run();
  pollTelegramCommands();
  setInterval(async () => {
    if (new Date().getMinutes() === 0) await run();
  }, 60000);
  process.on('SIGINT', () => process.exit(0));
}

startScheduler();
