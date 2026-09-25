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

const { formatFossefallBlock } = require('./fossefall-card');

const { scopeHeadline } = require('./biltype-gate');

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
  const srcRaw = String(bil.source || '').toLowerCase();
  const source = srcRaw === 'driveno' ? 'DRIVE' : (srcRaw === 'ordna' ? 'ORDNA' : 'PEASY');
  const qaTag = p.qaOverride ? ' ⚡ QA OVERRIDE' : '';
  out.push(B(`${source} BIL TIL ESTIMERING${qaTag}`));

  const scopeGate = p.utenforScope || p.biltypeGate;
  if (scopeGate && scopeGate.utenfor_scope) {
    out.push(B(scopeHeadline(scopeGate)));
    if (scopeGate.fant) out.push(forErp ? `Fant: ${scopeGate.fant}` : I(`Fant: ${E(scopeGate.fant)}`));
    out.push('');
  }

  // ── 2. Bil-linje ─────────────────────────────────────────────
  const prop = veg.propulsion || (veg.isHybrid ? 'HYBRID' : ((veg.fuel || '').toLowerCase().includes('elektr') && !/\+|hybrid/i.test(veg.fuel || '') ? 'EV' : 'FOSSIL'));
  const isEl = prop === 'EV';
  const hkStr = isEl
    ? (veg.range ? `${veg.range} km rekkevidde` : `${veg.kw || '?'} kW`)
    : (prop === 'HYBRID'
      ? (veg.drive ? `${veg.drive} hybrid` : 'hybrid')
      : (veg.hk ? `${veg.hk} hk` : (veg.kw ? `${veg.kw} kW` : '')));
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
  // v20.70: km-override-linje (vises kun når oppgitt km ble overstyrt av EU-kontroll)
  // v20.96: Km endret-linjen fjernet — bot korrigerer ikke km lenger
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
    `Finn-utpris: ${rpad(p.cappedFrom ? p.anchorUsed : ab.anker)} kr   (${comps.length} comps${breakdown ? ': ' + breakdown : ''})${p.cappedFrom ? '  ← capet fra ' + nf(p.cappedFrom) + ' kr' : ''}`,
    avgKm ? `Snitt km: ${rpad(avgKm)}      (${kmDiff >= 0 ? '+' : '-'}${nf(Math.abs(kmDiff))} vs origin)` : null,
    avgKm ? `Spenn:    ${(Math.round(minKm / 1000) + 'k-' + Math.round(maxKm / 1000) + 'k km').padStart(13)}` : null,
  ].filter(Boolean).join('\n');
  out.push(B('FINN-UTPRIS'));
  out.push(forErp ? ankerTab : `<pre>${esc(ankerTab)}</pre>`);
  if (variant) out.push(`Variant: ${E(variant)}`);
  if (p.cappedFrom) out.push(`⚠️ Anker capet til aktiv Finn-annonse: ${nf(p.anchorUsed)} kr (fra ${nf(p.cappedFrom)} kr)`);
  out.push('');

  // ── 6b. ORIGIN PÅ FINN ───────────────────────────────────────
  if (p.finnListing && p.finnListing.link) {
    const fl = p.finnListing;
    const via = fl.queriedBy === 'vin' ? 'funnet på VIN' : (fl.queriedBy === 'regnr' ? 'funnet på regnr' : 'funnet på Finn');
    const pris = fl.price ? nf(fl.price) + ' kr' : '';
    const line = 'ORIGIN PÅ FINN (' + via + ')' + (pris ? ' — ' + pris : '');
    if (forErp) {
      out.push(B(line));
      out.push(fl.link);
    } else {
      out.push('<b style="color:#E65100">' + esc(line) + '</b>');
      out.push('<a href="' + esc(fl.link) + '">' + esc(fl.link) + '</a>');
    }
    if (p.cappedFrom) out.push('⚠️ Anker capet mot annonsepris × 0,95');
  } else {
    out.push(B('ORIGIN PÅ FINN'));
    out.push(forErp ? 'Ikke funnet (søkt regnr + VIN)' : 'Ikke funnet (søkt regnr + VIN)');
  }
  const makeQ2 = String(veg.make || '').split(' ')[0];
  const modelQ2 = String(bil.model_series || veg.model || '').split('/')[0].split(/\s+/).slice(0, 2).join(' ').trim();
  const finnSokUrl = 'https://www.finn.no/mobility/search/car?registration_class=1&sort=PRICE_ASC&q=' + encodeURIComponent((makeQ2 + ' ' + modelQ2).trim()) + (bil.model_year ? '&year_from=' + bil.model_year + '&year_to=' + bil.model_year : '') + (originKm ? '&mileage_from=' + (Math.round(originKm * 0.85 / 1000) * 1000) + '&mileage_to=' + (Math.round(originKm * 1.25 / 1000) * 1000) : '');
  const carInfoUrl2 = 'https://www.car.info/no-no/valuation/N/' + String(bil.registration_number || '').replace(/\s/g, '');
  const finnFunnelUrl = p.finnUrl || finnSokUrl;
  out.push(forErp ? ('Sok sosterbiler pa Finn (AI builder): ' + finnFunnelUrl) : ('<a href="' + esc(finnFunnelUrl) + '">\u{1F50D} S\u00f8k s\u00f8sterbiler p\u00e5 Finn (AI builder)</a>'));
  out.push(forErp ? ('Car.info verdivurdering: ' + carInfoUrl2) : ('<a href="' + esc(carInfoUrl2) + '">Car.info verdivurdering</a>'));
  out.push('');

  // ── 6c. FOSSEFALL (primær) — midt, lav, høy, celle/tables path (PR#11)
  const ffPrimary = p.fossefall || (p.valuation && p.valuation.fossefall) || null;
  const ffBlockPrimary = formatFossefallBlock(ffPrimary);
  out.push(forErp ? ffBlockPrimary : `<pre>${esc(ffBlockPrimary)}</pre>`);
  out.push('');

  // ── 7. KALKYLE (fossefall fra measurements — én arm)
  const ff = p.fossefall || null;
  const writeArmRaw = String(p.writeArm || p.skrivArm || 'A').toUpperCase();
  const writeArm = writeArmRaw === 'O' || writeArmRaw === 'ORDNA' ? 'O' : (writeArmRaw === 'B' ? 'B' : 'A');
  const armLabel = writeArm === 'O' ? 'Ordna' : writeArm;
  const armKey = writeArm === 'O' ? 'ordna' : (writeArm === 'B' ? 'b' : 'a');
  const arm = ff && typeof ff === 'object' ? ff[armKey] : null;

  function ffKr(n, signed) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '–';
    const abs = Math.abs(Math.round(x)).toLocaleString('nb-NO');
    if (x < 0) return '−' + abs;
    if (signed && x > 0) return '+' + abs;
    return abs;
  }
  function ffCell(v, signed) {
    if (v == null) return '–';
    if (typeof v === 'object' && (v.lav != null || v.hoy != null)) {
      const lav = Number(v.lav), hoy = Number(v.hoy);
      if (!Number.isFinite(lav) && !Number.isFinite(hoy)) return '–';
      if (!Number.isFinite(hoy) || lav === hoy) return ffKr(Number.isFinite(lav) ? lav : hoy, signed);
      if (!Number.isFinite(lav)) return ffKr(hoy, signed);
      return ffKr(lav, signed) + ' / ' + ffKr(hoy, signed);
    }
    return ffKr(v, signed);
  }
  function ffAvvikLine(a) {
    if (!a || !a.avvik_kr || typeof a.avvik_kr !== 'object') return '';
    const av = a.avvik_kr;
    const lav = Number(av.lav), hoy = Number(av.hoy);
    const hasLav = Number.isFinite(lav) && lav !== 0;
    const hasHoy = Number.isFinite(hoy) && hoy !== 0;
    if (!hasLav && !hasHoy) return '';
    let nums;
    if (hasLav && hasHoy && lav !== hoy) nums = ffKr(lav, true) + ' / ' + ffKr(hoy, true);
    else nums = ffKr(hasLav ? lav : hoy, true);
    const aarsak = av.aarsak ? (' · ' + String(av.aarsak)) : '';
    return `Avvik:          ${nums}${aarsak}`;
  }

  let kalkyleBody;
  if (!arm) {
    kalkyleBody = 'Fossefall mangler i measurements';
  } else {
    const utakst = arm.usikkerhet_takst != null ? arm.usikkerhet_takst : arm.spenn;
    const tilleggBud = arm.forhandlermargin_tillegg_bud;
    function sideNum(v, side) {
      if (v == null) return 0;
      if (typeof v === 'object') {
        const n = Number(side === 'hoy' ? v.hoy : v.lav);
        return Number.isFinite(n) ? n : 0;
      }
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    const marginBase = Number(arm.forhandlermargin) || 0;
    const marginTot = {
      lav: marginBase + sideNum(tilleggBud, 'lav'),
      hoy: marginBase + sideNum(tilleggBud, 'hoy'),
    };
    const layers = [
      ['Finn-utpris', arm.finn_utpris, false],
      ['Origin-cap', arm.origin_cap, true],
      ['Forhandlermargin', marginTot, true],
      ['Avsetning takst', arm.avsetning_takst, true], // v20.165: manglet — summen gikk ikke opp
      ['Ståtid', arm.statid, true],
      ['Omregistrering', arm.omregistrering, true],
      ['Transport', arm.transport, true],
      ['Klargjøring', arm.klargjoring, true],
      ['AR-salær', arm.salaer_ar, true], // v20.165: manglet
      ['Usikkerhet takst', utakst, true],
      ['Ordna-trekk', arm.ordna_trekk, true],
      ['Vrakpant-gulv', arm.vrakpant_gulv, true],
      ['Avrunding', arm.avrunding, true],
      ['Peasy-avgift', arm.peasy_avgift, true],
    ];
    const lines = [`Arm:             ${armLabel}`];
    {
      const mid = arm.peasy_bud_mid != null ? arm.peasy_bud_mid : arm.estimertPeasyBud;
      if (mid != null && Number.isFinite(Number(mid))) {
        lines.push(('Peasy-bud midt:').padEnd(17) + ' ' + ffKr(mid, false));
      }
    }
    const grunnKun = arm.finn_utpris_grunn === 'kun kundens annonse' || arm.finn_utpris_grunn === 'kun_kundens_annonse' || arm.finn_utpris_kilde === 'kun_kundens_annonse';
    if (grunnKun) {
      const ap = Number(arm.annonsepris);
      const apTxt = Number.isFinite(ap) ? Math.round(ap).toLocaleString('nb-NO') : '–';
      lines.push('⚠ Finn-utpris kun fra kundens annonse (' + apTxt + ' × 0,95)');
    }
    function layerZero(val) {
      if (val == null) return true;
      if (typeof val === 'object') {
        const lav = Number(val.lav), hoy = Number(val.hoy);
        return (!Number.isFinite(lav) || lav === 0) && (!Number.isFinite(hoy) || hoy === 0);
      }
      return Number(val) === 0;
    }
    for (const [lab, val, signed] of layers) {
      if (lab !== 'Finn-utpris' && lab !== 'Forhandlermargin' && lab !== 'Peasy-avgift' && layerZero(val)) continue;
      if (lab === 'Origin-cap') {
        const foer = Number(arm.chefs_foer_cap);
        const tak = Number(arm.origin_cap_tak != null ? arm.origin_cap_tak : arm.finn_utpris);
        let cell = ffCell(val, signed);
        if (Number.isFinite(foer) && Number.isFinite(tak) && !layerZero(val)) {
          cell += ' · ' + Math.round(foer).toLocaleString('nb-NO') + ' → ' + Math.round(tak).toLocaleString('nb-NO');
        }
        lines.push(((lab + ':').padEnd(17) + ' ') + cell);
        continue;
      }
      if (lab === 'Forhandlermargin') {
        // Locked 2026-09-23: no herav 8%/12% (or other herav) rows.
        lines.push(((lab + ':').padEnd(17) + ' ') + ffCell(val, signed));
        continue;
      }
      lines.push(((lab + ':').padEnd(17) + ' ') + ffCell(val, signed));
    }
    if (ff && ff.statid_manuell && writeArm === 'A' && !layerZero(arm.statid)) {
      lines.push('Ståtid over 60 d, vurder manuelt');
    }
    // v20.165: B/Ordna er A-midt × skala. Vis steget, ellers går ikke summen opp.
    const skala = Number(arm.arm_scale);
    if (Number.isFinite(skala) && skala !== 1 && ff && ff.a && ff.a.peasy_bud_mid != null) {
      lines.push(((`${armLabel} = A × ${String(skala).replace('.', ',')}:`).padEnd(17) + ' ') + ffKr(ff.a.peasy_bud_mid, false) + ' → ' + ffKr(arm.peasy_bud_mid, false));
    }
    const lav = Number(arm.lav), hoy = Number(arm.hoy);
    const lh = (!Number.isFinite(lav) && !Number.isFinite(hoy))
      ? '–'
      : (!Number.isFinite(hoy) ? ffKr(lav, false)
        : (!Number.isFinite(lav) ? ffKr(hoy, false)
          : (Math.round(lav).toLocaleString('nb-NO') + ' – ' + Math.round(hoy).toLocaleString('nb-NO'))));
    lines.push(`Lav – høy:       ${lh}`);
    const avLin = ffAvvikLine(arm);
    if (avLin) lines.push(avLin);
    if (val.dLav != null && val.dLav <= 0) lines.push('QA: D lav ≤ 0 — ugyldig kalkyle, ikke send');
    kalkyleBody = lines.join('\n');
  }
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
    const skipBy = p.erpSkipBy || null; // 'A' | 'B' | 'Ordna' når annen arm eier skriv
    let dLavLine;
    if (p.erpWritten) dLavLine = '✅ D lav/høy skrevet';
    else if (skipBy) dLavLine = 'ERP: skrives av ' + skipBy;
    else dLavLine = '❌ D lav/høy feilet';
    const statusFlags = [
      dLavLine,
      (p.erpWritten || v.auctionType) ? '✅ Auction type satt' : (skipBy ? ('ERP: skrives av ' + skipBy) : '❌ Auction type feilet'),
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
