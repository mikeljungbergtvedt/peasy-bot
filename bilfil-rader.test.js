'use strict';
// node bilfil-rader.test.js — rader fra bilfila i Excel-form, og at hentRader faller tilbake til bilfila når Excel feiler.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { rad, rader, hentRader } = require('./bilfil-rader');
const { KOL } = require('./excel-kolonner');

const bil = {
  id: 2495, regnr: 'VH39365', kilde: 'peasy', liste: 'sold', status: 'sold_and_paid', lav: 84000, hoy: 98000, hoyeste_bud: 57600,
  merke: 'AUDI', modell: 'Q3', aar: 2012, postnr: null, sted: null, sd_mottatt: '2026-05-04', sd_tid: '04.05.2026 12:58',
  estimert: '2026-05-04', estimert_tid: '04.05.2026 13:06', solgt: '2026-05-15', registrert: null, registrert_logg: '2026-05-04',
  finans: false, bud: 63500, avgift: 5900, km: 220000, gire_bestilt: '2026-05-11', gire_tid: '11.05.2026 09:08', levere_selv: null,
  levere_tid: null, mottatt: '2026-05-12', returnert: null,
};

// 1. Én rad: samme verdier og format som Excel-raden for internnr. 2495 (01.10.2026).
const r = rad(bil);
assert.strictEqual(r.length, KOL.length);
assert.deepStrictEqual(
  [r[0], r[1], r[3], r[4], r[5], r[11], r[12], r[13], r[14], r[15], r[16], r[17], r[18], r[19], r[20], r[21], r[22], r[31]],
  [2495, 'VH39365', '84000-98000', 57600, false, 'peasy', 'sold_and_paid', '04.05.2026', '04.05.2026 12:58', '11.05.2026 09:08',
    null, '12.05.2026', '15.05.2026', 63500, '5900', null, 220000, '04.05.2026 13:06']);
assert.strictEqual(r[23], null, 'UTM finnes ikke i bilfila');

// 2. Uten estimat og budrunde: «-» og tomt, som Excel.
const tom = rad({ id: 1, regnr: 'AB12345', bud: null, avgift: null });
assert.strictEqual(tom[3], '-');
assert.strictEqual(tom[4], 0);
assert.strictEqual(tom[19], null);
assert.strictEqual(tom[20], null);

// 3. rader(): header først, bare berikede biler, null når bilfila er for gammel.
const fersk = { bygget: new Date().toISOString(), biler: [bil, { id: 7, regnr: 'X' }] };
const rr = rader(fersk);
assert.deepStrictEqual(rr[0], KOL);
assert.strictEqual(rr.length, 2, 'bil uten berikelse tas ikke med');
assert.strictEqual(rader({ bygget: '2020-01-01T00:00:00Z', biler: [bil] }), null);

// 4. hentRader: Excel feiler → bilfila (fra fil). Bilfila mangler → feilen kastes videre.
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilfil-rader-'));
  const fil = path.join(dir, 'peasy-cars.json');
  fs.writeFileSync(fil, JSON.stringify({ bygget: new Date().toISOString(), biler: Array.from({ length: 1200 }, (_, i) => Object.assign({}, bil, { id: i + 1 })) }));
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503 });
  try {
    const lest = await hentRader({ fil, log: () => {} });
    assert.strictEqual(lest.length, 1201, 'Excel feilet → bilfila');
    assert.deepStrictEqual(lest[0], KOL);
    await assert.rejects(hentRader({ fil: path.join(dir, 'finnes-ikke.json'), log: () => {} }), /503/);
    // ERP_RADER=bilfil: bilfila uten å spørre Excel. trengerExcelFelt: alltid Excel.
    let spurt = 0; global.fetch = async () => { spurt++; return { ok: false, status: 500 }; };
    process.env.ERP_RADER = 'bilfil';
    await hentRader({ fil, log: () => {} });
    assert.strictEqual(spurt, 0, 'bilfil-modus spør ikke Excel');
    await assert.rejects(hentRader({ fil: path.join(dir, 'finnes-ikke.json'), trengerExcelFelt: true, log: () => {} }), /500/);
    assert.strictEqual(spurt, 1);
  } finally { global.fetch = realFetch; delete process.env.ERP_RADER; fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('bilfil-rader.test.js: alle tester OK');
})().catch((e) => { console.error(e); process.exit(1); });
