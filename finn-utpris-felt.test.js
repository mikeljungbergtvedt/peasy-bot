'use strict';
// node finn-utpris-felt.test.js — falsk fetch, sender aldri noe.
const assert = require('assert');
const f = require('./finn-utpris-felt');
const hybrid = require('./eval-card-hybrid');

const TOKEN = 'hemmelig-token-123';
const PAA = { FINN_FELT_SKRIV: '1', SOFTTEAM_BOT_TOKEN: TOKEN };
const logg = [];
const log = (m) => logg.push(m);
const sisteLogg = () => logg[logg.length - 1];

function falsk(svarListe, fang) {
  let i = 0;
  return async (url, init) => {
    if (fang) fang.push({ url, init });
    const s = svarListe[Math.min(i++, svarListe.length - 1)];
    if (s instanceof Error) throw s;
    return { ok: s.status >= 200 && s.status < 300, status: s.status, json: async () => s.body };
  };
}
const OK = (v) => ({ status: 200, body: { success: true, data: { finn_asking_price: v }, message: 'Vellykket' } });
function tidsavbrudd() { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; }

(async () => {
  // ── normalisering ─────────────────────────────────────────
  assert.strictEqual(f.normaliserKr(57000), 57000);
  assert.strictEqual(f.normaliserKr('57000'), 57000);
  assert.strictEqual(f.normaliserKr(56999.5), 57000);
  assert.strictEqual(f.normaliserKr(56999.4), 56999);
  assert.strictEqual(f.normaliserKr(0), null);
  assert.strictEqual(f.normaliserKr(-5), null);
  assert.strictEqual(f.normaliserKr('abc'), null);
  assert.strictEqual(f.normaliserKr(''), null);
  assert.strictEqual(f.normaliserKr(null), null);
  assert.strictEqual(f.normaliserKr(true), null);
  assert.strictEqual(f.normaliserKr(9999999999), null);

  // ── 57000: riktig adresse, body og header ─────────────────
  let fang = [];
  let r = await f.skrivFinnUtpris(4758, 57000, { env: PAA, log, fetchImpl: falsk([OK(57000)], fang) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fang.length, 1);
  assert.strictEqual(fang[0].url, 'https://api.biladministrasjon.no/api/bot/cars/4758/finn-asking-price');
  assert.strictEqual(fang[0].init.method, 'PUT');
  assert.strictEqual(fang[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.strictEqual(fang[0].init.headers.Accept, 'application/json');
  assert.strictEqual(fang[0].init.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(fang[0].init.body), { finn_asking_price: 57000 });
  assert.strictEqual(sisteLogg(), '[finn-felt] 4758 57000 200');

  // ── null tømmer ───────────────────────────────────────────
  fang = [];
  await f.skrivFinnUtpris(4758, null, { env: PAA, log, fetchImpl: falsk([OK(null)], fang) });
  assert.deepStrictEqual(JSON.parse(fang[0].init.body), { finn_asking_price: null });
  assert.strictEqual(sisteLogg(), '[finn-felt] 4758 null 200');

  // ── 0, negativt, tekst → null; desimal → avrundet ─────────
  for (const [inn, ut] of [[0, null], [-5, null], ['abc', null], [123.6, 124]]) {
    fang = [];
    await f.skrivFinnUtpris(1, inn, { env: PAA, log, fetchImpl: falsk([OK(ut)], fang) });
    assert.deepStrictEqual(JSON.parse(fang[0].init.body), { finn_asking_price: ut }, 'inn ' + inn);
  }

  // ── 4xx: logges, kaster ikke, ingen nytt forsøk ───────────
  for (const status of [401, 403, 404, 409, 422]) {
    fang = [];
    r = await f.skrivFinnUtpris(4758, 57000, { env: PAA, log, fetchImpl: falsk([{ status, body: { message: 'x' } }], fang) });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.status, status);
    assert.strictEqual(fang.length, 1, 'ingen nytt forsøk ved ' + status);
    assert.ok(sisteLogg().startsWith('[finn-felt] 4758 57000 ' + status), sisteLogg());
  }

  // ── 500 → ett nytt forsøk (lykkes) ────────────────────────
  fang = [];
  r = await f.skrivFinnUtpris(4758, 57000, { env: PAA, log, fetchImpl: falsk([{ status: 500, body: {} }, OK(57000)], fang) });
  assert.strictEqual(fang.length, 2); assert.strictEqual(r.ok, true);
  // 500 to ganger → to kall, logget feil
  fang = [];
  r = await f.skrivFinnUtpris(4758, 57000, { env: PAA, log, fetchImpl: falsk([{ status: 502, body: {} }, { status: 503, body: {} }], fang) });
  assert.strictEqual(fang.length, 2); assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 503);

  // ── tidsavbrudd → ett nytt forsøk, så logget feil ─────────
  fang = [];
  r = await f.skrivFinnUtpris(4758, 57000, { env: PAA, log, fetchImpl: falsk([tidsavbrudd(), tidsavbrudd()], fang) });
  assert.strictEqual(fang.length, 2); assert.strictEqual(r.ok, false);
  assert.strictEqual(sisteLogg(), '[finn-felt] 4758 57000 FEIL: tidsavbrudd');
  // nettverksfeil → nytt forsøk som lykkes
  fang = [];
  r = await f.skrivFinnUtpris(4758, 57000, { env: PAA, log, fetchImpl: falsk([new Error('ECONNRESET'), OK(57000)], fang) });
  assert.strictEqual(fang.length, 2); assert.strictEqual(r.ok, true);

  // ── manglende token → tydelig logg, ingen kall ────────────
  fang = [];
  r = await f.skrivFinnUtpris(4758, 57000, { env: { FINN_FELT_SKRIV: '1' }, log, fetchImpl: falsk([OK(1)], fang) });
  assert.strictEqual(fang.length, 0); assert.strictEqual(r.skipped, 'mangler token');
  assert.match(sisteLogg(), /SOFTTEAM_BOT_TOKEN mangler/);

  // ── flagg: 0 / mangler → ingen kall og ingen logg; dry → ingen kall, én logglinje ──
  for (const env of [{}, { FINN_FELT_SKRIV: '0' }, Object.assign({}, PAA, { FINN_FELT_SKRIV: '0' })]) {
    fang = []; const n = logg.length;
    r = await f.skrivFinnUtpris(4758, 57000, { env, log, fetchImpl: falsk([OK(1)], fang) });
    assert.strictEqual(fang.length, 0); assert.strictEqual(r.skipped, 'flagg av'); assert.strictEqual(logg.length, n);
  }
  fang = [];
  r = await f.skrivFinnUtpris(4758, 57000, { env: Object.assign({}, PAA, { FINN_FELT_SKRIV: 'dry' }), log, fetchImpl: falsk([OK(1)], fang) });
  assert.strictEqual(fang.length, 0); assert.strictEqual(r.skipped, 'dry');
  assert.strictEqual(sisteLogg(), '[finn-felt] 4758 57000 dry');

  // ── FINN_FELT_URL overstyrer; ugyldig erpId ───────────────
  fang = [];
  await f.skrivFinnUtpris(12, 1000, { env: Object.assign({ FINN_FELT_URL: 'https://x.test/cars/{carId}/f' }, PAA), log, fetchImpl: falsk([OK(1000)], fang) });
  assert.strictEqual(fang[0].url, 'https://x.test/cars/12/f');
  r = await f.skrivFinnUtpris('abc', 57000, { env: PAA, log });
  assert.strictEqual(r.skipped, 'ugyldig erpId');

  // ── arm-valg: A gir A sin, B gir B sin, Ordna gir Ordna sin ─
  const card = { a: { finn_utpris: 57000 }, b: { finn_utpris: 61000 }, ordna: { finn_utpris: 50000 } };
  assert.strictEqual(f.velgFinnUtpris({ card, arm: 'A' }), 57000);
  assert.strictEqual(f.velgFinnUtpris({ card, arm: 'B' }), 61000);
  assert.strictEqual(f.velgFinnUtpris({ card, arm: 'O' }), 50000);
  assert.strictEqual(f.velgFinnUtpris({ card, arm: 'ORDNA' }), 50000);
  // bare kundens egen annonse / ingen comps → null
  assert.strictEqual(f.velgFinnUtpris({ kommentar: 57000, card, arm: 'A', kilde: 'kun_kundens_annonse' }), null);
  assert.strictEqual(f.velgFinnUtpris({ kommentar: 57000, card, arm: 'A', grunn: 'kun kundens annonse' }), null);
  assert.strictEqual(f.velgFinnUtpris({ kommentar: 57000, card, arm: 'A', kunKundensAnnonse: true }), null);
  assert.strictEqual(f.velgFinnUtpris({ card: { a: { finn_utpris: 57000, finn_utpris_grunn: 'kun kundens annonse' } }, arm: 'A' }), null);
  assert.strictEqual(f.velgFinnUtpris({ kommentar: 57000, antallComps: 0 }), null);
  assert.strictEqual(f.velgFinnUtpris({ card: { a: { finn_utpris: null } }, arm: 'A' }), null);

  // ── likt tallet under FINN-UTPRIS i kommentaren (eval-card-hybrid.js) ──
  function kommentarTall(p) {
    const t = hybrid.formatEvalCardHybrid(p, true);
    const m = t.match(/FINN-UTPRIS\n\s*Finn-utpris:\s+([\d\s ]+)\s*kr/);
    return m ? Number(m[1].replace(/[\s ]/g, '')) : null;
  }
  const comps = [{ km: 250000, price: 60000 }, { km: 240000, price: 55000 }];
  const p1 = { bil: { id: 4758, source: 'peasy', mileage: 267000, model_year: 2012 }, vegData: {}, valuation: {}, seg: {},
    anchor: { valgte_comps: comps, anker_beregning: { anker: 57000 } } };
  assert.strictEqual(kommentarTall(p1), 57000);
  assert.strictEqual(f.kommentarFinnUtpris(p1), kommentarTall(p1));
  assert.strictEqual(f.velgFinnUtpris({ kommentar: f.kommentarFinnUtpris(p1), card, arm: 'B' }), 57000, 'kommentaren vinner over kortet');
  const p2 = Object.assign({}, p1, { cappedFrom: 80000, anchorUsed: 71000 });
  assert.strictEqual(f.kommentarFinnUtpris(p2), kommentarTall(p2));
  assert.strictEqual(f.kommentarFinnUtpris(p2), 71000);
  const p3 = Object.assign({}, p1, { anchor: { valgte_comps: comps, anker_beregning: { anker: 123456 } } });
  assert.strictEqual(f.kommentarFinnUtpris(p3), kommentarTall(p3));

  // ── tokenet står aldri i loggen ───────────────────────────
  assert.ok(logg.every((l) => l.indexOf(TOKEN) === -1), 'token lekket i logg');

  console.log('finn-utpris-felt.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
