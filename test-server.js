require('dotenv').config({path:'/Users/bot/peasy-auto/.env'});
const http = require('http');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const VEGVESEN_KEY = process.env.VEGVESEN_API_KEY;
const CAR_INFO_KEY = process.env.CAR_INFO_KEY;

async function fetchVeg(regnr) {
  try {
    const r = await fetch('https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=' + regnr, { headers:{'SVV-Authorization':'Apikey '+VEGVESEN_KEY}});
    const j = await r.json();
    const k = j.kjoretoydataListe && j.kjoretoydataListe[0];
    if (!k) return null;
    const g = k.godkjenning && k.godkjenning.tekniskGodkjenning && k.godkjenning.tekniskGodkjenning.tekniskeData;
    return { make: g && g.generelt && g.generelt.merke[0] && g.generelt.merke[0].merke, model: g && g.generelt && g.generelt.handelsbetegnelse && g.generelt.handelsbetegnelse[0], year: k.forstegangsregistrering && k.forstegangsregistrering.registrertForstegangNorgeDato && k.forstegangsregistrering.registrertForstegangNorgeDato.slice(0,4) };
  } catch(e) { return null; }
}

async function fetchCarInfo(regnr) {
  try {
    if (!CAR_INFO_KEY) return '(mangler CAR_INFO_KEY)';
    const r = await fetch('https://api.car.info/v2/app/autoringen/license-plate/N/' + regnr + '/0', { headers:{'x-auth-identifier':'autoringen','x-auth-key':CAR_INFO_KEY,'Accept':'application/json','Accept-Language':'nb'}});
    if (!r.ok) return '(' + r.status + ')';
    const j = await r.json();
    if (!j.success) return '(success=false)';
    const cn = j.result && j.result.car_name;
    const fn = j.result && j.result.valuation && j.result.valuation.company_valuation && j.result.valuation.company_valuation.full_name;
    return fn || cn || '';
  } catch(e) { return 'FEIL: ' + e.message; }
}

async function aiQ(regnr, veg, carinfo) {
  const prompt = [
    'Du skal generere en kort, presis Finn.no fritekst-sokestreng for aa finne sammenlignbare bruktbiler.',
    '',
    'Returner KUN: MERKE MODELL [UTSTYRSNIVAA]',
    '- IKKE karosseritype (5-dorrs, hatchback, kombi, suv)',
    '- IKKE motorkoder (1.0 MPI, TSI, TDI, 3.0 D-4D, 400 d)',
    '- IKKE drivlinje (4WD, 4MATIC, xDrive, Quattro)',
    '- IKKE hk, gir, drivstoff, aar',
    '- Inkluder trim hvis kjent variant: GTI, GTD, Performance, M Sport, R-Line, S-Line, Long Range, Plus, Premium, Sport, AMG, R, RS, Prado',
    '- For VW up!: take up!, move up!, high up!, cross up!',
    '- For Tesla: Tesla Model Y Performance, Tesla Model 3 Long Range',
    '',
    'Eksempler:',
    '- Toyota Land Cruiser Prado',
    '- Volkswagen up! high up!',
    '- Tesla Model Y Performance',
    '- VW Golf GTI',
    '',
    'Raadata:',
    'Regnr: ' + regnr,
    'Vegvesen merke: ' + (veg ? veg.make : ''),
    'Vegvesen modell: ' + (veg ? veg.model : ''),
    'Car.info: ' + carinfo,
    'Aar: ' + (veg ? veg.year : ''),
    '',
    'Svar med BARE soketeksten. INGEN forklaring, INGEN anforselstegn.'
  ].join('\n');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', signal: controller.signal, headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'}, body: JSON.stringify({model:'claude-sonnet-4-5', max_tokens:100, messages:[{role:'user',content:prompt}]}) });
    clearTimeout(timeout);
    const j = await r.json();
    if (j.error) return 'AI-feil: ' + j.error.message;
    return ((j.content[0].text)||'').trim().replace(/^["']|["']$/g, '');
  } catch(e) { clearTimeout(timeout); return 'TIMEOUT/FEIL: ' + e.message; }
}

function buildFinnUrl(q, year) {
  return 'https://www.finn.no/mobility/search/car?q=' + encodeURIComponent(q.trim()) + '&registration_class=1&sales_form=1&sort=PRICE_ASC' + (year ? '&year_from=' + year + '&year_to=' + year : '') + '&price_from=15000';
}

const HTML = `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><title>Peasy AI bilmodell-test</title><style>body{font-family:system-ui;max-width:760px;margin:40px auto;padding:0 16px}h1{color:#0F3D2E}input{font-size:18px;padding:12px;width:200px;text-transform:uppercase;border:2px solid #0F3D2E;border-radius:6px}button{font-size:18px;padding:12px 24px;background:#0F3D2E;color:#fff;border:0;border-radius:6px;cursor:pointer;margin-left:8px}.result{margin-top:24px;padding:20px;background:#f5f5f0;border-radius:8px}.label{color:#666;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:14px}.val{font-size:17px;line-height:1.4}.ai{color:#0F3D2E;font-weight:bold;font-size:22px}.urlbox{background:#fff;padding:12px;border-radius:6px;border:1px solid #ddd;font-family:monospace;font-size:13px;word-break:break-all}.urlbox a{color:#0F3D2E}.spinner{opacity:.5}</style></head><body><h1>Peasy AI bilmodell-test</h1><p>Skriv inn et regnr og se hva Claude foreslaar som Finn.no q-streng + ferdig Finn-URL.</p><div><input id="r" placeholder="KH83234" autofocus><button onclick="run()">Test</button></div><div id="out"></div><script>async function run(){var v=document.getElementById('r').value.trim().toUpperCase();if(!v)return;var o=document.getElementById('out');o.innerHTML='<div class="result spinner">Henter Vegvesen + Car.info API + spoerr Claude...</div>';try{var r=await fetch('/q?r='+v);var j=await r.json();o.innerHTML='<div class="result"><div class="label">Vegvesen</div><div class="val">'+(j.veg?(j.veg.make+' | '+j.veg.model+' | '+j.veg.year):'(ikke funnet)')+'</div><div class="label">Car.info API</div><div class="val">'+(j.carinfo||'(tomt)')+'</div><div class="label">AI Claude Sonnet 4.5 foreslaar (Finn q-streng)</div><div class="val ai">'+j.ai+'</div><div class="label">Ferdig Finn-URL (klikk for aa apne)</div><div class="urlbox"><a href="'+j.finnUrl+'" target="_blank">'+j.finnUrl+'</a></div></div>';}catch(e){o.innerHTML='<div class="result">Feil: '+e.message+'</div>';}}document.getElementById('r').addEventListener('keypress',function(e){if(e.key==='Enter')run();});</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(HTML); return;
  }
  if (req.url.startsWith('/q?')) {
    const regnr = (new URL('http://x'+req.url)).searchParams.get('r') || '';
    console.log('[' + new Date().toISOString() + '] Test regnr: ' + regnr);
    const veg = await fetchVeg(regnr);
    const carinfo = await fetchCarInfo(regnr);
    const ai = await aiQ(regnr, veg, carinfo);
    const finnUrl = buildFinnUrl(ai, veg ? veg.year : '');
    console.log('  -> AI: ' + ai);
    console.log('  -> Finn: ' + finnUrl);
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({veg,carinfo,ai,finnUrl}));
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(8888, '0.0.0.0', () => console.log('Test-server kjorer paa http://localhost:8888 og http://100.121.97.112:8888'));
