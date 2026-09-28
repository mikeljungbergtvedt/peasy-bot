'use strict';
// egenvekt.js — bilens egenvekt i kg som tall.
// Før kom egenvekt bare fra elbil.no (bare elbiler, og som tekst «1 540 kg»). Alle andre fikk
// reserveverdien 1 500 kg i omregistreringen. Carinfo i origin_cv har «Egenvekt» for alle biler.

function tallKg(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 300 && v < 10000 ? Math.round(v) : null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 300 && n < 10000 ? n : null;
}

/** Egenvekt fra carinfo-attributtene. values kan være [min, maks] over varianter: bruk laveste. */
function egenvektFraCv(originCv) {
  const at = originCv && originCv.carinfo && Array.isArray(originCv.carinfo.attributes) ? originCv.carinfo.attributes : [];
  for (const a of at) {
    if (!a || String(a.name || '').trim().toLowerCase() !== 'egenvekt') continue;
    const vals = (Array.isArray(a.values) ? a.values : [a.values]).map(tallKg).filter((x) => x != null);
    if (vals.length) return Math.min.apply(null, vals);
  }
  return null;
}

/** Første gyldige: elbil.no-teksten, feltet på origin_cv, carinfo. */
function egenvekt(bilEgenvekt, originCv) {
  return tallKg(bilEgenvekt)
    || tallKg(originCv && (originCv.egenvekt || originCv.weight))
    || egenvektFraCv(originCv);
}

module.exports = { egenvekt, egenvektFraCv, tallKg };
