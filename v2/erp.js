// === v2-readonly: ERP-skrivevakt (satt inn av v2-erp-readonly-patch.cjs) ===
// Blokkerer all skriving til ERP. Login + GET slipper gjennom.
// Skru av med env V2_ERP_READONLY=0.
(() => {
  if (globalThis.__v2ErpReadonly) return;
  if (process.env.V2_ERP_READONLY === '0') return;
  globalThis.__v2ErpReadonly = true;
  const _origFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (url, opts = {}) => {
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const u = String(url);
    const isErp = /biladministrasjon\.no/.test(u);
    const isLogin = /\/auth\/login\b/.test(u);
    if (isErp && method !== 'GET' && !isLogin) {
      console.log('[v2-readonly] BLOKKERT ' + method + ' ' + u.split('?')[0]);
      return {
        ok: false, status: 0,
        json: async () => ({ success: false, blocked: true, message: 'v2-readonly: ERP-skriving blokkert' }),
        text: async () => 'v2-readonly: blokkert',
        headers: { get: () => null },
      };
    }
    return _origFetch(url, opts);
  };
  console.log('[v2-readonly] ERP-skriving deaktivert — login + GET tillatt, alle PUT/POST-mutasjoner blokkert');
})();

// erp.js - ERP-laget for Peasy bot (ES module)
// Auto-ekstrahert fra peasy-auto.js
import 'dotenv/config';
import { loadKmCache, getKmForRegnr } from './km-cache.js';

const ERP_BASE = 'https://api.biladministrasjon.no';
const ERP_USER = process.env.ERP_USER;
const ERP_PASS = process.env.ERP_PASS;
let _erpToken = null;
let _erpTokenExpiry = null;

function log(s) { console.log(`[${new Date().toISOString()}] [erp] ${s}`); }
function logErr(ctx, e) { console.error(`[${new Date().toISOString()}] [erp] FEIL [${ctx}]`, e?.message || e); }
function authH(token) { return { Authorization: `Bearer ${token}`, Accept: "application/json" }; }

export async function getErpToken() {
  if (_erpToken && _erpTokenExpiry && new Date() < _erpTokenExpiry) return _erpToken;
  log('ERP: logger inn...');
  const res = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS }),
  });
  const data = await res.json();
  if (!data.success) throw new Error('ERP login feilet: ' + JSON.stringify(data));
  _erpToken = data.data.token.token;
  _erpTokenExpiry = new Date(data.data.token.expires_at);
  log('ERP: innlogget OK');
  return _erpToken;
}

// getListe: IKKE FUNNET
// promoteToListe: IKKE FUNNET
export async function getErpCarDetail(erpId, token) {
  const res = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/peasy/cars/${erpId}`, { headers: authH(token) });
  const data = await res.json();
  return data.data || null;
}

export async function writeToERP(erpId, dLav, dHoy, auctionTypeId, anyDebts, brreg, token) {
  log(`ERP: PUT D lav/hoy + alle felt for bil ${erpId}...`);
  // V2 hardcoded read-only mot ERP — alle skriveoperasjoner returnerer
console.log('[v2-erp-readonly] BLOKKERT writeToERP (kildekode-guard)');
  return false;
  try {
    // Hent encumbrance.id
  const detail = await getErpCarDetail(erpId, token);
    const encumbranceId = detail?.car?.encumbrance?.id || null;
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}.${mm}.${yyyy}`;
    const encumbranceBase = {
      check_date: dateStr,
      comment: '',
      debt_date: dateStr,
      amount: 0,
      account_number: '0',
      reference: '0',
      contact_information: '0',
      contact_person: '',
      any_debts: anyDebts || false,
      checkmark: true,
    };
    if (encumbranceId) encumbranceBase.id = encumbranceId;
    const payload = {
      price_final_min: dLav,
      price_final_max: dHoy,
      auction_price_type_id: auctionTypeId,
      encumbrance: encumbranceBase,
      owners_check_comment: null,
      owners_check_date: dateStr,
      change_status: false,
    };
    const res = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/peasy/processing/update/${erpId}/final_estimate`, {
      method: 'PUT',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) { log(`ERP: bil ${erpId} skrevet OK`); return true; }
    logErr(`writeToERP ${erpId}`, data); return false;
  } catch (err) {
    logErr(`writeToERP ${erpId}`, err); return false;
  }
}

export async function verifyErpStatus(erpId, token) {
  try {
    const res = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/peasy/cars/${erpId}`, { headers: authH(token) });
    const data = await res.json();
    const c = data.data?.car || data.data;
    const dLavHoy = (c.price_final_min > 0 && c.price_final_max > 0);
    return {
      dLavHoy,
      auctionType: (c.auction_price_type_id != null),
      encumbrances: (c.encumbrance?.checkmark === true),
      owners: (c.owners_check_date != null),
      finans: (c.encumbrance?.any_debts === true),
    };
  } catch (e) {
    logErr(`verifyErpStatus ${erpId}`, e);
    return { dLavHoy: false, auctionType: false, encumbrances: false, owners: false, finans: false };
  }
}

export async function postToChat(erpId, evalText, token) {
  // V2 hardcoded read-only mot ERP — alle skriveoperasjoner returnerer
console.log('[v2-erp-readonly] BLOKKERT postToChat (kildekode-guard)');
  return false;
  const checkRes = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/driveno/${erpId}/comments/all`, { headers: authH(token) });
  const checkData = await checkRes.json();
  const existing = Array.isArray(checkData.data) ? checkData.data : [];
  if (existing.some(c => (c.comment || '').includes('BIL TIL ESTIMERING'))) {
    log(`Kommentar: bil ${erpId} har allerede eval-kort — skipper`);
    return false;
  }
  const res = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/driveno/${erpId}/comments`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: evalText }),
  });
  const data = await res.json();
  if (data.success) { log(`Kommentar: postet for bil ${erpId}`); return true; }
  logErr(`postToChat ${erpId}`, data);
  return false;
}

export async function confirmFinalEstimate(erpId, token) {
  // V2 hardcoded read-only mot ERP — alle skriveoperasjoner returnerer
console.log('[v2-erp-readonly] BLOKKERT confirmFinalEstimate (kildekode-guard)');
  return false;
  try {
    const res = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/peasy/processing/update/${erpId}/final_estimate/confirm`, {
      method: 'POST',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.success) { log(`ERP confirm OK for ${erpId}`); return { ok: true }; }
    logErr(`confirmFinalEstimate ${erpId}`, data);
    return { ok: false, errors: data.errors || data.message };
  } catch (e) { logErr(`confirmFinalEstimate ${erpId}`, e); return { ok: false, errors: e.message }; }
}

export async function getListe2() {
  await loadKmCache();
  const token = await getErpToken();
  const res = await fetch(
    `${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/peasy/processing/sd_received?per_page=100`,
    { headers: authH(token) }
    );
  const data = await res.json();
  const raw = data.data?.data?.data || [];
  const biler = raw.map(b => ({
    ...b,
    model_series: b.drive_no_car_data?.model_series || b.driveNoCarData?.model_series || b.model_series || '',
    model_year: b.drive_no_car_data?.model_year || b.driveNoCarData?.model_year || b.model_year || 0,
    mileage: getKmForRegnr(b.registration_number) || b.mileage || 0,
    karosseri_erp: '',
  }));
  log(`ERP: ${biler.length} biler pa liste 2`);
  return biler;
}

export async function getListe3() {
  await loadKmCache();
  log('ERP: henter liste 3...');
  const token = await getErpToken();
  const res = await fetch(
    `${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/peasy/processing/final_estimate?per_page=100`,
    { headers: authH(token) }
    );
  const data = await res.json();
  const raw = data.data?.data?.data || [];
  const biler = raw.map(b => ({
    ...b,
    model_series: b.drive_no_car_data?.model_series || b.driveNoCarData?.model_series || b.model_series || '',
    model_year: b.drive_no_car_data?.model_year || b.driveNoCarData?.model_year || b.model_year || 0,
    mileage: getKmForRegnr(b.registration_number) || b.mileage || 0,
    karosseri_erp: '',
  }));
  log(`ERP: ${biler.length} biler pa liste 3`);
  return biler;
}

export async function promoteToListe3(erpId, token) {
  log(`Liste 2: promoterer bil ${erpId} via API...`);
  try {
    const res = await fetch(`${process.env.ERP_BASE || "https://api.biladministrasjon.no"}/c2b_module/peasy/processing/update/${erpId}/sd_received`, {
      method: 'PUT',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_temp_min: null, price_temp_max: null, purchase_price_estimate_min: null, purchase_price_estimate_max: null, change_status: true }),
    });
    const data = await res.json();
    if (data.success) { log(`Liste 2: bil ${erpId} promotert OK`); return true; }
    logErr(`promoteToListe3 ${erpId}`, data); return false;
  } catch (err) {
    logErr(`promoteToListe3 ${erpId}`, err); return false;
  }
}

export async function maybeWriteToERP(bil, erpId, dLav, dHoy, atid, ad, br, tok) {
  if (!bil || !bil.id) { log("TESTMODUS - hopper over writeToERP"); return false; }
  // V2 hardcoded read-only mot ERP — alle skriveoperasjoner returnerer
console.log('[v2-erp-readonly] BLOKKERT maybeWriteToERP (kildekode-guard)');
  return false;
}

export async function maybeVerifyErp(bil, erpId, tok) {
  if (!bil || !bil.id) return null;
  return verifyErpStatus(erpId, tok);
}

export async function maybePostToChat(bil, erpId, text, tok) {
  if (!bil || !bil.id) { log("TESTMODUS - hopper over postToChat"); return false; }
  return postToChat(erpId, text, tok);
}

export async function maybeGetErpDetail(bil, erpId, tok) {
  if (!bil || !bil.id) return null;
  return getErpCarDetail(erpId, tok);
}
