const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('https://mikeljungbergtvedt.github.io/Peasy_Priskalkulator.html');

    // Extract waiting cars table (adjust if selector changes)
    const cars = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      return rows.slice(1).map(row => row.innerText.trim()).join('\n');
    });

    const message = cars.length > 0
      ? `Waiting cars:\n${cars}`
      : 'No waiting cars on the page.';

    console.log(message);

    // Send to Telegram
    const token = '8601623470:AAFEFsobVNOcpJvu9dEoYKLxLOievqnDAnw';
    const chatId = '8743185026';

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });

    console.log('Message sent to Telegram!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
