// ai-anchor.js v0.5
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
6. Beregn anker = snitt av valgte comps (alle valgte teller likt).
7. Identifiser risiko som paavirker hva forhandler ville betale paa auksjon.

VIKTIGE PRINSIPPER:
- Ferskhet teller. En solgt-pris fra denne maaneden er mer relevant enn en fra et halvt aar siden.
- Realiserte salg er bedre data enn aktive annonser (aktive kan staa lenge uten salg).
- Vesentlig avvik paa km, alder, motor, pakke eller drivlinje gjor en comp tvilsom.
- Aktive annonser som har staatt lenge (>60 dager) er sjelden gode prisdatapunkter.
- Markedstrend (slope) sier noe om retning, ikke om absolutt niva.
- Hvis bilen er sjelden, gjor det noe — likviditet paavirker auksjonsbud, men ikke markedsverdi for anker.

TENK SOM EN BRUKTBILSJEF, IKKE SOM ET REGELSYSTEM.
Det er ikke nodvendig at alle valgte comps har samme km. Det er ikke nodvendig at de er
samme aarsmodell. Men du maa kunne FORKLARE valget med en setning.

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
Beregn anker = snitt av valgte. Forklar valgene dine.

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
