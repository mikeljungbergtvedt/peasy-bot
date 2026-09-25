'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { qaMeasSvar, filtrerJsonl } = require('./qa-meas.js');

const rader = [
  { evaluator: 'easy', regnr: 'BS50672', erpId: 4997, easy: { finn_utpris: 197000 } },
  { evaluator: 'easy', regnr: 'AA11111', erpId: 1, easy: { note: 'nevner BS50672 i teksten' } },
  { evaluator: 'easy', regnr: 'VH71757', erpId: '4995', v3g: { regnr: 'XX99999' } },
  { evaluator: 'easy', regnr: 'CC22222', erpId: 49971 },
];
const text = rader.map(r => JSON.stringify(r)).join('\n') + '\n{ødelagt\n';

// regnr i fritekst eller nestet objekt skal ikke gi treff
let ut = filtrerJsonl(text, [], ['BS50672']).trim().split('\n');
assert.strictEqual(ut.length, 1);
assert.strictEqual(JSON.parse(ut[0]).erpId, 4997);

// erpId som tall og som streng, ikke delvis treff (49971 ≠ 4997)
ut = filtrerJsonl(text, ['4997', '4995'], []).trim().split('\n').map(l => JSON.parse(l).regnr);
assert.deepStrictEqual(ut, ['BS50672', 'VH71757']);

// ingen treff → tom tekst
assert.strictEqual(filtrerJsonl(text, ['123'], ['ZZ00000']), '');

// endepunktet: filvalg, validering og manglende fil
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qameas-'));
const v2 = path.join(dir, 'm.jsonl');
fs.writeFileSync(v2, text);
const files = { v2, v3g: path.join(dir, 'finnes-ikke.jsonl') };
let r = qaMeasSvar(new URLSearchParams('src=v2&regs=bs50672,VH71757'), files);
assert.strictEqual(r.status, 200);
assert.strictEqual(r.body.trim().split('\n').length, 2);
r = qaMeasSvar(new URLSearchParams('src=v3g&ids=4997'), files);
assert.strictEqual(r.status, 200);
assert.strictEqual(r.body, '');
r = qaMeasSvar(new URLSearchParams('src=v2&ids=abc&regs=;drop'), files);
assert.strictEqual(r.status, 400);
// maks 10 siste per bil, men rader med sendt-markør beholdes alltid
const mange = [];
for (let i = 0; i < 25; i++) mange.push(JSON.stringify({ regnr: 'DD33333', erpId: 7, n: i, milestones: i === 2 ? { fe_created_at: '2026-09-01 10:00:00' } : {} }));
const kapp = filtrerJsonl(mange.join('\n'), ['7'], []).trim().split('\n').map(l => JSON.parse(l).n);
assert.deepStrictEqual(kapp, [2, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
console.log('qa-meas.test.js OK');
