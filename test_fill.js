require('dotenv').config({path:'/Users/bot/peasy-auto/.env'});
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto('https://biladministrasjon.no/login', { waitUntil: 'networkidle', timeout: 20000 });
  await page.fill('input[name="email"]', process.env.ERP_USER);
  await page.fill('input[name="password"]', process.env.ERP_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log('URL:', page.url());
  await page.goto('https://biladministrasjon.no/cars_driveno/processing/final_estimate/2183', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  const sel = await page.$('select[name="auction_price_type_id"]');
  console.log('auction_price_type_id:', !!sel);
  const enc = await page.$('input[name="encumbrances"]');
  console.log('encumbrances:', !!enc);
  const own = await page.$('input[name="owners_checked"]');
  console.log('owners_checked:', !!own);
  if (sel) await page.selectOption('select[name="auction_price_type_id"]', '1');
  if (enc) { const checked = await enc.isChecked(); if (!checked) await enc.click(); }
  if (own) { const checked = await own.isChecked(); if (!checked) await own.click(); }
  await page.click('button.btn-primary:has-text("Lagre data")');
  await page.waitForTimeout(2000);
  console.log('DONE');
  await browser.close();
})().catch(e => console.error('FEIL:', e.message));
