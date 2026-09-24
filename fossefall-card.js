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
  const live = built.tables_live && built.a && !built.pris_manuelt ? built : null;
  const legacyOk = !built.tables_live && built.a && built.a.lav != null
    && built.engine && String(built.engine).indexOf('hardcoded') === 0;
  const src = live || (legacyOk ? built : null) || tables;
  if (!src || !src.a) return null;
  const celleId = celleOf(src) || (legacyOk ? ('hardcoded|' + (built.version || 'legacy')) : null);
  const engine = (live && built.engine) || (legacyOk && built.engine) || (tables && tables.engine) || 'fossefallSatser';
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

function roundKr(n) {
  return Math.round(Number(n) / 1000) * 1000;
}

function midOf(arm) {
  if (!arm) return null;
  const m = arm.peasy_bud_mid != null ? arm.peasy_bud_mid : arm.estimertPeasyBud;
  const n = Number(m);
  return Number.isFinite(n) ? n : null;
}

/** Locked scale: midt A; B = A×0.9; Ordna = A×0.75; lav/høy per midt. */
function scaledArmsOk(card) {
  if (!card || !card.a || !card.b || !card.ordna) return false;
  const midA = midOf(card.a);
  const midB = midOf(card.b);
  const midO = midOf(card.ordna);
  if (midA == null || midB == null || midO == null) return false;
  const gulv = 3000;
  const expectB = roundKr(midA * 0.9);
  const expectO = roundKr(midA * 0.75);
  // Vrakpant may clamp midt to ≥3000 after scale.
  if (!(midB === expectB || (expectB < gulv && midB === gulv))) return false;
  if (!(midO === expectO || (expectO < gulv && midO === gulv))) return false;
  if (card.a.lav == null || card.a.hoy == null) return false;
  if (card.b.lav == null || card.b.hoy == null) return false;
  if (card.ordna.lav == null || card.ordna.hoy == null) return false;
  if (card.a.skip || card.b.skip || card.ordna.skip) return false;
  // Columns must differ when A midt is large enough that ×0.9 / ×0.75 round apart above gulv.
  if (midA >= 20000 && (midA === midB || midA === midO || midB === midO)) return false;
  return true;
}

function armOkBasic(a) {
  if (!a) return false;
  const mid = midOf(a);
  if (mid == null) return false;
  if (a.lav == null || a.hoy == null) return false;
  if (a.skip) return false;
  return true;
}

function isCompleteCard(card) {
  if (!card || !card.a || !card.b || !card.ordna) return false;
  const eng = String(card.engine || '');
  if (eng.indexOf('hardcoded') === 0) {
    return armOkBasic(card.a) && armOkBasic(card.b) && armOkBasic(card.ordna);
  }
  if (card.engine && card.engine !== 'fossefallSatser') return false;
  if (card.pris_manuelt) return !!(card.celleId || card.grunn);
  if (!card.celleId) return false;
  if (!scaledArmsOk(card)) return false;
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
  return label + ': Peasy-bud midt ' + kr(mid) + '  lav ' + kr(arm.lav) + '  høy ' + kr(arm.hoy);
}

function formatFossefallBlock(card) {
  const lines = ['FOSSEFALL'];
  if (!card) {
    lines.push('Fossefall mangler');
    return lines.join('\n');
  }
  lines.push('Motor: ' + (card.engine || '–') + (card.tables_live ? ' (live)' : ''));
  lines.push('Peasy-bud midt: ' + kr(card.peasy_bud_mid));
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
  const eng = String(entry.engine || '');
  if (eng.indexOf('hardcoded') === 0) {
    return !!(entry.tables_path || entry.celleId);
  }
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
  if (card && card.tables_live) {
    const aLav = chosen && chosen.lav != null ? Number(chosen.lav) : Number(card.a && card.a.lav);
    const aHoy = chosen && chosen.hoy != null ? Number(chosen.hoy) : Number(card.a && card.a.hoy);
    if (Number.isFinite(aLav) && Number.isFinite(aHoy)) {
      return {
        arm: 'A',
        writeErp: true,
        publishCard: publishCard,
        reason: 'ERP: skrives av A',
        dLav: aLav,
        dHoy: aHoy,
      };
    }
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
