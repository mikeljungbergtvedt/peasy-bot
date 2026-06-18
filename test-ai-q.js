// test-ai-q.js - Standalone test av AI-bygget Finn-q-streng
// Tar 10 nylige biler fra Pulse, henter Vegvesen+Elbilradar+Car.info-data,
// ber Claude Haiku 4.5 bygge optimal q-streng, sammenligner med v19.29 regex.
// Endrer IKKE peasy-auto.js. Bot kjorer ufaret.

const XLSX = require('xlsx');
require('dotenv').config({ path: '/Users/bot/peasy-auto/.env' });

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const VEGVESEN_KEY = process.env.VEGVESEN_API_KEY;

if (!ANTHROPIC_KEY) { console.error('Mangler ANTHROPIC_API_KEY'); process.exit(1); }
if (!VEGVESEN_KEY) { console.error('Mangler VEGVESEN_API_KEY'); process.exit(1); }

async function fetchVegvesen(regnr) {
  try {
    const r = await fetch('https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=' + regnr, {
      headers: { 'SVV-Authorization': 'Apikey ' + VEGVESEN_KEY }
    });
    const j = await r.json();
    const k = j.kjoretoydataListe && j.kjoretoydataListe[0];
    if (!k) return null;
    const g = k.godkjenning && k.godkjenning.tekniskGodkjenning && k.godkjenning.tekniskGodkjenning.tekniskeData;
    const merke = g && g.generelt && g.generelt.merke && g.generelt.merke[0] && g.generelt.merke[0].merke;
    const handelsbet = g && g.generelt && g.generelt.handelsbetegnelse && g.generelt.handelsbetegnelse[0];
    return { make: merke, model: handelsbet, year: k.forstegangsregistrering && k.forstegangsregistrering.registrertForstegangNorgeDato && k.forstegangsregistrering.registrertForstegangNorgeDato.slice(0,4) };
  } catch (e) { return null; }
}

async function fetchElbilradar(regnr) {
  try {
    const r = await fetch('https://elbilradar.com/elbil_data.php?regnr=' + regnr);
    const html = await r.text();
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    return { title: title.replace(/ - Elbil RADAR/, '').trim() };
  } catch (e) { return null; }
}

async function aiBuildQ(rawdata) {
  const prompt = [
    'Du skal generere en presis Finn.no-sokestreng for aa finne sammenlignbare bruktbiler.',
    '',
    'Returner KUN: MERKE MODELL UTSTYRSNIVAA',
    '- Ikke karosseritype (5-dorrs, hatchback, kombi)',
    '- Ikke motor-koder (1.0 MPI, TSI, TDI) hvis ikke det er en kjent variant som GTI/GTD',
    '- Ikke aar, drivstoff, gir',
    '- Inkluder ALLTID utstyrsniva/trim hvis det finnes (high up!, GTI, Performance, M Sport, R-Line, Long Range, Plus, Premium)',
    '- For VW up!: returner trim som take up!, move up!, high up!, cross up!',
    '- For Tesla: returner som "Tesla Model Y Performance" eller "Tesla Model 3 Long Range"',
    '',
    'Eksempler paa riktig output:',
    '- Volkswagen up! high up!',
    '- Tesla Model Y Performance',
    '- VW Golf GTI',
    '- Toyota Land Cruiser',
    '',
    'Raadata:',
    'Regnr: ' + rawdata.regnr,
    'Vegvesen merke: ' + (rawdata.veg && rawdata.veg.make || ''),
    'Vegvesen modell: ' + (rawdata.veg && rawdata.veg.model || ''),
    'Elbilradar tittel: ' + (rawdata.elbil && rawdata.elbil.title || ''),
    'Aar: ' + (rawdata.veg && rawdata.veg.year || ''),
    '',
    'Svar med BARE soketeksten, INGEN forklaring, INGEN anforselstegn.'
  ].join('\n');
  
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (j.error) return 'ERROR: ' + j.error.message;
  return (j.content && j.content[0] && j.content[0].text || '').trim().replace(/^["']|["']$/g, '');
}

function oldRegexQ(rawdata) {
  // Simulerer v19.29-logikken
  const make = (rawdata.veg && rawdata.veg.make || '').replace(/\s*MOTORS\s*/i, '').trim();
  const model = rawdata.veg && rawdata.veg.model || '';
  // pakkeMatch fra v19.29 L561:
  const pakkeMatch = (rawdata.elbil && rawdata.elbil.title || '').match(/\b(Supercharged|Fully Charged|Long Range|Performance|Plus|Pro|Sport|Premium)\b/i);
  const pakke = pakkeMatch ? pakkeMatch[0] : '';
  return (make + ' ' + model + (pakke ? ' ' + pakke : '')).trim();
}

(async () => {
  const wb = XLSX.readFile('/tmp/pulse-data.xlsx');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  
  // Hent 10 nylige biler (med RegNr og Merke utfylt)
  const candidates = [];
  for (let i = rows.length - 1; i >= 1 && candidates.length < 10; i--) {
    const r = rows[i];
    if (r[1] && r[6] && r[13]) candidates.push({ regnr: r[1], merke: r[6], modell: r[7], aar: r[8] });
  }
  
  console.log('Tester ' + candidates.length + ' biler\n');
  console.log('═'.repeat(120));
  
  for (const bil of candidates) {
    console.log('\n' + bil.regnr + ' | ERP: ' + bil.merke + ' ' + bil.modell + ' (' + bil.aar + ')');
    const veg = await fetchVegvesen(bil.regnr);
    const elbil = await fetchElbilradar(bil.regnr);
    const rawdata = { regnr: bil.regnr, veg, elbil };
    
    console.log('  Vegvesen: ' + (veg ? (veg.make + ' | ' + veg.model) : 'N/A'));
    console.log('  Elbilradar: ' + (elbil ? elbil.title : 'N/A'));
    
    const oldQ = oldRegexQ(rawdata);
    const aiQ = await aiBuildQ(rawdata);
    
    console.log('  GAMMEL (v19.29 regex): ' + oldQ);
    console.log('  NY (AI Haiku):         ' + aiQ);
  }
})();
