// brreg.js - heftelser-sjekk via Playwright (gjenbruker Easy sin checkBrreg)
import { chromium } from 'playwright';

export async function checkBrreg(regnr, page) {
  try {
    await page.goto(
      `https://rettsstiftelser.brreg.no/nb/oppslag/motorvogn/${regnr.replace(/\s/g, '')}`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    if (text.toLowerCase().includes('ingen oppf'))
      return { anyDebts: false, text: 'Ingen heftelser' };
    if (text.includes('heftelse') || text.includes('pant') || text.includes('registrert'))
      return { anyDebts: true, text: 'Heftelser registrert - sjekk manuelt' };
    return { anyDebts: false, text: 'Ingen heftelser' };
  } catch (e) {
    logErr(`checkBrreg ${regnr}`, e);
    return { anyDebts: false, text: 'Kunne ikke sjekke heftelser' };
  }
}

// Wrapper som apner egen browser, kjorer checkBrreg, lukker.
// Returnerer det checkBrreg returnerer (typisk { anyDebts, brreg, ... }).
export async function checkBrregForRegnr(regnr) {
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const result = await checkBrreg(regnr, page);
    return result;
  } catch (e) {
    console.error('[brreg] FEIL', e?.message || e);
    return { anyDebts: false, brreg: {}, error: String(e?.message || e) };
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}
