require('dotenv').config({ path: '/Users/bot/peasy-auto/.env' });
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const VEGVESEN_KEY = process.env.VEGVESEN_API_KEY;
const regnr = 'KH83234';

async function fetchVeg() {
  const r = await fetch('https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=' + regnr, { headers: { 'SVV-Authorization': 'Apikey ' + VEGVESEN_KEY }});
  const j = await r.json();
  const k = j.kjoretoydataListe && j.kjoretoydataListe[0];
  if (!k) return null;
  const g = k.godkjenning && k.godkjenning.tekniskGodkjenning && k.godkjenning.tekniskGodkjenning.tekniskeData;
  return { make: g && g.generelt && g.generelt.merke[0] && g.generelt.merke[0].merke, model: g && g.generelt && g.generelt.handelsbetegnelse && g.generelt.handelsbetegnelse[0], year: k.forstegangsregistrering && k.forstegangsregistrering.registrertForstegangNorgeDato && k.forstegangsregistrering.registrertForstegangNorgeDato.slice(0,4) };
}
async function fetchElbil() {
  const r = await fetch('https://elbilradar.com/elbil_data.php?regnr=' + regnr);
  const html = await r.text();
  return (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
}
async function fetchCarInfo() {
  try {
    const r = await fetch('https://www.car.info/no-no/license-plate/N/' + regnr, { headers: { 'User-Agent': 'Mozilla/5.0' }});
    const html = await r.text();
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    const og = (html.match(/og:title.*?content="([^"]+)"/i) || [])[1] || '';
    return (og || title).trim();
  } catch(e) { return ''; }
}

(async () => {
  const veg = await fetchVeg();
  const elbil = await fetchElbil();
  const carinfo = await fetchCarInfo();
  console.log('Regnr:', regnr);
  console.log('Vegvesen:', JSON.stringify(veg));
  console.log('Elbilradar:', elbil);
  console.log('Car.info:', carinfo);
  console.log('');

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
    'Vegvesen merke: ' + (veg && veg.make || ''),
    'Vegvesen modell: ' + (veg && veg.model || ''),
    'Elbilradar tittel: ' + elbil,
    'Car.info: ' + carinfo,
    'Aar: ' + (veg && veg.year || ''),
    '',
    'Svar med BARE soketeksten, INGEN forklaring.'
  ].join('\n');

  console.log('--- Sender til Claude Haiku 4.5 ---');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (j.error) { console.log('FEIL:', j.error.message); return; }
  const txt = (j.content && j.content[0] && j.content[0].text || '').trim();
  console.log('AI svar:', txt);
  console.log('');
  console.log('GAMMEL v19.29: TOYOTA Land Cruiser 5-dorrs');
  console.log('NY AI:         ' + txt);
})();
