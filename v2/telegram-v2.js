// telegram-v2.js v0.4
// Format:
//   Header
//   BIL (identifikasjon)
//   ORIGIN PAA FINN (med Finn-links) — kun hvis det finnes origin-annonser
//   RISIKO
//   COMPS - alle kandidater i tabell, valgte markert med <-
//   ANKER
//   KALKYLE
//   Confidence + begrunnelse
//
// Ren tekst, ingen emoji (ERP-safe).

import 'dotenv/config';

const TOKEN = process.env.TELEGRAM_TOKEN_V2;
const CHAT  = process.env.TELEGRAM_CHAT_ID_V2;

export async function sendV2Eval(text) {
  if (!TOKEN || !CHAT) return { ok: false, error: 'config mangler' };
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  // Telegram max 4096 tegn. Vi splitter paa seksjonsoverskrifter (<b>NAVN</b>)
  // saa formateringen aldri brekker midt i HTML-tag eller tabell.
  const MAX = 3800;
  const chunks = [];

  if (text.length <= MAX) {
    chunks.push(text);
  } else {
    // Splitt foran hver <b>OVERSKRIFT</b> som er en seksjons-header
    const parts = text.split(/(?=<b>(?:BIL|ORIGIN|RISIKO|COMPS|BEGRUNNELSE|EKSKLUDERT|ANKER|KALKYLE|Confidence)\b)/);
    let buf = '';
    for (const p of parts) {
      if (!p) continue;
      // Hvis enkeltdel er stoerre enn MAX (uvanlig — typisk lange tabeller)
      // bryt paa linjeskift inni den
      if (p.length > MAX) {
        if (buf) { chunks.push(buf); buf = ''; }
        let rest = p;
        while (rest.length > MAX) {
          let cut = rest.lastIndexOf('\n', MAX);
          if (cut < MAX / 2) cut = MAX;
          // Unngaa kutt midt i <pre>...</pre> hvis mulig
          // (enkel sjekk: hvis den utestaaende delen har en <pre> uten </pre>)
          chunks.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        if (rest) buf = rest;
        continue;
      }
      if ((buf + p).length > MAX) {
        chunks.push(buf);
        buf = p;
      } else {
        buf += p;
      }
    }
    if (buf) chunks.push(buf);
  }

  let lastId = null;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const suffix = chunks.length > 1 ? `\n<i>(${i + 1}/${chunks.length})</i>` : '';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT,
          text: chunks[i] + suffix,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) return { ok: false, error: json.description || `HTTP ${res.status}`, sent: i };
      lastId = json.result.message_id;
    }
    return { ok: true, message_id: lastId, chunks: chunks.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function fmtKr(n) {
  if (!Number.isFinite(Number(n))) return '?';
  return Math.round(Number(n)).toLocaleString('nb-NO') + ' kr';
}
function fmtKm(n) {
  if (!Number.isFinite(Number(n))) return '?';
  return Math.round(Number(n)).toLocaleString('nb-NO') + ' km';
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Padder strenger til en gitt bredde (for tabell-justering i <pre>)
function pad(s, n, alignRight = false) {
  const str = String(s == null ? '' : s);
  if (str.length >= n) return str.slice(0, n);
  const filler = ' '.repeat(n - str.length);
  return alignRight ? filler + str : str + filler;
}

export function buildEvalCard({ regnr, km, anchor, pricing, all_comps, errors }) {
  const id = anchor?.identifikasjon || {};
  const ab = anchor?.anker_beregning || {};
  let risks = anchor?.risiko_flagg || [];
  const origins = anchor?.origin_annonser || [];
  const valgte = anchor?.valgte_comps || [];
  const eks = anchor?.ekskluderte_comps || [];

  // Sett med ident_id som ble valgt — brukes til pil-markering
  const valgteIds = new Set(valgte.map(v => v.ident_id));

  const lines = [];

  lines.push(`<b>V2 SHADOW — ${esc(regnr)} — ${fmtKm(km)}</b>`);
  lines.push('');

  if (errors && errors.length) {
    lines.push(`<b>Advarsler:</b> ${esc(errors.join(' | '))}`);
    lines.push('');
  }

  // BIL
  lines.push(`<b>BIL</b>`);
  lines.push(esc(id.variant || '?'));
  if (id.motor)      lines.push(`Motor: ${esc(id.motor)}`);
  if (id.pakke)      lines.push(`Pakke: ${esc(id.pakke)}`);
  if (id.drivlinje)  lines.push(`Drivlinje: ${esc(id.drivlinje)}`);
  if (id.model_year) lines.push(`Aarsmodell: ${id.model_year}`);
  if (id.fuel)       lines.push(`Drivstoff: ${esc(id.fuel)}`);
  lines.push('');

  // ORIGIN PAA FINN
  if (origins.length) {
    lines.push(`<b>ORIGIN PAA FINN (samme bil)</b>`);
    // Sorter origin etter dato (ferskest forst)
    const sortedOrigin = [...origins].sort((a, b) => {
      const da = a.sold_date || a.published_date || '';
      const db = b.sold_date || b.published_date || '';
      return db.localeCompare(da);
    });
    sortedOrigin.forEach(o => {
      const status = o.is_active ? 'AKTIV' : 'solgt';
      const dato = o.sold_date || o.published_date || '';
      lines.push(`${status} ${esc(dato)} — ${fmtKm(o.km)} — ${fmtKr(o.price)} (${esc(o.type)})`);
      if (o.finn_url) lines.push(`<a href="${esc(o.finn_url)}">${esc(o.finn_url)}</a>`);
    });
    lines.push('');
  }

  // RISIKO — filtrer bort generelle markedstrender (Fallende/Stigende marked er ikke ny info)
  risks = (risks || []).filter(function(r){ var s = String(r||'').toLowerCase(); return !(s.includes('fallende marked') || s.includes('stigende marked') || s.includes('markedsutvikling')); });
  if (risks.length) {
    lines.push(`<b>RISIKO</b>`);
    risks.forEach(r => lines.push(`- ${esc(r)}`));
    lines.push('');
  }

  // VALGTE COMPS — kun de AI faktisk brukte i anker
  if (valgte.length) {
    lines.push(`<b>VALGTE COMPS (${valgte.length})</b>`);
    // Sorter etter pris stigende
    const sorted = [...valgte].sort((a, b) => a.price - b.price);
    sorted.forEach(v => {
      const status = v.status === 'aktiv' ? 'aktiv' : 'solgt';
      const dato = v.dato || '';
      lines.push(
        `${esc(v.licence_plate)} | ${fmtKm(v.km)} | ${fmtKr(v.price)} | ${esc(v.type)} ${status} ${esc(dato)}`
      );
      if (v.begrunnelse) lines.push(`   <i>${esc(v.begrunnelse)}</i>`);
    });
    lines.push('');
  }

  // ANKER
  lines.push(`<b>ANKER</b>`);
  // Snitt av ALLE comps i poolen (kontekst)
  if (all_comps && all_comps.length) {
    const priser = all_comps.map(c => Number(c.price) || 0).filter(p => p > 0);
    const kms = all_comps.map(c => Number(c.km) || 0).filter(k => k > 0);
    if (priser.length && kms.length) {
      const snittPris = Math.round(priser.reduce((a,b) => a + b, 0) / priser.length);
      const snittKm = Math.round(kms.reduce((a,b) => a + b, 0) / kms.length);
      lines.push(`Alle ${all_comps.length} comps:  snitt ${fmtKr(snittPris)}  |  snitt ${fmtKm(snittKm)}`);
    }
  }
  // Snitt av VALGTE comps (de AI plukket ut til anker)
  if (ab.valgte_priser && ab.valgte_priser.length) {
    const snittValgtePris = Math.round(ab.valgte_priser.reduce((a,b) => a + b, 0) / ab.valgte_priser.length);
    if (ab.valgte_km && ab.valgte_km.length === ab.valgte_priser.length) {
      const snittValgteKm = Math.round(ab.valgte_km.reduce((a,b) => a + b, 0) / ab.valgte_km.length);
      lines.push(`Valgte ${ab.valgte_priser.length}:       snitt ${fmtKr(snittValgtePris)}  |  snitt ${fmtKm(snittValgteKm)}`);
    } else {
      lines.push(`Valgte ${ab.valgte_priser.length}:       snitt ${fmtKr(snittValgtePris)}`);
    }
  }
  lines.push(`Bilen:                                  ${fmtKm(km)}`);
  lines.push(`<b>Anker: ${fmtKr(ab.anker)}</b>`);
  if (ab.metode) lines.push(`<i>(${esc(ab.metode)})</i>`);
  lines.push('');

  // KALKYLE
  if (pricing && pricing.dLav) {
    lines.push(`<b>KALKYLE (Easy-formel)</b>`);
    const capNote = '';
    lines.push(`<pre>Bracket: ${esc(pricing.bracket)}
Segment: ${esc(pricing.segment)} (spread +/-${(pricing.spreadPct * 100).toFixed(1)}%)
Anker:        ${fmtKr(pricing.anchorPrice)}
- Margin:     ${fmtKr(pricing.margin)}
= Brutto:     ${fmtKr(pricing.brutto)}
- Peasy fee:  ${fmtKr(pricing.fee)}
= D mid:      ${fmtKr(pricing.dMid)}
D lav:        ${fmtKr(pricing.dLav)}
D hoey:       ${fmtKr(pricing.dHoy)}${capNote}</pre>`);
    lines.push('');
  }

  lines.push(`<b>Confidence: ${anchor?.confidence ?? '?'}/100</b>`);
  if (anchor?.begrunnelse_kort) {
    lines.push(`<i>${esc(anchor.begrunnelse_kort)}</i>`);
  }

  return lines.join('\n');
}
