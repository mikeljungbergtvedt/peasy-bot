'use strict';
// bilfil.js — én bilfil med faste feltnavn, bygd fra ERP-listene (endepunkter), ikke Excel-eksporten.
// Steg 2 i _transit/excel-migrering.md. Bare lesing fra ERP.
//   node bilfil.js                 bygg og skriv logs.nosync/peasy-cars.json
//   node bilfil.js --test          bygg og sammenlign felt for felt mot Excel-eksporten
// Env for test fra klonen: BILFIL_ROOT=/Users/bot/peasy-auto

const fs = require('fs');
const path = require('path');

const VERSJON = 'bilfil v1';
const ROOT = process.env.BILFIL_ROOT || __dirname;
const ERP = 'https://api.biladministrasjon.no';
const UT = path.join(ROOT, 'logs.nosync', 'peasy-cars.json');
const XLSX_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';

// Liste → status slik Excel-eksporten skriver den (kolonne M). rejected deles på status_entity.
const LISTER = {
  sd_received: 'sd_received', final_estimate: 'final_estimate', order_delivery: 'Venter på trans. best.',
  on_the_way: 'waiting_for_transport', car_received: 'received', waiting_for_preparation: 'waiting_for_preparation',
  ready_for_auction: 'ready_for_auction', on_auction: 'on_auction', auction_finished: 'auction_finished',
  wait_for_bid_accept: 'wait_for_bid_accept', wait_for_signing: 'waiting_for_sign_contract', contract_signed: 'contract_signed',
  incomplete_contract: 'incomplete_contract', wait_for_sales_note: 'wait_for_sales_note', sold: 'sold_and_paid', returned: 'returned',
  rejected: null,
};
const AVVIST = { REJECTED_BY_CUSTOMER: 'Avvist by customer', REJECTED_BY_ADMIN: 'Avvist by admin', REJECTED_BY_TIMEOUT: 'Avvist',
  REJECTED: 'Avvist', REJECT_DELIVERY_UNAVAILABLE: 'Utenfor Gire', REJECTED_BY_TAX_GROUP: 'rejected_by_tax_group' };

const num = (v) => (v == null || v === '' ? null : Number(v));
// Tidsstempel → norsk dato (ERP gir UTC). Rene datoer (YYYY-MM-DD) står som de er.
const dag = (v) => {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }) : s.slice(0, 10);
};

async function login() {
  const r = await fetch(ERP + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS }) });
  return (await r.json()).data.token.token;
}

function bil(liste, x) {
  const d = x.drive_no_car_data || {}, u = x.user || {}, m = x.process_milestones || {};
  const se = x.status_entity && x.status_entity.status;
  return {
    id: num(x.id), regnr: x.registration_number || null, kilde: x.source || null, liste,
    status: liste === 'rejected' ? (AVVIST[se] || 'Avvist') : LISTER[liste], erp_status: se || null,
    lav: num(x.price_final_min), hoy: num(x.price_final_max), hoyeste_bud: num(x.highest_bid),
    merke: d.manufacturer_name || x.manufacturer || null, modell: d.model_series || null, aar: num(d.model_year),
    postnr: u.zip || null, sted: u.city || null,
    sd_mottatt: dag(m.sd_created_at), estimert: dag(m.fe_created_at), avvist: dag(m.rejected_at),
    solgt: dag(x.car && x.car.sold_date), hentet_retur: dag(x.collected_at), registrert: dag(x.created_at),
    avvist_grunn_id: num(x.reject_reason_id), avvist_kommentar: x.reject_reason_comment || null,
  };
}

async function bygg() {
  const H = { Authorization: 'Bearer ' + (await login()), Accept: 'application/json' };
  const biler = {}; let kall = 0;
  for (const liste of Object.keys(LISTER)) {
    for (let side = 1; ; side++) {
      const r = await fetch(`${ERP}/c2b_module/peasy/processing/${liste}?per_page=100&page=${side}`, { headers: H }); kall++;
      if (!r.ok) break;
      const d = (await r.json()).data.data;
      for (const x of d.data || []) biler[x.id] = bil(liste, x);
      if (side >= (d.last_page || 1)) break;
    }
  }
  // Nye biler (før egenerklæring) ligger ikke i listene, bare i /cars.
  for (let side = 1; ; side++) {
    const r = await fetch(`${ERP}/c2b_module/peasy/cars?per_page=100&page=${side}`, { headers: H }); kall++;
    if (!r.ok) break;
    const d = (await r.json()).data.data;
    for (const x of d.data || []) if (!biler[x.id]) biler[x.id] = Object.assign(bil('nye', x), { status: 'Nye biler' });
    if (side >= (d.last_page || 1)) break;
  }
  return { versjon: VERSJON, bygget: new Date().toISOString(), kall, biler: Object.values(biler) };
}

// Test: felt for felt mot Excel-eksporten (kolonnene etter posisjon, slik de er i dag).
async function test(fil) {
  const XLSX = require('xlsx');
  const r = await fetch(XLSX_URL);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(1);
  const byId = new Map(fil.biler.map((b) => [String(b.id), b]));
  const xd = (s) => { const m = String(s || '').match(/(\d\d)\.(\d\d)\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const felt = {
    regnr: (x) => String(x[1] || '').toUpperCase(), kilde: (x) => x[11] || null, status: (x) => x[12] || null,
    lav: (x) => { const m = String(x[3] || '').match(/(\d+)\s*-\s*(\d+)/); return m && +m[1] ? +m[1] : null; },
    hoy: (x) => { const m = String(x[3] || '').match(/(\d+)\s*-\s*(\d+)/); return m && +m[2] ? +m[2] : null; },
    hoyeste_bud: (x) => num(x[4]) || null, merke: (x) => (x[6] ? String(x[6]).normalize('NFD').replace(/[\u0300-\u036f]/g, '') : null), aar: (x) => num(x[8]),
    postnr: (x) => (x[9] ? String(x[9]) : null), estimert: (x) => xd(x[31]), solgt: (x) => xd(x[18]),
  };
  const st = {}; for (const k of Object.keys(felt)) st[k] = { like: 0, ulike: 0, eks: [] };
  let mangler = 0;
  for (const x of rows) {
    const b = byId.get(String(x[0])); if (!b) { mangler++; continue; }
    for (const [k, f] of Object.entries(felt)) {
      const a = f(x), c = b[k];
      const cc = k === 'merke' && c ? String(c).normalize('NFD').replace(/[\u0300-\u036f]/g, '') : c;
      const lik = (a == null && (c == null || c === 0)) || String(a).toLowerCase().trim() === String(cc).toLowerCase().trim();
      if (lik) st[k].like++; else { st[k].ulike++; if (st[k].eks.length < 3) st[k].eks.push(`${x[1]}: excel=${a} bilfil=${c}`); }
    }
  }
  return { excel_rader: rows.length, bilfil_biler: fil.biler.length, mangler_i_bilfil: mangler, felt: st };
}

module.exports = { VERSJON, bil, bygg };

if (require.main === module) {
  require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
  (async () => {
    const d = await bygg();
    fs.mkdirSync(path.dirname(UT), { recursive: true });
    fs.writeFileSync(UT, JSON.stringify(d));
    console.log(`${d.bygget} ${VERSJON}: ${d.biler.length} biler, ${d.kall} kall → ${UT}`);
    if (process.argv.includes('--test')) {
      const t = await test(d);
      console.log(`Excel ${t.excel_rader} rader, bilfil ${t.bilfil_biler} biler, ${t.mangler_i_bilfil} Excel-rader mangler i bilfil`);
      for (const [k, s] of Object.entries(t.felt)) console.log(`  ${k.padEnd(12)} like ${String(s.like).padStart(5)}  ulike ${String(s.ulike).padStart(5)}  ${s.eks.join(' | ')}`);
    }
  })().catch((e) => { console.error('Feil:', e.message); process.exit(1); });
}
