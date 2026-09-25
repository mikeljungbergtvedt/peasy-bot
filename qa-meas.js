'use strict';
// qa-meas.js — målingene for bare de bilene Pulse ber om (liste 3).
// QA i Pulse slapp å laste hele measurements.jsonl (32 MB) + v3g-measurements.jsonl (24 MB)
// for å finne noen få biler. GET /qa/meas?src=v2|v3g&ids=4997,4995&regs=BS50672,VH71757
// Svarer med de samme JSONL-linjene som /measurements og /v3g-measurements, bare filtrert.
const fs = require('fs');

const FILES = {
  v2: '/Users/bot/peasy-auto/v2/logs.nosync/measurements.jsonl',
  v3g: '/Users/bot/peasy-auto/v3g/logs.nosync/v3g-measurements.jsonl',
};
const MAKS = 300;
const RE_REG = /"regnr"\s*:\s*"([^"]*)"/;
const RE_ID = /"erpId"\s*:\s*"?(\d+)/;

function liste(s, re) {
  const ut = [];
  for (const x of String(s || '').split(',')) {
    const v = x.trim();
    if (re.test(v) && ut.indexOf(v) < 0) ut.push(v);
    if (ut.length >= MAKS) break;
  }
  return ut;
}

function normReg(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '');
}

// Første regnr/erpId i linja er radens egne (de står først i hver måling).
// Finnes de ikke i de første 4 000 tegnene, parses hele linja.
function nokler(line) {
  const hode = line.slice(0, 4000);
  let reg = (hode.match(RE_REG) || [])[1];
  let id = (hode.match(RE_ID) || [])[1];
  if (reg == null || id == null) {
    try {
      const o = JSON.parse(line);
      if (reg == null && o.regnr != null) reg = String(o.regnr);
      if (id == null && o.erpId != null) id = String(o.erpId);
    } catch (e) { return null; }
  }
  return { reg: normReg(reg), id: id == null ? '' : String(id) };
}

// Pulse bruker bare den nyeste målingen per bil (+ rader som viser at estimatet er sendt).
// Derfor: de siste SISTE radene per bil, pluss alle rader med sendt-markør.
const SISTE = 10;
const RE_SENDT = /"(fe_created_at|order_delivery(_at)?)"\s*:\s*"[0-9]/;

function filtrerJsonl(text, ids, regs, siste) {
  const cap = siste || SISTE;
  const idSet = new Set(ids.map(String));
  const regSet = new Set(regs.map(normReg));
  const treff = [];
  const perBil = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const k = nokler(line);
    if (!k) continue;
    if (!((k.reg && regSet.has(k.reg)) || (k.id && idSet.has(k.id)))) continue;
    const bil = k.id || k.reg;
    const i = treff.length;
    treff.push({ line, keep: RE_SENDT.test(line) });
    if (!perBil.has(bil)) perBil.set(bil, []);
    perBil.get(bil).push(i);
  }
  for (const idx of perBil.values()) {
    for (const i of idx.slice(-cap)) treff[i].keep = true;
  }
  const ut = treff.filter(t => t.keep).map(t => t.line);
  return ut.length ? ut.join('\n') + '\n' : '';
}

function qaMeasSvar(params, files) {
  const f = files || FILES;
  const src = params.get('src') === 'v3g' ? 'v3g' : 'v2';
  const ids = liste(params.get('ids'), /^\d{1,9}$/);
  const regs = liste(normReg(params.get('regs')), /^[A-Z0-9]{2,10}$/);
  if (!ids.length && !regs.length) return { status: 400, body: 'ids eller regs mangler' };
  const file = f[src];
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return { status: 200, body: filtrerJsonl(text, ids, regs) };
}

module.exports = { qaMeasSvar, filtrerJsonl, FILES };
