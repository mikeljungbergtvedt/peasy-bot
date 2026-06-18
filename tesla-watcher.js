require('dotenv').config();
const fs = require('fs');

const TESLA_CACHE_FILE = 'tesla-prices.json';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const PAINT_NO = {
  'WHITE': 'Perlemorshvit', 'BLACK': 'Enfargert svart', 'SILVER': 'Sølv',
  'BLUE': 'Dypblå metallic', 'RED': 'Rød multi-coat', 'GRAY': 'Middagsgrå',
  'STEALTH_GREY': 'Stealth Grey', 'ULTRA_RED': 'Ultra Red', 'QUICKSILVER': 'Quicksilver',
};

async function sendTelegram(message) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}

function loadCache() {
  if (fs.existsSync(TESLA_CACHE_FILE)) return JSON.parse(fs.readFileSync(TESLA_CACHE_FILE, 'utf8'));
  return {};
}

function saveCache(data) {
  fs.writeFileSync(TESLA_CACHE_FILE, JSON.stringify(data, null, 2));
}

function getRange(car) {
  const specs = car.OptionCodeData || [];
  const rangeSpec = specs.find(s => s.group === 'SPECS_RANGE');
  return rangeSpec ? `${rangeSpec.value} km` : '';
}

async function fetchTeslaInventory() {
  const query = encodeURIComponent(JSON.stringify({
    query: { model: 'm3', condition: 'new', options: {}, arrangeby: 'Price', order: 'asc', market: 'NO', language: 'no', super_region: 'europe', zip: '0001', range: 0, region: 'NO' },
    offset: 0, count: 50, outsideOffset: 0, outsideSearch: false
  }));
  const url = `https://www.tesla.com/inventory/api/v4/inventory-results?query=${query}`;
  const res = await fetch(url, {
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
  console.log('🚗 Checking Tesla Model 3 inventory...');
  const results = await fetchTeslaInventory();
  console.log(`  Found ${results.length} cars`);

  const cache = loadCache();
  const newCache = {};
  const alerts = [];

  for (const car of results) {
    const vin = car.VIN;
    if (!vin) continue;

    const basePrice = car.CashDetails?.cash?.inventoryPriceWithoutDiscounts || 0;
    const discount = car.CashDetails?.cash?.inventoryDiscountWithTax || 0;
    const finalPrice = basePrice - discount;
    const trimName = car.TrimName || car.TRIM?.[0] || 'Model 3';
    const paintCode = car.PAINT?.[0] || '';
    const color = PAINT_NO[paintCode] || paintCode;
    const range = getRange(car);
    const inTransit = car.InTransit ? '🚢 I transit' : '📍 På lager';
    const link = `https://www.tesla.com/no_NO/order/${vin}`;

    newCache[vin] = { finalPrice, trimName, color, discount };

    if (cache[vin]) {
      const oldPrice = cache[vin].finalPrice;
      if (finalPrice < oldPrice) {
        const drop = oldPrice - finalPrice;
        alerts.push({ vin, trimName, color, range, inTransit, oldPrice, finalPrice, drop, discount, link });
      }
    } else if (discount > 0) {
      alerts.push({ vin, trimName, color, range, inTransit, oldPrice: null, finalPrice, drop: discount, discount, link, isNew: true });
    }
  }

  saveCache(newCache);

  if (alerts.length > 0) {
    let msg = `⚡️ <b>TESLA MODEL 3 — PRISREDUKSJON!</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const a of alerts) {
      msg += `🚗 <b>Model 3 ${a.trimName}</b>\n`;
      msg += `🎨 ${a.color} | 🔋 ${a.range} | ${a.inTransit}\n`;
      if (a.isNew) {
        msg += `🆕 Ny i inventar med rabatt!\n`;
      } else {
        msg += `📉 Senket med <b>${a.drop.toLocaleString('nb-NO')} kr</b>\n`;
        msg += `Før: ${a.oldPrice.toLocaleString('nb-NO')} kr\n`;
      }
      msg += `💰 <b>Pris nå: ${a.finalPrice.toLocaleString('nb-NO')} kr</b>\n`;
      if (a.discount > 0) msg += `🏷 Rabatt: ${a.discount.toLocaleString('nb-NO')} kr\n`;
      msg += `🔗 <a href="${a.link}">Se denne bilen</a>\n\n`;
    }
    msg += `🔗 <a href="https://www.tesla.com/no_NO/inventory/new/m3?arrangeby=plh&PaymentType=cash">Se alle Model 3</a>`;
    await sendTelegram(msg);
    console.log(`  📱 Sent ${alerts.length} alert(s)`);
  } else {
    console.log('  ✅ Ingen prisendringer');
  }
}

checkTeslaPrices().catch(err => console.error('Tesla watcher error:', err.message));
