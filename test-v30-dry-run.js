// v19.30 dry-run: AI bygger q + henter listings + AI plukker 5 best matchede komper
require('dotenv').config();
const REGNR = process.argv[2] || 'AY29446';
const KM_ORIGIN = parseInt(process.argv[3] || '212000', 10);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CAR_INFO_KEY = process.env.CAR_INFO_KEY;
function log(m) { console.log('[' + new Date().toISOString().slice(11,19) + '] ' + m); }
async function fwt(url, opts, ms) { const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms); try{return await fetch(url,{...opts,signal:c.signal});}finally{clearTimeout(t);} }
async function getCarInfo(regnr, km) {
  const url='https://api.car.info/v2/app/autoringen/license-plate/N/'+regnr+'/'+(km||0);
  const r=await fwt(url,{headers:{'x-auth-identifier':'autoringen','x-auth-key':CAR_INFO_KEY,'Accept':'application/json','Accept-Language':'nb'}},10000);
  if(!r.ok){log('car.info '+r.status);return null;}
  const j=await r.json(); return j.result||null;
}
async function aiCall(prompt, maxTokens) {
  const r=await fwt('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})},25000);
  const j=await r.json();
  if(j.error)throw new Error('AI: '+j.error.message);
  return (j.content&&j.content[0]&&j.content[0].text||'').trim();
}
async function aiBuildQuery(ci) {
  const p='Du er ekspert paa norske bruktbiler. Bygg en kort Finn-soeketekst som matcher hvordan annonser typisk er titulert paa Finn.\n\nRegel: Merke + Modell + motorfamilie ELLER utstyrspakke (det som er mest brukt i tittel). INGEN motorstyrke, INGEN girkasse, INGEN aarstall, INGEN AWD/4WD (det er filter).\n\nEksempler: BMW iX xDrive60 | Tesla Model Y Performance | VW ID.4 PURE | Volvo XC60 D4\n\nRaadata car.info:\n'+JSON.stringify({brand:ci.brand,series:ci.series,generation:ci.generation,car_name:ci.car_name,engine:ci.engine,trim_package:ci.trim_package})+'\n\nSvar med BARE soeketeksten.';
  return await aiCall(p, 60);
}
async function fetchFinnListings(q, yearFrom, yearTo) {
  const params=new URLSearchParams({q,year_from:yearFrom,year_to:yearTo,sort:'PRICE_ASC'});
  const url='https://www.finn.no/mobility/search/car?'+params.toString();
  const r=await fwt(url,{headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'nb-NO'}},15000);
  const html=await r.text();
  // Hent __NEXT_DATA__ JSON
  const m=html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if(!m){return{url,listings:[],total:0,note:'no __NEXT_DATA__'};}
  let data; try{data=JSON.parse(m[1]);}catch(e){return{url,listings:[],total:0,note:'JSON parse fail'};}
  // Finn ads-array i pageProps
  const docs=data?.props?.pageProps?.search?.docs||data?.props?.pageProps?.searchResults?.docs||[];
  const total=data?.props?.pageProps?.search?.metadata?.result_size?.value||data?.props?.pageProps?.search?.totalCount||docs.length;
  const listings=docs.slice(0,30).map(d=>({
    id:d.id||d.ad_id,
    title:d.heading||d.title,
    price:d.price?.amount||d.price_total||d.price,
    year:d.year,
    km:d.mileage||d.km,
    fuel:d.fuel,
    transmission:d.transmission,
    wheelDrive:d.wheel_drive,
    powerHp:d.engine_effect||d.power||d.hp,
    bodyType:d.body_type,
    url:d.canonical_url||('https://www.finn.no/mobility/item/'+d.id),
    rawTitle:d.heading
  }));
  return{url,listings,total};
}
async function aiSelectComps(origin, listings) {
  const oStr=JSON.stringify({brand:origin.brand,series:origin.series,car_name:origin.car_name,engine:origin.engine,trim_package:origin.trim_package,year:origin.model_year,km:KM_ORIGIN,hp:origin.power_hp||origin.engine_power||null});
  const lStr=listings.map((l,i)=>(i+1)+'. '+JSON.stringify({title:l.title,price:l.price,year:l.year,km:l.km,fuel:l.fuel,trans:l.transmission,awd:l.wheelDrive,hp:l.powerHp})).join('\n');
  const p='Du er ekspert paa bruktbil-prising. Du skal velge de 5 BEST sammenlignbare komp-bilene mot origin-bilen.\n\nVurder: motorfamilie, drivlinje, utstyrspakke, km nær origin (innenfor ±25%), aarstall ±1, hk-niva, drivstoff.\n\nORIGIN:\n'+oStr+'\n\nKANDIDATER:\n'+lStr+'\n\nReturner KUN et JSON-array med 5 valgte (nummer 1-indeksert) og kort begrunnelse: [{"i":N,"why":"..."}, ...]. Ingen annen tekst.';
  const txt=await aiCall(p, 800);
  try { const m=txt.match(/\[[\s\S]*\]/); return JSON.parse(m?m[0]:txt); } catch(e) { return null; }
}
async function main() {
  log('=== v19.30 DRY-RUN ===');
  log('REGNR='+REGNR+' KM='+KM_ORIGIN);
  const ci=await getCarInfo(REGNR,KM_ORIGIN);
  if(!ci){log('FEIL: ingen car.info');return;}
  log('Origin: '+ci.car_name);
  log('engine: '+(ci.engine||'-')+' | trim: '+(ci.trim_package||'-')+' | year: '+(ci.model_year||'-'));
  log('--- AI bygger q ---');
  const q=await aiBuildQuery(ci);
  log('AI q: "'+q+'"');
  const yr=ci.model_year||2016;
  log('--- Henter Finn-listings ---');
  const r=await fetchFinnListings(q,yr-1,yr+1);
  log('URL: '+r.url);
  log('Totalt: '+r.total+' treff, hentet '+r.listings.length+' listings');
  if(r.listings.length===0){log('FEIL: ingen listings ('+(r.note||'-')+')');return;}
  log('--- Sample 5 forste listings ---');
  r.listings.slice(0,5).forEach((l,i)=>log((i+1)+'. '+l.price+' kr | '+l.km+' km | '+l.year+' | '+l.title));
  log('--- AI velger 5 best matchede ---');
  const picks=await aiSelectComps(ci,r.listings);
  if(!picks){log('FEIL: AI ga ikke gyldig JSON');return;}
  log('AI valg:');
  picks.forEach(p=>{ const l=r.listings[p.i-1]; if(l) log('  #'+p.i+' '+l.price+' kr | '+l.km+' km | '+l.year+' | '+l.title+' | WHY: '+p.why); });
  const valgte=picks.map(p=>r.listings[p.i-1]).filter(Boolean);
  if(valgte.length){
    const avgKm=Math.round(valgte.reduce((s,l)=>s+(l.km||0),0)/valgte.length);
    const avgPris=Math.round(valgte.reduce((s,l)=>s+(l.price||0),0)/valgte.length);
    log('Snitt valgte: '+avgPris+' kr | '+avgKm+' km (origin: '+KM_ORIGIN+' km)');
  }
  log('=== FERDIG ===');
}
main().catch(e=>console.error('FAIL:',e.message));
