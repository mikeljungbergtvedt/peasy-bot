'use strict';
// publiser-maalinger: bare tillegg, eksisterende linjer (med backsync-utfall) røres ikke.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const p = require('./publiser-maalinger');

const L = (o) => JSON.stringify(o);
// nyeLinjer
const remote = [L({ regnr: 'AA1', timestamp: 't1', evaluator: 'easy', outcome: { bud_amount: 5 } })].join('\n') + '\n';
const lokal = [
  L({ regnr: 'AA1', timestamp: 't1', evaluator: 'easy' }),          // finnes (uten utfall lokalt)
  L({ regnr: 'BB2', timestamp: 't2', evaluator: 'easy' }),          // ny
  L({ regnr: 'BB2', timestamp: 't2', evaluator: 'easy' }),          // dublett lokalt
  L({ regnr: 'BB2', timestamp: 't3', evaluator: 'easy' }),          // ny (QA-omprising)
  '{ødelagt',
  L({ timestamp: 't4' }),                                           // uten regnr
].join('\n');
const nye = p.nyeLinjer(lokal, remote);
assert.strictEqual(nye.length, 2);
assert.ok(nye.every((l) => JSON.parse(l).regnr === 'BB2'));

// Ekte git: origin + klone
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
g(T, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
g(T, 'clone', '-q', path.join(T, 'origin.git'), 'klone');
const K = path.join(T, 'klone');
g(K, 'config', 'user.email', 't@t'); g(K, 'config', 'user.name', 't');
g(K, 'checkout', '-q', '-b', 'main');
fs.writeFileSync(path.join(K, 'v2-measurements.jsonl'), remote.trimEnd()); // uten linjeskift på slutten
g(K, 'add', '.'); g(K, 'commit', '-q', '-m', 'start'); g(K, 'push', '-q', 'origin', 'main');
const lokalFil = path.join(T, 'lokal.jsonl');
fs.writeFileSync(lokalFil, lokal);
const r = p.publiserMaalinger({ lokal: lokalFil, klone: K, log: () => {} });
assert.deepStrictEqual(r, { lagtTil: 2 });
const ut = g(T, '--git-dir', path.join(T, 'origin.git'), 'show', 'main:v2-measurements.jsonl');
const linjer = ut.trim().split('\n').map((l) => JSON.parse(l));
assert.strictEqual(linjer.length, 3);
assert.deepStrictEqual(linjer[0].outcome, { bud_amount: 5 }, 'utfallet fra backsync står');
assert.deepStrictEqual(linjer.map((x) => x.timestamp), ['t1', 't2', 't3']);
// Andre kjøring: ingenting nytt, ingen commit
const antall = g(K, 'rev-list', '--count', 'HEAD');
assert.deepStrictEqual(p.publiserMaalinger({ lokal: lokalFil, klone: K, log: () => {} }), { lagtTil: 0 });
assert.strictEqual(g(K, 'rev-list', '--count', 'HEAD'), antall);
// Uten klone: feil, men kaster ikke
assert.ok(p.publiserMaalinger({ lokal: lokalFil, klone: path.join(T, 'finnes-ikke'), log: () => {} }).feil);
fs.rmSync(T, { recursive: true, force: true });
console.log('publiser-maalinger.test.js OK');
