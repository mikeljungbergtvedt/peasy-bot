// data-collector.js
// Henter ALT relevant for å bestemme ankerpris på en bil:
//   - car.info (classifieds + valuation + history + alerts + packages)
//   - Vegvesen (avregistrert, bruktimport, motor, karosseri)
//   - elbilradar (kun EV)  [v1.15: cache fra Easy for å bypass 403]
//
// Returnerer ett samlet aggregat-objekt som sendes til AI-anchor.
//
// Bruk:
//   import { collectAllData } from './data-collector.js';
//   const data = await collectAllData('BT65230', 154000);

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';

const T_CARINFO  = +process.env.TIMEOUT_CARINFO  || 12000;
const T_VEGVESEN = +process.env.TIMEOUT_VEGVESEN || 10000;
const T_ELBIL    = +process.env.TIMEOUT_ELBIL    || 8000;

const CAR_INFO_KEY        = process.env.CAR_INFO_KEY;
const CAR_INFO_IDENTIFIER = process.env.CAR_INFO_IDENTIFIER || 'autoringen';
const VEGVESEN_KEY        = process.env.VEGVESEN_API_KEY;

// ----- helper -------------------------------------------------------------
async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ----- car.info (BETALT API — primær kilde) -------------------------------
export async function fetchCarInfo(regnr, km) {
  if (!CAR_INFO_KEY) return { ok: false, error: 'CAR_INFO_KEY mangler' };
  const url = `https://api.car.info/v2/app/autoringen/license-plate/N/${encodeURIComponent(regnr)}/${km}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'x-auth-identifier': CAR_INFO_IDENTIFIER,
        'x-auth-key': CAR_INFO_KEY,
        'Accept': 'application/json',
        'Accept-Language': 'nb',
      },
    }, T_CARINFO);
    if (!res.ok) return { ok: false, error: `car.info HTTP ${res.status}` };
    const json = await res.json();
    return { ok: true, raw: json, result: json?.result || null };
  } catch (e) {
    return { ok: false, error: `car.info: ${e.message}` };
  }
}

// ----- Vegvesen (kopi av peasy-auto getVegvesenData) ----------------------
export async function fetchVegvesen(regnr) {
  if (!VEGVESEN_KEY) return { ok: false, error: 'VEGVESEN_API_KEY mangler' };
  try {
    const res = await fetchWithTimeout(
      `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=${regnr.replace(/\s/g, '')}`,
      { headers: { 'Accept': 'application/json', 'SVV-Authorization': VEGVESEN_KEY } },
      T_VEGVESEN,
    );
    if (!res.ok) return { ok: false, error: `Vegvesen HTTP ${res.status}` };
    const data = await res.json();
    const k = data.kjoretoydataListe?.[0];
    if (!k) return { ok: false, error: 'Vegvesen: ingen data' };

    // Parsing IDENTISK med peasy-auto for konsistens
    const td = k.godkjenning?.tekniskGodkjenning?.tekniskeData;
    const motorer = td?.motorOgDrivverk?.motor || [];
    const motor = motorer[0];
    const drivstoff = motor?.drivstoff?.[0];
    const motorCount = motorer.length;
    const miljo = td?.miljodata?.miljoOgdrivstoffGruppe?.[0];
    const utslipp = miljo?.forbrukOgUtslipp?.[0];
    const aksler = td?.akslinger?.akselGruppe || [];
    const drivAksler = aksler.filter(g => g.akselListe?.aksel?.some(a => a.drivAksel)).length;
    const generelt = td?.generelt;
    const firstRegStr = k.godkjenning?.forstegangsGodkjenning?.forstegangRegistrertDato || '';
    const firstRegMonth = firstRegStr ? parseInt(firstRegStr.split('-')[1] || '0') : 0;
    const firstRegYear  = firstRegStr ? parseInt(firstRegStr.split('-')[0] || '0') : 0;
    const kw = drivstoff?.maksNettoEffekt || drivstoff?.maksEffektPrTime || 0;
    const karosseri = td?.karosseri?.karosseritype?.kodeBeskrivelse || '';
    const farge = td?.karosseriOgLasteplan?.rFarger?.[0]?.kodeNavn || td?.karosseri?.rFarger?.[0]?.kodeNavn || '';
    const avgiftsgruppe = k?.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering?.tekniskKode?.kodeBeskrivelse || '';
    const bruktimport = k?.godkjenning?.forstegangsGodkjenning?.bruktimport || null;
    const forstegangNorgeDato = k?.forstegangsregistrering?.registrertForstegangNorgeDato || null;
    const opprinneligRegDato = k?.godkjenning?.forstegangsGodkjenning?.forstegangRegistrertDato || null;

    // Avregistrert-status — viktig for risiko-vurdering
    const registrering = k?.registrering;
    const avregistrert = registrering?.registreringsstatus?.kodeBeskrivelse || null;
    const avregistrertDato = registrering?.avregistrertDato || null;

    return {
      ok: true,
      data: {
        make: generelt?.merke?.[0]?.merke || '',
        model: generelt?.handelsbetegnelse?.[0] || '',
        fuel: drivstoff?.drivstoffKode?.kodeBeskrivelse || 'Ukjent',
        gearbox: td?.motorOgDrivverk?.girkassetype?.kodeBeskrivelse || 'Ukjent',
        kw,
        hk: Math.round(kw * 1.36),
        drive: drivAksler >= 2 ? '4WD' : '2WD',
        range: utslipp?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring || null,
        karosseri,
        avgiftsgruppe,
        isVarebil: avgiftsgruppe?.toLowerCase().includes('varebil') || false,
        firstRegMonth,
        firstRegYear,
        isHybrid: motorCount > 1,
        bruktimport,
        forstegangNorgeDato,
        opprinneligRegDato,
        avregistrert,
        avregistrertDato,
        farge,
      },
    };
  } catch (e) {
    return { ok: false, error: `Vegvesen: ${e.message}` };
  }
}

// ----- elbilradar (kun EV) ------------------------------------------------
// v1.15: les fra Easy sin elbilradar-cache først (Easy henter via Cloudflare-bypass).
// Fall back til direkte HTTP (typisk 403 fra V2 uten browser-context).
const ELBIL_CACHE_FILE = '/Users/bot/peasy-auto/elbilradar-cache.json';
const ELBIL_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function tryElbilradarCache(regnr) {
  try {
    if (!existsSync(ELBIL_CACHE_FILE)) return null;
    const cache = JSON.parse(readFileSync(ELBIL_CACHE_FILE, 'utf8'));
    const entry = cache[regnr];
    if (!entry || !entry.data) return null;
    const age = Date.now() - new Date(entry.ts).getTime();
    if (age > ELBIL_CACHE_MAX_AGE_MS) return null;
    return entry.data;
  } catch (e) { return null; }
}

export async function fetchElbilradar(regnr) {
  // v1.15: prøv Easy-cache først
  const cached = tryElbilradarCache(regnr);
  if (cached) {
    return { ok: true, data: { title: cached.title || '', variantLine: cached.variantLine || null, modelFull: cached.modelFull || null, pakke: cached.pakke || null, equipment: cached.equipment || [], source: 'easy-cache' } };
  }
  try {
    const url = `https://elbilradar.com/elbil_data.php?regnr=${regnr.replace(/\s/g,'')}`;
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        'Accept': 'text/html',
      },
    }, T_ELBIL);
    if (!res.ok) return { ok: false, error: `elbilradar HTTP ${res.status}` };
    const html = await res.text();

    // Enkel ekstraksjon av variant og utstyr — mer detaljert parsing
    // kan legges til om AI trenger flere felt.
    const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const variantMatch = decoded.match(/>([A-Z][A-Za-z0-9 -]+?(?: [A-Za-z0-9-]+){1,4}\/[^<>\n]+(?:\/[^<>\n]+){1,8})</);
    const variantRaw = variantMatch ? variantMatch[1].trim() : null;
    const titleM = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleM ? titleM[1].trim() : '';

    let modelFull = null, pakke = null, equipment = [];
    if (variantRaw) {
      const parts = variantRaw.split('/').map(s => s.trim().replace(/"+$/,'').trim()).filter(Boolean);
      const first = parts[0] || '';
      const words = first.split(/\s+/);
      const deduped = [];
      for (let i = 0; i < words.length; i++) {
        if (i === 0 || words[i].toLowerCase() !== words[i-1].toLowerCase()) deduped.push(words[i]);
      }
      modelFull = deduped.join(' ');
      const pakkeMatch = modelFull.match(/\b(Supercharged|Fully Charged|Long Range|Performance|Plus|Pro|Sport|Premium)\b/i);
      pakke = pakkeMatch ? pakkeMatch[1] : null;
      equipment = parts.slice(1);
    }

    return { ok: true, data: { title, variantLine: variantRaw, modelFull, pakke, equipment } };
  } catch (e) {
    return { ok: false, error: `elbilradar: ${e.message}` };
  }
}

// ----- Hovedfunksjon — orkestrerer alle kilder ---------------------------
export async function collectAllData(regnr, km) {
  const out = {
    regnr,
    km: Number(km),
    timestamp: new Date().toISOString(),
    sources: {},
    errors: [],
  };

  // Parallell: car.info + Vegvesen (rask)
  const [carInfo, veg] = await Promise.all([
    fetchCarInfo(regnr, km),
    fetchVegvesen(regnr),
  ]);

  out.sources.car_info = carInfo;
  if (!carInfo.ok) out.errors.push(`car.info: ${carInfo.error}`);

  out.sources.vegvesen = veg;
  if (!veg.ok) out.errors.push(`vegvesen: ${veg.error}`);

  // elbilradar — kun for EV (sjekk drivstoff fra Vegvesen)
  const fuel = veg?.data?.fuel || '';
  const isEV = /elektri|electric|el\b/i.test(String(fuel));
  if (isEV) {
    out.sources.elbilradar = await fetchElbilradar(regnr);
    if (!out.sources.elbilradar.ok) out.errors.push(`elbilradar: ${out.sources.elbilradar.error}`);
  }

  return out;
}
