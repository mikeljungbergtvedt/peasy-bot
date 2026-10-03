'use strict';
// node vrakpant-absurd.test.js — billige biler går til vrakpant-gulvet, ikke «absurd midt/Finn» (v20.175, AE15238 03.10).
// Satsene er et øyeblikksbilde av Innstillinger 03.10.2026 (vrakpant-absurd.fixture.json), så testen er lik hver gang.
const assert = require('assert');
const ff = require('./fossefall');
const fixture = require('./vrakpant-absurd.fixture.json');

(async () => {
  await ff.loadFossefallSatser({ force: true, fetch: async () => ({ ok: true, json: async () => fixture }) });
  const pris = (finn, km) => ff.buildSharedFossefall({ finnUtpris: finn, km, modelYear: 2008 });

  // AE15238: Finn 23 000, 294 000 km. Midt ~3 000 → vrakpant-gulv, ikke PRIS MANUELT.
  const ae = pris(23000, 294000);
  assert.ok(!ae.pris_manuelt, 'Finn 23 000 skal ikke være PRIS MANUELT: ' + ae.grunn);
  assert.ok(ae.a.lav >= 3000 && ae.a.hoy >= 5000, 'vrakpant-gulv: lav ≥ 3000, høy ≥ 5000');

  // Negativ verdi (Finn 15 000) får fortsatt vrakpant-gulvet.
  const lav = pris(15000, 294000);
  assert.ok(!lav.pris_manuelt);
  assert.deepStrictEqual([lav.a.lav, lav.a.hoy], [3000, 5000]);

  // Vanlig bil (Finn 65 000) prises som før.
  const normal = pris(65000, 294000);
  assert.ok(!normal.pris_manuelt, 'Finn 65 000 med vanlige satser er OK');

  console.log('vrakpant-absurd.test.js ok');
  console.log('  Finn 23 000 → ' + ae.a.lav + '–' + ae.a.hoy + ' · Finn 15 000 → ' + lav.a.lav + '–' + lav.a.hoy + ' · Finn 65 000 → ' + normal.a.lav + '–' + normal.a.hoy);
})().catch((e) => { console.error(e); process.exit(1); });
