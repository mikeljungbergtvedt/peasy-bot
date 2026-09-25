'use strict';
// statid-forslag.js — ståtid-forslag fra carinfo-annonser (origin_cv.carinfo.valuation).
// Kilde: Finn-annonser for samme modell (same_car = 1), med publisert dato, salgsdato og lenke.
// Solgte teller med salgstid (days). Aktive (ikke solgt, ikke fjernet) teller med alder på målingstidspunktet.
// Samme sats som fossefall.computeStatid: dager over 15 (tak 45) × 0,33 % av Finn-utpris per dag (200–1 500 kr).
// Forslaget trekkes ALDRI automatisk. Det vises i QA, og bare et menneske kan legge det på (qa/anker statidKr).

const MIN_COMPS = 3;
const NULLPUNKT = 15;
const TAK = 45;
const SATS = 0.0033;
const MIN_PER_DAG = 200;
const MAKS_PER_DAG = 1500;

const plate = (v) => String(v == null ? '' : v).toUpperCase().replace(/[\s-]/g, '');
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function dato(v) {
  const t = Date.parse(String(v || '').slice(0, 10));
  return Number.isFinite(t) ? t : null;
}

/**
 * originCv: målingens origin_cv. regnr: bilen selv (utelates). finn: Finn-utpris. maalt: ISO-tid for målingen.
 */
function statidForslag({ originCv, regnr, finn, maalt } = {}) {
  const v = originCv && originCv.carinfo && originCv.carinfo.valuation;
  const ads = v ? [].concat(v.company_classifieds || [], v.private_classifieds || []) : [];
  const egen = plate(regnr);
  const naa = dato(maalt) || Date.now();
  const kilder = [];
  for (const a of ads) {
    if (!a || Number(a.same_car) !== 1) continue;
    if (egen && plate(a.licence_plate) === egen) continue;
    const pub = dato(a.classified_published_date);
    if (a.ca_sold_date) {
      const d = Number(a.days);
      if (!Number.isFinite(d) || d < 0) continue;
      kilder.push({ status: 'solgt', dager: Math.round(d), pris: Number(a.classified_price) || null, km: Number(a.mileage_km) || null, publisert: a.classified_published_date || null, solgt: a.ca_sold_date, url: a.classified_url || null });
    } else if (!a.classified_removed_date && pub) {
      const d = Math.round((naa - pub) / 86400000);
      if (d < 0) continue;
      kilder.push({ status: 'aktiv', dager: d, pris: Number(a.classified_price) || null, km: Number(a.mileage_km) || null, publisert: a.classified_published_date, solgt: null, url: a.classified_url || null });
    }
  }
  const nSolgt = kilder.filter((k) => k.status === 'solgt').length;
  const nAktive = kilder.length - nSolgt;
  const ut = { kr: 0, median_dager: null, n_solgt: nSolgt, n_aktive: nAktive, tellende_dager: 0, kr_per_dag: null, grunn: null, kilde: 'carinfo', regel: `min ${MIN_COMPS} comps · dager over ${NULLPUNKT} (tak ${TAK}) × 0,33 % av Finn-utpris per dag` };
  if (kilder.length < MIN_COMPS) { ut.grunn = `for få comps (${kilder.length})`; ut.kilder = kilder; return ut; }
  const med = median(kilder.map((k) => k.dager));
  const tellende = Math.max(0, Math.min(med, TAK) - NULLPUNKT);
  let perDag = SATS * Number(finn);
  if (!Number.isFinite(perDag)) perDag = MIN_PER_DAG;
  perDag = Math.max(MIN_PER_DAG, Math.min(MAKS_PER_DAG, perDag));
  const kr = tellende > 0 ? -Math.round((tellende * perDag) / 100) * 100 : 0;
  ut.kr = kr;
  ut.median_dager = Math.round(med * 10) / 10;
  ut.tellende_dager = tellende;
  ut.kr_per_dag = Math.round(perDag);
  if (!tellende) ut.grunn = `selges raskt (median ${ut.median_dager} d ≤ ${NULLPUNKT})`;
  // lengste liggetid først, maks 10 kilder i målingen
  ut.kilder = kilder.sort((a, b) => b.dager - a.dager).slice(0, 10);
  return ut;
}

module.exports = { statidForslag, MIN_COMPS };
