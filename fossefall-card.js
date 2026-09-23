'use strict';
/**
 * QA-kort for fossefall.
 * Kortet er tabellmotoren (midt, lav, høy, celle-id, tables path) for A, B og Ordna.
 * Easy-cost (klargjøring 5000) er ikke et komplett kort.
 * Odd erpId: B skriver ERP-bud. Easy publiserer likevel kortet.
 * Cache uten komplett stempel skal ikke hoppe over — da blir bilen stående uten fossefall.
 */
const fs = require('fs');
const path = require('path');
const fossefall = require('./fossefall');

function abArm(erpId, source) {
  const k = String(source || '').toLowerCase();
  if (k === 'ordna' || k === 'autodb') return 'O';
  const n = Number(erpId);
  if (!Number.isFinite(n) || n <= 0) return 'A';
  return n % 2 === 0 ? 'A' : 'B';
}

function armKey(arm) {
  if (arm === 'O') return 'ordna';
  return String(arm || 'A').toLowerCase();
}

function celleOf(src) {
  if (!src) return null;
  return src.celleId || (src.a && src.a.celleId) || null;
}

function cardFromBuilt(built) {
  if (!built) return null;
  const tables = built.fossefall_v2 || null;
  const live = built.tables_live && built.a ? built : null;
  const src = live || tables;
  if (!src || !src.a) return null;
  const celleId = celleOf(src);
  const engine = (live && built.engine) || (tables && tables.engine) || 'fossefallSatser';
  const card = {
    a: src.a,
    b: src.b || null,
    ordna: src.ordna || null,
    pris_manuelt: !!(src.pris_manuelt || built.pris_manuelt),
    signal: src.signal || built.signal || (src.a && src.a.signal) || null,
    grunn: src.grunn || built.grunn || (src.a && src.a.grunn) || null,
    engine: engine,
    tables_live: !!built.tables_live,
    version: fossefall.FOSSEFALL_VERSION,
    celleId: celleId,
    price_id: src.price_id || (src.a && src.a.price_id) || null,
    km_id: src.km_id || (src.a && src.a.km_id) || null,
    estimertPeasyBud: src.estimertPeasyBud != null ? src.estimertPeasyBud : (src.a && src.a.peasy_bud_mid),
    peasy_bud_mid: src.peasy_bud_mid != null ? src.peasy_bud_mid : (src.a && src.a.peasy_bud_mid),
    lav: src.lav != null ? src.lav : (src.a && src.a.lav),
    hoy: src.hoy != null ? src.hoy : (src.a && src.a.hoy),
    statid_manuell: src.statid_manuell,
    statid_median_days: src.statid_median_days,
    statid_n_comps: src.statid_n_comps,
    statid_grunn: src.statid_grunn,
    statid_kr: src.statid_kr,
    statid_a_live: src.statid_a_live,
  };
  card.tables_path = engine + ':' + (celleId || '—');
  return card;
}

function sameBand(left, right) {
  if (!left || !right) return false;
  return left.peasy_bud_mid === right.peasy_bud_mid
    && left.lav === right.lav
    && left.hoy === right.hoy;
}

function isCompleteCard(card) {
  if (!card || !card.a || !card.b || !card.ordna) return false;
  if (card.engine && card.engine !== 'fossefallSatser') return false;
  if (card.pris_manuelt) return !!(card.celleId || card.grunn);
  if (card.a.peasy_bud_mid == null || card.a.lav == null || card.a.hoy == null) return false;
  if (!card.celleId) return false;
  if (!sameBand(card.a, card.b) || !sameBand(card.b, card.ordna)) return false;
  if (Math.abs(Number(card.a.klargjoring)) !== 1000) return false;
  if (Math.abs(Number(card.b.klargjoring)) !== 1000) return false;
  if (Math.abs(Number(card.ordna.klargjoring)) !== 1000) return false;
  return true;
}

function kr(n) {
  if (n == null || n === '') return '–';
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x).toLocaleString('nb-NO') : '–';
}

function armLine(label, arm) {
  if (!arm) return label + ': –';
  const mid = arm.peasy_bud_mid != null ? arm.peasy_bud_mid : arm.estimertPeasyBud;
  return label + ': midt ' + kr(mid) + '  lav ' + kr(arm.lav) + '  høy ' + kr(arm.hoy);
}

function formatFossefallBlock(card) {
  const lines = ['FOSSEFALL'];
  if (!card) {
    lines.push('Fossefall mangler');
    return lines.join('\n');
  }
  lines.push('Motor: ' + (card.engine || '–') + (card.tables_live ? ' (live)' : ''));
  lines.push('Midt: ' + kr(card.peasy_bud_mid));
  lines.push('Lav: ' + kr(card.lav));
  lines.push('Høy: ' + kr(card.hoy));
  lines.push('Celle-id: ' + (card.celleId || '–'));
  lines.push('Tables path: ' + (card.tables_path || '–'));
  if (card.pris_manuelt) lines.push('PRIS MANUELT' + (card.grunn ? ' — ' + card.grunn : ''));
  lines.push(armLine('A', card.a));
  lines.push(armLine('B', card.b));
  lines.push(armLine('Ordna', card.ordna));
  const klarg = card.a && card.a.klargjoring;
  if (klarg != null && !card.pris_manuelt) lines.push('Klargjøring: ' + kr(klarg));
  return lines.join('\n');
}

function cacheStamp(card) {
  return {
    at: new Date().toISOString(),
    fossefall: fossefall.FOSSEFALL_VERSION,
    celleId: card && (card.celleId || null),
    engine: card && card.engine || null,
    tables_path: card && card.tables_path || null,
    grunn: card && card.grunn || null,
    complete: isCompleteCard(card),
    pris_manuelt: !!(card && card.pris_manuelt),
  };
}

function cacheSkipsReprice(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (entry.complete !== true) return false;
  if (entry.fossefall !== fossefall.FOSSEFALL_VERSION) return false;
  if (entry.engine !== 'fossefallSatser') return false;
  if (!entry.celleId && !entry.pris_manuelt) return false;
  if (!entry.tables_path || entry.tables_path.indexOf('fossefallSatser:') !== 0) return false;
  if (entry.pris_manuelt && String(entry.grunn || '').indexOf('satser ikke lastet') !== -1) return false;
  return true;
}

function planErpWrite(opts) {
  opts = opts || {};
  const card = opts.card || null;
  const arm = abArm(opts.erpId, opts.source);
  const chosen = card && card[armKey(arm)];
  const publishCard = isCompleteCard(card);
  if (card && card.pris_manuelt) {
    return {
      arm: arm,
      writeErp: false,
      publishCard: publishCard,
      reason: 'PRIS MANUELT',
      dLav: null,
      dHoy: null,
    };
  }
  if (arm === 'B' || arm === 'O') {
    return {
      arm: arm,
      writeErp: false,
      publishCard: publishCard,
      reason: arm === 'B' ? 'ERP: skrives av B' : 'ERP: skrives av Ordna',
      dLav: chosen && chosen.lav != null ? chosen.lav : null,
      dHoy: chosen && chosen.hoy != null ? chosen.hoy : null,
    };
  }
  if (card && card.tables_live && Number.isFinite(Number(card.lav)) && Number.isFinite(Number(card.hoy))) {
    return {
      arm: 'A',
      writeErp: true,
      publishCard: publishCard,
      reason: 'ERP: skrives av A',
      dLav: Number(card.lav),
      dHoy: Number(card.hoy),
    };
  }
  const legacyLav = Number(opts.legacyLav);
  const legacyHoy = Number(opts.legacyHoy);
  if (Number.isFinite(legacyLav) && Number.isFinite(legacyHoy)) {
    return {
      arm: 'A',
      writeErp: true,
      publishCard: publishCard,
      reason: 'ERP: skrives av A',
      dLav: legacyLav,
      dHoy: legacyHoy,
    };
  }
  return { arm: arm, writeErp: false, publishCard: publishCard, reason: 'mangler bud', dLav: null, dHoy: null };
}

function measurementFromPass(opts) {
  opts = opts || {};
  const card = opts.card || null;
  const dLav = opts.dLav != null ? opts.dLav : (card && card.lav);
  const dHoy = opts.dHoy != null ? opts.dHoy : (card && card.hoy);
  const easy = {
    anker: opts.anker != null ? opts.anker : null,
    dLav: dLav != null ? dLav : null,
    dHoy: dHoy != null ? dHoy : null,
    finn_utpris: card && card.a ? card.a.finn_utpris : null,
    fossefall: card,
  };
  return {
    evaluator: 'easy',
    writer: 'easy',
    regnr: opts.regnr || null,
    erpId: opts.erpId != null ? opts.erpId : null,
    km: opts.km != null ? opts.km : null,
    timestamp: opts.timestamp || new Date().toISOString(),
    origin_cv: opts.originCv || null,
    easy: easy,
    fossefall: card,
    has_errors: false,
  };
}

function measurementHasCompleteFossefall(record) {
  if (!record || typeof record !== 'object') return false;
  const ff = record.fossefall || (record.easy && record.easy.fossefall) || null;
  return isCompleteCard(ff);
}

function defaultMeasurementsFile() {
  return process.env.PEASY_MEASUREMENTS_FILE
    || path.join(__dirname, 'v2', 'logs.nosync', 'measurements.jsonl');
}

function appendMeasurement(record, file) {
  try {
    const target = file || defaultMeasurementsFile();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, JSON.stringify(record) + '\n');
    return { ok: true, file: target };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  abArm,
  cardFromBuilt,
  isCompleteCard,
  formatFossefallBlock,
  cacheStamp,
  cacheSkipsReprice,
  planErpWrite,
  measurementFromPass,
  measurementHasCompleteFossefall,
  appendMeasurement,
  defaultMeasurementsFile,
};
