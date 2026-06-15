// pricing-formula.js
// IDENTISK kopi av peasy-auto (Easy bot) sin pris-formel.
// Vi roerer ikke formelen — vi gir den bare en ny anker som input.
//
// Inputs:
//   anchorPrice — ankerpris fra AI (snitt 3 billigste godkjente comps)
//   km          — kjorelengde
//   modelYear   — aarsmodell
//   lowestComp  — laveste pris blant valgte comps (for comp-cap)
//
// Output: alle mellomtall + endelig Pris Lav / Pris Hoy som selger ville sett.

// Fee-trinn (fra peasy-auto.js CONFIG.fee — bekreftet via sysdok v11.32)
const FEE_TIERS = [
  { maxT: 75000,    fee: 5900 },
  { maxT: 125000,   fee: 7900 },
  { maxT: Infinity, fee: 9900 },
];

// Margin-tabell (fra peasy-auto.js — bekreftet via sysdok v11.32)
const MARGIN_TABLE = [
  { maxAnker: 100000,   min:  8000, maks: 12000, bracket: 'Lav' },
  { maxAnker: 250000,   min: 12000, maks: 22000, bracket: 'Mid' },
  { maxAnker: 400000,   min: 22000, maks: 35000, bracket: 'Hoy' },
  { maxAnker: 600000,   min: 35000, maks: 50000, bracket: 'Premium-Lav' },
  { maxAnker: Infinity, min: 50000, maks: 70000, bracket: 'Premium-Hoy' },
];

// Spread per slitasje-segment
const SPREAD = {
  normal: 0.05,
  highkm: 0.075,
};

// Identifiserer slitasje-segment (samme regel som peasy-auto)
export function identifySegment(km, modelYear) {
  const currentYear = new Date().getFullYear();
  const age = currentYear - (modelYear || currentYear);
  const kmPerYear = age > 0 ? Math.round(km / age) : 0;
  if (km >= 100000 || kmPerYear > 25000) return 'highkm';
  return 'normal';
}

// Hovedformel — direkte port av peasy-auto sin pris-beregning
export function calculatePricing({ anchorPrice, km, modelYear, lowestComp }) {
  // 1. Margin = clamp(12% av anker, min, maks) per bracket
  const mb = MARGIN_TABLE.find(b => anchorPrice <= b.maxAnker);
  const marginRaw = Math.round(anchorPrice * 0.12 / 1000) * 1000;
  const margin = Math.min(mb.maks, Math.max(mb.min, marginRaw));

  // 2. Brutto = anker - margin (het tidligere T i koden, semantisk: Brutto til selger foer fee)
  const brutto = anchorPrice - margin;

  // 3. Peasy fee
  const feeEntry = FEE_TIERS.find(f => brutto < f.maxT);
  const fee = feeEntry.fee;

  // 4. D mid
  const dMid = brutto - fee;

  // 5. Slitasje-segment -> spread
  const segment = identifySegment(km, modelYear);
  const spreadPct = SPREAD[segment];

  const dLavRaw = Math.round(dMid * (1 - spreadPct) / 1000) * 1000;
  let dHoyRaw   = Math.round(dMid * (1 + spreadPct) / 1000) * 1000;

  // 6. Spread-gulv (minimum kr-spread)
  let spread;
  if (dLavRaw < 30000)       spread = 2500;
  else if (dLavRaw < 100000) spread = Math.max(5000, Math.round(dMid * spreadPct / 1000) * 1000);
  else                       spread = Math.round(dMid * spreadPct / 1000) * 1000;

  const dLav = Math.round((dMid - spread) / 1000) * 1000;
  let   dHoy = Math.round((dMid + spread) / 1000) * 1000;

  // 7. Comp-cap fjernet i v2 — v2 bruker realiserte salg, ikke asking. Ren spread fra D mid.
  const compCapApplied = false;
  const compCapFlag = null;

  return {
    anchorPrice,
    bracket: mb.bracket,
    margin,
    brutto,
    fee,
    dMid,
    segment,
    spreadPct,
    spread,
    dLav,
    dHoy,
    lowestComp,
    compCapApplied,
    compCapFlag,
  };
}
