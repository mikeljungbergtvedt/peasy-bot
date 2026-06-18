const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Opening ERP Endelig estimering page...');
    await page.goto('https://peasy.no/endelig-estimering/CF9335', { waitUntil: 'networkidle' }); // change URL if needed

    // If login required, uncomment and fill:
    // await page.fill('input[name="username"]', 'your-limited-username');
    // await page.fill('input[name="password"]', 'your-limited-password');
    // await page.click('button[type="submit"]');
    // await page.waitForNavigation();

    console.log('Reading key data...');
    const data = await page.evaluate(() => {
      return {
        regNr: document.querySelector('input[name="Registreringsnummer"]')?.value || 'N/A',
        make: document.querySelector('input[name="Merke"]')?.value || 'N/A',
        model: document.querySelector('input[name="Modell"]')?.value || 'N/A',
        year: document.querySelector('input[name="År"]')?.value || 'N/A',
        km: document.querySelector('input[name="KM"]')?.value || 'N/A',
        color: document.querySelector('input[name="Farge"]')?.value || 'N/A',
        gearbox: document.querySelector('input[name="Girkasse"]')?.value || 'N/A',
        fuel: document.querySelector('input[name="Drivstoff type"]')?.value || 'N/A',
        comment: document.querySelector('textarea[name="Kommentar"]')?.value || 'N/A',
        totalCorrection: document.querySelector('input[name="TOTAL KORREKSJON"]')?.value || 'N/A',
        status: document.querySelector('span[contains(text(),"ESTIMATING_AR_FINAL")]')?.innerText || 'N/A',
        sellerName: document.querySelector('input[name="Navn"]')?.value || 'N/A',
        sellerEmail: document.querySelector('input[name="E-post"]')?.value || 'N/A',
        sellerPhone: document.querySelector('input[name="Telefon"]')?.value || 'N/A',
      };
    });

    const message = `Car data read:\n` +
      `- Reg nr: ${data.regNr}\n` +
      `- Make/Model/Year: ${data.make} ${data.model} ${data.year}\n` +
      `- KM/Color: ${data.km} km, ${data.color}\n` +
      `- Gear/Fuel: ${data.gearbox} / ${data.fuel}\n` +
      `- Comment: ${data.comment}\n` +
      `- Total korreksjon: ${data.totalCorrection}\n` +
      `- Status: ${data.status}\n` +
      `- Seller: ${data.sellerName}, ${data.sellerEmail}, ${data.sellerPhone}\n` +
      'Data read OK. No changes made.';

    console.log(message);

    // Send to Telegram
    const token = '8601623470:AAFEFsobVNOcpJvu9dEoYKLxLOievqnDAnw';
    const chatId = '8743185026';

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });

    console.log('Summary sent to Telegram!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
