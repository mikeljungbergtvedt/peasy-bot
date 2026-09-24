// Felles mal for Peasy dag/uke/måned-analyse
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const XLSX_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';
export const MAIL_TO = process.env.DAILY_REPORT_TO || 'mike@autoringen.no';
export const AR_SALAER = 0.027;
export const SIGNATUR = 'Produsert av Grok Build';

const MEAS_CANDIDATES = [
  process.env.MEAS_FILE,
  '/Users/bot/peasy-auto/v2/logs.nosync/measurements.jsonl',
  path.join(__dirname, 'v2-measurements.jsonl')
].filter(Boolean);
const OVERRIDE_CANDIDATES = [
  process.env.OVERRIDE_FILE,
  '/Users/bot/peasy-auto/easy-overrides.jsonl',
  path.join(__dirname, 'easy-overrides.jsonl')
].filter(Boolean);
const CONFIG_CANDIDATES = [
  process.env.PEASY_CONFIG,
  '/Users/bot/peasy-auto/v2/peasy-config.json',
  path.join(__dirname, 'peasy-config.json')
].filter(Boolean);
const SNAP_CANDIDATES = [
  process.env.DAILY_REPORT_SNAP,
  '/Users/bot/peasy-auto/v2/daily-report-retur-snapshot.json',
  path.join(__dirname, 'daily-report-retur-snapshot.json')
].filter(Boolean);

export const pad = n => (n < 10 ? '0' : '') + n;
export const fmtDate = d => pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
export const fmtKr = n => n == null || !Number.isFinite(n) ? '–' : Math.round(n).toLocaleString('nb-NO') + ' kr';
export const fmtKrPlain = n => n == null || !Number.isFinite(n) ? '–' : Math.round(n).toLocaleString('nb-NO');

export function parseKr(v) {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(String(v).replace(/[\s\u00a0krKR]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

export function feeFromT(t) {
  if (t == null || !Number.isFinite(t)) return null;
  if (t < 75000) return 5900;
  if (t < 125000) return 7900;
  return 9900;
}

export function parseNorwegianDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
}

export function isInRange(s, start, end) {
  const d = parseNorwegianDate(s);
  if (!d) return false;
  return d >= start && d <= end;
}

export function fmtIsoDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function isoToDate(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isIsoInRange(iso, start, end) {
  const d = isoToDate(iso);
  if (!d) return false;
  return d >= start && d <= end;
}

export function isoToNb(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return m[3] + '.' + m[2] + '.' + m[1];
}

export function parseDLavLive(v) {
  if (v == null || v === '' || v === '-') return null;
  const m = String(v).replace(/[\s\u00a0]/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function parseKm(raw) {
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function fmtKm(raw) {
  const n = parseKm(raw);
  return n != null ? n.toLocaleString('nb-NO') + ' km' : '–';
}
export function kmMapFromRows(rows) {
  if (!rows || !rows.length) return {};
  const I = headerIndex(rows[0]);
  const map = {};
  for (const r of rows.slice(1)) {
    const rg = String(r[I['RegNr.']] || '').toUpperCase();
    const n = parseKm(r[I['KM']]);
    if (rg && n != null) map[rg] = n;
  }
  return map;
}

export function internKey(r, I) {
  return String(r[I['Internnr.']] ?? '').trim();
}

export function fmtKilde(s) {
  const k = String(s || '').toLowerCase();
  if (k === 'peasy') return 'Peasy';
  if (k === 'driveno' || k === 'drive') return 'Drive';
  if (k === 'ordna') return 'Ordna';
  return (s && String(s).trim()) ? String(s) : '–';
}

function lookupMeas(intern, regnr, meas) {
  if (intern && meas.byIntern[intern]) return meas.byIntern[intern];
  if (regnr && meas.byReg[regnr]) return meas.byReg[regnr];
  return null;
}
function lookupOverride(intern, regnr, overrides) {
  if (intern && overrides.byIntern[intern]) return overrides.byIntern[intern];
  if (regnr && overrides.byReg[regnr]) return overrides.byReg[regnr];
  return null;
}

export function resolveBot(erpDlav, measRec, override) {
  const ov = override && override.dLav != null ? Number(override.dLav) : null;
  const easy = measRec?.easy?.dLav != null ? Number(measRec.easy.dLav) : null;
  const v3 = measRec?.v2?.dLav != null ? Number(measRec.v2.dLav) : null;
  if (erpDlav != null && ov != null && ov === erpDlav) return 'Easy';
  if (erpDlav != null) {
    const easyHit = easy != null && easy === erpDlav;
    const v3Hit = v3 != null && v3 === erpDlav;
    if (easyHit && !v3Hit) return 'Easy';
    if (v3Hit && !easyHit) return 'V3';
    if (easyHit && v3Hit) return 'Easy';
    if (easy != null || v3 != null) {
      const de = easy != null ? Math.abs(easy - erpDlav) : Infinity;
      const dv = v3 != null ? Math.abs(v3 - erpDlav) : Infinity;
      if (de <= dv && easy != null) return 'Easy';
      if (v3 != null) return 'V3';
    }
  }
  if (ov != null) return 'Easy';
  if (v3 != null) return 'V3';
  if (easy != null) return 'Easy';
  return '–';
}

export function dealFromRow(r, I, meas, overrides, utfall) {
  const rg = String(r[I['RegNr.']] || '').toUpperCase();
  const intern = internKey(r, I);
  const measRec = lookupMeas(intern, rg, meas);
  const ov = lookupOverride(intern, rg, overrides);
  const internForBot = intern || String(measRec && (measRec.erpId ?? measRec.internnr) || '').trim();
  const evalLav = parseDLavLive(r[I['Endelig AR verdi']]);
  const hoyeste = parseKr(r[I['Høyeste bud']]);
  const tBud = parseKr(r[I['Bud']]);
  const avgift = parseKr(r[I['Avgift']]);
  const fee = avgift != null ? avgift : feeFromT(tBud != null ? tBud : hoyeste);
  const krDiff = (evalLav != null && hoyeste != null) ? hoyeste - evalLav : null;
  const pct = (evalLav && hoyeste) ? Math.round(((hoyeste / evalLav) - 1) * 100) : null;
  return {
    regnr: rg, internnr: internForBot || intern,
    merke: r[I['Merke']], modell: r[I['Modell']], aar: r[I['År']],
    kilde: fmtKilde(r[I['Kilde']]),
    bot: botFromIntern(internForBot, r[I['Kilde']]),
    eval_lav: evalLav, bud: hoyeste, t_bud: tBud, avgift, fee,
    kr_diff: krDiff, pct_over_dlav: pct, utfall,
    variant: measRec?.identifikasjon?.variant,
    km: fmtKm(r[I['KM']] ?? measRec?.km),
    dato: dealDato(r, I, utfall)
  };
}

function dealDato(r, I, utfall) {
  const raw = utfall === 'Solgt'
    ? r[I['Solgt på']]
    : (r[I['Returnert på']] || r[I['Gire bestilt på']] || r[I['Levere selv']]);
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) return fmtDate(raw);
  const parsed = parseNorwegianDate(raw);
  if (parsed) return fmtDate(parsed);
  const t = Date.parse(raw);
  return Number.isFinite(t) ? fmtDate(new Date(t)) : String(raw).slice(0, 10);
}

export function headerIndex(H) {
  const idx = {};
  H.forEach((h, i) => { idx[h] = i; });
  return idx;
}

async function readFirstExisting(candidates) {
  for (const p of candidates) {
    try {
      const text = await fs.readFile(p, 'utf8');
      return { path: p, text };
    } catch (e) { /* neste */ }
  }
  return null;
}

export async function fetchXlsx() {
  const res = await fetch(XLSX_URL);
  if (!res.ok) throw new Error('XLSX fetch failed: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
}

export async function loadMeasurements() {
  const found = await readFirstExisting(MEAS_CANDIDATES);
  if (!found) return { byIntern: {}, byReg: {}, path: null, count: 0 };
  const recs = found.text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const byReg = {}; const byIntern = {};
  for (const r of recs) {
    const rg = (r.regnr || '').toUpperCase();
    const intern = String(r.erpId ?? r.internnr ?? '').trim();
    if (rg && (!byReg[rg] || (r.timestamp || '') > (byReg[rg].timestamp || ''))) byReg[rg] = r;
    if (intern && (!byIntern[intern] || (r.timestamp || '') > (byIntern[intern].timestamp || ''))) byIntern[intern] = r;
  }
  return { byIntern, byReg, path: found.path, count: recs.length };
}

export async function loadConfig() {
  const found = await readFirstExisting(CONFIG_CANDIDATES);
  const defaults = { returKost: 2500, prodKostUnder35k: 2250, prodKostOver35k: 2750, gireKost: 750 };
  if (!found) return { ...defaults, path: null };
  try { return { ...defaults, ...JSON.parse(found.text), path: found.path }; } catch (e) { return { ...defaults, path: found.path }; }
}

export async function loadOverrides() {
  const found = await readFirstExisting(OVERRIDE_CANDIDATES);
  if (!found) return { byIntern: {}, byReg: {}, path: null };
  const byReg = {}; const byIntern = {};
  for (const line of found.text.split('\n')) {
    const t = line.trim(); if (!t) continue;
    let r; try { r = JSON.parse(t); } catch (e) { continue; }
    const rg = String(r.regnr || '').toUpperCase();
    const intern = String(r.erpId ?? r.internnr ?? '').trim();
    if (rg) byReg[rg] = r;
    if (intern) byIntern[intern] = r;
  }
  return { byIntern, byReg, path: found.path };
}

export async function loadReturnSnapshot() {
  const found = await readFirstExisting(SNAP_CANDIDATES);
  if (!found) return { keys: new Set(), firstSeen: {}, path: null, existed: false };
  try {
    const j = JSON.parse(found.text);
    const keys = new Set((j.keys || []).map(k => String(k)));
    const rawFs = (j.firstSeen && typeof j.firstSeen === 'object' && !Array.isArray(j.firstSeen)) ? j.firstSeen : {};
    const firstSeen = Object.fromEntries(Object.entries(rawFs).map(([k, v]) => [String(k), String(v)]));
    return { keys, firstSeen, path: found.path, existed: true };
  } catch (e) {
    return { keys: new Set(), firstSeen: {}, path: found.path, existed: false };
  }
}


export function feeFromE(e) {
  if (e == null || e === '') return null;
  const n = typeof e === 'number' ? e : parseInt(String(e).replace(/[\s\u00a0]/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n <= 35000) return 5900;
  if (n <= 75000) return 8900;
  if (n <= 150000) return 9900;
  return 11900;
}

export function beregneSpend(cfg, fraDate, tilDate) {
  let sum = 0;
  for (const p of (cfg && cfg.marketingPerioder) || []) {
    const pFra = new Date(p.fra);
    const pTil = p.til ? new Date(p.til) : new Date();
    const overlapFra = fraDate > pFra ? fraDate : pFra;
    const overlapTil = tilDate < pTil ? tilDate : pTil;
    if (overlapTil > overlapFra) {
      const dager = Math.ceil((overlapTil - overlapFra) / 86400000);
      sum += dager * (Number(p.krPerDag) || 0);
    }
  }
  return sum;
}

export function pulseMoneyFromSettled(soldRows, returRows, I, cfg, from, to) {
  cfg = cfg || {};
  const pkU = Number(cfg.prodKostUnder35k) || 2250;
  const pkO = Number(cfg.prodKostOver35k) || 2750;
  let rk = Number(cfg.returKost);
  if (!Number.isFinite(rk)) rk = 3000;
  const isPeasy = r => String(r[I['Kilde']] || '').trim().toLowerCase() === 'peasy';
  const internOf = r => internKey(r, I);

  const sold = [];
  const seenSold = {};
  for (const r of soldRows || []) {
    if (!isPeasy(r)) continue;
    const id = internOf(r);
    if (id && seenSold[id]) continue;
    if (id) seenSold[id] = true;
    sold.push(r);
  }
  const retur = [];
  const seenRet = {};
  for (const r of returRows || []) {
    if (!isPeasy(r)) continue;
    const id = internOf(r);
    if (id && seenSold[id]) continue;
    if (id && seenRet[id]) continue;
    if (id) seenRet[id] = true;
    retur.push(r);
  }

  let sumProdSold = 0, sumFee = 0, nFee = 0, sumBud = 0, nBud = 0, sumInntekt = 0;
  for (const r of sold) {
    const lav = parseDLavLive(r[I['Endelig AR verdi']]);
    sumProdSold += (lav != null && lav > 35000) ? pkO : pkU;
    const fee = feeFromE(r[I['Høyeste bud']]);
    if (fee) { sumFee += fee; nFee++; }
    const bud = parseInt(String(r[I['Høyeste bud']] == null ? '' : r[I['Høyeste bud']]).replace(/[\s\u00a0]/g, ''), 10);
    if (bud > 0) { sumBud += bud; nBud++; }
    let u = parseInt(String(r[I['Avgift']] == null ? '' : r[I['Avgift']]).replace(/[\s\u00a0]/g, ''), 10);
    if (!(u > 0)) u = fee || 0;
    if (u > 0) sumInntekt += u;
  }

  const nS = sold.length, nR = retur.length;
  const sumRet = nR * rk;
  const sumProd = sumProdSold + sumRet;
  const prodPer = nS > 0 ? Math.round(sumProd / nS) : null;
  const snittFee = nS > 0 ? Math.round(sumInntekt / nS) : (nFee > 0 ? Math.round(sumFee / nFee) : null);
  const spend = (from && to) ? beregneSpend(cfg, from, to) : 0;
  const markedPer = nS > 0 ? Math.round(spend / nS) : null;
  const igjen = (snittFee != null && prodPer != null && markedPer != null) ? (snittFee - prodPer - markedPer) : null;
  const db = sumInntekt - sumProd;

  return {
    solgtN: nS, returN: nR, hentN: 0,
    sumInntekt, sumRet, sumProdSold, sumGire: 0, sumProd, db, igjen,
    returKost: rk, gireKost: 0, spend, snittFee, prodPer, markedPer,
    omsetning: sumBud,
    peasyFee: sumInntekt, noCureTap: sumRet, peasyNetto: db
  };
}

/** Avgjort auksjon: Solgt på / Returnert på. Ingen hent-kost. 0/0 = 0. */
export function pulseMoneyRange(rows, from, to, cfg) {
  const H = rows[0];
  const I = headerIndex(H);
  const peasy = rows.slice(1).filter(r => String(r[I['Kilde']] || '').trim().toLowerCase() === 'peasy');
  const internOf = r => internKey(r, I);
  const inW = d => d && d >= from && d <= to;

  const sold = [];
  const seenSold = {};
  for (const r of peasy) {
    const id = internOf(r);
    if (!inW(parseNorwegianDate(r[I['Solgt på']]))) continue;
    if (id && seenSold[id]) continue;
    if (id) seenSold[id] = true;
    sold.push(r);
  }

  const retur = [];
  const seenRet = {};
  for (const r of peasy) {
    const id = internOf(r);
    if (id && seenSold[id]) continue;
    if (!inW(parseNorwegianDate(r[I['Returnert på']]))) continue;
    if (id && seenRet[id]) continue;
    if (id) seenRet[id] = true;
    retur.push(r);
  }

  return pulseMoneyFromSettled(sold, retur, I, cfg, from, to);
}

export function moneyFromDeals(solgtAnalysis, returAnalysis, cfg) {
  const returKost = (cfg && cfg.returKost) || 2500;
  const omsetning = solgtAnalysis.reduce((s, d) => s + (d.bud || 0), 0);
  const peasyFee = solgtAnalysis.reduce((s, d) => s + (d.fee || 0), 0);
  const arSalaer = Math.round(omsetning * AR_SALAER);
  const noCureTap = returAnalysis.length * returKost;
  return {
    omsetning, arSalaer, peasyFee, noCureTap, returKost,
    returN: returAnalysis.length, solgtN: solgtAnalysis.length,
    peasyNetto: peasyFee - noCureTap
  };
}


function botNorm(b) {
  const s = String(b || '').trim();
  if (!s || s === '–') return 'Ukjent';
  if (/^v3g$/i.test(s) || /^v3$/i.test(s)) return 'V3G';
  if (/^easy$/i.test(s)) return 'Easy';
  return s;
}

function botOrder(a, b) {
  const rank = n => n === 'Easy' ? 0 : n === 'V3G' ? 1 : n === 'Ukjent' ? 9 : 2;
  return rank(a) - rank(b) || a.localeCompare(b);
}

function botSummaryBox(line, winner) {
  return '<p style="background:#f5f5f0;border:1px solid #ddd;padding:8px 10px;font-size:13px;margin:0 0 12px">' +
    line + (winner ? ' · <b>' + winner + '</b>' : '') + '</p>';
}

function botDealSummaryHtml(deals) {
  const bots = {};
  for (const d of deals || []) {
    const b = botNorm(d.bot);
    if (!bots[b]) bots[b] = { solgt: 0, retur: 0 };
    if (d.utfall === 'Solgt') bots[b].solgt++;
    else bots[b].retur++;
  }
  const parts = Object.keys(bots).sort(botOrder).map(n => {
    const t = bots[n].solgt + bots[n].retur;
    const pct = t ? Math.round(bots[n].solgt / t * 100) : 0;
    return { n, solgt: bots[n].solgt, retur: bots[n].retur, t, pct };
  });
  if (!parts.length) return '';
  const ranked = parts.filter(p => p.n !== 'Ukjent' && p.t > 0);
  let winner = '';
  if (ranked.length) {
    const max = Math.max(...ranked.map(p => p.pct));
    const win = ranked.filter(p => p.pct === max);
    winner = win.length === 1
      ? win[0].n + ' leverer best (' + win[0].pct + ' % solgt)'
      : 'Likt (' + max + ' % solgt)';
  }
  const shown = parts.filter(p => p.n !== 'Ukjent');
  const line = shown.map(p => p.n + ' ' + p.solgt + ' solgt / ' + p.retur + ' retur (' + p.pct + ' %)').join(' · ');
  return botSummaryBox(line, winner);
}

function botAvvistSummaryHtml(rows) {
  const n = (rows || []).length;
  if (!n) return '';
  const bots = {};
  for (const r of rows) {
    const b = botNorm(r.bot);
    bots[b] = (bots[b] || 0) + 1;
  }
  const parts = Object.keys(bots).sort(botOrder).map(name => ({
    n: name, c: bots[name], pct: Math.round(bots[name] / n * 100)
  }));
  const shown = parts.filter(p => p.n !== 'Ukjent');
  const line = shown.map(p => p.n + ' ' + p.c + ' avvist (' + p.pct + ' %)').join(' · ');
  return botSummaryBox(line, '');
}

export function dealTableHtml(deals) {
  if (!deals || deals.length === 0) return '<p style="color:#666;font-style:italic">Ingen solgte eller returnerte biler i perioden.</p>';
  const row = s => {
    const bil = ((s.merke || '') + ' ' + (s.modell || '')).trim() || '–';
    const dlav = s.eval_lav != null ? Math.round(s.eval_lav).toLocaleString('nb-NO') : '–';
    const bud = s.bud != null ? Math.round(s.bud).toLocaleString('nb-NO') : '–';
    const krD = s.kr_diff != null ? (s.kr_diff >= 0 ? '+' : '') + Math.round(s.kr_diff).toLocaleString('nb-NO') : '–';
    const pctColor = s.pct_over_dlav == null ? '#888' : s.pct_over_dlav >= 0 ? '#0F6E66' : '#A8221C';
    const pctText = s.pct_over_dlav != null
      ? '<b style="color:' + pctColor + '">' + (s.pct_over_dlav >= 0 ? '+' : '') + s.pct_over_dlav + '%</b>'
      : '<span style="color:#888">–</span>';
    const utfallColor = s.utfall === 'Solgt' ? '#0F6E66' : '#A8221C';
    const dato = s.dato ? String(s.dato).slice(0, 10) : '';
    return '<tr><td style="padding:6px;border:1px solid #ddd;font-size:11px;color:#666">' + dato +
      '</td><td style="padding:6px;border:1px solid #ddd;font-family:monospace">' + s.regnr +
      '</td><td style="padding:6px;border:1px solid #ddd">' + bil +
      '</td><td style="padding:6px;border:1px solid #ddd;text-align:right">' + (s.km || '–') +
      '</td><td style="padding:6px;border:1px solid #ddd">' + (s.kilde || '–') +
      '</td><td style="padding:6px;border:1px solid #ddd">' + (s.bot || '–') +
      '</td><td style="padding:6px;border:1px solid #ddd;text-align:right;font-family:monospace">' + dlav +
      '</td><td style="padding:6px;border:1px solid #ddd;text-align:right;font-family:monospace;font-weight:600">' + bud +
      '</td><td style="padding:6px;border:1px solid #ddd;text-align:right;font-family:monospace">' + krD +
      '</td><td style="padding:6px;border:1px solid #ddd;text-align:right">' + pctText +
      '</td><td style="padding:6px;border:1px solid #ddd;font-weight:700;color:' + utfallColor + '">' + s.utfall + '</td></tr>';
  };
  return `<h2 style="color:#004225;border-bottom:1px solid #ddd;padding-bottom:4px">Solgt og returnert — bud vs live eval-lav</h2>
<p style="line-height:1.6"><em>Eval-lav = live Endelig AR verdi (lav). Bud = høyeste bud. Diff = bud minus eval-lav.</em></p>
${botDealSummaryHtml(deals)}
<table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
<tr style="background:#004225;color:#fff">
<th style="padding:6px;border:1px solid #ddd;text-align:left">Dato</th>
<th style="padding:6px;border:1px solid #ddd;text-align:left">Regnr</th>
<th style="padding:6px;border:1px solid #ddd;text-align:left">Merke / modell</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">KM</th>
<th style="padding:6px;border:1px solid #ddd;text-align:left">Kilde</th>
<th style="padding:6px;border:1px solid #ddd;text-align:left">Bot</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Eval lav</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Bud</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Δ kr</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Δ %</th>
<th style="padding:6px;border:1px solid #ddd;text-align:left">Utfall</th>
</tr>
${deals.map(row).join('')}
</table>`;
}

export function moneyTableHtml(money) {
  if (!money) return '';
  const db = money.db != null ? money.db : ((money.sumInntekt || 0) - (money.sumProd || 0));
  const dbCol = db >= 0 ? '#0F6E66' : '#A8221C';
  const igjen = money.igjen != null ? money.igjen : 0;
  const igjenCol = igjen >= 0 ? '#004225' : '#A8221C';
  const vask = money.sumProdSold || 0;
  const row = (label, val, sub, bg, color, bold) =>
    '<tr' + (bg ? ' style="background:' + bg + '"' : '') + '>' +
    '<td style="padding:8px;border:1px solid #ddd;font-weight:' + (bold ? '700' : '600') + '">' + label +
    (sub ? ' <span style="color:#666;font-weight:400;font-size:12px">(' + sub + ')</span>' : '') +
    '</td><td style="padding:8px;border:1px solid #ddd;text-align:right;font-family:monospace;font-weight:' + (bold ? '700' : '600') +
    (color ? ';color:' + color : '') + '">' + val + '</td></tr>';
  return `<h2 style="color:#004225;border-bottom:1px solid #ddd;padding-bottom:4px">Penger — inntekt og omsetning</h2>
<table style="border-collapse:collapse;width:100%;margin-bottom:20px">
${row('Inntekt solgt', fmtKr(money.sumInntekt), (money.solgtN || 0) + ' Peasy-solgt · kolonne U', '#f5f5f0', '#0F6E66')}
${row('Kost retur', fmtKr(money.sumRet), (money.returN || 0) + ' retur × ' + fmtKrPlain(money.returKost) + ' kr', null, '#A8221C')}
${row('Vask/foto', fmtKr(vask), (money.solgtN || 0) + ' solgt · prod på avgjort auksjon', null, '#E65100')}
${row('Dekningsbidrag', fmtKr(db), 'inntekt − vask/foto − retur · avgjort auksjon', '#f5f5f0', dbCol, true)}
${row('Igjen per solgt', fmtKr(igjen), 'inntekt − prod − marked · Peasy', null, igjenCol)}
</table>`;
}

export function computePeriodMetrics(rows, start, end, meas, overrides, cfg, snap) {
  // LÅS 2026-09-14 dag/uke/mnd: identisk Pulse Kjerne på samme XLSX.
  // Solgt = kolonne Solgt på i [start,end].
  // Retur = Returnert på i perioden, pluss åpen to_be_returned uten Returnert på
  //         med Gire bestilt på eller Levere selv i perioden.
  // Live-bot: internnr partall Easy, oddetall V3G. V3 er skygge. Ordna = V3G.
  // Ikke E63-snapshot. Ikke «Ukjent». Ikke kåre vinner på ~50/50 avvist.

  const H = rows[0]; const I = headerIndex(H);
  const cars = rows.slice(1);
  const inP = col => cars.filter(r => isInRange(r[I[col]], start, end));
  const leads = inP('SD mottatt på');
  const leadsPeasy = leads.filter(r => String(r[I['Kilde']] || '').toLowerCase() === 'peasy');
  const leadsDrive = leads.filter(r => String(r[I['Kilde']] || '').toLowerCase() === 'driveno');
  const leadsOrdna = leads.filter(r => String(r[I['Kilde']] || '').toLowerCase() === 'ordna');
  const est = inP('Estimering');
  const bestGire = inP('Gire bestilt på');
  const bestLev = inP('Levere selv');
  const akseptert = [...bestGire, ...bestLev.filter(r => !bestGire.includes(r))];
  const mottatt = inP('Mottatt');
  const solgt = inP('Solgt på');

  // Uke/mnd: samme som Pulse Kjerne. Solgt på / Returnert på i perioden.
  // Åpen to_be_returned uten Returnert på telles på akseptdato (P eller Q).
  const returRows = [];
  const returSeen = new Set();
  for (const r of cars) {
    if (!isInRange(r[I['Returnert på']], start, end)) continue;
    const k = internKey(r, I) || String(r[I['RegNr.']] || '');
    if (k) returSeen.add(k);
    returRows.push(r);
  }
  for (const r of cars) {
    const st = String(r[I['Status']] || '').toLowerCase().replace(/\s+/g, '_');
    if (st !== 'to_be_returned') continue;
    if (isInRange(r[I['Returnert på']], start, end)) continue;
    const acc = r[I['Gire bestilt på']] || r[I['Levere selv']];
    if (!isInRange(acc, start, end)) continue;
    const k = internKey(r, I) || String(r[I['RegNr.']] || '');
    if (k && returSeen.has(k)) continue;
    if (k) returSeen.add(k);
    returRows.push(r);
  }

  const solgtAnalysis = solgt.map(r => dealFromRow(r, I, meas, overrides, 'Solgt'));
  const returAnalysis = returRows.map(r => dealFromRow(r, I, meas, overrides, 'Retur'));
  const dealAnalysis = [...solgtAnalysis, ...returAnalysis]
    .sort((a, b) => String(a.dato || '').localeCompare(String(b.dato || '')));

  const evalPool = leads.length > 0 ? leads : est;
  const evalRows = evalPool.map(r => {
    const rg = String(r[I['RegNr.']] || '').toUpperCase();
    const intern = internKey(r, I);
    const v3m = lookupMeas(intern, rg, meas);
    const v3 = v3m?.v2 || null;
    const easy = v3m?.easy || null;
    const em = easy && easy.dLav && easy.dHoy ? (easy.dLav + easy.dHoy) / 2 : null;
    const vm = v3 && v3.dLav && v3.dHoy ? (v3.dLav + v3.dHoy) / 2 : null;
    return {
      regnr: rg, merke: r[I['Merke']], modell: r[I['Modell']],
      easy_lav: easy?.dLav, easy_hoy: easy?.dHoy,
      v3_lav: v3?.dLav, v3_hoy: v3?.dHoy,
      diff_pct: (em && vm) ? Math.round(((vm / em) - 1) * 100) : null,
      variant: v3m?.identifikasjon?.variant,
      has_v3: !!vm
    };
  });

  const returNote = 'Solgt = Solgt på. Retur = Returnert på (åpne Skal returneres uten hentedato på akseptdato). Samme som Pulse Kjerne.';

  return {
    leads: { total: leads.length, peasy: leadsPeasy.length, drive: leadsDrive.length, ordna: leadsOrdna.length },
    estimering_sendt: est.length,
    akseptert: { total: akseptert.length, gire: bestGire.length, levere_selv: bestLev.length },
    mottatt: mottatt.length,
    solgt: solgt.length,
    returnert: returAnalysis.length,
    returNote,
    avvist_approx: est.filter(r => String(r[I['Status']] || '').toLowerCase().startsWith('avvist')),
    eval_rows: evalRows,
    solgt_analysis: solgtAnalysis,
    retur_analysis: returAnalysis,
    deal_analysis: dealAnalysis,
    money: pulseMoneyRange(rows, start, end, cfg)
  };
}


export function osloDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

export function fmtOsloStamp(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
  return d.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function kildeLabel(src) {
  const s = String(src || '').toLowerCase();
  if (s === 'driveno' || s === 'drive') return 'Drive';
  if (s === 'ordna') return 'Ordna';
  if (s === 'peasy') return 'Peasy';
  return src || '–';
}

function daysBetween(fromIso, toDate) {
  if (!fromIso) return '–';
  const a = new Date(fromIso);
  if (isNaN(a.getTime())) return '–';
  const end = toDate ? new Date(toDate) : new Date();
  const days = Math.floor((end.getTime() - a.getTime()) / 86400000);
  if (days <= 0) return 'i dag';
  return days + ' d';
}

function estBand(b) {
  const min = b.price_final_min, max = b.price_final_max;
  if (min == null && max == null) return '–';
  if (min != null && max != null && min !== max) {
    return Math.round(min).toLocaleString('nb-NO') + '–' + Math.round(max).toLocaleString('nb-NO') + ' kr';
  }
  const n = min != null ? min : max;
  return Math.round(n).toLocaleString('nb-NO') + ' kr';
}

function kmStr(b) {
  const dd = b.drive_no_car_data || {};
  const raw = dd.mileage || dd.km || b.mileage;
  const n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n.toLocaleString('nb-NO') + ' km' : '–';
}

function botFromIntern(intern, source) {
  const src = String(source || '').toLowerCase();
  if (src === 'ordna') return 'V3G';
  const n = Number(intern);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Samme lodde som ab-arm.js: partall A Easy, oddetall B V3G. V3 er skygge og priser ikke.
  return n % 2 === 0 ? 'Easy' : 'V3G';
}

export async function fetchAvvistRows(start, end, kmByReg = {}) {
  const token = process.env.EASY_WEBHOOK_TOKEN;
  if (!token) {
    console.log('Avvist-tabell: EASY_WEBHOOK_TOKEN mangler');
    return [];
  }
  // Liste 16 er paginert STIGENDE: side 1 er de eldste avvisningene.
  // Uten ?page ga proxyen side 1 (april-juli 2025), og filteret fant aldri noe.
  // Vi gaar derfor bakover fra siste side til en hel side ligger foer periodestart.
  const MAKS_SIDER = 10;
  const hent = async (side) => {
    const r = await fetch('http://127.0.0.1:7780/list/rejected?per_page=100&page=' + side, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) {
      console.log('Avvist-tabell: liste 16 HTTP', r.status, 'side', side);
      return null;
    }
    return r.json();
  };
  const startIso = fmtIsoDate(start);
  const endIso = fmtIsoDate(end);

  const forste = await hent(1);
  if (!forste) return [];
  const sisteSide = Number(forste.last_page) || 1;

  const sett = new Set();
  const biler = [];
  let komplett = false;
  let sider = 0;
  for (let side = sisteSide; side >= 1 && sider < MAKS_SIDER; side--) {
    const j = side === 1 ? forste : await hent(side);
    if (!j) break;
    sider++;
    // Avvisninger kan ha kommet inn mellom de to kallene.
    if (side === sisteSide && Number(j.last_page) > sisteSide) {
      console.log('Avvist-tabell: ADVARSEL - last_page vokste fra', sisteSide, 'til',
        j.last_page, '- de nyeste avvisningene kan mangle');
    }
    const chunk = j.biler || [];
    for (const b of chunk) {
      const k = String(b.id ?? b.registration_number ?? '');
      if (k && sett.has(k)) continue;
      if (k) sett.add(k);
      biler.push(b);
    }
    const nyeste = chunk
      .map(b => osloDay((b.process_milestones || {}).rejected_at))
      .filter(Boolean).sort().at(-1);
    if (nyeste && nyeste < startIso) { komplett = true; break; }
    // Naadd starten av lista: da har vi sett alt som finnes, ikke bare nok.
    if (side === 1) komplett = true;
  }
  if (!komplett) {
    console.log('Avvist-tabell: ADVARSEL - stoppet paa sidegrensen (' + MAKS_SIDER +
      ' sider), kan mangle rader foer ' + startIso);
  }
  console.log('Avvist-tabell: hentet', biler.length, 'rader fra', sider,
    'sider, last_page', sisteSide, komplett ? '(komplett)' : '(ufullstendig)');

  const meas = await loadMeasurements();
  const overrides = await loadOverrides();
  return biler.filter(b => {
    const st = (b.status_entity && b.status_entity.status) || '';
    if (st !== 'REJECTED_BY_CUSTOMER') return false;
    const day = osloDay((b.process_milestones || {}).rejected_at);
    return day && day >= startIso && day <= endIso;
  }).map(b => {
    const mil = b.process_milestones || {};
    const dd = b.drive_no_car_data || {};
    const make = b.manufacturer || dd.manufacturer_name || '';
    const model = dd.model_series || b.model_series || '';
    const year = dd.model_year || '';
    const rg = String(b.registration_number || '').toUpperCase();
    const measRec = lookupMeas(null, rg, meas);
    const ov = lookupOverride(null, rg, overrides);
    const intern = String(b.id ?? measRec?.erpId ?? measRec?.internnr ?? '').trim();
    const bot = botFromIntern(intern, b.source);
    return {
      kilde: kildeLabel(b.source),
      bot,
      regnr: b.registration_number || '–',
      avvist: fmtOsloStamp(mil.rejected_at),
      dager: daysBetween(mil.fe_created_at || mil.sd_created_at, end),
      bil: [make, model, year].filter(Boolean).join(' '),
      km: fmtKm((measRec && measRec.km) ?? (kmByReg && kmByReg[rg])),
      est: estBand(b),
      arsak: b.reject_reason || 'Avvist av kunde'
    };
  });
}

export function avvistTableHtml(rows, { title, empty } = {}) {
  const n = (rows || []).length;
  const head = title || ('❌ Avvist estimat i perioden');
  const emptyTxt = empty || 'Ingen biler i perioden';
  const body = n
    ? rows.map((s, i) => {
        const bg = i % 2 ? '' : 'background:#f5f5f0';
        return '<tr style="' + bg + '"><td style="padding:6px;border:1px solid #ddd">' + s.kilde +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.bot +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.regnr +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.avvist +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.dager +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.bil +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.km +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.est +
          '</td><td style="padding:6px;border:1px solid #ddd">' + s.arsak + '</td></tr>';
      }).join('')
    : '<tr><td colspan="9" style="padding:8px;border:1px solid #ddd;color:#888">' + emptyTxt + '</td></tr>';
  return `<h2 style="color:#004225;border-bottom:1px solid #ddd;padding-bottom:4px">${head} — ${n} biler</h2>
<p style="color:#666;font-size:12px;margin-top:0">Liste 16. Kunden avviste estimatet. Ikke det samme som retur etter auksjon (E63).</p>
${botAvvistSummaryHtml(rows)}
<table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
<tr style="background:#eee"><th style="padding:6px;border:1px solid #ddd;text-align:left">Kilde</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Bot</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Regnr</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Avvist</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Dager</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Bil</th><th style="padding:6px;border:1px solid #ddd;text-align:left">KM</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Peasy est verdi</th><th style="padding:6px;border:1px solid #ddd;text-align:left">Årsak</th></tr>
${body}
</table>`;
}

export function renderAnalysis({ title, periodLabel, m }) {
  const kildeMix = [
    m.leads.peasy + ' Peasy',
    m.leads.drive + ' Drive',
    (m.leads.ordna ? m.leads.ordna + ' Ordna' : null)
  ].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:900px;margin:0 auto;padding:20px">
<h1 style="color:#004225;border-bottom:2px solid #004225;padding-bottom:8px;margin-bottom:4px">${title}</h1>
<p style="color:#666;margin-top:0">Periode: <strong>${periodLabel}</strong> · Generert: ${fmtDate(new Date())} kl ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}</p>

<h2 style="color:#004225;border-bottom:1px solid #ddd;padding-bottom:4px">Nøkkeltall</h2>
<table style="border-collapse:collapse;width:100%;margin-bottom:20px">
<tr style="background:#f5f5f0"><td style="padding:8px;border:1px solid #ddd;font-weight:600">Leads</td><td style="padding:8px;border:1px solid #ddd">${m.leads.total} <span style="color:#666">(${kildeMix})</span></td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">Bestilt hent/lev</td><td style="padding:8px;border:1px solid #ddd">${m.akseptert.total} <span style="color:#666">(Gire: ${m.akseptert.gire} · Levere selv: ${m.akseptert.levere_selv})</span></td></tr>
<tr style="background:#f5f5f0"><td style="padding:8px;border:1px solid #ddd;font-weight:600">Mottatt</td><td style="padding:8px;border:1px solid #ddd">${m.mottatt}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">Solgt</td><td style="padding:8px;border:1px solid #ddd">${m.solgt}</td></tr>
<tr style="background:#f5f5f0"><td style="padding:8px;border:1px solid #ddd;font-weight:600">Retur</td><td style="padding:8px;border:1px solid #ddd">${m.returnert}${m.returNote ? ' <span style="color:#888;font-size:11px;font-weight:400">* ' + m.returNote + '</span>' : ''}</td></tr>
</table>

${dealTableHtml(m.deal_analysis)}
${moneyTableHtml(m.money)}
${avvistTableHtml(m.avvist || [], { title: m.avvistTitle, empty: m.avvistEmpty })}

<p style="margin-top:30px;color:#888;font-size:11px;font-style:italic">
Samme mal for dag, uke og måned. Tall i perioden, ikke kohort. Mottatt er låsen. Penger = avgjort auksjon (Peasy). Inntekt og kost bookes når kunden tar stilling til høyeste bud. Ingen hent-kost.
</p>
<p style="margin-top:8px;color:#888;font-size:11px">${SIGNATUR}</p>
</body></html>`;
}

export async function sendReport(subject, html, dryRun, previewPath) {
  if (dryRun) {
    const out = previewPath || '/tmp/peasy-report-preview.html';
    await fs.writeFile(out, html, 'utf8');
    console.log('DRY-RUN preview written to:', out);
    return { ok: true, dry: true, path: out };
  }
  const user = process.env.IMAP_USER || process.env.EMAIL_USER;
  const pass = process.env.IMAP_PASS;
  if (!user || !pass) throw new Error('IMAP_USER / IMAP_PASS mangler i .env');
  const t = nodemailer.createTransport({
    host: 'exchange.tornado.email', port: 587, secure: false,
    auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000
  });
  const info = await t.sendMail({
    from: 'Peasy Bot <' + user + '>', to: MAIL_TO, subject, html
  });
  console.log('mail sendt til', MAIL_TO, ':', info.response);
  return { ok: true, response: info.response };
}

/** ISO-uke: mandag 00:00 – søndag 23:59 */
export function isoWeekRange(year, week) {
  const jan4 = new Date(year, 0, 4);
  const start = new Date(jan4);
  start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function isoWeekNumber(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
}

export function monthRange(year, month1to12) {
  const start = new Date(year, month1to12 - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month1to12, 0, 23, 59, 59, 999);
  return { start, end };
}

/** Kalenderdag 00:00 – 23:59 */
export function dayRange(d) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

export function isLastDayOfMonth(d) {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n.getDate() === 1;
}

export function breakdownDays(rows, start, nDays, firstSeen) {
  const H = rows[0]; const I = headerIndex(H);
  const cars = rows.slice(1);
  const days = [];
  for (let i = 0; i < nDays; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
    const returnert = (firstSeen && typeof firstSeen === 'object')
      ? Object.values(firstSeen).filter(iso => isIsoInRange(iso, d, dEnd)).length
      : 0;
    days.push({
      date: d,
      leads: cars.filter(r => isInRange(r[I['SD mottatt på']], d, dEnd)).length,
      akseptert: cars.filter(r => isInRange(r[I['Gire bestilt på']], d, dEnd) || isInRange(r[I['Levere selv']], d, dEnd)).length,
      solgt: cars.filter(r => isInRange(r[I['Solgt på']], d, dEnd)).length,
      returnert
    });
  }
  return days;
}

export function daysTableHtml(days) {
  if (!days || !days.length) return '';
  const rows = days.map(d => `<tr>
    <td style="padding:4px 8px;border:1px solid #ddd">${fmtDate(d.date)}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${d.leads}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${d.akseptert}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${d.solgt}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${d.returnert}</td>
  </tr>`).join('');
  return `<h2 style="color:#004225;border-bottom:1px solid #ddd;padding-bottom:4px">Per dag</h2>
<table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px">
<tr style="background:#004225;color:#fff">
<th style="padding:6px;border:1px solid #ddd;text-align:left">Dato</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Leads</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Akseptert</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Solgt</th>
<th style="padding:6px;border:1px solid #ddd;text-align:right">Returnert</th>
</tr>
${rows}
</table>`;
}
