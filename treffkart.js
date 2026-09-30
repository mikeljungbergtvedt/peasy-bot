'use strict';
// treffkart.js — data til Treffkartet (heatmap: estimat × km → solgt per 100, ja-andel, retur).
// Leser ERP-eksporten (bare lesing). Skriver treffkart.json på Pages med --push. Nattjobb: com.peasy.treffkart (00:05).
// v2: to spørsmål. 1) Er Finn-utprisen riktig? Vår Finn-utpris (jr/dossiers) mot bilens Finn-pris etterpå
//     (søk på reg.nr., bare tapte biler, bare annonser publisert etter estimatet). 2) Er fossefallet riktig? Bud mellom lav og høy.
//   node treffkart.js          vis antall
//   node treffkart.js --push   skriv treffkart.json til Pages

const path = require('path');
const XLSX = require('xlsx');

const VERSJON = 'treffkart v2';
const ERP_XLSX_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';
const GH_REPO = 'mikeljungbergtvedt/mikeljungbergtvedt.github.io';
const GH_FILE = 'treffkart.json';

const fs = require('fs');
const ROOT = process.env.TREFFKART_ROOT || __dirname; // test fra klonen: TREFFKART_ROOT=/Users/bot/peasy-auto
const DOSSIERS = path.join(ROOT, 'jr', 'dossiers');
const FINN_STATE = path.join(ROOT, 'logs.nosync', 'treffkart-finn.json');
const FINN_API = 'https://www.finn.no/mobility/search/api/search/SEARCH_ID_CAR_USED';
const SOK_DAGER = 90;      // tapte biler estimert siste 90 dager søkes
const SOK_PAUSE_MS = 1200;

const dato = (s) => { const m = String(s || '').match(/(\d\d)\.(\d\d)\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// ERP-status → utfall. null = utelates (avvist av admin).
function utfall(st) {
  const s = String(st || '').toLowerCase();
  if (s === 'avvist by admin') return null;
  if (s === 'venter på trans. best.') return 'venter';
  if (s === 'avvist by customer') return 'nei';
  if (s === 'avvist') return 'borte';
  if (s === 'sold' || s === 'sold_and_paid') return 'solgt';
  if (s === 'returned' || s === 'to_be_returned') return 'retur';
  return 'pågår';
}

// Én rad per bil med estimat: [internnr, regnr, estimert, estimat midt, km, utfall, høyeste bud, kilde, bil, lav, høy, vår Finn-utpris, Finn-fasit]
// Finn-fasit = [pris, selger, publisert] eller null.
function radFra(x) {
  const est = dato(x[31]); if (!est) return null;
  const u = utfall(x[12]); if (!u) return null;
  const m = String(x[3] || '').match(/(\d+)\s*-\s*(\d+)/); if (!m) return null;
  const lav = Number(m[1]), hoy = Number(m[2]); if (!lav || !hoy) return null;
  return [x[0], x[1], est, Math.round((lav + hoy) / 2), Number(x[22]) || null, u, Number(x[4]) || null, x[11], [x[6], x[7], x[8]].filter(Boolean).join(' '), lav, hoy, null, null];
}

async function bygg() {
  const r = await fetch(ERP_XLSX_URL);
  if (!r.ok) throw new Error('ERP-eksport ' + r.status);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const b = rows.slice(1).map(radFra).filter(Boolean);
  const fu = finnUtprisMap();
  const st = lesState();
  for (const r of b) {
    r[11] = fu[String(r[0])] || null;
    const f = st[String(r[0])];
    if (f && f.pris) r[12] = [f.pris, f.selger, f.publ];
  }
  return { versjon: VERSJON, bygget: new Date().toISOString(), b };
}

// Vår Finn-utpris per internnr fra botens dossierer (jr/dossiers/<internnr>-<regnr>.json).
function finnUtprisMap() {
  const ut = {};
  let filer = [];
  try { filer = fs.readdirSync(DOSSIERS); } catch (_) { return ut; }
  for (const f of filer) {
    const m = f.match(/^(\d+)-[A-Z0-9]+\.json$/); if (!m) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DOSSIERS, f), 'utf8'));
      const v = d.finn_utpris || (d.origin_comps && d.origin_comps.finn_utpris);
      if (v) ut[m[1]] = Number(v);
    } catch (_) {}
  }
  return ut;
}

function lesState() { try { return JSON.parse(fs.readFileSync(FINN_STATE, 'utf8')); } catch (_) { return {}; } }
function skrivState(s) { fs.mkdirSync(path.dirname(FINN_STATE), { recursive: true }); fs.writeFileSync(FINN_STATE, JSON.stringify(s)); }

// Søk opp tapte biler med vår Finn-utpris på Finn (reg.nr.). Første annonse publisert etter estimatet er fasit.
// Funnet = lagres og søkes ikke igjen. Ikke funnet = søkes igjen neste natt så lenge estimatet er under 90 dager.
async function sokFinn(b) {
  const st = lesState();
  const fra = new Date(Date.now() - SOK_DAGER * 864e5).toISOString().slice(0, 10);
  const fu = finnUtprisMap();
  const ko = b.filter((r) => r[2] >= fra && ['nei', 'borte', 'retur'].includes(r[5]) && fu[String(r[0])] && !(st[String(r[0])] && st[String(r[0])].pris));
  let funnet = 0;
  for (const r of ko) {
    try {
      const j = await (await fetch(FINN_API + '?q=' + encodeURIComponent(r[1]), { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
      const d = (j.docs || []).find((x) => String(x.regno || '').toUpperCase() === String(r[1]).toUpperCase());
      const publ = d && d.timestamp ? new Date(d.timestamp).toISOString().slice(0, 10) : null;
      if (d && publ && publ >= r[2] && d.price && d.price.amount) {
        st[String(r[0])] = { pris: d.price.amount, selger: d.dealer_segment || null, publ, finnkode: d.id, sett: new Date().toISOString() };
        funnet++;
      } else {
        st[String(r[0])] = Object.assign({}, st[String(r[0])] || {}, { sist_sokt: new Date().toISOString() });
      }
    } catch (_) {}
    await new Promise((res) => setTimeout(res, SOK_PAUSE_MS));
  }
  skrivState(st);
  return { sokt: ko.length, funnet };
}


async function pushTilPages(data, token) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;
  const h = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  for (let forsok = 1; ; forsok++) {
    const shaRes = await fetch(url, { headers: h });
    const shaData = shaRes.ok ? await shaRes.json() : {};
    const body = { message: `treffkart ${data.bygget.slice(0, 16)}`, content: Buffer.from(JSON.stringify(data)).toString('base64') };
    if (shaData && shaData.sha) body.sha = shaData.sha;
    const put = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(body) });
    const pd = await put.json();
    if (pd && pd.content) return;
    if (forsok >= 4) throw new Error('push feilet: ' + ((pd && pd.message) || put.status));
    await new Promise((res) => setTimeout(res, 1500 * forsok));
  }
}

module.exports = { VERSJON, utfall, radFra, finnUtprisMap };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), override: true, quiet: true });
  (async () => {
    let d = await bygg();
    if (!process.argv.includes('--uten-sok')) {
      const s = await sokFinn(d.b);
      console.log(`Finn-søk: ${s.sokt} tapte biler søkt, ${s.funnet} nye funnet`);
      d = await bygg();
    }
    console.log(`${new Date().toISOString()} ${VERSJON}: ${d.b.length} biler med estimat, ${d.b.filter((r) => r[12]).length} med Finn-fasit`);
    if (process.argv.includes('--push')) {
      if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN mangler i .env');
      await pushTilPages(d, process.env.GITHUB_TOKEN);
      console.log('treffkart.json skrevet');
    }
  })().catch((e) => { console.error('Feil:', e.message); process.exit(1); });
}
