const fs = require('fs');
const path = '/Users/bot/peasy-auto/peasy-auto.js';
let src = fs.readFileSync(path, 'utf8');

const newFn = `async function searchFinnComps(car, specs, page) {
  const { make, model, year, km } = car;
  const cleanMake = make.replace(/\\s*MOTORS\\s*/i, '').trim();
  const q = encodeURIComponent(cleanMake + ' ' + model);
  const isElectric = specs.fuel.toLowerCase().includes('elektr');
  const isDiesel = specs.fuel.toLowerCase().includes('diesel');
  const isAuto = specs.gearbox.toLowerCase().includes('automat');
  const is4WD = specs.drive === '4WD';
  const fuel = isElectric ? '&fuel=2' : isDiesel ? '&fuel=3' : '&fuel=1';
  const trans = isAuto ? '&transmission=2' : '&transmission=1';
  const drive = is4WD ? '&wheel_drive=2' : '';

  const scrape = async (yFrom, yTo, filters) => {
    const url = 'https://www.finn.no/mobility/search/car?registration_class=1&sales_form=1&sort=PRICE_ASC&year_from=' + yFrom + '&year_to=' + yTo + filters + '&q=' + q;
    console.log('  🔍 ' + url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const comps = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('article')).slice(0,30).map(a => {
        const text = a.innerText || '';
        const price = parseInt((text.match(/(\\d[\\d\\s]+)\\s*kr/) || [])[1]?.replace(/\\s/g,'')) || 0;
        const km = parseInt((text.match(/(\\d[\\d\\s]+)\\s*km/i) || [])[1]?.replace(/\\s/g,'')) || 0;
        const year = parseInt((text.match(/\\b(19\\d{2}|20\\d{2})\\b/) || [])[1]) || 0;
        return { price, km, year };
      }).filter(c => {
        const currentYear = new Date().getFullYear();
        return c.price >= 20000 && c.price <= 2000000 && (c.year === 0 || (c.year >= 1990 && c.year <= currentYear));
      });
    });
    const seen = new Set();
    const unique = comps.filter(c => { const key = c.price+'-'+c.km; if(seen.has(key)) return false; seen.add(key); return true; });
    unique.sort((a,b) => Math.abs(a.km-km) - Math.abs(b.km-km));
    console.log('     → ' + unique.length + ' results');
    return { comps: unique, url };
  };

  let r;
  r = await scrape(year, year, fuel + trans + drive);
  if (r.comps.length >= 5) return { comps: r.comps.slice(0,10), finnUrl: r.url };
  r = await scrape(year, year, fuel);
  if (r.comps.length >= 5) return { comps: r.comps.slice(0,10), finnUrl: r.url };
  r = await scrape(year, year, '');
  if (r.comps.length >= 5) return { comps: r.comps.slice(0,10), finnUrl: r.url };
  r = await scrape(year-1, year+1, fuel);
  if (r.comps.length >= 5) return { comps: r.comps.slice(0,10), finnUrl: r.url };
  r = await scrape(year-1, year+1, '');
  if (r.comps.length >= 3) return { comps: r.comps.slice(0,10), finnUrl: r.url };
  r = await scrape(year-2, year+2, '');
  return { comps: r.comps.slice(0,10), finnUrl: r.url };
}`;

// Find and replace the entire searchFinnComps function
const start = src.indexOf('async function searchFinnComps(car, specs, page)');
const end = src.indexOf('\nasync function calcValuation');
if (start === -1 || end === -1) {
  console.log('❌ Could not find function boundaries');
  process.exit(1);
}
src = src.slice(0, start) + newFn + '\n' + src.slice(end);
fs.writeFileSync(path, src);
console.log('✅ searchFinnComps rewritten');
