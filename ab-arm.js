// A/B-lodd for live eval.
// Partall internnr = A Easy. Oddetall = B V3G.
// Låst av erpId — re-pris bytter ikke arm.
// Ordna (ERP source=ordna) står utenfor loddet: V3G eier skriv + egen kalkyle.

'use strict';

function isOrdnaSource(source) {
  return String(source || '').trim().toLowerCase() === 'ordna';
}

function armForErpId(erpId) {
  const n = Number(erpId);
  if (!Number.isFinite(n) || n <= 0) return 'A';
  return n % 2 === 0 ? 'A' : 'B';
}

function liveOwner(erpId, source) {
  if (isOrdnaSource(source)) return 'ORDNA';
  return armForErpId(erpId);
}

function isArmB(erpId, source) {
  if (isOrdnaSource(source)) return false;
  return armForErpId(erpId) === 'B';
}

function armLabel(erpId, source) {
  const owner = liveOwner(erpId, source);
  if (owner === 'ORDNA') return 'V3G Ordna';
  return owner === 'B' ? 'B V3G' : 'A Easy';
}

function easyShouldSkipWrite(erpId, source) {
  if (isOrdnaSource(source)) return 'ordna';
  if (isArmB(erpId)) return 'arm-B';
  return null;
}

function v3gShouldWrite(erpId, source) {
  if (isOrdnaSource(source)) return true;
  return isArmB(erpId);
}

function isPositiveKr(n) {
  if (n == null || n === '') return false;
  const x = Number(n);
  return Number.isFinite(x) && x > 0;
}

function writingArmPrices({ erpId, source, easy, v3g } = {}) {
  const owner = liveOwner(erpId, source);
  if (owner === 'B' || owner === 'ORDNA') {
    const inner = (v3g && v3g.v3g) || v3g || {};
    const fu = inner.finn_utpris != null ? inner.finn_utpris : inner.anker;
    const dLav = inner.dLav;
    return { owner, finn_utpris: fu, dLav, ok: isPositiveKr(fu) && isPositiveKr(dLav) };
  }
  const ez = easy || {};
  const fu = ez.finn_utpris != null ? ez.finn_utpris : ez.anker;
  return { owner, finn_utpris: fu, dLav: ez.dLav, ok: isPositiveKr(fu) && isPositiveKr(ez.dLav) };
}

function erpHasPositiveD(carPayload) {
  const car = (carPayload && carPayload.car) || carPayload || {};
  return isPositiveKr(car.price_final_min) || isPositiveKr(car.price_temp_min);
}

module.exports = {
  armForErpId,
  isArmB,
  armLabel,
  isOrdnaSource,
  liveOwner,
  easyShouldSkipWrite,
  v3gShouldWrite,
  isPositiveKr,
  writingArmPrices,
  erpHasPositiveD,
};
