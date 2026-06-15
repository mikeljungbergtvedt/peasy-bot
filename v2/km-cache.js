import XLSX from 'xlsx';
const XLSX_URL = 'https://api.biladministrasjon.no/public/reports/peasy/dhqui7Hkl54?output=xlsx';
let _kmCache = {};
let _loaded = false;
let _loadedAt = 0;
export async function loadKmCache(force = false) {
  if (_loaded && !force && (Date.now() - _loadedAt) < 30 * 60 * 1000) return _kmCache;
  try {
    const r = await fetch(XLSX_URL);
    const buf = await r.arrayBuffer();
    const wb = XLSX.read(Buffer.from(buf), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    _kmCache = {};
    for (const row of rows.slice(1)) {
      const rn = String(row[1] || '').trim().toUpperCase().replace(/\s/g, '');
      const km = parseInt(row[22]) || 0;
      if (rn && km > 0) _kmCache[rn] = km;
    }
    _loaded = true;
    _loadedAt = Date.now();
    console.log('[km-cache] lastet ' + Object.keys(_kmCache).length + ' regnr');
    return _kmCache;
  } catch (e) {
    console.error('[km-cache] FEIL', e.message);
    return _kmCache;
  }
}
export function getKmForRegnr(regnr) {
  return _kmCache[String(regnr || '').trim().toUpperCase().replace(/\s/g, '')] || 0;
}
