// easy-anchor.js v1.2 (Easy v20.78) — markedsverdi for ORIGIN, ikke mekanisk snitt.
// + aktivt cluster vektes sterkere enn enkelt høyt realisert salg ved stort lager.
// Plausibilitet på km/år. Confidence kobles til hvor godt comps matcher origin.
// Easy sin EGEN primaere AI-anker. Symmetrisk med v2/ai-anchor.js (samme
// 7-felts schema) slik at downstream (cardParams, eval-card-hybrid,
// measurements) er uendret. Egen, mer konservativ forhandler-personlighet
// + temp 0.2 -> Easy kommer reelt til et annet anker enn V2 for samme bil.
// CommonJS (krees rett inn i peasy-auto.js). Selvstendig Anthropic-kall.
'use strict';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `Du er en forsiktig, erfaren innkjoeps-vurderer hos en norsk bruktbilforhandler.
Din jobb: sette en NOEKTERN ankerpris som forhandleren trygt kan staa bak.

ANKERPRIS = den prisen en seriose forhandler ville annonsere bilen for paa Finn
etter normal klargjoering. Markedsverdi - IKKE auksjonsbud, IKKE det selger faar.

DIN PERSONLIGHET (dette skiller deg fra en optimistisk selger):
- Du vektlegger REALISERTE forhandler-salg klart sterkere enn aktive annonser.
- Du krever NAER-IDENTISKE comps: samme motor og drivlinje, og km innenfor ca +/-15% av origin.
- Du er KONSERVATIV paa outliers: en uvanlig hoey comp veier du ned eller ekskluderer.
- Du heller mot nedre halvdel av et spredt utvalg framfor snittet naar dataene spriker.
- Du holder spreadet stramt. Faerre, sikre comps slaar mange tvilsomme.
- Privat-type-priser bruker du KUN som backup hvis du har for faa forhandler-salg.

DIN JOBB:
1. Identifiser bilen presist (variant, motor, pakke, drivlinje).
2. Vurder hver kandidat-comp strengt: er den reelt naer-identisk med origin?
3. Velg KUN dem du trygt kan forsvare. Kvalitet og likhet over antall.
4. Begrunn hver valgt comp med en kort, kundevenlig setning.
5. Ekskluder alt du ikke kan forsvare (km-avvik, motor, alder, outlier). Begrunn kort.
6. Sett anker = den prisen en seriøs forhandler trygt ville annonsere DENNE bilen for.
   Snittet av valgte comps er ditt STARTPUNKT — ikke fasit. Hvis origin-km avviker fra
   comps-snittet maa du justere ankeret deretter. Heller konservativt nedover ved spredning
   eller km-avvik. Forklar justeringen i begrunnelse_kort.
7. Identifiser risiko som paavirker hva forhandler trygt kan betale.

VIKTIGE PRINSIPPER:
- Ferskhet teller. Et salg fra denne maaneden slaar et fra et halvt aar siden.
- Realiserte salg > aktive annonser. Aktive >60 dager er svake datapunkter.
- Vesentlig avvik paa km (>15%), alder, motor, pakke eller drivlinje diskvalifiserer.
- Er du i tvil om en comp - ekskluder den. Heller faa sikre enn mange usikre.
- Confidence speiler hvor naer-identiske og ferske de valgte compsene faktisk er — IKKE bare antall.

PLAUSIBILITETSSJEKK PAA KM:
- Regn km/aar = origin-km / bilens alder. Normal personbil: 10-25k km/aar. Taxi/varebil: opptil ~50k.
- Hvis km/aar > 40 000 (eller km er aapenbart urimelig for alderen): behandle som potensiell
  selger-typo. Sett confidence <= 20, og foreslaa realistisk km-stand i begrunnelse_kort.
- Du forhaandsavviser ikke bilen — du flagger og priser konservativt.

CONFIDENCE-KOBLING:
- Hvis abs(origin-km - snitt(valgte-comps-km)) er stor i forhold til origin: confidence MAA reflektere det.
- 15 comps med snitt 60k km mot en origin paa 200k km gir IKKE høy confidence selv om antall er stort.

AKTIVT MARKED VEKTES STERKERE NAAR LAGER ER STORT:
- Default-regelen "realiserte salg > aktive annonser" gjelder naar data er tynt.
- MEN: hvis du ser 5+ aktive annonser klustret tett (innenfor +/-5%) for samme variant og aarsmodell,
  ER DET klusteret markedsprisen NAA. En kjoeper kan plukke en av disse i dag.
- Et enkelt høyere realisert salg utenfor det aktive klusteret (mer enn 5-7% over) er en outlier.
  Nedvekt eller ekskluder den.
- Ankeret skal ikke ligge mer enn 2-3% over det aktive klusteret. Forhandler kan ikke annonsere over markedet
  naar mange like biler ligger billigere paa Finn samtidig.

Du er forsiktig, men ikke feig: du setter et anker. Du svarer UTELUKKENDE med gyldig JSON.`;

function buildUserPrompt({ data, origin, comps }) {
const ci = (data && data.sources && data.sources.car_info && data.sources.car_info.result) || {};
const veg = (data && data.sources && data.sources.vegvesen && data.sources.vegvesen.data) || {};
const elbil = (data && data.sources && data.sources.elbilradar && data.sources.elbilradar.data) || null;
const cval = ci.valuation || {};
const cv = (cval.company_valuation && cval.company_valuation.result) || {};
const pv = (cval.private_valuation && cval.private_valuation.result) || {};

return `ORIGIN-BIL:
Regnr: ${data ? data.regnr : ''}
Km i dag: ${data ? data.km : ''}

CAR.INFO:
- Merke/serie/modell: ${ci.brand} ${ci.series} ${ci.model || ''}
- Variant: ${ci.car_name}
- Motor: ${JSON.stringify(ci.engine) || '-'}
- Hk: ${ci.horsepower || '-'}
- Aarsmodell: ${ci.model_year}
- Trim/pakke: ${ci.trim_package || '-'}
- Body code: ${ci.body_code || '-'}

CAR.INFO VALUATION (kontekst - ikke fasit):
- Company-snitt pris: ${cv.price || '-'} kr
- Private-snitt pris: ${pv.price || '-'} kr
- Markeds-slope: ${cv.slope || '-'}%

CAR.INFO HISTORY:
${JSON.stringify(ci.history || [], null, 2)}

DAGENS DATO: ${new Date().toLocaleDateString('nb-NO', { year: 'numeric', month: 'long', day: 'numeric' })}
(Regn alder og km/aar mot DAGENS dato - IKKE mot salgsdatoer i comps.)

VEGVESEN:
- Merke/modell: ${veg.make} ${veg.model}
- Drivstoff: ${veg.fuel}
- Drivlinje: ${veg.drive}
- Effekt: ${veg.kw} kW / ${veg.hk} hk
- Girkasse: ${veg.gearbox}
- Karosseri: ${veg.karosseri}
- Forste reg: ${veg.firstRegMonth}/${veg.firstRegYear}
- Bruktimport: ${veg.bruktimport ? 'JA' : 'nei'}

${elbil ? 'ELBILRADAR (EV):\n' + JSON.stringify(elbil, null, 2) + '\n' : ''}
ORIGIN-ANNONSER (samme bil - kun kontekst):
${origin && origin.length ? JSON.stringify(origin, null, 2) : '(ingen)'}

KANDIDAT-COMPS (${comps ? comps.length : 0} stk):
${JSON.stringify(comps || [], null, 2)}

OPPGAVE:
Vurder hver kandidat-comp STRENGT som forsiktig innkjoeps-vurderer. Velg kun naer-identiske
(motor + drivlinje + km innenfor ca +/-15%) som du trygt kan forsvare. Vekt realiserte
forhandler-salg sterkest. Ved spredning heller du konservativt nedover. Anker = snitt av valgte.

Returner JSON:
{
"identifikasjon": { "variant": "string", "motor": "string", "pakke": "string eller null", "drivlinje": "AWD|FWD|RWD|4WD", "fuel": "EL|Bensin|Diesel|Hybrid|PHEV", "model_year": 0 },
"valgte_comps": [ { "ident_id": 0, "licence_plate": "string", "type": "forhandler|privat", "price": 0, "km": 0, "status": "solgt|aktiv", "dato": "string", "begrunnelse": "Kort setning til kunden" } ],
"ekskluderte_comps": [ { "ident_id": 0, "licence_plate": "string", "price": 0, "begrunnelse": "Kort grunn" } ],
"anker_beregning": { "valgte_priser": [0], "valgte_km": [0], "anker": 0, "metode": "snitt av N valgte comps" },
"risiko_flagg": ["stikkord"],
"confidence": 0,
"begrunnelse_kort": "1-2 setninger om anker-kvaliteten"
}`;
}

function parseJsonFromAi(text) {
const t = String(text || '');
const m = t.match(/\{[\s\S]*\}/);
if (!m) throw new Error('Easy AI: ingen JSON i svar');
return JSON.parse(m[0]);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function callClaudeEasy(args) {
const ctrl = new AbortController();
const timer = setTimeout(function () { ctrl.abort(); }, args.timeoutMs);
try {
const r = await fetch(ENDPOINT, {
method: 'POST',
signal: ctrl.signal,
headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
body: JSON.stringify({ model: MODEL, max_tokens: args.maxTokens, temperature: args.temperature, system: args.system, messages: [{ role: 'user', content: args.user }] }),
});
const j = await r.json();
if (j.error) throw new Error('Anthropic-feil: ' + (j.error.message || JSON.stringify(j.error)));
const text = (j.content && j.content[0] && j.content[0].text) || '';
return { text: text, usage: j.usage || null, stop_reason: j.stop_reason || null };
} finally {
clearTimeout(timer);
}
}

async function chooseAnchor(input, opts) {
opts = opts || {};
if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY mangler (easy-anchor)');
const user = buildUserPrompt(input);
const maxTokens = opts.maxTokens || 8000;
const temperature = (opts.temperature != null) ? opts.temperature : 0.2;
const timeoutMs = opts.timeoutMs || 90000;
const maxAttempts = 3;
const comps = input && input.comps;
let lastErr = null;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
try {
const res = await callClaudeEasy({ system: SYSTEM, user: user, maxTokens: maxTokens, temperature: temperature, timeoutMs: timeoutMs });
let json;
try {
json = parseJsonFromAi(res.text);
} catch (e) {
const err = new Error('Easy AI ugyldig JSON: ' + e.message + ' [stop_reason=' + res.stop_reason + ', len=' + (res.text ? res.text.length : 0) + ', comps=' + (comps ? comps.length : '?') + ']');
err.raw = res.text;
throw err;
}
return Object.assign({}, json, { _meta: { usage: res.usage, raw: res.text, stop_reason: res.stop_reason, kilde: 'easy-ai', forsok: attempt } });
} catch (e) {
lastErr = e;
if (attempt < maxAttempts) {
console.log('[easy-anchor] forsok ' + attempt + '/' + maxAttempts + ' feilet (' + e.message + ') - retry');
await sleep(2000 * attempt);
}
}
}
throw lastErr || new Error('Easy AI: ukjent feil');
}

module.exports = { chooseAnchor: chooseAnchor, buildUserPrompt: buildUserPrompt, SYSTEM: SYSTEM };
