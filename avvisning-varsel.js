'use strict';
// avvisning-varsel.js — kunder som avviser estimatet og skriver grunnen med egne ord → e-post til post@peasy.no.
//
// Kilde: ERP liste «rejected» (nyeste sider) + bilens logg, hendelsen «rejected.by.customer» { comment, reason_id }.
// Egne ord = comment som ikke er et av de faste valgene (reject-reasons.js) og ikke tom.
// Gjelder alle kilder (Peasy, Drive, Ordna, AutoDB). Hver bil varsles én gang (logs.nosync/avvisning-varsel.json).
// Første kjøring: siste 14 dager i én samle-e-post. Deretter én e-post per kjøring med nye.
// Bare lesing fra ERP. Skriver ingenting i ERP.
//
//   node avvisning-varsel.js            vis, send ikke
//   node avvisning-varsel.js --send     send e-post
//   launchd com.peasy.avvisningvarsel (hvert 15. min, --send)

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true, override: true });
const { REJECT_REASONS, reasonLabel } = require('./reject-reasons.js');

const VERSJON = 'avvisning-varsel v1';
const ERP = 'https://api.biladministrasjon.no';
const TIL = process.env.AVVISNING_VARSEL_TIL || 'post@peasy.no';
const STATE = path.join(__dirname, 'logs.nosync', 'avvisning-varsel.json');
const MAALINGER = path.join(__dirname, 'v2', 'logs.nosync', 'measurements.jsonl');
const FORSTE_DAGER = 14;
const SIDER = 3; // nyeste sider av «rejected» (100 per side)

const FASTE = new Set(Object.values(REJECT_REASONS).map((s) => s.toLowerCase().trim()));
const kr = (n) => (n == null || n === '' ? '–' : Math.round(Number(n)).toLocaleString('nb-NO'));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function lesState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) { return null; } }
function skrivState(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s)); }
function norskTid(s) { const m = String(s || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/); return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`) : null; }

function egneOrd(comment) {
  const t = String(comment || '').trim();
  if (!t || /^without comment$/i.test(t) || /^cars\.reject_reason\./i.test(t)) return null; // tom eller ERP-oversettelsesnøkkel
  return FASTE.has(t.toLowerCase()) ? null : t;
}

function finnUtpris(erpId) {
  let rows; try { rows = fs.readFileSync(MAALINGER, 'utf8').split('\n'); } catch (_) { return null; }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!rows[i] || rows[i].indexOf(String(erpId)) === -1) continue;
    try { const r = JSON.parse(rows[i]); if (String(r.erpId) === String(erpId) && r.fossefall && r.fossefall.a) return r.fossefall.a.finn_utpris || null; } catch (_) {}
  }
  return null;
}

async function login() {
  const r = await fetch(ERP + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS }) });
  return (await r.json()).data.token.token;
}

async function nyeAvvisninger(state) {
  const tok = await login();
  const H = { Authorization: 'Bearer ' + tok };
  const forste = await (await fetch(ERP + '/c2b_module/peasy/processing/rejected?per_page=100', { headers: H })).json();
  const siste = (forste.data && forste.data.data && forste.data.data.last_page) || 1;
  let kand = [];
  for (let p = siste; p >= Math.max(1, siste - SIDER + 1); p--) {
    const d = await (await fetch(ERP + '/c2b_module/peasy/processing/rejected?per_page=100&page=' + p, { headers: H })).json();
    kand = kand.concat((d.data && d.data.data && d.data.data.data) || []);
  }
  kand = kand.filter((b) => b && b.status_entity && b.status_entity.status === 'REJECTED_BY_CUSTOMER' && !state.sett[String(b.id)]);
  const grense = state.forste ? Date.now() - FORSTE_DAGER * 864e5 : 0;
  const ut = [];
  for (const b of kand) {
    const c = await (await fetch(ERP + '/c2b_module/peasy/cars/' + b.id, { headers: H })).json();
    const car = (c.data && (c.data.car || c.data)) || {};
    const logg = Array.isArray(car.log) ? car.log : Object.values(car.log || {});
    const hendelse = logg.filter((l) => l && l.event === 'rejected.by.customer').pop();
    state.sett[String(b.id)] = new Date().toISOString();
    if (!hendelse) continue;
    const tid = norskTid(hendelse.created_at);
    if (tid && tid.getTime() < grense) continue;
    const ord = egneOrd(hendelse.data && hendelse.data.comment);
    if (!ord) continue;
    const d = car.driveNoCarData || b.drive_no_car_data || {};
    ut.push({
      id: b.id, regnr: b.registration_number, kilde: b.source || car.source || '',
      bil: [d.manufacturer_name || b.manufacturer, d.model_series, d.model_year].filter(Boolean).join(' '),
      km: car.mileage || d.mileage, lav: car.price_final_min, hoy: car.price_final_max,
      valgt: reasonLabel(hendelse.data.reason_id), ord, tid: hendelse.created_at, finn: finnUtpris(b.id),
    });
  }
  return ut.sort((a, b) => String(norskTid(b.tid)).localeCompare(String(norskTid(a.tid))));
}

function lagEpost(liste, samle) {
  const emne = liste.length === 1
    ? `Kunde skrev: «${liste[0].ord.slice(0, 70)}${liste[0].ord.length > 70 ? '…' : ''}» (${liste[0].regnr})`
    : `${liste.length} kunder skrev hvorfor de avviste${samle ? ' (siste ' + FORSTE_DAGER + ' dager)' : ''}`;
  const blokker = liste.map((x) =>
    `<div style="border-left:4px solid #004225;background:#F6F5F0;border-radius:6px;padding:10px 14px;margin:0 0 12px">` +
    `<div style="font-size:16px;margin:0 0 6px">«${esc(x.ord)}»</div>` +
    `<div style="font-size:13px;color:#5E6B62;line-height:1.5"><b style="color:#16201B">${esc(x.regnr)}</b> · ${esc(x.bil)}${x.km ? ' · ' + kr(x.km) + ' km' : ''} · ${esc(x.kilde)} · intern ${esc(x.id)}<br>` +
    `Estimat ${kr(x.lav)}–${kr(x.hoy)} kr${x.finn ? ' · Finn-utpris ' + kr(x.finn) + ' kr' : ''}<br>` +
    `Valgt grunn: ${esc(x.valgt || '–')} · avvist ${esc(x.tid)}</div></div>`).join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;color:#16201B">` +
    `<p style="margin:0 0 12px">${liste.length === 1 ? 'En kunde' : liste.length + ' kunder'} avviste estimatet og skrev grunnen med egne ord:</p>${blokker}` +
    `<p style="font-size:12px;color:#5E6B62">Faste valg (for eksempel «Prisen var lavere enn forventet») sendes ikke. Sendt automatisk fra Mini (${VERSJON}).</p></div>`;
  const tekst = liste.map((x) => `«${x.ord}»\n${x.regnr} · ${x.bil} · ${x.kilde} · intern ${x.id}\nEstimat ${kr(x.lav)}–${kr(x.hoy)} kr · valgt: ${x.valgt || '–'} · ${x.tid}\n`).join('\n');
  return { emne, html, tekst };
}

async function send(ep) {
  const user = process.env.IMAP_USER || process.env.EMAIL_USER;
  const t = require('nodemailer').createTransport({ host: 'exchange.tornado.email', port: 587, secure: false,
    auth: { user, pass: process.env.IMAP_PASS }, connectionTimeout: 10000, greetingTimeout: 10000 });
  return t.sendMail({ from: 'Peasy Bot <' + user + '>', to: TIL, subject: ep.emne, html: ep.html, text: ep.tekst });
}

module.exports = { egneOrd, lagEpost };

if (require.main === module) {
  (async () => {
    const sende = process.argv.includes('--send');
    const state = lesState() || { forste: true, sett: {} };
    const liste = await nyeAvvisninger(state);
    const samle = !!state.forste;
    console.log(`${new Date().toISOString()} ${liste.length} nye med egne ord${samle ? ' (første kjøring, siste ' + FORSTE_DAGER + ' dager)' : ''}`);
    liste.forEach((x) => console.log(`  ${x.regnr} (${x.id}) «${x.ord.slice(0, 90)}»`));
    if (!sende) { console.log('ikke sendt (kjør med --send)'); return; }
    if (liste.length) { const r = await send(lagEpost(liste, samle)); console.log('sendt til', TIL, r.response.slice(0, 20)); }
    state.forste = false;
    skrivState(state);
  })().catch((e) => { console.error('Feil:', e.message); process.exit(1); });
}
