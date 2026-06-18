const { chromium } = require('playwright');

async function testSearch(make, model, year, km) {
  console.log(`\n🚗 ${make} ${model} ${year} ${km}km`);
  const cleanMake = make.replace(/\s*MOTORS\s*/i, '').trim();
  const q = encodeURIComponent(`${cleanMake} ${model}`);
  const delta = km < 50000 ? 10000 : km <= 100000 ? 20000 : 30000;
  const url = `https://www.finn.no/mobility/search/car?registration_class=1&sales_form=1&sort=PRICE_ASC&year_from=${year-1}&year_to=${year+1}&mileage_from=${Math.max(0,km-delta)}&mileage_to=${km+delta}&q=${q}`;
  console.log(`  🔗 ${url}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const comps = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('article')).slice(0,10).map(a => {
      const text = a.innerText || '';
      const price = parseInt((text.match(/(\d[\d\s]+)\s*kr/) || [])[1]?.replace(/\s/g,'')) || 0;
      const km = parseInt((text.match(/(\d[\d\s]+)\s*km/i) || [])[1]?.replace(/\s/g,'')) || 0;
      const year = parseInt((text.match(/\b(19\d{2}|20\d{2})\b/) || [])[1]) || 0;
      const title = a.querySelector('h2')?.innerText || '';
      return { title, price, km, year };
    });
  });
  await browser.close();
  const currentYear = new Date().getFullYear();
  const filtered = comps.filter(c => c.price >= 20000 && c.price <= 2000000 && (c.year === 0 || (c.year >= 1990 && c.year <= currentYear)));
  const seen = new Set();
  const unique = filtered.filter(c => { const key = `${c.price}-${c.km}`; if (seen.has(key)) return false; seen.add(key); return true; });
  console.log(`  📊 ${unique.length} results (${comps.length - unique.length} filtered/deduped):`);
  unique.forEach((c, i) => console.log(`    ${i+1}. ${c.title} | ${c.price.toLocaleString('nb-NO')} kr | ${c.km.toLocaleString('nb-NO')} km | ${c.year}`));
}

(async () => {
  await testSearch('MERCEDES-BENZ', 'GLC', 2018, 65500);
  await testSearch('VOLVO', 'V70', 2008, 313000);
  await testSearch('TESLA MOTORS', 'Model S', 2016, 235000);
  console.log('\n✅ All tests done');
})().catch(console.error);
