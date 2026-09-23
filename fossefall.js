'use strict';
/**
 * fossefall.js — v20.146
 * Delbeløp i kroner. Ingen X-faktor.
 * usikkerhet_takst (alias spenn). returtrekk fjernet (var alias/dobbeltbokføring).
 *
 * v20.146: ståtid inngår i den ene peasy-bud-midten (ikke bare som skift på lav/høy).
 * Midt rundes til hele 1000 først (half up). Lav/høy = den midten ∓ spenn.
 * Deretter vrakpant-gulv på midt, lav og høy. AR-bud ≤ 0 er ikke PRIS MANUELT.
 * celleId = prisbånd|kmbånd (Pulse-aksene).
 * v20.144: ett tall, så ett spenn, så profil som merkelapp.
 * Finn → margin → takst → omreg → klargjøring 1000 → AR-bud → peasyFee → én peasyBud (midt).
 * Spenn-tabellens ned|opp legges rundt den samme midten → lav/høy.
 * A / B / Ordna viser den samme midten og det samme intervallet. De skalerer ikke (ikke ×1.00 / ×0.90 / ×0.75).
 * STATID_A_LIVE (default på): ståtid inngår i peasy-bud-midt og kopieres til alle armer. Den klemmes ikke av margin-maks.
 * FOSSEFALL_TABLES_LIVE=1: a/b/ordna kommer fra tabellene.
 * Default (flagget av): gammel computeA/computeBand blir stående; ny motor ligger i fossefall_v2.
 * Tom celle eller satser som ikke lar seg lese → PRIS MANUELT. Ingen interpolering, ingen oppdiktede satser.
 * FOSSEFALL_HARDCODED_FALLBACK=1: hvis live-flagget er på og tabellene feiler, behold gammel motor.
 */
const FOSSEFALL_VERSION = 'v20.146';

/** Merkelapp for Softteam. Ingen multiplikator — alle armer deler én midt og ett spenn. */
const PROFILES = {
  a: { id: 'a', label: 'snill' },
  b: { id: 'b', label: 'tro' },
  ordna: { id: 'ordna', label: 'underpromise' },
};

/** Ny sti. Gammel Easy-sti (computeA) beholder EASY_COST.klargjoring = 5000. */
const KLARGJORING_KR = 1000;

const CONFIG_URL = process.env.PEASY_CONFIG_URL
  || 'https://mikeljungbergtvedt.github.io/peasy-config.json';
const SATSER_CACHE_TTL_MS = 5 * 60 * 1000;

const EASY_COST = {
  marginPct: 0.08,
  minMargin: 8000,
  klargjoring: 5000,
  paakostPct: 0.15,
  paakostCap: 30000,
  vrakpantGulv: 3000,
  minSpread: 5000,
};

const FEE_TIERS = [
  { maxT: 35000, fee: 5900 },
  { maxT: 75000, fee: 8900 },
  { maxT: 150000, fee: 9900 },
  { maxT: Infinity, fee: 11900 },
];

const MARGIN_TABLE = [
  { maxAnker: 100000, min: 8000, maks: 12000, bracket: 'Lav' },
  { maxAnker: 250000, min: 12000, maks: 22000, bracket: 'Mid' },
  { maxAnker: 400000, min: 22000, maks: 35000, bracket: 'Hoy' },
  { maxAnker: 600000, min: 35000, maks: 50000, bracket: 'Premium-Lav' },
  { maxAnker: Infinity, min: 50000, maks: 70000, bracket: 'Premium-Hoy' },
];

const SPREAD = { normal: 0.05, highkm: 0.075 };
const ORDNA_KALKYLE_MULT = 0.75;
const V3G_RETUR_MULT = 0.90;

function statidALive() {
  const v = process.env.STATID_A_LIVE;
  if (v == null || v === '') return true;
  return !/^(0|false|off|nei|no)$/i.test(String(v).trim());
}

function peasyFee(bud) {
  if (bud <= 35000) return 5900;
  if (bud <= 75000) return 8900;
  if (bud <= 150000) return 9900;
  return 11900;
}

function omreg(bilInfo) {
  const year = (bilInfo && bilInfo.year) || 2020;
  const vekt = (bilInfo && bilInfo.egenvekt) || 1500;
  const isVarebil = !!(bilInfo && (bilInfo.isVarebil === true || /varebil|lastebil|kombinert|campingbil/i.test(bilInfo.biltype || '')));
  const usedFallback = !(bilInfo && bilInfo.egenvekt);
  let kr;
  if (isVarebil) {
    if (year >= 2023) kr = 2459;
    else if (year >= 2015) kr = 1553;
    else kr = 1296;
  } else if (vekt <= 1200) {
    if (year >= 2023) kr = 4918;
    else if (year >= 2015) kr = 3236;
    else kr = 1942;
  } else {
    if (year >= 2023) kr = 7505;
    else if (year >= 2015) kr = 4532;
    else kr = 1942;
  }
  return { kr, note: usedFallback ? 'reserveverdi år/vekt' : null };
}

function identifySegment(km, modelYear) {
  const currentYear = new Date().getFullYear();
  const age = currentYear - (modelYear || currentYear);
  const kmPerYear = age > 0 ? Math.round(km / age) : 0;
  if (km >= 100000 || kmPerYear > 25000) return 'highkm';
  return 'normal';
}

function segmentModifier(ctx) {
  const year = Number(ctx.year) || 0;
  const km = Number(ctx.km) || 0;
  const anker = Number(ctx.anker) || 0;
  if (anker > 500000) return { mult: 1.58, tag: 'konservativ', regel: '×1,58 anker > 500 000' };
  if (year >= 2023 && km > 0 && km < 50000) return { mult: 1.58, tag: 'konservativ', regel: '×1,58 år≥2023 km<50 000' };
  if (year >= 2010 && year <= 2014 && km >= 100000) return { mult: 0.67, tag: 'aggressiv', regel: '×0,67 år 2010–2014 km≥100 000' };
  return { mult: 1.0, tag: 'standard', regel: null };
}

/**
 * Nærmeste 1000 kr, half up.
 * Halvparten (.5) rundes mot +∞, samme som ECMAScript Math.round.
 * For positive kroner: rest ≥ 500 rundes opp (113568 → 114000, 113500 → 114000, 113499 → 113000).
 */
function roundKr(n) {
  return Math.round(Number(n) / 1000) * 1000;
}

function celleIdOf(looked) {
  if (!looked) return null;
  if (looked.cell) return looked.cell;
  if (looked.priceId && looked.kmId) return looked.priceId + '|' + looked.kmId;
  return null;
}

function sideOf(v, side) {
  if (v == null) return 0;
  if (typeof v === 'object' && (v.lav != null || v.hoy != null)) {
    const x = Number(v[side]);
    return Number.isFinite(x) ? x : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function verifyLag(lag) {
  if (!lag) return { ok: false, err: 'mangler' };
  const sLav = sumLag(lag, 'lav');
  const sHoy = sumLag(lag, 'hoy');
  return {
    ok: sLav === lag.lav && sHoy === lag.hoy,
    sumLav: sLav,
    sumHoy: sHoy,
    lav: lag.lav,
    hoy: lag.hoy,
  };
}

function emptySide() {
  return { lav: 0, hoy: 0 };
}


/** Felles gulv for A/B/Ordna: midt og lav ≥ 3000, høy ≥ 5000. Etter avrunding. Rad = løftet beløp. */
const VRAKPANT_GULV_LAV = 3000;
const VRAKPANT_GULV_HOY = 5000;
function applyVrakpantGulv(lag) {
  if (!lag) return lag;
  let lav = Number(lag.lav);
  let hoy = Number(lag.hoy);
  if (!Number.isFinite(lav) || !Number.isFinite(hoy)) {
    lag.vrakpant_gulv = emptySide();
    return lag;
  }
  // Bare løft: midt og lav ≥ 3000; høy ≥ max(lav+2000, 5000). Aldri PRIS MANUELT fordi tallet var ≤ 0.
  const nLav = Math.max(lav, VRAKPANT_GULV_LAV);
  const nHoy = Math.max(hoy, nLav + 2000, VRAKPANT_GULV_HOY);
  const liftLav = nLav - lav;
  const liftHoy = nHoy - hoy;
  let midLift = 0;
  const hasMid = lag.peasy_bud_mid != null || lag.estimertPeasyBud != null;
  if (hasMid) {
    const mid = Number(lag.peasy_bud_mid != null ? lag.peasy_bud_mid : lag.estimertPeasyBud);
    if (Number.isFinite(mid)) {
      const nMid = Math.max(mid, VRAKPANT_GULV_LAV);
      midLift = nMid - mid;
      lag.peasy_bud_mid = nMid;
      lag.estimertPeasyBud = nMid;
    }
  }
  if (liftLav === 0 && liftHoy === 0 && midLift === 0) {
    lag.vrakpant_gulv = emptySide();
    if (lag._meta) lag._meta.vrakpant = false;
    return lag;
  }
  lag.vrakpant_gulv = { lav: liftLav, hoy: liftHoy };
  lag.lav = nLav;
  lag.hoy = nHoy;
  if (!lag._meta) lag._meta = {};
  lag._meta.vrakpant = true;
  return lag;
}

function computeA(finn, bilInfo, originCapInfo) {
  const M = EASY_COST;
  const a = roundKr(finn);
  const marginPct = Math.round(a * M.marginPct);
  const margin = Math.max(M.minMargin, marginPct);
  const takGulv = margin - marginPct; // + when minMargin floor hit
  const om = omreg(bilInfo || {});
  const omregKr = om.kr;
  const paakostHoy = Math.min(M.paakostCap, a * M.paakostPct);
  const budHoy = a - margin - omregKr - M.klargjoring;
  const budLav = budHoy - paakostHoy;
  const feeHoy = peasyFee(budHoy);
  const feeLav = peasyFee(budLav);
  const dLavRaw = budLav - feeLav;
  const dHoyRaw = budHoy - feeHoy;
  let dLav = roundKr(dLavRaw);
  let dHoy = roundKr(dHoyRaw);
  if (dHoy > a) dHoy = a;
  if (!(dHoy > dLav)) dHoy = dLav + M.minSpread;

  const avrundingLav = dLav - dLavRaw;
  const avrundingHoy = dHoy - dHoyRaw;

  const origin_cap = (originCapInfo && Number(originCapInfo.kr)) || 0;
  const annonsepris = (originCapInfo && originCapInfo.annonsepris) || null;
  const origin_cap_tak = (originCapInfo && originCapInfo.origin_cap_tak) || null;
  const chefs_foer_cap = (originCapInfo && originCapInfo.chefs_foer_cap) || null;

  const lag = {
    finn_utpris: a,
    origin_cap,
    origin_cap_tak,
    annonsepris,
    chefs_foer_cap,
    forhandlermargin: -margin,
    forhandlermargin_pct: -marginPct,
    forhandlermargin_tak_gulv: -takGulv, // if floor raised margin, takGulv>0 → this is negative? 
    // margin = max(minMargin, pct). If pct=30400, min=8000 → margin=30400, takGulv=0.
    // If pct=5000, margin=8000, takGulv=+3000 (extra margin from floor).
    // Parts: pct + tak_gulv_part should equal total margin magnitude.
    // forhandlermargin_pct = -marginPct, forhandlermargin_tak_gulv = -(margin - marginPct) = -takGulv
    // Sum: -marginPct - takGulv = -margin. Good.
    forhandlermargin_segment: 0,
    forhandlermargin_segment_regel: null,
    statid: 0,
    omregistrering: -omregKr,
    omregistrering_note: om.note,
    transport: 0,
    klargjoring: -M.klargjoring,
    usikkerhet_takst: { lav: -paakostHoy, hoy: 0 },
    spenn: { lav: -paakostHoy, hoy: 0 }, // alias
    forhandlermargin_tillegg_bud: emptySide(),
    ordna_trekk: emptySide(),
    vrakpant_gulv: emptySide(),
    avrunding: { lav: avrundingLav, hoy: avrundingHoy },
    peasy_avgift: { lav: -feeLav, hoy: -feeHoy },
    lav: dLav,
    hoy: dHoy,
    _meta: { paakost: paakostHoy, dLavRaw, dHoyRaw, vrakpant: false },
  };

  // Fix forhandlermargin_tak_gulv sign: store as difference that sums with pct to total
  lag.forhandlermargin_tak_gulv = -(margin - marginPct);

  // Vrakpant-gulv applied once in buildFossefall

  // Ensure sum matches (påkost in spenn + avrunding already in formula)
  // sum lav: a + origin_cap + (-margin) + 0 + (-omreg) + 0 + (-klarg) + (-paakost) + 0 + 0 + 0 + avr + (-fee)
  // = (a - margin - omreg - klarg - paakost - fee) + avr + origin_cap = dLavRaw + avr + origin_cap = dLav + origin_cap
  // If origin_cap ≠ 0, finn_utpris is already capped value — origin_cap is informational delta from ask.
  // Spec: finn is anker, origin_cap is the difference if cap hit. So finn_utpris stays capped,
  // origin_cap is separate display field that should NOT double-count in sum.
  // Re-read: "Finn-utpris | anker · origin-cap (differansen...)" — both shown; sum to lav/hoy.
  // If both in sum, finn should be uncapped ask. Safer: keep finn = capped (used in kalkyle),
  // origin_cap stored but NOT in sumLag (informational). Spec says layers still sum exactly.
  // So origin_cap is a sub-breakdown of finn, not an extra layer — store it, exclude from sumLag.
  return lag;
}

function computeBand(finn, km, modelYear, mult, kind, originCapInfo) {
  const a = roundKr(finn);
  const segMod = segmentModifier({ year: modelYear, km, anker: a });
  const mb = MARGIN_TABLE.find((b) => a <= b.maxAnker);
  const marginPctKr = roundKr(a * 0.12);
  const marginClamped = Math.min(mb.maks, Math.max(mb.min, marginPctKr));
  const takGulvDiff = marginClamped - marginPctKr; // e.g. 35000-46000 = -11000
  const marginAfterSeg = roundKr(marginClamped * segMod.mult);
  const segmentDiff = marginAfterSeg - marginClamped;
  const margin = marginAfterSeg;

  const brutto = a - margin;
  const fee = FEE_TIERS.find((f) => brutto < f.maxT).fee;
  const dMid = brutto - fee;
  const segment = identifySegment(km, modelYear);
  const spreadPct = SPREAD[segment];
  const dLavRawGate = roundKr(dMid * (1 - spreadPct));
  let spread;
  if (dLavRawGate < 30000) spread = 2500;
  else if (dLavRawGate < 100000) spread = Math.max(5000, roundKr(dMid * spreadPct));
  else spread = roundKr(dMid * spreadPct);

  const dLavPre = dMid - spread;
  const dHoyPre = dMid + spread;
  const dLavStd = roundKr(dLavPre);
  const dHoyStd = roundKr(dHoyPre);
  const bandAvrLav = dLavStd - dLavPre;
  const bandAvrHoy = dHoyStd - dHoyPre;

  const lavAfter = roundKr(dLavStd * mult);
  const hoyAfter = roundKr(dHoyStd * mult);
  let hoyFixed = hoyAfter;
  if (!(hoyFixed > lavAfter)) hoyFixed = lavAfter + 5000;

  const trekkLav = lavAfter - dLavStd;
  const trekkHoy = hoyFixed - dHoyStd;

  const origin_cap = (originCapInfo && Number(originCapInfo.kr)) || 0;
  const annonsepris = (originCapInfo && originCapInfo.annonsepris) || null;
  const origin_cap_tak = (originCapInfo && originCapInfo.origin_cap_tak) || null;
  const chefs_foer_cap = (originCapInfo && originCapInfo.chefs_foer_cap) || null;

  const tilleggBud = kind === 'b' ? { lav: trekkLav, hoy: trekkHoy } : emptySide();
  const ordna_trekk = kind === 'ordna' ? { lav: trekkLav, hoy: trekkHoy } : emptySide();

  const lag = {
    finn_utpris: a,
    origin_cap,
    origin_cap_tak,
    annonsepris,
    chefs_foer_cap,
    forhandlermargin: -margin,
    forhandlermargin_pct: -marginPctKr,
    forhandlermargin_tak_gulv: -takGulvDiff, // -(-11000)=+11000; pct -46000 + 11000 = -35000
    forhandlermargin_segment: -segmentDiff,
    forhandlermargin_segment_regel: segMod.regel,
    statid: 0,
    omregistrering: 0,
    omregistrering_note: null,
    transport: 0,
    klargjoring: 0,
    usikkerhet_takst: { lav: -spread, hoy: spread },
    spenn: { lav: -spread, hoy: spread }, // alias
    forhandlermargin_tillegg_bud: tilleggBud,
    ordna_trekk,
    vrakpant_gulv: emptySide(),
    avrunding: { lav: bandAvrLav, hoy: bandAvrHoy },
    peasy_avgift: { lav: -fee, hoy: -fee },
    lav: lavAfter,
    hoy: hoyFixed,
    _meta: { dMid, spread, segment, dLavStd, dHoyStd, mult, segMod },
  };
  return lag;
}

/**
 * origin_cap is informational (breakdown of Finn); excluded from sumLag.
 */
function sumLag(lag, side) {
  if (!lag) return null;
  return (
    Number(lag.finn_utpris || 0) +
    Number(lag.forhandlermargin || 0) +
    Number(lag.avsetning_takst || 0) +
    Number(lag.statid || 0) +
    Number(lag.omregistrering || 0) +
    Number(lag.transport || 0) +
    Number(lag.klargjoring || 0) +
    sideOf(lag.usikkerhet_takst != null ? lag.usikkerhet_takst : lag.spenn, side) +
    sideOf(lag.forhandlermargin_tillegg_bud, side) +
    sideOf(lag.ordna_trekk, side) +
    sideOf(lag.vrakpant_gulv, side) +
    sideOf(lag.avrunding, side) +
    sideOf(lag.peasy_avgift, side)
  );
}

function makeAvvik(lag, stored, hints) {
  hints = hints || {};
  if (!stored || !lag) return null;
  const sLav = Number(stored.dLav);
  const sHoy = Number(stored.dHoy);
  if (!Number.isFinite(sLav) || !Number.isFinite(sHoy)) return null;
  const dLav = sLav - lag.lav;
  const dHoy = sHoy - lag.hoy;
  if (dLav === 0 && dHoy === 0) return null;
  const reasons = [];
  if (hints.km_override) reasons.push('km-override');
  if (hints.origin_cap) reasons.push('origin-cap');
  if (hints.vrakpant || (lag._meta && lag._meta.vrakpant)) reasons.push('vrakpant-gulv');
  if (hints.anker_lagret != null && Number.isFinite(Number(hints.anker_lagret))) {
    const aLagret = Number(hints.anker_lagret);
    if (roundKr(aLagret) !== lag.finn_utpris && aLagret !== lag.finn_utpris) reasons.push('annet-anker');
  }
  if (hints.egenvekt_mangler) reasons.push('egenvekt-fallback');
  if (hints.aar_mangler) reasons.push('aar-fallback');
  if (hints.wrecker) reasons.push('wrecker');
  const avr = lag.avrunding || {};
  if (Math.abs(Number(avr.lav) || 0) > 1000 || Math.abs(Number(avr.hoy) || 0) > 1000) {
    reasons.push('avrunding>1000');
  }
  if (!reasons.length) reasons.push('ukjent');
  return {
    lav: dLav,
    hoy: dHoy,
    aarsak: reasons.join(','),
    lagret: { dLav: sLav, dHoy: sHoy },
    formel: { dLav: lag.lav, dHoy: lag.hoy },
  };
}

function stripMeta(lag) {
  if (!lag) return null;
  const out = Object.assign({}, lag);
  delete out._meta;
  return out;
}

function medianNum(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function extractSoldDays(comps) {
  const list = Array.isArray(comps) ? comps : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const st = String(c.status || c.state || '').toLowerCase();
    if (st === 'aktiv' || st === 'active') continue;
    const isSold = st === 'solgt' || st === 'sold' || !!c.sold_date
      || (!st && Number.isFinite(Number(c.days)));
    if (!isSold) continue;
    const d = Number(c.days);
    if (Number.isFinite(d) && d >= 0) out.push(d);
  }
  return out;
}

function computeStatid(finn, soldDays) {
  const days = (Array.isArray(soldDays) ? soldDays : [])
    .map((d) => Number(d))
    .filter((d) => Number.isFinite(d) && d >= 0);
  const n = days.length;
  if (n < 5) {
    return {
      kr: 0,
      median_days: null,
      n_comps: n,
      counted_days: 0,
      kr_per_day: null,
      grunn: 'for få solgte comps',
      manuell: false,
    };
  }
  const median = medianNum(days);
  const counted = Math.max(0, Math.min(median, 45) - 15);
  let perDay = 0.0033 * Number(finn);
  if (!Number.isFinite(perDay)) perDay = 200;
  perDay = Math.max(200, Math.min(1500, perDay));
  const raw = counted * perDay;
  const absRound = Math.round(raw / 100) * 100;
  const kr = counted > 0 ? -absRound : 0;
  return {
    kr,
    median_days: Math.round(median * 10) / 10,
    n_comps: n,
    counted_days: counted,
    kr_per_day: Math.round(perDay),
    grunn: counted === 0 ? 'under nullpunkt (≤15 dager)' : null,
    manuell: median > 60,
  };
}

function finalizeAvrunding(lag) {
  if (!lag) return lag;
  const avrIn = (lag.avrunding && typeof lag.avrunding === 'object')
    ? lag.avrunding : { lav: 0, hoy: 0 };
  const avr = {
    lav: Number(avrIn.lav) || 0,
    hoy: Number(avrIn.hoy) || 0,
  };
  for (const side of ['lav', 'hoy']) {
    const cur = Number(lag[side]);
    if (!Number.isFinite(cur)) continue;
    const pre = cur - avr[side];
    const rounded = roundKr(pre);
    avr[side] = rounded - pre;
    lag[side] = rounded;
  }
  lag.avrunding = avr;
  return lag;
}

function applyStatid(aLag, statidKr) {
  if (!aLag) return null;
  const s = Number(statidKr) || 0;
  const out = Object.assign({}, aLag, {
    statid: s,
    lav: Number(aLag.lav) + s,
    hoy: Number(aLag.hoy) + s,
    usikkerhet_takst: (aLag.usikkerhet_takst || aLag.spenn) && typeof (aLag.usikkerhet_takst || aLag.spenn) === 'object' ? { lav: (aLag.usikkerhet_takst || aLag.spenn).lav, hoy: (aLag.usikkerhet_takst || aLag.spenn).hoy } : (aLag.usikkerhet_takst || aLag.spenn),
    spenn: aLag.spenn && typeof aLag.spenn === 'object' ? { lav: aLag.spenn.lav, hoy: aLag.spenn.hoy } : aLag.spenn,
    forhandlermargin_tillegg_bud: emptySide(),
    ordna_trekk: emptySide(),
    vrakpant_gulv: aLag.vrakpant_gulv && typeof aLag.vrakpant_gulv === 'object'
      ? { lav: aLag.vrakpant_gulv.lav, hoy: aLag.vrakpant_gulv.hoy } : aLag.vrakpant_gulv,
    avrunding: aLag.avrunding && typeof aLag.avrunding === 'object'
      ? { lav: aLag.avrunding.lav, hoy: aLag.avrunding.hoy } : aLag.avrunding,
    peasy_avgift: aLag.peasy_avgift && typeof aLag.peasy_avgift === 'object'
      ? { lav: aLag.peasy_avgift.lav, hoy: aLag.peasy_avgift.hoy } : aLag.peasy_avgift,
  });
  return out;
}

/**
 * origin_cap = min(0, cap_tak − kokkenes Finn før cap). 0 når taket ikke slo inn.
 * Info: origin_cap_tak, annonsepris. Aldri annonse−finn som proxy.
 */
function resolveOriginCap(opts, finn) {
  const annonse = Number(opts.annonsepris != null ? opts.annonsepris : opts.originAsk);
  const chefsBefore = Number(
    opts.chefsUtprisBeforeCap != null ? opts.chefsUtprisBeforeCap
      : (opts.chefsRaw != null ? opts.chefsRaw : opts.chefs_foer_cap)
  );
  let capTak = Number(opts.originCapTak != null ? opts.originCapTak : opts.origin_cap_tak);
  if (!Number.isFinite(capTak) && Number.isFinite(annonse) && annonse > 0) {
    capTak = Math.round((annonse * 0.95) / 1000) * 1000;
  }
  let kr = 0;
  if (Number.isFinite(chefsBefore) && Number.isFinite(capTak) && chefsBefore > capTak) {
    kr = Math.min(0, capTak - chefsBefore);
  }
  return {
    kr,
    origin_cap_tak: Number.isFinite(capTak) ? capTak : null,
    annonsepris: Number.isFinite(annonse) && annonse > 0 ? annonse : null,
    chefs_foer_cap: Number.isFinite(chefsBefore) && chefsBefore > 0 ? Math.round(chefsBefore) : null,
  };
}

function tablesLive() {
  return /^(1|true|on|ja|yes)$/i.test(String(process.env.FOSSEFALL_TABLES_LIVE || '').trim());
}

function hardcodedFallback() {
  return /^(1|true|on|ja|yes)$/i.test(String(process.env.FOSSEFALL_HARDCODED_FALLBACK || '').trim());
}

function profileOf(profile) {
  if (profile && typeof profile === 'object') {
    const id = String(profile.id || '').toLowerCase();
    if (PROFILES[id]) return PROFILES[id];
    return null;
  }
  const key = String(profile || 'a').toLowerCase();
  if (PROFILES[key]) return PROFILES[key];
  return null;
}

let _satserCache = { satser: null, fetchedAt: 0, error: null };

function getFossefallSatser() {
  return _satserCache.satser || null;
}

/**
 * Hent peasy-config.json (samme github.io-URL som Pulse) og cache fossefallSatser i minnet.
 * DRAFT-status brukes likevel — Mike har lagt tabellene i Pulse.
 * Feil: behold forrige cache. Ingen cache → null (kalleren feiler lukket, finner ikke opp satser).
 */
async function loadFossefallSatser(opts) {
  opts = opts || {};
  const now = Date.now();
  if (!opts.force && _satserCache.satser && (now - _satserCache.fetchedAt) < SATSER_CACHE_TTL_MS) {
    return _satserCache.satser;
  }
  if (!opts.force && !_satserCache.satser && _satserCache.fetchedAt && (now - _satserCache.fetchedAt) < SATSER_CACHE_TTL_MS) {
    return null;
  }
  const url = opts.url || CONFIG_URL;
  const fetcher = opts.fetch || fetch;
  try {
    const res = await fetcher(url, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
    const json = await res.json();
    const satser = json && json.fossefallSatser;
    if (!satser || typeof satser !== 'object' || !satser.axes) throw new Error('fossefallSatser mangler');
    _satserCache = { satser, fetchedAt: now, error: null };
    return satser;
  } catch (e) {
    _satserCache.error = (e && e.message) || String(e);
    _satserCache.fetchedAt = now;
    return _satserCache.satser || null;
  }
}

function isEmptyCell(v) {
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

function readKr(v) {
  if (isEmptyCell(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readCell(table, priceId, kmId) {
  if (table == null || typeof table !== 'object') return undefined;
  const key = priceId + '|' + kmId;
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const row = table[priceId];
  if (row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, kmId)) return row[kmId];
  return undefined;
}

/**
 * Inklusiv min, eksklusiv maks. Siste bånd er inklusiv maks.
 * 30 000 kr treffer «30–60», ikke «10–30». Ingen interpolering mellom bånd.
 */
function findBand(axis, value) {
  if (!Array.isArray(axis) || !axis.length) return null;
  const x = Number(value);
  if (!Number.isFinite(x)) return null;
  for (let i = 0; i < axis.length; i++) {
    const b = axis[i];
    if (!b || b.id == null) continue;
    const min = Number(b.min);
    const max = Number(b.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    const last = i === axis.length - 1;
    if (x >= min && (x < max || (last && x <= max))) return b;
  }
  return null;
}

function parseSpenn(v) {
  if (isEmptyCell(v)) return null;
  if (Array.isArray(v)) {
    if (v.length < 2 || isEmptyCell(v[0]) || isEmptyCell(v[1])) return null;
    const ned = Number(v[0]);
    const opp = Number(v[1]);
    if (!Number.isFinite(ned) || !Number.isFinite(opp)) return null;
    return { ned, opp };
  }
  if (typeof v === 'object') {
    const nedRaw = v.ned != null ? v.ned : v.lav;
    const oppRaw = v.opp != null ? v.opp : v.hoy;
    if (isEmptyCell(nedRaw) || isEmptyCell(oppRaw)) return null;
    const ned = Number(nedRaw);
    const opp = Number(oppRaw);
    if (!Number.isFinite(ned) || !Number.isFinite(opp)) return null;
    return { ned, opp };
  }
  const parts = String(v).trim().split('|');
  if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '') return null;
  const ned = Number(parts[0].trim().replace(/\s/g, '').replace(',', '.'));
  const opp = Number(parts[1].trim().replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(ned) || !Number.isFinite(opp)) return null;
  return { ned, opp };
}

/**
 * Slå opp én celle. Tom/manglende celle → ok:false (ikke nabo, ikke interpolering).
 * margin klemmes med radens min/max når de finnes.
 */
function lookupFossefallCell(satser, finn, km) {
  if (!satser || typeof satser !== 'object' || !satser.axes) {
    return { ok: false, grunn: 'satser ikke lastet' };
  }
  const priceBand = findBand(satser.axes.price, finn);
  if (!priceBand) return { ok: false, grunn: 'utenfor akser (pris)' };
  const kmBand = findBand(satser.axes.km, km);
  if (!kmBand) return { ok: false, grunn: 'utenfor akser (km)' };
  const cell = priceBand.id + '|' + kmBand.id;
  const marginRaw = readKr(readCell(satser.margin, priceBand.id, kmBand.id));
  if (marginRaw == null) return { ok: false, grunn: 'tom celle margin ' + cell, priceId: priceBand.id, kmId: kmBand.id };
  const takst = readKr(readCell(satser.takst, priceBand.id, kmBand.id));
  if (takst == null) return { ok: false, grunn: 'tom celle takst ' + cell, priceId: priceBand.id, kmId: kmBand.id };
  const spenn = parseSpenn(readCell(satser.spenn, priceBand.id, kmBand.id));
  if (!spenn) return { ok: false, grunn: 'tom celle spenn ' + cell, priceId: priceBand.id, kmId: kmBand.id };

  const marginMin = readKr(satser.min && satser.min[priceBand.id]);
  const marginMax = readKr(satser.max && satser.max[priceBand.id]);
  if (marginMin != null && marginMax != null && marginMin > marginMax) {
    return { ok: false, grunn: 'ugyldig margin-klemme ' + priceBand.id, priceId: priceBand.id, kmId: kmBand.id };
  }
  let margin = marginRaw;
  if (marginMin != null && margin < marginMin) margin = marginMin;
  if (marginMax != null && margin > marginMax) margin = marginMax;

  return {
    ok: true,
    priceId: priceBand.id,
    kmId: kmBand.id,
    cell,
    marginRaw,
    margin,
    marginMin,
    marginMax,
    takst,
    spenn,
  };
}

function skipArm(profile, grunn) {
  return {
    skip: true,
    signal: 'PRIS MANUELT',
    grunn: grunn || 'PRIS MANUELT',
    profile: profile || null,
    lav: null,
    hoy: null,
  };
}

/**
 * Ett fossefall. Profilen er bare hvilken arm som vises.
 * Finn − forhandlermargin − avsetning takst − omreg − klargjøring 1000 = AR-bud
 * AR-bud − peasyFee = én peasyBud (midt). Ingen profil-skalering.
 * Spenn ned|opp legges rundt den avrundede midten → lav/høy.
 * Ståtid (samme beløp på alle armer når den er på) ligger i midten, etter fee, og klemmes ikke av margin-maks.
 * Vrakpant-gulv på midt/lav/høy legges på i buildSharedFossefall, etter avrundingen.
 */
function computeSharedFossefall(opts) {
  opts = opts || {};
  const prof = profileOf(opts.profile || 'a');
  if (!prof) return skipArm(opts.profile, 'ukjent profil');

  const finnIn = Number(opts.finnUtpris != null ? opts.finnUtpris : opts.finn);
  if (!Number.isFinite(finnIn) || finnIn <= 0) return skipArm(prof.id, 'finn-utpris mangler');
  if (opts.km == null || opts.km === '' || !Number.isFinite(Number(opts.km))) {
    return skipArm(prof.id, 'km mangler');
  }
  const km = Number(opts.km);
  const finn = roundKr(finnIn);
  const satser = opts.satser || getFossefallSatser();
  const looked = opts.looked || lookupFossefallCell(satser, finn, km);
  if (!looked || !looked.ok) {
    const skipped = skipArm(prof.id, (looked && looked.grunn) || 'satser ikke lastet');
    skipped.celleId = celleIdOf(looked);
    if (looked && looked.priceId) skipped.price_id = looked.priceId;
    if (looked && looked.kmId) skipped.km_id = looked.kmId;
    return skipped;
  }

  const modelYear = Number(opts.modelYear) || Number(opts.year) || Number(opts.bilInfo && opts.bilInfo.year) || 2020;
  const bilInfo = Object.assign({ year: modelYear }, opts.bilInfo || {});
  const om = omreg(bilInfo);
  const omregKr = om.kr;
  const margin = looked.margin;
  const marginRaw = looked.marginRaw;
  const takst = looked.takst;
  const ned = looked.spenn.ned;
  const opp = looked.spenn.opp;
  const statidKr = Number(opts.statidKr) || 0;

  const arBud = finn - margin - takst - omregKr - KLARGJORING_KR;
  const fee = peasyFee(arBud);
  // Ståtid etter fee, inne i den ene midten. Rund midt først, så lav/høy fra den midten ± spenn.
  const midRaw = arBud - fee + statidKr;
  const peasyBudMid = roundKr(midRaw);
  const lav = peasyBudMid - ned;
  const hoy = peasyBudMid + opp;
  const midAvr = peasyBudMid - midRaw;
  const celleId = celleIdOf(looked);

  const originCapInfo = opts.originCapInfo || null;
  const origin_cap = (originCapInfo && Number(originCapInfo.kr)) || 0;

  return {
    skip: false,
    signal: null,
    grunn: null,
    profile: prof.id,
    profil: prof.label,
    price_id: looked.priceId,
    km_id: looked.kmId,
    celleId,
    ar_bud: arBud,
    estimertPeasyBud: peasyBudMid,
    peasy_bud_mid: peasyBudMid,
    finn_utpris: finn,
    origin_cap,
    origin_cap_tak: originCapInfo ? originCapInfo.origin_cap_tak : null,
    annonsepris: originCapInfo ? originCapInfo.annonsepris : null,
    chefs_foer_cap: originCapInfo ? originCapInfo.chefs_foer_cap : null,
    forhandlermargin: -margin,
    forhandlermargin_pct: -marginRaw,
    forhandlermargin_tak_gulv: -(margin - marginRaw),
    forhandlermargin_segment: 0,
    forhandlermargin_segment_regel: null,
    avsetning_takst: -takst,
    statid: statidKr,
    omregistrering: -omregKr,
    omregistrering_note: om.note,
    transport: 0,
    klargjoring: -KLARGJORING_KR,
    usikkerhet_takst: { lav: -ned, hoy: opp },
    spenn: { lav: -ned, hoy: opp },
    forhandlermargin_tillegg_bud: emptySide(),
    ordna_trekk: emptySide(),
    vrakpant_gulv: emptySide(),
    avrunding: { lav: midAvr, hoy: midAvr },
    peasy_avgift: { lav: -fee, hoy: -fee },
    lav,
    hoy,
    _meta: {
      engine: 'fossefallSatser',
      version: FOSSEFALL_VERSION,
      cell: looked.cell,
      celleId,
      marginRaw,
      margin,
      takst,
      ned,
      opp,
      arBud,
      midRaw,
      peasyBudMid,
      fee,
      omregKr,
      klargjoring: KLARGJORING_KR,
      statidKr,
      vrakpant: false,
    },
  };
}

function buildSharedFossefall(opts) {
  opts = opts || {};
  const finn = Number(opts.finnUtpris != null ? opts.finnUtpris : opts.finn);
  if (!Number.isFinite(finn) || finn <= 0) {
    const grunn = 'finn-utpris mangler';
    return {
      a: skipArm('a', grunn), b: skipArm('b', grunn), ordna: skipArm('ordna', grunn),
      pris_manuelt: true, signal: 'PRIS MANUELT', grunn, engine: 'fossefallSatser',
    };
  }
  const kmMissing = opts.km == null || opts.km === '' || !Number.isFinite(Number(opts.km));
  if (kmMissing) {
    const grunn = 'km mangler';
    return {
      a: skipArm('a', grunn), b: skipArm('b', grunn), ordna: skipArm('ordna', grunn),
      pris_manuelt: true, signal: 'PRIS MANUELT', grunn, engine: 'fossefallSatser',
    };
  }
  const km = Number(opts.km);
  const modelYear = Number(opts.modelYear) || Number(opts.bilInfo && opts.bilInfo.year) || 2020;
  const bilInfo = Object.assign({ year: modelYear }, opts.bilInfo || {});
  const originCapInfo = resolveOriginCap(opts, finn);
  const satser = opts.satser || getFossefallSatser();
  const looked = lookupFossefallCell(satser, roundKr(finn), km);
  if (!looked.ok) {
    const grunn = looked.grunn || 'satser ikke lastet';
    const celleId = celleIdOf(looked);
    const stamp = (profile) => {
      const arm = skipArm(profile, grunn);
      arm.celleId = celleId;
      if (looked.priceId) arm.price_id = looked.priceId;
      if (looked.kmId) arm.km_id = looked.kmId;
      return arm;
    };
    return {
      a: stamp('a'), b: stamp('b'), ordna: stamp('ordna'),
      pris_manuelt: true, signal: 'PRIS MANUELT', grunn, engine: 'fossefallSatser',
      price_id: looked.priceId || null, km_id: looked.kmId || null,
      celleId,
    };
  }

  const soldDays = opts.soldDays || opts.statidDays || [];
  const statid = computeStatid(finn, soldDays);
  const live = opts.statidLive != null ? !!opts.statidLive : statidALive();
  const base = {
    finnUtpris: finn,
    km,
    modelYear,
    bilInfo,
    satser,
    looked,
    originCapInfo,
  };
  const statidKr = live ? statid.kr : 0;
  const aRaw = computeSharedFossefall(Object.assign({}, base, { profile: 'a', statidKr }));
  const bRaw = computeSharedFossefall(Object.assign({}, base, { profile: 'b', statidKr }));
  const oRaw = computeSharedFossefall(Object.assign({}, base, { profile: 'ordna', statidKr }));

  if (aRaw.skip || bRaw.skip || oRaw.skip) {
    const grunn = aRaw.grunn || bRaw.grunn || oRaw.grunn;
    return {
      a: aRaw, b: bRaw, ordna: oRaw,
      pris_manuelt: true, signal: 'PRIS MANUELT', grunn, engine: 'fossefallSatser',
      price_id: looked.priceId || null,
      km_id: looked.kmId || null,
      celleId: celleIdOf(looked) || aRaw.celleId || null,
    };
  }

  // Gulv etter at midt er rundet og lav/høy er midt ± spenn. Ingen ny tusen-runding etter gulvet.
  applyVrakpantGulv(aRaw);
  applyVrakpantGulv(bRaw);
  applyVrakpantGulv(oRaw);

  const lagret = opts.lagret || {};
  const hints = opts.hints || {};
  const a = stripMeta(aRaw);
  const b = stripMeta(bRaw);
  const ordna = stripMeta(oRaw);
  a.avvik_kr = makeAvvik(aRaw, lagret.a, hints.a);
  b.avvik_kr = makeAvvik(bRaw, lagret.b, hints.b);
  ordna.avvik_kr = makeAvvik(oRaw, lagret.ordna, hints.ordna);

  if (opts.debug) {
    a._meta = aRaw._meta;
    b._meta = bRaw._meta;
    ordna._meta = oRaw._meta;
  }

  return {
    a, b, ordna,
    a_statid: null,
    statid_median_days: statid.median_days,
    statid_n_comps: statid.n_comps,
    statid_grunn: statid.grunn,
    statid_manuell: !!statid.manuell,
    statid_kr: live ? (a.statid || 0) : statid.kr,
    statid_a_live: live,
    pris_manuelt: false,
    signal: null,
    grunn: null,
    engine: 'fossefallSatser',
    estimertPeasyBud: a.estimertPeasyBud,
    peasy_bud_mid: a.peasy_bud_mid,
    lav: a.lav,
    hoy: a.hoy,
    price_id: looked.priceId,
    km_id: looked.kmId,
    celleId: looked.cell,
    version: FOSSEFALL_VERSION,
  };
}

function buildLegacyFossefall(opts) {
  opts = opts || {};
  const finn = Number(opts.finnUtpris);
  if (!Number.isFinite(finn) || finn <= 0) {
    return { a: null, b: null, ordna: null };
  }
  const km = Number(opts.km) || 0;
  const modelYear = Number(opts.modelYear) || Number(opts.bilInfo && opts.bilInfo.year) || 2020;
  const bilInfo = Object.assign({ year: modelYear }, opts.bilInfo || {});
  const lagret = opts.lagret || {};
  const hints = opts.hints || {};
  const originCapInfo = resolveOriginCap(opts, finn);

  const aRaw0 = computeA(finn, bilInfo, originCapInfo);
  const bRaw = computeBand(finn, km, modelYear, V3G_RETUR_MULT, 'b', originCapInfo);
  const oRaw = computeBand(finn, km, modelYear, ORDNA_KALKYLE_MULT, 'ordna', originCapInfo);

  const soldDays = opts.soldDays || opts.statidDays || null;
  const statid = computeStatid(finn, soldDays || []);
  const live = opts.statidLive != null ? !!opts.statidLive : statidALive();

  let aRaw = aRaw0;
  if (live && statid.kr) {
    aRaw = applyStatid(aRaw0, statid.kr);
  }

  // Vrakpant-gulv etter alle lag (inkl. Ordna ×0,75): bare løft per arm.
  applyVrakpantGulv(aRaw);
  applyVrakpantGulv(bRaw);
  applyVrakpantGulv(oRaw);

  // Avrunding til hele tusen til slutt (etter ståtid/vrakpant); rest i avrunding-rad (±1000).
  finalizeAvrunding(aRaw);
  finalizeAvrunding(bRaw);
  finalizeAvrunding(oRaw);

  const a = stripMeta(aRaw);
  const b = stripMeta(bRaw);
  const ordna = stripMeta(oRaw);

  a.avvik_kr = makeAvvik(aRaw, lagret.a, hints.a);
  b.avvik_kr = makeAvvik(bRaw, lagret.b, hints.b);
  ordna.avvik_kr = makeAvvik(oRaw, lagret.ordna, hints.ordna);

  // Shadow copy only when NOT live (legacy); when live a already has ståtid
  let a_statid = null;
  if (!live) {
    const aStatidRaw = applyStatid(aRaw0, statid.kr);
    if (aStatidRaw) {
      applyVrakpantGulv(aStatidRaw);
      finalizeAvrunding(aStatidRaw);
    }
    a_statid = aStatidRaw ? stripMeta(aStatidRaw) : null;
    if (a_statid) a_statid.avvik_kr = null;
  }

  if (opts.debug) {
    a._meta = aRaw._meta;
    b._meta = bRaw._meta;
    ordna._meta = oRaw._meta;
  }

  return {
    a,
    b,
    ordna,
    a_statid,
    statid_median_days: statid.median_days,
    statid_n_comps: statid.n_comps,
    statid_grunn: statid.grunn,
    statid_manuell: !!statid.manuell,
    statid_kr: live ? (a.statid || 0) : statid.kr,
    statid_a_live: live,
  };
}

function buildFossefall(opts) {
  opts = opts || {};
  const legacy = buildLegacyFossefall(opts);
  const shared = buildSharedFossefall(opts);
  const live = tablesLive();
  const sharedOk = !!(shared && !shared.pris_manuelt && shared.a && !shared.a.skip && shared.b && !shared.b.skip && shared.ordna && !shared.ordna.skip);
  const grunn = (shared && (shared.grunn || (shared.a && shared.a.grunn))) || '';
  // Hardkodet sti kun når tabellene ikke lot seg laste — aldri når cellen er tom.
  const allowHardcoded = hardcodedFallback() && grunn === 'satser ikke lastet';
  if (live && sharedOk) {
    return Object.assign({}, shared, {
      fossefall_v2: shared,
      fossefall_legacy: legacy,
      tables_live: true,
      engine: 'fossefallSatser',
      pris_manuelt: false,
    });
  }
  if (live && !sharedOk && !allowHardcoded) {
    return {
      a: shared.a,
      b: shared.b,
      ordna: shared.ordna,
      a_statid: null,
      statid_median_days: shared.statid_median_days != null ? shared.statid_median_days : legacy.statid_median_days,
      statid_n_comps: shared.statid_n_comps != null ? shared.statid_n_comps : legacy.statid_n_comps,
      statid_grunn: shared.statid_grunn != null ? shared.statid_grunn : legacy.statid_grunn,
      statid_manuell: shared.statid_manuell != null ? shared.statid_manuell : legacy.statid_manuell,
      statid_kr: shared.statid_kr != null ? shared.statid_kr : legacy.statid_kr,
      statid_a_live: shared.statid_a_live != null ? shared.statid_a_live : legacy.statid_a_live,
      fossefall_v2: shared,
      fossefall_legacy: legacy,
      tables_live: true,
      engine: 'fossefallSatser',
      pris_manuelt: true,
      signal: 'PRIS MANUELT',
      grunn: shared.grunn || (shared.a && shared.a.grunn) || 'PRIS MANUELT',
      price_id: shared.price_id || null,
      km_id: shared.km_id || null,
      celleId: shared.celleId || (shared.a && shared.a.celleId) || null,
      version: FOSSEFALL_VERSION,
    };
  }
  return Object.assign({}, legacy, {
    fossefall_v2: shared,
    tables_live: false,
    engine: live ? 'hardcoded-fallback' : 'hardcoded',
    pris_manuelt: false,
    version: FOSSEFALL_VERSION,
  });
}

module.exports = {
  FOSSEFALL_VERSION,
  PROFILES,
  KLARGJORING_KR,
  CONFIG_URL,
  buildFossefall,
  buildSharedFossefall,
  computeSharedFossefall,
  lookupFossefallCell,
  loadFossefallSatser,
  getFossefallSatser,
  tablesLive,
  sumLag,
  verifyLag,
  computeStatid,
  extractSoldDays,
  applyStatid,
  applyStatidShadow: applyStatid,
  finalizeAvrunding,
  statidALive,
  _internal: {
    computeA,
    computeBand,
    computeStatid,
    extractSoldDays,
    finalizeAvrunding,
    roundKr,
    ORDNA_KALKYLE_MULT,
    V3G_RETUR_MULT,
    buildLegacyFossefall,
    resetSatserCache: function () { _satserCache = { satser: null, fetchedAt: 0, error: null }; },
  },
};
