'use strict';
// bilfil.js — én bilfil med faste feltnavn, bygd fra ERP-listene (endepunkter), ikke Excel-eksporten.
// Steg 2 i _transit/excel-migrering.md. Bare lesing fra ERP.
//   node bilfil.js                 bygg og skriv logs.nosync/peasy-cars.json
//   node bilfil.js --test          bygg og sammenlign felt for felt mot Excel-eksporten
//   node bilfil.js --push          bygg og skriv peasy-cars.json til Pages (Pulse leser den)
//   node bilfil.js --push --hvis-nye   bare hvis det har kommet webhook-hendelser siden forrige bygging (launchd hvert 5. min)
// Env for test fra klonen: BILFIL_ROOT=/Users/bot/peasy-auto

const fs = require('fs');
const path = require('path');

const VERSJON = 'bilfil v2';
const ROOT = process.env.BILFIL_ROOT || __dirname;
const ERP = 'https://api.biladministrasjon.no';
const UT = path.join(ROOT, 'logs.nosync', 'peasy-cars.json');
const HENDELSER = path.join(ROOT, 'logs.nosync', 'erp-webhook-events.jsonl');
const GH_REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const GH_FILE = 'peasy-cars.json';
const BERIK = path.join(ROOT, 'logs.nosync', 'bilfil-berik.json');
// Antall cars/{id}-kall per kjøring. Første gang fylles alle biler over flere kjøringer (launchd hvert 5. min).
const MAX_BERIK = Number(process.env.BILFIL_MAX_BERIK || 200);
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
  const no = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); // cars/{id} skriver «dd.mm.yyyy hh:mm» (norsk tid)
  if (no) return `${no[3]}-${no[2]}-${no[1]}`;
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
    finans: !!(x.encumbrance && x.encumbrance.any_debts), // Excel skriver FALSE også når heftelsessjekk mangler
  };
}

// Felt som bare finnes i cars/{id} (ikke i listene). Testet mot Excel 01.10:
//   T Bud = processing_bid.highest_bid (forhandlerbud; listefeltet highest_bid er E = bud − avgift). Returnerte biler: sale_reaction_story.
//   U Avgift = processing_bid.commission (ikke owners[0].car.commission). W KM = mileage. F Finans = encumbrance.any_debts.
//   Datoene fra hendelsesloggen (car.log). Nyere biler har ikke process_milestones, eldre har den som reserve:
//   P Gire bestilt = siste order_delivery.success / status AR_CAR_CREATED, Q Levere selv = siste order_delivery.self,
//   R Mottatt = første status RECEIVED, V Returnert = returned_at / TO_BE_RETURNED.
// Det vi trenger fra cars/{id}, lagret kompakt i bilfil-berik.json så reglene kan endres uten nye kall.
function berikRaw(c) {
  const pb = (c.car && c.car.processing_bid) || {}, m = c.process_milestones || {};
  const relevant = /^(order_delivery\.(success|self)|status\.changed)$/;
  return {
    km: num(c.mileage), selv: c.self_delivery === true, gjeld: !!(c.encumbrance && c.encumbrance.any_debts),
    bud: num(pb.highest_bid), avgift: num(pb.commission),
    story: ((c.car && c.car.sale_reaction_story) || []).filter((x) => num(x.highest_bid)).map((x) => [num(x.highest_bid), num(x.commission)]),
    ms: { otw: m.on_the_way || null, mottatt: m.car_received_at || null, retur: m.returned_at || null },
    log: (Array.isArray(c.log) ? c.log : []).filter((l) => relevant.test(l.event)).map((l) => [l.created_at, l.event, (l.data && l.data.status) || null]),
  };
}

function berikFelt(r, liste) {
  const avvist = liste === 'rejected';
  const siste = (f) => { const l = r.log.filter(f).pop(); return l ? dag(l[0]) : null; };
  const forste = (f) => { const l = r.log.find(f); return l ? dag(l[0]) : null; };
  const status = (st) => (l) => l[1] === 'status.changed' && l[2] === st;
  const sb = r.story.length ? r.story[r.story.length - 1] : [];
  return {
    bud: r.bud || sb[0] || null, avgift: r.avgift || sb[1] || null, km: r.km || null, finans: r.gjeld,
    // Avviste biler: Excel følger egne regler for P/Q (tomt eller siste bestilling). Vi lar dem stå tomme.
    gire_bestilt: r.selv || avvist ? null : (siste((l) => l[1] === 'order_delivery.success') || siste(status('AR_CAR_CREATED')) || dag(r.ms.otw)),
    levere_selv: !r.selv || avvist ? null : (siste((l) => l[1] === 'order_delivery.self') || dag(r.ms.otw)),
    mottatt: forste(status('RECEIVED')) || dag(r.ms.mottatt),
    // V = returned_at (tidspunktet bilen ble satt til retur), ellers siste TO_BE_RETURNED / RETURNED i loggen.
    returnert: dag(r.ms.retur) || siste(status('TO_BE_RETURNED')) || siste(status('RETURNED')),
  };
}

function lesJson(f, tom) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return tom; } }

// carId med webhook-hendelser etter tidspunktet t (ISO).
function bilerMedHendelser(t) {
  const ids = new Set();
  let txt = ''; try { txt = fs.readFileSync(HENDELSER, 'utf8'); } catch (_) { return ids; }
  for (const l of txt.split('\n')) {
    if (!l) continue;
    try { const e = JSON.parse(l); if (e.ts > t && e.data && e.data.carId != null) ids.add(String(e.data.carId)); } catch (_) {}
  }
  return ids;
}

// Henter cars/{id} for biler som mangler, har byttet liste, eller har fått hendelser siden sist. Høyst MAX_BERIK per kjøring.
async function berik(biler, H) {
  const cache = lesJson(BERIK, {});
  const forrige = Object.values(cache).reduce((a, x) => (x.hentet > a ? x.hentet : a), '');
  const hendelser = forrige ? bilerMedHendelser(forrige) : new Set();
  const trenger = Object.values(biler).filter((b) => { const c = cache[b.id]; return !c || !c.raw || c.liste !== b.liste || hendelser.has(String(b.id)); });
  const jobb = trenger.sort((a, b) => b.id - a.id).slice(0, MAX_BERIK); // nyeste først
  let kall = 0, feil = 0;
  for (let i = 0; i < jobb.length; i += 4) {
    await Promise.all(jobb.slice(i, i + 4).map(async (b) => {
      try {
        const r = await fetch(`${ERP}/c2b_module/peasy/cars/${b.id}`, { headers: H }); kall++;
        if (!r.ok) { feil++; return; }
        const c = ((await r.json()).data || {}).car;
        if (c) cache[b.id] = { liste: b.liste, hentet: new Date().toISOString(), raw: berikRaw(c) };
      } catch (_) { feil++; }
    }));
  }
  fs.mkdirSync(path.dirname(BERIK), { recursive: true });
  fs.writeFileSync(BERIK, JSON.stringify(cache));
  for (const b of Object.values(biler)) if (cache[b.id] && cache[b.id].raw) Object.assign(b, berikFelt(cache[b.id].raw, b.liste));
  return { kall, feil, mangler: Math.max(0, trenger.length - jobb.length) };
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
  const b = process.argv.includes('--uten-berik') ? { kall: 0, feil: 0, mangler: null } : await berik(biler, H);
  return { versjon: VERSJON, bygget: new Date().toISOString(), kall: kall + b.kall, berik_feil: b.feil, berik_mangler: b.mangler, biler: Object.values(biler) };
}

// Test: felt for felt mot Excel-eksporten (kolonnene etter posisjon, slik de er i dag).
async function test(fil) {
  const XLSX = require('xlsx');
  const r = await fetch(XLSX_URL);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const alle = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const hode = (alle[0] || []).map((x) => String(x).trim());
  const kol = (n) => hode.indexOf(n);
  const rows = alle.slice(1);
  const byId = new Map(fil.biler.map((b) => [String(b.id), b]));
  const xd = (s) => { const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
  const felt = {
    regnr: (x) => String(x[1] || '').toUpperCase(), kilde: (x) => x[11] || null, status: (x) => x[12] || null,
    lav: (x) => { const m = String(x[3] || '').match(/(\d+)\s*-\s*(\d+)/); return m && +m[1] ? +m[1] : null; },
    hoy: (x) => { const m = String(x[3] || '').match(/(\d+)\s*-\s*(\d+)/); return m && +m[2] ? +m[2] : null; },
    hoyeste_bud: (x) => num(x[4]) || null, merke: (x) => (x[6] ? String(x[6]).normalize('NFD').replace(/[\u0300-\u036f]/g, '') : null), aar: (x) => num(x[8]),
    postnr: (x) => (x[9] ? String(x[9]) : null), estimert: (x) => xd(x[31]), solgt: (x) => xd(x[18]),
    // v2: felt fra cars/{id} og encumbrance, mot Excel etter kolonnenavn
    finans: (x) => { const v = String(x[kol('Finans')] == null ? '' : x[kol('Finans')]).toUpperCase(); return v === 'TRUE' ? true : v === 'FALSE' ? false : null; },
    bud: (x) => num(String(x[kol('Bud')] || '').replace(/[\s ]/g, '')) || null,
    avgift: (x) => num(String(x[kol('Avgift')] || '').replace(/[\s ]/g, '')) || null,
    km: (x) => num(String(x[kol('KM')] || '').replace(/[\s ]/g, '')) || null,
    gire_bestilt: (x) => xd(x[kol('Gire bestilt på')]), levere_selv: (x) => xd(x[kol('Levere selv')]),
    mottatt: (x) => xd(x[kol('Mottatt')]), returnert: (x) => xd(x[kol('Returnert på')]),
  };
  const nyeFelt = ['finans', 'bud', 'avgift', 'km', 'gire_bestilt', 'levere_selv', 'mottatt', 'returnert'];
  const st = {}; for (const k of Object.keys(felt)) st[k] = { like: 0, ulike: 0, eks: [] };
  let mangler = 0;
  for (const x of rows) {
    const b = byId.get(String(x[0])); if (!b) { mangler++; continue; }
    for (const [k, f] of Object.entries(felt)) {
      if (nyeFelt.includes(k) && k !== 'finans' && !('bud' in b)) continue; // bilen er ikke beriket ennå
      const a = f(x), c = b[k];
      const cc = k === 'merke' && c ? String(c).normalize('NFD').replace(/[\u0300-\u036f]/g, '') : c;
      const lik = (a == null && (c == null || c === 0)) || String(a).toLowerCase().trim() === String(cc).toLowerCase().trim();
      if (lik) st[k].like++; else { st[k].ulike++; if (st[k].eks.length < 3) st[k].eks.push(`${x[1]}: excel=${a} bilfil=${c}`); }
    }
  }
  return { excel_rader: rows.length, bilfil_biler: fil.biler.length, mangler_i_bilfil: mangler, felt: st };
}

async function pushTilPages(data, token) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
  const h = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  for (let forsok = 1; ; forsok++) {
    const shaRes = await fetch(url, { headers: h });
    const shaData = shaRes.ok ? await shaRes.json() : {};
    const body = { message: `bilfil ${data.bygget.slice(0, 16)}`, content: Buffer.from(JSON.stringify(data)).toString('base64') };
    if (shaData && shaData.sha) body.sha = shaData.sha;
    const put = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(body) });
    const pd = await put.json();
    if (pd && pd.content) return;
    if (forsok >= 4) throw new Error('push feilet: ' + ((pd && pd.message) || put.status));
    await new Promise((r) => setTimeout(r, 1500 * forsok));
  }
}

// Har det kommet webhook-hendelser siden bilfilen sist ble bygget?
function nyeHendelser() {
  try { return fs.statSync(HENDELSER).mtimeMs > fs.statSync(UT).mtimeMs; } catch (_) { return true; }
}

module.exports = { VERSJON, bil, bygg };

if (require.main === module) {
  require('dotenv').config({ path: path.join(ROOT, '.env'), override: true, quiet: true });
  (async () => {
    // Kjør også når berikelsen ikke er ferdig (første fylling går over flere kjøringer).
    const ferdig = (lesJson(UT, {}).berik_mangler || 0) === 0;
    if (process.argv.includes('--hvis-nye') && !nyeHendelser() && ferdig) return;
    const d = await bygg();
    fs.mkdirSync(path.dirname(UT), { recursive: true });
    fs.writeFileSync(UT, JSON.stringify(d));
    console.log(`${d.bygget} ${VERSJON}: ${d.biler.length} biler, ${d.kall} kall, berik feil ${d.berik_feil}, mangler ${d.berik_mangler} → ${UT}`);
    if (process.argv.includes('--push')) {
      if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN mangler i .env');
      await pushTilPages(d, process.env.GITHUB_TOKEN);
      console.log('peasy-cars.json skrevet');
    }
    if (process.argv.includes('--test')) {
      const t = await test(d);
      console.log(`Excel ${t.excel_rader} rader, bilfil ${t.bilfil_biler} biler, ${t.mangler_i_bilfil} Excel-rader mangler i bilfil`);
      for (const [k, s] of Object.entries(t.felt)) console.log(`  ${k.padEnd(12)} like ${String(s.like).padStart(5)}  ulike ${String(s.ulike).padStart(5)}  ${s.eks.join(' | ')}`);
    }
  })().catch((e) => { console.error('Feil:', e.message); process.exit(1); });
}
