'use strict';

/**
 * Jr never writes ERP. Login + GET only.
 * Install once per process. Disable with JR_ERP_READONLY=0 (tests).
 */

const WRITES_ERP = false;

function installErpReadonly(fetchImpl) {
  if (process.env.JR_ERP_READONLY === '0') return fetchImpl;
  if (fetchImpl && fetchImpl.__jrErpReadonly) return fetchImpl;

  const orig = fetchImpl || globalThis.fetch.bind(globalThis);
  const guarded = async (url, opts = {}) => {
    const method = String((opts && opts.method) || 'GET').toUpperCase();
    const u = String(url);
    const isErp = /biladministrasjon\.no/.test(u);
    const isLogin = /\/auth\/login\b/.test(u);
    if (isErp && method !== 'GET' && !isLogin) {
      return {
        ok: false,
        status: 0,
        json: async () => ({ success: false, blocked: true, writes_erp: WRITES_ERP }),
        text: async () => 'jr-readonly: ERP write blocked',
        headers: { get: () => null },
      };
    }
    return orig(url, opts);
  };
  guarded.__jrErpReadonly = true;
  if (!fetchImpl) globalThis.fetch = guarded;
  return guarded;
}

module.exports = { WRITES_ERP, installErpReadonly };
