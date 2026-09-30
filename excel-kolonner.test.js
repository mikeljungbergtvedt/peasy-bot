'use strict';
const assert = require('assert');
const { KOL, kanon } = require('./excel-kolonner');
const rad = KOL.map((n, i) => 'v' + i);
const rows = [KOL.slice(), rad, rad.map((x) => x + 'b')];
// Uendret rekkefølge: samme objekt tilbake.
assert.strictEqual(kanon(rows), rows);
// Stokket: samme verdier på samme plass etter navn.
const perm = KOL.map((_, i) => i).reverse();
const stokk = rows.map((r) => perm.map((j) => r[j]));
assert.deepStrictEqual(kanon(stokk), rows);
// Ekstra kolonne først og en som mangler (KM): resten riktig, KM tom, varsel.
let varsel = '';
const utenKm = rows.map((r) => ['ny kolonne'].concat(r.filter((_, i) => i !== 22)));
const k = kanon(utenKm, (m) => { varsel = m; });
assert.strictEqual(k[1][12], 'v12');
assert.strictEqual(k[1][22], undefined);
assert.ok(/KM/.test(varsel));
console.log('excel-kolonner.test.js ok');
