'use strict';
/**
 * A/B write split for Easy vs V3G.
 * Even erpId → A (Easy) writes ERP.
 * Odd erpId → B (V3G) writes. Easy skips the PUT and logs «skrives av B».
 * Ordna is not this split — it shares the same midt/spenn labels, and does not write through A or B.
 */

function writeArm(erpId) {
  const n = Number(erpId);
  if (!Number.isFinite(n)) return 'A';
  return Math.abs(Math.trunc(n)) % 2 === 0 ? 'A' : 'B';
}

/**
 * Cache stamp counts as "priced" for skip + pulse venter.
 * A bare ISO string is the pre-fossefall stamp. While tables are live that
 * stamp must not skip the car forever — the QA card was never attached.
 */
function cacheStampComplete(entry, tablesLive) {
  if (!entry) return false;
  if (!tablesLive) return true;
  if (typeof entry !== 'object') return false;
  return !!(entry.fossefallCard && entry.celleId);
}

module.exports = { writeArm, cacheStampComplete };
