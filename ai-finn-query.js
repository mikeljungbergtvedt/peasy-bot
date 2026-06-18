// ai-finn-query.js — v19.30
// AI bygger optimal Finn.no fritekst-q-streng for steg 1 av Finn-funnel.
// Brukes som drop-in via require() i peasy-auto.js.

const _cache = new Map();

async function aiBuildFinnQuery(bil, vegData) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return null;
  
  const regnr = bil.registration_number || '';
  if (_cache.has(regnr)) return _cache.get(regnr);
  
  const make = (vegData && vegData.make) || (bil.carInfo && bil.carInfo.make) || bil.make || '';
  const model = (bil.carInfo && bil.carInfo.model) || bil.model_series || '';
  const modelFull = bil.modelFull || '';
  const pakke = bil.pakke || '';
  const elbilStr = bil.elbilradarTitle || '';
  const carInfoStr = bil.carInfo ? ((bil.carInfo.make || '') + ' ' + (bil.carInfo.model || '') + ' ' + (bil.carInfo.variant || '')).trim() : '';
  const finnStr = bil.finnAnnonseTittel || '';
  const year = (bil.carInfo && bil.carInfo.model_year) || bil.model_year || '';
  
  const prompt = [
    'Du skal generere en presis Finn.no-sokestreng for aa finne sammenlignbare bruktbiler.',
    'Returner KUN: MERKE MODELL UTSTYRSNIVAA',
    '- IKKE karosseritype (5-dorrs, hatchback, kombi, suv)',
    '- IKKE motor-koder (1.0 MPI, TSI, TDI, 400 d) hvis det ikke er en kjent variant som GTI/GTD/TFSI',
    '- IKKE aar, drivstoff, gir, drivlinje (4MATIC, xDrive, Quattro hvis det ikke definerer modellen)',
    '- Inkluder trim hvis det finnes (high up!, GTI, Performance, M Sport, R-Line, Long Range, Plus, Premium)',
    '',
    'Eksempler:',
    '- Volkswagen up! high up!',
    '- Tesla Model Y Performance',
    '- Mercedes-Benz GLS',
    '- Toyota Land Cruiser',
    '- VW Golf GTI',
    '',
    'Raadata:',
    'Regnr: ' + regnr,
    'Vegvesen merke: ' + make,
    'Vegvesen modell: ' + model,
    'Model full (Elbilradar): ' + modelFull,
    'Pakke: ' + pakke,
    'Elbilradar tittel: ' + elbilStr,
    'Car.info: ' + carInfoStr,
    'Tidligere Finn-tittel: ' + finnStr,
    'Aar: ' + year,
    '',
    'Svar med BARE soketeksten, INGEN forklaring, INGEN anforselstegn.'
  ].join('\n');
  
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json();
    if (j.error) { console.log('[' + new Date().toISOString() + '] AI finnQuery FEIL: ' + j.error.message); return null; }
    let txt = (j.content && j.content[0] && j.content[0].text || '').trim();
    txt = txt.replace(/^["']|["']$/g, '').trim();
    if (!txt || txt.length > 100) return null;
    _cache.set(regnr, txt);
    return txt;
  } catch (e) { console.log('[' + new Date().toISOString() + '] AI finnQuery EXC: ' + e.message); return null; }
}

module.exports = { aiBuildFinnQuery };
