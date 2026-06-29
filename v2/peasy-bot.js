// peasy-bot.js v1.1 - Hovedloop for v2, erstatter Easy v20
// Poller liste 3 hver hele time 07-19, alle ukedager.
// ERP I/O matcher Easy v20: token, liste, detalj, write, verify, post-chat

import 'dotenv/config';
import fs from 'fs';
import {
  getErpToken,
  getListe3,
  getErpCarDetail,
  writeToERP,
  verifyErpStatus,
  postToChat,
  maybeWriteToERP,
  maybeVerifyErp,
  maybePostToChat,
  maybeGetErpDetail
} from './erp.js';
import { collectAllData } from './data-collector.js';
import { splitOriginAndComps, dedupeComps, formatClassified } from './v2-eval.js';
import { chooseAnchor } from './ai-anchor.js';
import { calculatePricing, identifySegment } from './pricing-formula.js';
import { buildEvalCard } from './telegram-v2.js';
import { sendTelegram } from './telegram-bot.js';
import { checkBrregForRegnr } from './brreg.js';

const VERSION = 'peasy-bot v1.14';
const CACHE_FILE = '/Users/bot/peasy-pricing-v2/peasy-cache.json';
const SCHEDULE_HOURS = { start: 7, end: 19 };

function log(s) { console.log('[' + new Date().toISOString() + '] [bot] ' + s); }
function logErr(ctx, e) { console.error('[' + new Date().toISOString() + '] [bot] FEIL [' + ctx + ']', e?.message || e); }

function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; } }
function saveCache(c) { fs.writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2)); }

async function evalCar(bil, token) {
  const regnr = String(bil.registration_number || '').trim().toUpperCase();
  const erpId = bil.id;
  let km = bil.mileage || 0;
  let kmOverride = null;
  log('=== Evaluerer ' + regnr + ' (erpId=' + erpId + ') ===');
  try {
    // 1. Hent full bil-detalj fra ERP (selvdeklarasjon, beskrivelse, bilder, body_type)
    let detail = null;
    try { detail = await maybeGetErpDetail(bil, erpId, token); } catch (e) { logErr('getErpCarDetail', e); }
    let sdComment = null;
    let imageCount = 0;
    let bodyTypeId = null;
    if (detail) {
      const car = detail.car || detail;
      const sdSelf = car?.self_declaration?.comment || detail?.self_declaration?.comment || null;
      const carDesc = car?.description || null;
      if (carDesc && sdSelf && carDesc.trim() === sdSelf.trim()) sdComment = sdSelf;
      else if (carDesc && sdSelf) sdComment = sdSelf + '\n\nBILBESKRIVELSE: ' + carDesc;
      else sdComment = sdSelf || carDesc || null;
      imageCount = (car && Array.isArray(car.files)) ? car.files.length : 0;
      bodyTypeId = car?.driveNoCarData?.body_type_id || null;
    }
    if (km <= 0) { log('SKIP: ' + regnr + ' har km=0, kan ikke prise'); /* SKIP-telegram fjernet 20260610 - kun stille log */ return 'skip'; }
    log('Detail: sdComment=' + (sdComment ? 'JA(' + sdComment.length + 'tegn)' : 'NEI') + ' imageCount=' + imageCount + ' bodyTypeId=' + bodyTypeId);

    // 2. v2 pipeline (car.info comps + Sonnet anker + Easy-formel pricing)
    const data = await collectAllData(regnr, km);
    const ci = data?.sources?.car_info?.result || {};
    // v1.13: km-override fra EU-kontroll — EU-km autoritativ (Statens vegvesen)
    try {
      const _insp = ((ci && ci.history) || []).filter(h => h && h.type === 'inspection');
      const _euMaxKm = Math.max(0, ..._insp.map(e => Number(e.km) || 0));
      if (_euMaxKm > 0 && km > 0 && _euMaxKm > km) {
        log('[km-override] ' + regnr + ': EU ' + _euMaxKm + ' > oppgitt ' + km + ' — bruker EU-km');
        kmOverride = { from: km, to: _euMaxKm, reason: 'eu' };
        km = _euMaxKm;
        bil.mileage = _euMaxKm;
      }
      // v1.14: km-typo-fix — hvis oppgitt > 2x EU, prøv å fjerne siste siffer
      if (_euMaxKm > 0 && km > _euMaxKm * 2) {
        const _candidate = Math.floor(km / 10);
        if (_candidate >= _euMaxKm && _candidate <= _euMaxKm * 1.5) {
          log('[km-typo-fix] ' + regnr + ': oppgitt ' + km + ' → ' + _candidate + ' (fjernet siste siffer, EU=' + _euMaxKm + ')');
          kmOverride = { from: km, to: _candidate, reason: 'typo' };
          km = _candidate;
          bil.mileage = _candidate;
        } else {
          log('[km-typo-mistanke] ' + regnr + ': oppgitt ' + km + ' >> EU ' + _euMaxKm + ' — kunne ikke auto-rette');
        }
      }
    } catch (e) {}
    const companyRaw = ci.valuation?.company_valuation?.classifieds || [];
    const privateRaw = ci.valuation?.private_classifieds || [];
    const all = [
      ...companyRaw.map(c => formatClassified(c, 'forhandler')),
      ...privateRaw.map(c => formatClassified(c, 'privat'))
    ];
    const { origin, comps: rawComps } = splitOriginAndComps(all, regnr);
    const comps = dedupeComps(rawComps);
    if (comps.length === 0) {
      log('SKIP: ingen comps for ' + regnr);
      return;
    }
    const anchor = await chooseAnchor({ data, origin, comps });
    const modelYear = bil.model_year || 0;
    const seg = identifySegment(modelYear, km);
    const lowestComp = Math.min(...(anchor.valgte_comps || []).map(c => c.price).filter(p => p > 0));
    const pricing = calculatePricing({
      anchorPrice: anchor.anker_beregning?.anker || 0,
      km, modelYear,
      lowestComp: isFinite(lowestComp) ? lowestComp : null
    });
    log('Anker=' + (anchor.anker_beregning?.anker) + ' dLav=' + pricing.dLav + ' dHoy=' + pricing.dHoy + ' confidence=' + anchor.confidence);

    // 3. Bygg eval-kort
    const card = buildEvalCard({ regnr, km, anchor, pricing, all_comps: comps, errors: [] });

    // 4. Brreg-heftelser (essensielt for ERP-skriving)
    log('Sjekker Brreg for ' + regnr + '...');
    let brregRes = { anyDebts: false, brreg: {} };
    try {
      brregRes = await checkBrregForRegnr(regnr);
      log('Brreg: anyDebts=' + brregRes.anyDebts + ' kilde=' + (brregRes.brreg?.source || 'ukjent'));
    } catch (e) {
      logErr('checkBrregForRegnr', e);
    }
    const anyDebts = !!brregRes.anyDebts;
    const brregObj = brregRes.brreg || brregRes || {};

    // 5. Skriv til ERP
    const dLav = pricing.dLav;
    const dHoy = pricing.dHoy;
    const auctionTypeId = dLav < 35000 ? 2 : 1;
    if (dLav <= 0 || dHoy <= 0) { log("SKIP ERP-write: ugyldige priser dLav=" + dLav + " dHoy=" + dHoy); try { await sendTelegram("SKIP ERP for " + regnr + ": ugyldige priser dLav=" + dLav + " dHoy=" + dHoy); } catch(e){} return 'skip'; }
    // === v1.4 PRICING SAFETY VALVE ===
    {
      const blockers = [];
      const _cmt = (sdComment || '').toString();
      const _kjorbar = /reparasjonsobjekt|starter ikke|motor.*defekt|delebil|motorstopp|registerreim|totalskade/i.test(_cmt) ? 'nei' : (_cmt ? 'usikker' : 'ja');
      if (_kjorbar === 'nei') blockers.push('selger_sier_ikke_kjorbar');
      // v1.13: km_konflikt-blokker fjernet — km-override gjøres oppstrøms i evalCar
      const _valgte = (anchor && Array.isArray(anchor.valgte_comps)) ? anchor.valgte_comps : [];
      if (_valgte.length < 3) blockers.push('kun_' + _valgte.length + '_ekte_sosterbiler');
      if (Number(dLav) < 3000) blockers.push('d_lav_under_vrakpant_' + dLav);
      if (blockers.length > 0) {
        log('[v1.4] BLOKKERT skriving for ' + regnr + ' (' + erpId + '): ' + blockers.join(', '));
        try {
          await sendTelegram(
            '\u26A0\uFE0F <b>MANUELL VURDERING</b>\n\n' +
            'Regnr: ' + regnr + '\nInternnr: ' + erpId + '\n\n' +
            'Flagg:\n  \u2022 ' + blockers.join('\n  \u2022 ') + '\n\n' +
            'AI foreslo: ' + dLav + ' \u2013 ' + dHoy + ' kr\n' +
            'Confidence: ' + (_conf != null ? _conf : '?') + '/100\n\n' +
            '<a href="https://biladministrasjon.no/cars_driveno/processing/final_estimate/' + erpId + '">\u00C5pne i ERP</a>',
            { parse_mode: 'HTML' }
          );
        } catch (e) { logErr('blocker-alarm', e); }
        try { /* v1.9: ikke cache blokkerte biler */ } catch (e) {} return 'blocked';
        return;
      }
    }
    // === end safety valve ===
    const erpWritten = await maybeWriteToERP(bil, erpId, dLav, dHoy, auctionTypeId, anyDebts, brregObj, token);
    log('ERP skrevet: ' + (erpWritten ? 'OK' : 'NEI'));

    // 5. Verifiser ERP
    let erpVerify = null;
    try { erpVerify = await maybeVerifyErp(bil, erpId, token); } catch (e) { logErr('verifyErp', e); }
    log('ERP verifisert: ' + JSON.stringify(erpVerify));

    // 6. Post eval-kort som ERP-kommentar
    const cardErp = String(card).replace(/<\/?(b|i|u|s|code|pre|strong|em)[^>]*>/gi, "");
    const chatPosted = await maybePostToChat(bil, erpId, cardErp, token);
    try { await sendTelegram(card); log('Telegram-kort sendt'); } catch(e) { logErr('sendTelegram', e); }
    log('Eval-kort postet: ' + (chatPosted ? 'OK' : 'NEI'));

    log('FERDIG: ' + regnr); return 'ok';
  } catch (e) {
    logErr('evalCar ' + regnr, e); return 'error';
  }
}

async function runOnce() {
  log('--- Polleloop starter ---');
  const cache = loadCache();
  try {
    const token = await getErpToken();
    const liste3 = await getListe3(token);
    log('Liste 3: ' + (liste3?.length || 0) + ' biler');
    for (const bil of (liste3 || [])) {
      if (cache[String(bil.id)]) continue;
      const result = await evalCar(bil, token); if (result === 'ok') {
      cache[String(bil.id)] = new Date().toISOString();
      saveCache(cache); }
    }
  } catch (e) {
    logErr('runOnce', e);
  }
  log('--- Polleloop ferdig ---');
}

function shouldRunNow() {
  const now = new Date();
  return now.getMinutes() === 0
      && now.getHours() >= SCHEDULE_HOURS.start
      && now.getHours() <= SCHEDULE_HOURS.end;
}


const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = String(process.env.TELEGRAM_CHAT_ID);
let _tgOffset = 0;
let _runLock = false;

async function tgGetUpdates() {
  try {
    const url = 'https://api.telegram.org/bot' + TG_TOKEN + '/getUpdates?timeout=2&offset=' + (_tgOffset + 1);
    const res = await fetch(url);
    const j = await res.json();
    if (!j.ok || !Array.isArray(j.result)) return [];
    return j.result;
  } catch (e) {
    console.error('[tgGetUpdates]', e);
    return [];
  }
}

async function handleTgUpdate(upd) {
  _tgOffset = Math.max(_tgOffset, upd.update_id);
  const msg = upd.message;
  if (!msg || !msg.text) return;
  if (String(msg.chat?.id) !== TG_CHAT) return;
  const txt = msg.text.trim();
  log('TG kommando mottatt: ' + txt);
  if (txt === '/run' || txt.startsWith('/run')) {
    if (_runLock) {
      await sendTelegram('Allerede en kjoring i gang, vent.');
      return;
    }
    _runLock = true;
    await sendTelegram('Manuell polling startet (/run).');
    try { await runOnce(); } finally { _runLock = false; }
    await sendTelegram('Manuell polling ferdig.');
  } else if (/^\/[A-Z]{2}[0-9]{4,5}(\s+\d+)?$/i.test(txt)) {
    // REGNR_HANDLER_V2
    const m=txt.match(/^\/([A-Z]{2}[0-9]{4,5})(?:\s+(\d+))?$/i);
    const regnr=m[1].toUpperCase();
    const km=m[2]?parseInt(m[2]):0;
    if(km===0){await sendTelegram('Skriv km: /'+regnr+' 100000');return;}
    if(_runLock){await sendTelegram('Vent, kjorer noe.');return;}
    _runLock=true;
    await sendTelegram('Priser '+regnr+' '+km+' km (TEST, ingen ERP)...');
    try{
      const bil={registration_number:regnr,id:null,mileage:km,model_year:null,model_series:null};
      await evalCar(bil,null);
    }catch(e){await sendTelegram('Feil '+regnr+': '+e.message);}
    finally{_runLock=false;}
  } else if (txt === '/status') {
    await sendTelegram(VERSION + ' kjorer. Lock=' + _runLock + ' Tid=' + new Date().toISOString());
  } else if (txt.startsWith('/')) {
    await sendTelegram('Ukjent kommando: ' + txt + ' (stottede: /run, /status)');
  }
}

async function tgPollLoop() {
  while (true) {
    const updates = await tgGetUpdates();
    for (const u of updates) {
      try { await handleTgUpdate(u); } catch (e) { console.error('[handleTgUpdate]', e); }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

async function main() {
  log(VERSION + ' startet');
  log('Schedule: hver hele time ' + SCHEDULE_HOURS.start + ':00-' + SCHEDULE_HOURS.end + ':00, man-soen');
  tgPollLoop().catch(e => console.error('[tgPollLoop]', e));
  setInterval(async () => {
    if (shouldRunNow()) {
      await runOnce();
    }
  }, 60 * 1000);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
