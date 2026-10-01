'use strict';
// bilfil-rader.js — rader i samme form som ERP-eksporten (Excel), bygd fra bilfila (logs.nosync/peasy-cars.json).
// Samme kolonner og rekkefølge som excel-kolonner.js (KOL), så koden rundt kan fortsette å lese r[12] = Status osv.
// Felt som bare finnes i Excel (Drive verdi, UTM, kjøperens postnr.) står tomme til Softteam gir dem (PS-199).
//   const { rader } = require('./bilfil-rader'); const rows = rader();   // [KOL, ...rader] eller null

const fs = require('fs');
const path = require('path');
const { KOL } = require('./excel-kolonner');

const FIL = path.join(__dirname, 'logs.nosync', 'peasy-cars.json');
const MAKS_ALDER_MS = 24 * 3600 * 1000; // bilfila bygges bare etter webhook-hendelser; eldre enn et døgn = noe er galt, bruk Excel

// Formatet følger Excel: datoer «dd.mm.yyyy», tomt estimat «-», manglende høyeste bud 0, avgift som tekst.
// «YYYY-MM-DD» → «dd.mm.yyyy»
const no = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : null);

function rad(b) {
  const r = new Array(KOL.length).fill(null);
  r[0] = b.id;
  r[1] = b.regnr;
  r[2] = '-'; // Drive verdi finnes ikke i endepunktene (PS-199)
  r[3] = b.lav != null && b.hoy != null ? `${b.lav}-${b.hoy}` : '-';
  r[4] = b.hoyeste_bud || 0;
  r[5] = b.finans == null ? null : b.finans;
  r[6] = b.merke; r[7] = b.modell; r[8] = b.aar;
  r[9] = b.postnr; r[10] = b.sted;
  r[11] = b.kilde; r[12] = b.status;
  r[13] = no(b.registrert || b.registrert_logg);
  r[14] = b.sd_tid || no(b.sd_mottatt);
  r[15] = b.gire_tid || no(b.gire_bestilt);
  r[16] = b.levere_tid || no(b.levere_selv);
  r[17] = no(b.mottatt);
  r[18] = no(b.solgt);
  r[19] = b.bud; r[20] = b.avgift == null ? null : String(b.avgift); // Excel: avgift som tekst
  r[21] = no(b.returnert);
  r[22] = b.km;
  r[31] = b.estimert_tid || no(b.estimert);
  return r;
}

/** Bygger rader fra en bilfil (objekt) eller leser logs.nosync/peasy-cars.json. null hvis fila mangler eller er for gammel. */
function rader(fil, opts = {}) {
  let d = fil;
  if (!d) {
    try { d = JSON.parse(fs.readFileSync(opts.fil || FIL, 'utf8')); } catch (_) { return null; }
  }
  if (!d || !Array.isArray(d.biler)) return null;
  if (!opts.ignorerAlder && Date.now() - Date.parse(d.bygget) > (opts.maksAlderMs || MAKS_ALDER_MS)) return null;
  // Bare biler som er beriket fra cars/{id}: ellers mangler bud, km og datoene.
  const biler = d.biler.filter((b) => 'bud' in b).sort((a, b) => a.id - b.id);
  return [KOL.slice(), ...biler.map(rad)];
}

const EXCEL_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';

/**
 * Felles for jobbene på Mini: ERP-rader i Excel-form (KOL).
 * Standard: Excel (som før). ERP_RADER=bilfil i .env: bilfila først. Feiler Excel, brukes bilfila.
 * opts.trengerExcelFelt = true for jobber som trenger UTM/Drive verdi (de får alltid Excel når den virker).
 */
async function hentRader(opts = {}) {
  const logg = opts.log || console.log;
  const fraBilfil = () => { const r = rader(null, { fil: opts.fil }); if (r && r.length > 1000) { logg(`[erp-rader] bilfil (${r.length - 1} biler)`); return r; } return null; };
  if (process.env.ERP_RADER === 'bilfil' && !opts.trengerExcelFelt) { const r = fraBilfil(); if (r) return r; }
  try {
    const XLSX = require('xlsx');
    const res = await fetch(opts.excelUrl || EXCEL_URL);
    if (!res.ok) throw new Error('ERP-eksport HTTP ' + res.status);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), Object.assign({ type: 'buffer' }, opts.xlsxOpts || {}));
    return require('./excel-kolonner').kanon(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }), logg);
  } catch (e) {
    const r = fraBilfil();
    if (r) { logg(`[erp-rader] Excel feilet (${e.message}), bruker bilfila`); return r; }
    throw e;
  }
}

module.exports = { rader, rad, hentRader, FIL, EXCEL_URL };
