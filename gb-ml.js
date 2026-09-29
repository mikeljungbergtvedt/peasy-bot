'use strict';
/**
 * gb-ml.js — isolert GB-ML-motor (skyggesti for GB-fanen i Pulse).
 *
 * reg.nr -> Car.info-cache (kun lesing, ingen nye Car.info-kall) -> Finn-annonser for samme merke/modell
 * (gb-ml/fetch_finn.py, curl, 0,5 s pause) -> gb-ml/train.py (Finn-trent modell) -> JSON til GB-fanen.
 *
 * Rører ikke estimate()/gb-utpris.js, ERP, liste 3, QA SEND eller fossefall.
 * Skriver kun til GB_ML_CACHE (default: <os.tmpdir()>/gb-ml), aldri inn i repoet.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const ENGINE = path.join(ROOT, 'gb-ml');
const CACHE = process.env.GB_ML_CACHE || path.join(os.tmpdir(), 'gb-ml');
const PY = process.env.GB_ML_PYTHON || (fs.existsSync(path.join(ENGINE, '.venv', 'bin', 'python3'))
  ? path.join(ENGINE, '.venv', 'bin', 'python3') : 'python3');
const RESULT_TTL_MS = Number(process.env.GB_ML_RESULT_TTL_H || 12) * 3600e3;
const FINN_TTL_MS = Number(process.env.GB_ML_FINN_TTL_H || 24) * 3600e3;
const MAX_ADS = Number(process.env.GB_ML_MAX_ADS || 350);
const DELAY = Number(process.env.GB_ML_DELAY_S || 0.5);

const jobs = new Map(); // regnr -> { started_at, phase, err }

function normRegnr(s) { return String(s || '').toUpperCase().replace(/[\s-]/g, ''); }
function fresh(p, ttl) { try { return Date.now() - fs.statSync(p).mtimeMs < ttl; } catch (e) { return false; } }
function carinfoPath(regnr) { return path.join(ROOT, 'cache', 'carinfo-plate', regnr + '.json'); }
function dossierPath(regnr) {
  const dir = path.join(ROOT, 'jr', 'dossiers');
  try {
    const f = fs.readdirSync(dir).filter((n) => n.endsWith('-' + regnr + '.json')).sort().pop();
    return f ? path.join(dir, f) : null;
  } catch (e) { return null; }
}
function paths(regnr) {
  return {
    finn: path.join(CACHE, 'finn-' + regnr + '.txt'),
    result: path.join(CACHE, 'result-' + regnr + '.json'),
    log: path.join(CACHE, 'log-' + regnr + '.txt'),
  };
}

function run(args, outFile, logFile) {
  return new Promise((resolve, reject) => {
    const out = outFile ? fs.createWriteStream(outFile) : null;
    const lg = fs.createWriteStream(logFile, { flags: 'a' });
    const p = spawn(PY, args, { cwd: ENGINE, stdio: ['ignore', 'pipe', 'pipe'] });
    if (out) p.stdout.pipe(out); else p.stdout.pipe(lg);
    p.stderr.pipe(lg);
    p.on('error', reject);
    p.on('close', (code) => {
      if (out) out.end();
      lg.end();
      code === 0 ? resolve() : reject(new Error(path.basename(args[0]) + ' exit ' + code));
    });
  });
}

// Fra Vegvesen: Finn-registreringsklasse (2 = varebil, EU-klasse N1/N1G, ellers 1), el/hybrid og WLTP-rekkevidde.
// Uten Vegvesen: klasse fra Car.info (pickup/van/truck = 2). El/hybrid bruker rekkevidde, aldri hk/kW.
async function vegInfo(regnr) {
  const ut = { regclass: 1, elhyb: false, range: null };
  try {
    require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
    const key = process.env.VEGVESEN_API_KEY;
    const r = await fetch('https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=' + encodeURIComponent(regnr),
      { headers: { Accept: 'application/json', 'SVV-Authorization': key }, signal: AbortSignal.timeout(15000) });
    const k = r.ok ? ((await r.json()).kjoretoydataListe || [])[0] : null;
    if (k) {
      const kl = k.godkjenning?.tekniskGodkjenning?.kjoretoyklassifisering?.tekniskKode || {};
      if (/^N1/i.test(String(kl.kodeVerdi || '')) || /varebil/i.test(String(kl.kodeNavn || '') + ' ' + String(kl.kodeBeskrivelse || ''))) ut.regclass = 2;
      const td = k.godkjenning?.tekniskGodkjenning?.tekniskeData;
      const fuels = (td?.motorOgDrivverk?.motor || []).flatMap((m) => (m.drivstoff || []).map((d) => String(d.drivstoffKode?.kodeBeskrivelse || '')));
      ut.elhyb = fuels.some((f) => /elektr|hybrid/i.test(f));
      const rk = td?.miljodata?.miljoOgdrivstoffGruppe?.[0]?.forbrukOgUtslipp?.[0]?.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring;
      if (Number(rk) > 0) ut.range = Number(rk);
      return ut;
    }
  } catch (_) {}
  try {
    const r = JSON.parse(fs.readFileSync(carinfoPath(regnr), 'utf8')).raw.result || {};
    if (/truck|van/i.test(String(r.vehicle_type || '')) || /pickup|varebil|kassebil|van/i.test(String(r.chassis || ''))) ut.regclass = 2;
  } catch (_) {}
  return ut;
}

async function job(regnr, force) {
  const P = paths(regnr);
  const st = jobs.get(regnr);
  try {
    if (force || !fresh(P.finn, FINN_TTL_MS)) {
      st.phase = 'finn';
      st.veg = await vegInfo(regnr);
      const regclass = st.veg.regclass;
      await run(['fetch_finn.py', '--carinfo', carinfoPath(regnr), '--max-ads', String(MAX_ADS), '--delay', String(DELAY), '--regclass', String(regclass)], P.finn + '.part', P.log);
      fs.renameSync(P.finn + '.part', P.finn);
    }
    st.phase = 'train';
    const veg = st.veg || await vegInfo(regnr);
    const args = ['train.py', '--carinfo', carinfoPath(regnr), '--data', P.finn, '--regnr', regnr, '--out', P.result + '.part'];
    if (veg.elhyb) args.push('--elhyb');
    if (veg.range) args.push('--range', String(veg.range));
    const dp = dossierPath(regnr);
    if (dp) args.push('--dossier', dp);
    await run(args, null, P.log);
    fs.renameSync(P.result + '.part', P.result);
    jobs.delete(regnr);
  } catch (e) {
    st.phase = 'error';
    st.err = String((e && e.message) || e);
  }
}

function progress(regnr) {
  try {
    const txt = fs.readFileSync(paths(regnr).finn + '.part', 'utf8');
    const meta = txt.match(/^META (.*)$/m);
    return {
      docs: (txt.match(/^DOC /gm) || []).length,
      ads: (txt.match(/^AD /gm) || []).length,
      finn_model: meta ? JSON.parse(meta[1]) : null,
    };
  } catch (e) { return null; }
}

/**
 * Returnerer straks. { status: 'ready', result } | { status: 'running', phase, progress } | { status: 'error', err }
 * Første kall for en bil starter henting (typisk 3–7 min for ~350 annonser), deretter poller Pulse.
 */
function getGbMl(regnrRaw, opts) {
  const regnr = normRegnr(regnrRaw);
  const force = !!(opts && opts.force);
  if (!/^[A-Z0-9]{2,8}$/.test(regnr)) return { status: 'error', err: 'ugyldig reg.nr' };
  if (!fs.existsSync(carinfoPath(regnr))) {
    return { status: 'error', err: 'Mangler Car.info-cache for ' + regnr + ' (gb-ml gjør ingen Car.info-oppslag selv)' };
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const P = paths(regnr);
  const st = jobs.get(regnr);
  if (st && st.phase !== 'error') return { status: 'running', phase: st.phase, started_at: st.started_at, progress: progress(regnr) };
  if (st && st.phase === 'error' && !force) { jobs.delete(regnr); return { status: 'error', err: st.err }; }
  if (!force && fresh(P.result, RESULT_TTL_MS)) {
    try { return { status: 'ready', result: JSON.parse(fs.readFileSync(P.result, 'utf8')) }; } catch (e) { /* bygg på nytt */ }
  }
  jobs.set(regnr, { started_at: new Date().toISOString(), phase: 'start' });
  job(regnr, force);
  return { status: 'running', phase: 'start', started_at: jobs.get(regnr).started_at, progress: null };
}

module.exports = { getGbMl, _paths: paths };
