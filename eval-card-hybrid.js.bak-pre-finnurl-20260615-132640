// eval-card-hybrid.js
// HYBRID eval-kort: Easy topp/bunn + v2 comps/anker/risiko.
// Erstatter formatEvalCard sin MIDT-blokk. Finn-soek og Service/EU-seksjon er
// utelatt (minimal fusjon — kan legges til senere).
//
// Bruk i peasy-auto.js:
//   const { formatEvalCardHybrid } = require('./eval-card-hybrid');
//   const erpText = formatEvalCardHybrid(cardParams, true);   // ERP-kommentar (ren tekst)
//   const tgText  = formatEvalCardHybrid(cardParams, false);  // Telegram (HTML)
//
// cardParams forventes aa inneholde:
//   { bil, vegData, seg, imageCount, sdComment, brreg, valuation,
//     anchor,            // v2 chooseAnchor-objektet (valgte_comps, anker_beregning, risiko_flagg, confidence, begrunnelse_kort)
//     prevEvals,         // getPrevEvals(regnr, erpId)
//     erpWritten, erpVerify, chatPosted, qaOverride }

'use strict';

function nf(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString('nb-NO') : '?';
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// km-format: 152000 -> "152k km", <1000 -> "950 km"
function kmShort(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '? km';
  return v >= 1000 ? `${Math.round(v / 1000)}k km` : `${Math.round(v)} km`;
}
const MND = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
// Gjoer "2026-02-14" -> "feb 2026". Andre strenger returneres som de er.
function monthYear(s) {
  if (!s) return '';
  const m = String(s).match(/(\d{4})-(\d{2})/);
  if (m) return `${MND[parseInt(m[2], 10) - 1] || '?'} ${m[1]}`;
  return String(s).trim();
}
// Hoyrejuster et tall-felt til 10 tegn (for KALKYLE-kolonner i ren tekst)
function rpad(n) {
  return nf(n).padStart(10);
}

function formatEvalCardHybrid(p, forErp = false) {
  const bil = p.bil || {};
  const veg = p.vegData || {};
  const seg = p.seg || {};
  const val = p.valuation || {};
  const anchor = p.anchor || {};
  const comps = Array.isArray(anchor.valgte_comps) ? anchor.valgte_comps : [];
  const ab = anchor.anker_beregning || {};

  // HTML- vs ren-tekst-merking
  const B = forErp ? (s) => s : (s) => `<b>${s}</b>`;
  const I = forErp ? (s) => s : (s) => `<i>${s}</i>`;
  const E = forErp ? (s) => String(s == null ? '' : s) : esc;

  const out = [];

  // ── 1. Tittel ────────────────────────────────────────────────
  const source = (bil.source || '').toLowerCase() === 'driveno' ? 'DRIVE' : 'PEASY';
  const qaTag = p.qaOverride ? ' ⚡ QA OVERRIDE' : '';
  out.push(B(`${source} BIL TIL ESTIMERING${qaTag}`));

  // ── 2. Bil-linje ─────────────────────────────────────────────
  const isEl = (veg.fuel || '').toLowerCase().includes('elektr');
  const hkStr = isEl
    ? (veg.range ? `${veg.range} km rekkevidde` : `${veg.kw || '?'} kW`)
    : (veg.hk ? `${veg.hk} hk` : (veg.kw ? `${veg.kw} kW` : ''));
  const kmYear = seg.kmPerYear ? `${nf(seg.kmPerYear)} km/år` : '';
  const karosseri = (veg.avgiftsgruppe || '').includes('Personbil')
    ? 'Personbil'
    : (veg.avgiftsgruppe || '').toLowerCase().includes('varebil')
      ? 'Varebil'
      : (veg.karosseri || bil.karosseri_erp || '');
  const carLine = [
    bil.registration_number,
    `${veg.make || ''} ${bil.model_series || ''} ${bil.model_year || ''}`.trim(),
    `${nf(bil.mileage || 0)} km`,
    kmYear,
    veg.fuel, veg.gearbox, veg.drive, hkStr, karosseri,
    (p.imageCount && p.imageCount > 0) ? `🖼️ ${p.imageCount}` : '',
  ].filter(Boolean).join(' | ');
  out.push(forErp ? carLine : I(carLine));
  out.push('');

  // ── 3. Bilmodell-blokk ───────────────────────────────────────
  // Gjenbruker Easy sin cv_text hvis den finnes (rik berikelse), ellers bygg fra vegData.
  let bilmodell;
  if (bil.cv_text) {
    bilmodell = '🚗 Bilmodell\n' + bil.cv_text;
  } else {
    const modelDisp = bil.modelFull || `${veg.make || ''} ${veg.model || bil.model_series || ''}`.trim();
    const l1 = [modelDisp, veg.hk ? veg.hk + ' hk' : '', veg.range ? veg.range + ' km rekkevidde' : '', bil.model_year || veg.firstRegYear || '']
      .filter(Boolean).join(' · ');
    const l2 = [veg.fuel, veg.gearbox, veg.drive, veg.karosseri].filter(Boolean).join(' · ');
    const l3 = (bil.equipment && bil.equipment.length) ? bil.equipment.join(' · ') : '';
    const l4 = [];
    if (veg.motorCode || bil.motorEffekt) l4.push('Motor: ' + (bil.motorEffekt || veg.motorCode) + (veg.kw ? ` (${veg.kw} kW)` : ''));
    if (veg.forstegangNorgeDato) l4.push('Første reg Norge: ' + veg.forstegangNorgeDato);
    if (bil.farge || veg.farge) l4.push('Farge: ' + (bil.farge || veg.farge));
    bilmodell = ['🚗 Bilmodell', l1, l2, l3, l4.join(' · ')].filter(Boolean).join('\n');
  }
  out.push(bilmodell);
  out.push('');

  // ── 4. Tidligere priset hos Peasy (dato, D lav/høy, status) ───
  // PEASY 20260610: filter ut dagens 'Nye biler'-entry uten pris
  const _realPrev = (p.prevEvals || []).filter(e => !(String(e.status||'').toLowerCase().includes('nye biler') && !e.dLavHoy));
  if (_realPrev.length) {
    out.push('🔁 Tidligere priset hos Peasy');
    _realPrev.forEach(e => {
      const bits = [e.dato, e.dLavHoy ? `(${e.dLavHoy})` : '', e.status ? `– ${E(e.status)}` : '']
        .filter(Boolean).join(' ');
      out.push(bits || '(tidligere registrert)');
    });
    out.push('');
  }

  // ── 5. V2 COMPS ──────────────────────────────────────────────
  // AKTIVE + SOLGTE leses DIREKTE fra car.info (p.activeComps / p.soldForhandler
  // / p.soldPrivat), uavhengig av AI-utvalget. AI-begrunnelse er allerede lagt
  // paa de compsene AI faktisk brukte. valgte*-tallene er kun til ANKER-breakdown.
  const valgteAktive = comps.filter(c => c.status === 'aktiv');
  const valgteForhandler = comps.filter(c => c.status !== 'aktiv' && c.type === 'forhandler');
  const valgtePrivat = comps.filter(c => c.status !== 'aktiv' && c.type === 'privat');
  const marketActive = Array.isArray(p.activeComps) ? p.activeComps : [];
  const soldFh = Array.isArray(p.soldForhandler) ? p.soldForhandler : [];
  const soldPv = Array.isArray(p.soldPrivat) ? p.soldPrivat : [];
  const originKm = Number(p.bil && p.bil.mileage) || 0;

  // Spess per comp: bruk det glue-en la pa (c._spec), ellers parse tittel som fallback
  function specsOf(c) {
    if (c._spec) return c._spec;
    const t = String(c.title || '').replace(/^Bruktbil til salgs:\s*/i, '').replace(/\s*\|\s*FINN\.no\s*$/i, '');
    const yM = t.match(/\b(19|20)\d{2}\b/);
    const hM = t.match(/(\d{2,3})\s*hk/i);
    const hk = hM ? parseInt(hM[1], 10) : null;
    return { year: yM ? parseInt(yM[0], 10) : null, model: (t.split(' - ')[0] || '').trim(), hk, kW: hk ? Math.round(hk / 1.36) : null, body: '', ah: null };
  }
  // Spess-streng: år · variant · hk/kW · karosseri · batteri
  function specStr(c) {
    const s = specsOf(c);
    const parts = [];
    if (s.year) parts.push(String(s.year));
    if (s.model) parts.push(s.model);
    if (s.hk) parts.push(`${s.hk} hk${s.kW ? '/' + s.kW + ' kW' : ''}`);
    if (s.body) parts.push(s.body);
    if (s.ah) parts.push(`${s.ah} Ah`);
    return parts.join(' · ') || '?';
  }
  function flagOf(c) {
    if (c._comparable === true) return '✅ ';
    if (c._comparable === false) return '⚠️ ';
    return '';
  }
  // Linje 2: AI-begrunnelse > avvik-grunn > km/dager. Regnr til slutt (lite).
  function note2(c, kind) {
    let note = c.begrunnelse;
    if (!note && Array.isArray(c._flag) && c._flag.length) note = 'avvik: ' + c._flag.join(', ');
    if (!note) {
      const bits = [];
      if (Number.isFinite(Number(c.km)) && originKm) { const d = Number(c.km) - originKm; bits.push(`km-avvik ${d >= 0 ? '+' : '−'}${nf(Math.abs(d))}`); }
      const dom = Number(c.days_on_market);
      if (Number.isFinite(dom) && dom > 0) bits.push(kind === 'sold' ? `solgt på ${dom} d` : `${dom} d på marked`);
      note = bits.join(' · ');
    }
    const reg = c.licence_plate || '';
    if (!note && !reg) return '';
    const inner = forErp
      ? [note, reg].filter(Boolean).join(' · ')
      : [note ? I(E(note)) : '', reg ? E(reg) : ''].filter(Boolean).join(' · ');
    return `\n   ${inner}`;
  }
  function soldLine(c) {
    const head = `${flagOf(c)}${specStr(c)} | ${kmShort(c.km)} | ${nf(c.price)} kr | solgt ${monthYear(c.sold_date)}`;
    return head + note2(c, 'sold');
  }
  function activeLine(c) {
    const url = c.finn_url || c.classified_url || '';
    const since = c.published_date ? ' | siden ' + monthYear(c.published_date) : '';
    const head = `${flagOf(c)}${specStr(c)} | ${kmShort(c.km)} | ${nf(c.price)} kr${since}`;
    const link = url ? (forErp ? `\n   ${url}` : `\n   <a href="${esc(url)}">Åpne annonse</a>`) : '';
    return head + note2(c, 'aktiv') + link;
  }
  function group(title, arr, lineFn) {
    out.push(title);
    out.push(arr.length ? arr.map(lineFn).join('\n') : '(ingen)');
    out.push('');
  }
  // ── 6. ANKER (viktigst øverst) ───────────────────────────────
  const breakdown = [
    valgteForhandler.length ? `${valgteForhandler.length} forhandler` : '',
    valgtePrivat.length ? `${valgtePrivat.length} privat` : '',
    valgteAktive.length ? `${valgteAktive.length} aktiv` : '',
  ].filter(Boolean).join(' + ');
  const valgteKm = comps.map(c => Number(c.km)).filter(n => Number.isFinite(n) && n > 0);
  const avgKm = valgteKm.length ? Math.round(valgteKm.reduce((a, b) => a + b, 0) / valgteKm.length) : 0;
  const minKm = valgteKm.length ? Math.min(...valgteKm) : 0;
  const maxKm = valgteKm.length ? Math.max(...valgteKm) : 0;
  const kmDiff = avgKm - originKm;
  const variant = (p.anchor && p.anchor.identifikasjon && p.anchor.identifikasjon.variant) || '';
  const ankerTab = [
    `Anker:    ${rpad(ab.anker)} kr   (${comps.length} salg${breakdown ? ': ' + breakdown : ''})`,
    avgKm ? `Snitt km: ${rpad(avgKm)}      (${kmDiff >= 0 ? '+' : '-'}${nf(Math.abs(kmDiff))} vs origin)` : null,
    avgKm ? `Spenn:    ${(Math.round(minKm / 1000) + 'k-' + Math.round(maxKm / 1000) + 'k km').padStart(13)}` : null,
  ].filter(Boolean).join('\n');
  out.push(B('ANKER'));
  out.push(forErp ? ankerTab : `<pre>${esc(ankerTab)}</pre>`);
  if (variant) out.push(`Variant: ${E(variant)}`);
  if (p.cappedFrom) out.push(`⚠️ Anker capet til aktiv Finn-annonse: ${nf(p.anchorUsed)} kr (fra ${nf(p.cappedFrom)} kr)`);
  out.push('');

  // ── 6b. FINN-ANNONSE (aktiv på finn.no) ──────────────────────
  out.push(B('FINN-ANNONSE'));
  if (p.finnListing && p.finnListing.link) {
    const fl = p.finnListing;
    const flBits = [];
    if (fl.price) flBits.push(nf(fl.price) + ' kr');
    if (fl.year) flBits.push(String(fl.year));
    if (fl.km != null) flBits.push(nf(fl.km) + ' km');
    const flLabel = flBits.length ? flBits.join(' | ') : 'apne annonse';
    out.push(forErp
      ? ('Origin aktiv pa Finn - ' + flLabel + ': ' + fl.link)
      : ('<a href="' + esc(fl.link) + '">\u{1F517} Origin aktiv p\u00e5 Finn \u2014 ' + esc(flLabel) + '</a>'));
  } else {
    out.push(forErp ? 'Origin ikke aktiv pa Finn' : 'Origin ikke aktiv p\u00e5 Finn');
  }
  const makeQ2 = String(veg.make || '').split(' ')[0];
  const modelQ2 = String(bil.model_series || veg.model || '').split('/')[0].split(/\s+/).slice(0, 2).join(' ').trim();
  const finnSokUrl = 'https://www.finn.no/mobility/search/car?registration_class=1&sort=PRICE_ASC&q=' + encodeURIComponent((makeQ2 + ' ' + modelQ2).trim()) + (bil.model_year ? '&year_from=' + bil.model_year + '&year_to=' + bil.model_year : '') + (originKm ? '&mileage_from=' + (Math.round(originKm * 0.85 / 1000) * 1000) + '&mileage_to=' + (Math.round(originKm * 1.25 / 1000) * 1000) : '');
  const carInfoUrl2 = 'https://www.car.info/no-no/license-plate/N/' + String(bil.registration_number || '').replace(/\s/g, '');
  const finnFunnelUrl = p.finnUrl || finnSokUrl;
  out.push(forErp ? ('Sok sosterbiler pa Finn (filtrert): ' + finnFunnelUrl) : ('<a href="' + esc(finnFunnelUrl) + '">\u{1F50D} S\u00f8k s\u00f8sterbiler p\u00e5 Finn (filtrert)</a>'));
  out.push(forErp ? ('Generasjon/facelift: ' + carInfoUrl2) : ('<a href="' + esc(carInfoUrl2) + '">Generasjon/facelift (car.info)</a>'));
  out.push('');

  // ── 7. KALKYLE (Easy calcValuation — fasit som skrives til ERP) ─
  const spreadStr = val.spreadPct != null ? `±${(val.spreadPct * 100).toFixed(1)}%` : '?';
  const kalkyleBody = [
    `Bracket: ${val.bracket || '?'}`,
    `Segment: ${seg.segment || '?'} (${spreadStr})`,
    `Anker:   ${rpad(p.anchorUsed != null ? p.anchorUsed : ab.anker)} kr`,
    `- Margin:${rpad(val.margin)} kr`,
    `= Brutto:${rpad(val.T)} kr`,
    `- Fee:   ${rpad(val.fee)} kr`,
    `= D mid: ${rpad(val.dMid)} kr`,
    `D lav:   ${rpad(val.dLav)} kr`,
    `D høy:   ${rpad(val.dHoy)} kr`,
    ...(val.compCapApplied ? [`🛡️ Comp-cap: D høy klippet til laveste comp × 0.95`] : []),
    // QA-flagg: kun biler >= 75k anker — billigbiler har strukturelt lav dLav%
    // (flate kostnader) og 0-35k er beste retur-segment, skal ikke flagges.
    ...((() => {
      const ank = p.anchorUsed != null ? p.anchorUsed : ab.anker;
      if (val.dLav != null && val.dLav <= 0) return ['🚩 QA: D lav ≤ 0 — ugyldig kalkyle, ikke send'];
      if (ank >= 75000 && val.dLav != null && val.dLav < 0.65 * ank)
        return [`🚩 QA: D lav er ${Math.round(100 * val.dLav / ank)}% av anker (<65%) — sjekk comp-cap/pool før utsending`];
      return [];
    })()),
  ].join('\n');
  out.push(B('KALKYLE'));
  out.push(forErp ? kalkyleBody : `<pre>${esc(kalkyleBody)}</pre>`);
  out.push('');

  // ── 8. Confidence + begrunnelse ──────────────────────────────
  out.push(B(`Confidence: ${anchor.confidence != null ? anchor.confidence : '?'}/100`));
  if (anchor.begrunnelse_kort) out.push(forErp ? anchor.begrunnelse_kort : I(E(anchor.begrunnelse_kort)));
  out.push('');

  // ── 8b. Evalueringsgrunnlag — kollapsbart i Telegram, fullt i ERP ──
  if (forErp) {
    out.push('Evalueringsgrunnlag');
    out.push('');
    out.push(`📌 AKTIVE ANNONSER PÅ MARKEDET (${marketActive.length})`);
    out.push(marketActive.length ? marketActive.map(activeLine).join('\n') : '(ingen aktive akkurat nå)');
    out.push('');
    group(`🏪 SOLGTE – FORHANDLER (${soldFh.length})`, soldFh, soldLine);
    group(`👤 SOLGTE – PRIVAT (${soldPv.length})`, soldPv, soldLine);
  } else {
    const tgCompact = (c, kind) => {
      const plate = c.licence_plate ? ' · ' + E(c.licence_plate) : '';
      let l = flagOf(c) + specStr(c) + ' | ' + kmShort(c.km) + ' | ' + nf(c.price) + ' kr | ' + (kind === 'sold' ? 'solgt ' + monthYear(c.sold_date) : 'aktiv') + plate;
      if (c.begrunnelse) l += '\n   ' + I(E(c.begrunnelse));
      const url = kind !== 'sold' ? (c.finn_url || '') : '';
      if (url) l += '\n   <a href="' + esc(url) + '">Åpne annonse</a>';
      return l;
    };
    const q = [];
    q.push('📌 AKTIVE (' + marketActive.length + ')');
    q.push(marketActive.length ? marketActive.map(c => tgCompact(c, 'aktiv')).join('\n') : '(ingen)');
    q.push('🏪 SOLGTE – FORHANDLER (' + soldFh.length + ')');
    q.push(soldFh.length ? soldFh.slice(0, 8).map(c => tgCompact(c, 'sold')).join('\n') : '(ingen)');
    q.push('👤 SOLGTE – PRIVAT (' + soldPv.length + ')');
    q.push(soldPv.length ? soldPv.slice(0, 8).map(c => tgCompact(c, 'sold')).join('\n') : '(ingen)');
    out.push(B('Evalueringsgrunnlag') + ' ' + I('(trykk for å utvide)'));
    out.push('<blockquote expandable>' + q.join('\n') + '</blockquote>');
    out.push('');
  }

  // ── 9. RISIKO ────────────────────────────────────────────────
  if (Array.isArray(anchor.risiko_flagg) && anchor.risiko_flagg.length) {
    out.push(B('RISIKO'));
    anchor.risiko_flagg.forEach(r => out.push(`* ${E(r)}`));
    out.push('');
  }

  // ── 10. HEFTELSER ────────────────────────────────────────────
  out.push(B('HEFTELSER'));
  out.push(p.brreg && p.brreg.anyDebts
    ? `⚠️ ${E(p.brreg.text || 'Heftelser registrert – sjekk manuelt')}`
    : '✅ Ingen heftelser');
  out.push('');

  // ── 11. SELGERKOMMENTAR (kun ekte biler) ─────────────────────
  if (bil.id && p.sdComment) {
    out.push(B('SELGERKOMMENTAR'));
    out.push(E(p.sdComment));
    out.push('');
  }

  // ── 12. ERP STATUS (kun ekte biler) ──────────────────────────
  if (bil.id) {
    const v = p.erpVerify || {};
    const statusFlags = [
      p.erpWritten ? '✅ D lav/høy skrevet' : '❌ D lav/høy feilet',
      (p.erpWritten || v.auctionType) ? '✅ Auction type satt' : '❌ Auction type feilet',
      p.chatPosted ? '✅ Eval-kort postet' : '— Eval-kort ikke postet',
    ].join(' | ');
    out.push(B('ERP STATUS'));
    out.push(statusFlags);
  }

  // ── Telegram-fot: lenke til ERP ──────────────────────────────
  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!forErp && bil.id) {
    text += `\n<a href="https://biladministrasjon.no/cars_driveno/processing/final_estimate/${bil.id}">Åpne i ERP</a>`;
  }
  return text;
}

module.exports = { formatEvalCardHybrid };
