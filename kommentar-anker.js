'use strict';
// kommentar-anker.js — Finn-pris/anker fra eval-kortet («BIL TIL ESTIMERING») i ERP-kommentaren.
// For eldre biler med auksjonsbud som ikke har Finn-utpris i målingene.
// Kortet har hatt flere format: «(Anker = snitt 4 valgte: 96 725 kr …)», «(anker 97k)»,
// «Anker: 123 000 kr» og senere «Finn-pris: 123 000 kr». ERP svarer { data: { comments: [...] } }.
//
// Bare lesing: innlogging + GET /comments/all. Skriver aldri til ERP.
// Hver bil hentes én gang og lagres i logs.nosync/kommentar-anker.json (også «ingen kort»).
// takst-celler.js bruker tallet bare til heatmapet, ikke til median eller forslag.

const fs = require('fs');
const path = require('path');

const ERP_BASE = 'https://api.biladministrasjon.no';
const FIL = path.join(__dirname, 'logs.nosync', 'kommentar-anker.json');
const FRA_DATO = '2025-11-01';
const K = { internnr: 0, regnr: 1, registrert: 13, bud: 19 };

function plate(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase().split(/\s+/)[0] || '';
  return s.replace(/-/g, '');
}
function isoDato(v) {
  const m = String(v == null ? '' : v).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

const KR = '([\\d\\s\\u00a0.]+?)\\s*kr';
const MONSTRE = [
  { felt: 'Finn-pris', re: new RegExp('(?:^|\\n)\\s*Finn-pris:\\s*' + KR) },
  { felt: 'Anker', re: new RegExp('(?:^|\\n)\\s*Anker:\\s*' + KR) },
  { felt: 'Anker snitt', re: new RegExp('\\(Anker = snitt \\d+ valgte:\\s*' + KR) },
  { felt: 'anker k', re: /\(anker (\d+(?:[.,]\d+)?)k\)/i, tusen: true },
];

/** Finn-pris fra ett eval-kort. Første format som treffer (i rekkefølgen over) vinner. */
function ankerFraKort(tekst) {
  const t = String(tekst || '').replace(/<[^>]+>/g, '');
  if (t.indexOf('BIL TIL ESTIMERING') < 0) return null;
  for (const m of MONSTRE) {
    const hit = t.match(m.re);
    if (!hit) continue;
    const n = m.tusen
      ? Math.round(Number(hit[1].replace(',', '.')) * 1000)
      : Number(hit[1].replace(/[\s\u00a0.]/g, ''));
    if (Number.isFinite(n) && n > 0) return { anker: n, felt: m.felt };
  }
  return null;
}

/** ERP: { data: { comments: [...] } }. Tåler også en liste direkte. */
function kommentarListe(svar) {
  const d = svar && svar.data;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.comments)) return d.comments;
  return [];
}

/** Siste eval-kort med tall vinner. */
function ankerFraKommentarer(liste) {
  const arr = Array.isArray(liste) ? liste.slice() : [];
  arr.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  let ut = null;
  for (const c of arr) {
    const a = ankerFraKort(c && c.comment);
    if (a) ut = Object.assign(a, { dato: c.created_at ? String(c.created_at).slice(0, 10) : null });
  }
  return ut;
}

function lesCache(fil) {
  try { return JSON.parse(fs.readFileSync(fil || FIL, 'utf8')) || {}; } catch (e) { return {}; }
}
function skrivCache(obj, fil) {
  const f = fil || FIL;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f);
}

async function loggInn() {
  const res = await fetch(ERP_BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS }),
  });
  const d = await res.json();
  if (!d || !d.success) throw new Error('ERP-innlogging feilet');
  return d.data.token.token;
}

/**
 * Hent kort for biler med bud fra FRA_DATO som mangler i cachen.
 * hopp(reg) → true for biler som allerede har Finn-utpris i målingene (trenger ikke kommentaren).
 */
async function oppdaterKommentarAnker({ rows, hopp, getToken, maks = 400, pauseMs = 250, fil, log } = {}) {
  const L = log || console.log;
  const cache = lesCache(fil);
  const kandidater = [];
  for (const r of rows || []) {
    if (!Array.isArray(r) || !(Number(r[K.bud]) > 0)) continue;
    const reg = plate(r[K.regnr]);
    const inr = r[K.internnr];
    if (!reg || inr == null || inr === '') continue;
    const d = isoDato(r[K.registrert]);
    if (d && d < FRA_DATO) continue;
    if (cache[reg]) continue;
    if (hopp && hopp(reg)) continue;
    kandidater.push({ reg, inr: String(inr) });
  }
  if (!kandidater.length) return { hentet: 0, funnet: 0, igjen: 0 };
  const tok = getToken ? await getToken() : await loggInn();
  let hentet = 0, funnet = 0;
  for (const k of kandidater.slice(0, maks)) {
    let res;
    try {
      res = await fetch(`${ERP_BASE}/c2b_module/driveno/${encodeURIComponent(k.inr)}/comments/all`, {
        headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
      });
    } catch (e) { break; }
    if (res.status === 401 || res.status === 403) { L('kommentar-anker: ERP sier nei (' + res.status + ') — stopper'); break; }
    if (!res.ok) { await new Promise((r) => setTimeout(r, pauseMs)); continue; }
    const d = await res.json().catch(() => null);
    const a = ankerFraKommentarer(kommentarListe(d));
    cache[k.reg] = a ? Object.assign({ internnr: k.inr }, a) : { internnr: k.inr, ingen: true };
    hentet++;
    if (a) funnet++;
    if (hentet % 25 === 0) skrivCache(cache, fil);
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  skrivCache(cache, fil);
  return { hentet, funnet, igjen: Math.max(0, kandidater.length - hentet) };
}

module.exports = { ankerFraKort, ankerFraKommentarer, kommentarListe, oppdaterKommentarAnker, lesCache, FIL };
