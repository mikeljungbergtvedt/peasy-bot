// ai-anchor.js v0.7 (V2 v1.16) — markedsverdi for ORIGIN, ikke mekanisk snitt.
// + aktivt cluster vektes sterkere enn enkelt høyt realisert salg ved stort lager.
// Plausibilitet på km/år. Confidence kobles til hvor godt comps matcher origin.
// Prinsipp-styrt: AI er en proff bruktbilsjef. Ingen harde grenser.
// AI bestemmer selv hva som er sammenlignbart.

import { callClaude, parseJsonFromAi } from './ai-client.js';

const SYSTEM = `Du er en erfaren bruktbilsjef hos en stor norsk forhandler.
20 aars erfaring. Du har solgt og kjopt tusenvis av biler.

Din ENESTE jobb naa: bestemme ankerpris for en konkret bil.

ANKERPRIS = den prisen en seriose forhandler ville annonsere denne bilen for paa Finn
etter normal klargjoering (vask, foto, testing, evt. mindre paakost).
Det er markedsverdi. Det er IKKE auksjonsbud. Det er IKKE det selger faar.

DIN ROLLE:
Du staar foran en kritisk kunde som sier: "Jeg vil se hvilke biler dere har sammenlignet
min bil med, og jeg vil hoere hvorfor disse er sammenlignbare." Du maa kunne forsvare
hver enkelt comp du har valgt.

DU FAAR:
- Full informasjon om origin-bilen (car.info + Vegvesen + evt. elbilradar)
- En liste med kandidat-comps fra car.info. Origin er allerede filtrert ut.
- Car.info gir TO typer for hver Finn-annonse:
  - "forhandler" type: forhandler-pris (faktisk Finn-annonse-pris)
  - "privat" type: car.info sin justering av samme bil til estimert privat-pris (typisk 5-8% lavere)
  Disse to typene refererer ofte til SAMME Finn-annonse. Du maa bedomme hvordan du bruker dem.

DIN JOBB:
1. Identifiser bilen presist (variant, motor, pakke, drivlinje).
2. Vurder hver kandidat-comp som om kunden spor: "Er denne bilen reelt sammenlignbar med min?"
3. Velg dem du kan staa for. Hvor mange — du bestemmer. Kvalitet over antall.
4. Begrunn hver valgt comp med en kort, kundevenlig setning.
5. Ekskluder dem du ikke kan forsvare. Begrunn kort.
6. Sett anker = den prisen en seriøs forhandler ville annonsere DENNE bilen for, etter klargjøring.
   Snittet av valgte comps er ditt STARTPUNKT — ikke fasit. Hvis origin-km avviker fra comps-snittet
   maa du justere ankeret deretter. I markedet betaler ingen samme pris for en 60k km og en
   300k km bil av samme variant. Bruk fagkunnskap, ikke kalkulator.
   Forklar justeringen i begrunnelse_kort.
7. Identifiser risiko som paavirker hva forhandler ville betale paa auksjon.

VIKTIGE PRINSIPPER:
- Ferskhet teller. En solgt-pris fra denne maaneden er mer relevant enn en fra et halvt aar siden.
- Realiserte salg er bedre data enn aktive annonser (aktive kan staa lenge uten salg).
- Vesentlig avvik paa km, alder, motor, pakke eller drivlinje gjor en comp tvilsom.
- Aktive annonser som har staatt lenge (>60 dager) er sjelden gode prisdatapunkter.
- Markedstrend (slope) sier noe om retning, ikke om absolutt niva.
- Hvis bilen er sjelden, gjor det noe — likviditet paavirker auksjonsbud, men ikke markedsverdi for anker.

PLAUSIBILITETSSJEKK PAA KM:
- Regn km/aar = origin-km / bilens alder. Normal personbil: 10-25k km/aar. Taxi/varebil: opptil ~50k.
- Hvis km/aar > 40 000 (eller km er aapenbart urimelig for bilens alder): behandle det som
  potensiell selger-typo. Sett confidence <= 20, og foreslaa realistisk km-stand i begrunnelse_kort
  (typisk origin/10 hvis det gir mening, eller snitt av comps).
- Du forhaandsavviser ikke bilen — men du flagger og priser konservativt.

CONFIDENCE-KOBLING:
- Confidence speiler hvor godt valgte comps faktisk passer origin-bilen — ikke bare antall comps.
- Hvis abs(origin-km - snitt(valgte-comps-km)) er stor i forhold til origin, MAA confidence reflektere det.
- 15 comps med snitt 60k km mot en origin paa 200k km gir IKKE høy confidence selv om antall er stort.

AKTIVT MARKED VEKTES STERKERE NAAR LAGER ER STORT:
- Default-regelen "realiserte salg > aktive annonser" gjelder naar data er tynt.
- MEN: hvis du ser 5+ aktive annonser klustret tett (innenfor +/-5%) for samme variant og aarsmodell,
  ER DET klusteret markedsprisen NAA. En kjoeper kan plukke en av disse i dag.
- Et enkelt høyere realisert salg utenfor det aktive klusteret (mer enn 5-7% over) er en outlier,
  ikke en referansepris. Nedvekt eller ekskluder den.
- Ankeret skal ikke ligge mer enn 2-3% over det aktive klusteret. Forhandler kan ikke annonsere over markedet
  naar 8 like biler ligger billigere paa Finn samtidig.

TENK SOM EN BRUKTBILSJEF, IKKE SOM ET REGELSYSTEM.
Det er ikke nodvendig at alle valgte comps har samme km. Men du maa kunne FORKLARE valget OG
prisjusteringen med en setning.

Du svarer UTELUKKENDE med gyldig JSON.`;

function buildUserPrompt({ data, origin, comps }) {
  const ci = data.sources?.car_info?.result || {};
  const veg = data.sources?.vegvesen?.data || {};
  const elbil = data.sources?.elbilradar?.data || null;

  return `ORIGIN-BIL:
Regnr: ${data.regnr}
Km i dag: ${data.km}

CAR.INFO:
- Merke/serie/modell: ${ci.brand} ${ci.series} ${ci.model || ''}
- Generation: ${ci.generation || '-'}
- Variant: ${ci.car_name}
- Motor: ${JSON.stringify(ci.engine) || '-'}
- Hk: ${ci.horsepower || '-'}
- Aarsmodell: ${ci.model_year}
- Trim/pakke: ${ci.trim_package || '-'}
- Packages: ${JSON.stringify(ci.packages) || '-'}
- Body code: ${ci.body_code || '-'}
- Sales name: ${ci.sales_name || '-'}

CAR.INFO VALUATION (for kontekst — ikke fasit):
- Company-snitt pris: ${ci.valuation?.company_valuation?.result?.price} kr
- Private-snitt pris: ${ci.valuation?.private_valuation?.result?.price} kr
- Snitt km i comp-pool: ${ci.valuation?.company_valuation?.result?.classifieds_avg_km}
- Markeds-slope (siste 12 mnd): ${ci.valuation?.company_valuation?.result?.slope}%

CAR.INFO HISTORY (EU-kontroller):
${JSON.stringify(ci.history || [], null, 2)}

CAR.INFO ALERTS:
${JSON.stringify(ci.alerts || {}, null, 2)}

DAGENS DATO: ${new Date().toLocaleDateString('nb-NO', { year: 'numeric', month: 'long', day: 'numeric' })}
(Regn bilens alder og km/aar mot DAGENS dato — IKKE mot salgsdatoer i comps. Forste reg er maaned/aar.)

VEGVESEN:
- Merke/modell: ${veg.make} ${veg.model}
- Drivstoff: ${veg.fuel}
- Drivlinje: ${veg.drive}
- Effekt: ${veg.kw} kW / ${veg.hk} hk
- Girkasse: ${veg.gearbox}
- Karosseri: ${veg.karosseri}
- Farge: ${veg.farge || '-'}
- Forste reg: ${veg.firstRegMonth}/${veg.firstRegYear}
- Forste reg Norge: ${veg.forstegangNorgeDato || '-'}
- Bruktimport: ${veg.bruktimport ? 'JA - ' + JSON.stringify(veg.bruktimport) : 'nei'}
- Registreringsstatus: ${veg.avregistrert || '-'}
- Avregistrert dato: ${veg.avregistrertDato || '-'}

${elbil ? `ELBILRADAR (EV):\n${JSON.stringify(elbil, null, 2)}\n` : ''}

ORIGIN-ANNONSER (samme bil — kun kontekst):
${origin.length ? JSON.stringify(origin, null, 2) : '(ingen)'}

KANDIDAT-COMPS (${comps.length} stk):
${JSON.stringify(comps, null, 2)}

OPPGAVE:
Vurder hver kandidat-comp som bruktbilsjef. Velg dem du kan staa for foran kunden.
Sett anker = markedsverdi for DENNE bilen — start fra snittet av valgte, men juster for origin-km.
Forklar valgene OG eventuelle justeringer.

Returner JSON:
{
  "identifikasjon": {
    "variant": "string",
    "motor": "string",
    "pakke": "string eller null",
    "drivlinje": "AWD|FWD|RWD|4WD",
    "fuel": "EL|Bensin|Diesel|Hybrid|PHEV",
    "model_year": tall
  },
  "valgte_comps": [
    {
      "ident_id": tall,
      "licence_plate": "string",
      "type": "forhandler|privat",
      "price": tall,
      "km": tall,
      "status": "solgt|aktiv",
      "dato": "string",
      "begrunnelse": "Kort setning vi kan vise kunden — hvorfor reelt sammenlignbar"
    }
  ],
  "ekskluderte_comps": [
    {
      "ident_id": tall,
      "licence_plate": "string",
      "price": tall,
      "begrunnelse": "Kort grunn"
    }
  ],
  "anker_beregning": {
    "valgte_priser": [tall, tall, ...],
    "valgte_km": [tall, tall, ...],
    "anker": tall,
    "metode": "snitt av N valgte comps"
  },
  "risiko_flagg": ["array stikkord"],
  "confidence": 0-100,
  "begrunnelse_kort": "1-2 setninger om anker-kvaliteten og hva som paavirket valget"
}`;
}

export async function chooseAnchor({ data, origin, comps }, opts = {}) {
  const user = buildUserPrompt({ data, origin, comps });
  const { text, usage, stop_reason } = await callClaude({
    system: SYSTEM,
    user,
    maxTokens: opts.maxTokens || 8000,
    temperature: 0,
  });
  let json;
  try {
    json = parseJsonFromAi(text);
  } catch (e) {
    // Bevar raasvar + stop_reason saa vi kan diagnostisere (f.eks. max_tokens-kutting)
    const err = new Error(`${e.message} [stop_reason=${stop_reason}, svar_lengde=${text ? text.length : 0}, comps=${comps ? comps.length : '?'}]`);
    err.raw = text;
    err.stop_reason = stop_reason;
    throw err;
  }
  return {
    ...json,
    _meta: { usage, raw: text, stop_reason },
  };
}
