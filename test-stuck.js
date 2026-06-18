'use strict';
// test-stuck.js — viser stuck-oversikten NAA (read-only, ingen Telegram).
// Logger inn pa ERP, henter liste 8-12, skriver ut samme digest som boten sender 12+15.
// Kjor pa Mini:  cd /Users/bot/peasy-auto && node test-stuck.js

require('dotenv').config();
const BASE = 'https://api.biladministrasjon.no';

const LISTE_DEFS = [
  { nr: 8,  navn: 'AUKSJON AVSLUTTET',   emoji: '🏁', endpoint: 'auction_finished',           vis_bud: true  },
  { nr: 9,  navn: 'VENT. PA BUDAKSEPT',  emoji: '⏳', endpoint: 'waiting_bid_acceptance',     vis_bud: true  },
  { nr: 10, navn: 'VENT. SALGSMELDING',  emoji: '📋', endpoint: 'waiting_for_sale_reaction',  vis_bud: false },
  { nr: 11, navn: 'UFERDIGE KONTRAKTER', emoji: '📝', endpoint: 'incomplete_contract',        vis_bud: false },
  { nr: 12, navn: 'VENTER PÅ SIGNERING', emoji: '✍️', endpoint: 'wait_for_signing',           vis_bud: false },
];

(async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS }),
  });
  const d = await r.json();
  if (!d.success) { console.error('ERP login feilet:', JSON.stringify(d).slice(0, 200)); process.exit(1); }
  const token = d.data.token.token;
  const H = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const seksjoner = [];
  let totalt = 0;
  for (const def of LISTE_DEFS) {
    try {
      const res = await fetch(`${BASE}/c2b_module/peasy/processing/${def.endpoint}?per_page=100`, { headers: H });
      if (!res.ok) { console.log(`Liste ${def.nr} (${def.endpoint}): HTTP ${res.status}`); continue; }
      const data = await res.json();
      const biler = data.data?.data?.data || [];
      console.log(`Liste ${def.nr} (${def.navn}): ${biler.length} biler`);
      if (!biler.length) continue;
      totalt += biler.length;
      const linjer = biler.map(bil => {
        const regnr = bil.registration_number || '?';
        const merke = bil.drive_no_car_data?.make || bil.make || '';
        const modell = bil.drive_no_car_data?.model_series || bil.model_series || '';
        let s = '  ' + regnr + ' | ' + (merke + ' ' + modell).trim();
        if (def.vis_bud) {
          const bud = bil.highest_bid ? bil.highest_bid.toLocaleString('nb-NO') + ' kr' : 'ukjent';
          s += ' | bud ' + bud;
        }
        return s;
      });
      seksjoner.push(def.emoji + ' ' + def.navn + ' (' + biler.length + ')\n' + linjer.join('\n'));
    } catch (e) { console.log(`Liste ${def.nr}: feil — ${e.message}`); }
  }

  console.log('\n========= STUCK-OVERSIKT (slik boten sender kl 12 + 15) =========\n');
  console.log(seksjoner.length
    ? `📋 STUCK-OVERSIKT — ${totalt} biler står på vent\n\n${seksjoner.join('\n\n')}`
    : 'Ingen biler på liste 8-12 akkurat nå.');
})().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
