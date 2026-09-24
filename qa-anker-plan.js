'use strict';
/**
 * qa-anker-plan.js — v20.156
 * QA → «Sett Finn-pris»: manuell Finn-utpris går gjennom samme fossefall som boten
 * (fossefall.js + satstabellene), med årsmodell og egenvekt så omregistrering blir riktig.
 * Skrivende scenario velges med fossefall-card abArm — samme regel som planErpWrite og Pulse
 * (Ordna → Ordna, alle andre inkl. AutoDB: internnr partall A / oddetall B).
 * v20.156: AutoDB er ikke Ordna (fossefall-card abArm rettet).
 * PRIS MANUELT fra fossefallet → ok:false med grunn. Ingen gammel kalkyle som reserve.
 */
const { buildFossefall, loadFossefallSatser } = require('./fossefall');
const fossefallCard = require('./fossefall-card');

async function planQaAnker(opts) {
  opts = opts || {};
  const anker = Number(opts.anker);
  if (!Number.isFinite(anker) || anker <= 0) return { ok: false, grunn: 'Finn-utpris mangler' };
  if (!opts.satser) {
    try { await loadFossefallSatser(); } catch (_) {}
  }
  const year = Number(opts.year) || 0;
  const egenvekt = Number(opts.egenvekt) || undefined;
  const ctx = {
    finnUtpris: anker,
    km: Number(opts.km) || 0,
    modelYear: year,
    bilInfo: { year: year, egenvekt: egenvekt, isVarebil: !!opts.isVarebil },
    lagret: {},
    hints: { a: { anker_lagret: anker, aar_mangler: !year, egenvekt_mangler: !egenvekt } },
    soldDays: [],
  };
  if (opts.satser) ctx.satser = opts.satser;
  const built = buildFossefall(ctx);
  const card = fossefallCard.cardFromBuilt(built) || built;
  const arm = fossefallCard.abArm(opts.erpId, opts.source);
  if (!card || card.pris_manuelt) {
    return { ok: false, arm: arm, card: card, grunn: (card && card.grunn) || 'PRIS MANUELT' };
  }
  const chosen = card[arm === 'O' ? 'ordna' : (arm === 'B' ? 'b' : 'a')] || {};
  const dLav = Number(chosen.lav);
  const dHoy = Number(chosen.hoy);
  if (!(dLav > 0) || !(dHoy > 0)) {
    return { ok: false, arm: arm, card: card, grunn: 'Lav/høy mangler for ' + arm };
  }
  return { ok: true, arm: arm, card: card, dLav: dLav, dHoy: dHoy, auctionTypeId: dLav <= 35000 ? 2 : 1 };
}

module.exports = { planQaAnker };
