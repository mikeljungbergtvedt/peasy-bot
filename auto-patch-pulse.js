#!/usr/bin/env node
'use strict';
// Idempotent innsetting av Auto-fanen (skygge) i peasy-pulse.html. Leser auto-score.json via auto-tab.js.
// Backsync kan git reset --hard repoet; kjør denne på nytt etter det.

const fs = require('fs');
const src = process.argv[2] || '/Users/bot/mikeljungbergtvedt.github.io/peasy-pulse.html';
let s = fs.readFileSync(src, 'utf8');

if (!s.includes('id="btn-auto"')) {
  s = s.replace(
    `id="btn-laering" onclick="setMode('laering')">Læring</button>`,
    `id="btn-laering" onclick="setMode('laering')">Læring</button>\n      <button class="mode-btn" data-mode="auto" id="btn-auto" onclick="setMode('auto')">Auto</button>`
  );
}
if (!s.includes("{id:'auto',group:'Analyse'}")) {
  s = s.replace("{id:'laering',group:'Analyse'},", "{id:'laering',group:'Analyse'},\n  {id:'auto',group:'Analyse'},");
}
if (!s.includes("m==='laering'||m==='auto'")) {
  s = s.replace("||m==='gb'||m==='laering');", "||m==='gb'||m==='laering'||m==='auto');");
}
if (!s.includes('window.loadAuto')) {
  s = s.replace(
    "if(m==='laering'){try{if(typeof window.loadLaering==='function')window.loadLaering();}catch(e){}}",
    "if(m==='laering'){try{if(typeof window.loadLaering==='function')window.loadLaering();}catch(e){}}\n      if(m==='auto'){try{if(typeof window.loadAuto==='function')window.loadAuto();}catch(e){}}"
  );
}

const CSS = `#auto-section{max-width:1200px;margin:0 auto;padding:4px 0 40px;color:#16201B}
#auto-section h2{font-size:18px;color:#004225;margin:8px 0 6px}
#auto-section .au-m{color:#5E6B62;font-size:12.5px}
#auto-section .au-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
@media(max-width:720px){#auto-section .au-kpis{grid-template-columns:repeat(2,1fr)}}
#auto-section .au-kpi{background:#fff;border:1px solid #DCD8CC;border-radius:10px;padding:14px 16px}
#auto-section .au-kl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5E6B62;font-weight:600}
#auto-section .au-kv{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}#auto-section .au-kv.g{color:#004225}
#auto-section .au-card{background:#fff;border:1px solid #DCD8CC;border-radius:10px;padding:14px 16px;margin-bottom:12px;overflow-x:auto}
#auto-section .au-ct{font-weight:700;font-size:14.5px}
#auto-section table.au-tbl{border-collapse:collapse;width:100%;font-size:13px;min-width:720px;margin-top:8px;display:table}
#auto-section table.au-tbl th{text-align:left;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#5E6B62;padding:6px 8px;border-bottom:1px solid #DCD8CC}
#auto-section table.au-tbl td{padding:7px 8px;border-bottom:1px solid #DCD8CC;vertical-align:top}
#auto-section .au-r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#auto-section .au-s{font-weight:700}#auto-section .au-s.hi{color:#004225}#auto-section .au-s.lo{color:#B8452F}
#auto-section .au-w{max-width:420px;font-size:12.5px;color:#3a463f}
#auto-section .au-b{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}
#auto-section .au-ok{background:#004225;color:#fff}#auto-section .au-qa{background:#F1E7C8;color:#6b5510}
#auto-section .au-fold{cursor:pointer;user-select:none}
#auto-section .au-pl{display:inline-block;width:22px;height:22px;line-height:20px;text-align:center;border:1px solid #004225;border-radius:6px;color:#004225;font-weight:700;margin-right:6px}
body:has(#auto-section[style*="display: block"]) #app > .loading{display:none!important}
`;
if (!s.includes('#auto-section{max-width')) {
  s = s.replace('.mode-toggle.open .mode-btn[hidden]{display:none!important;}\n', '.mode-toggle.open .mode-btn[hidden]{display:none!important;}\n' + CSS);
}

const SECTION = `
<section class="mode-section" data-mode="auto" id="auto-section" style="display:none;">
  <h2>Auto — skygge</h2>
  <div class="au-m">Poengsum 0–100 for om QA-kortet kunne vært sendt automatisk. Skygge: ingenting sendes, ERP røres ikke. Heftelser stopper ikke.</div>
  <div id="auto-body"><div class="au-m">Laster …</div></div>
</section>
`;
if (!s.includes('id="auto-section"')) {
  s = s.replace('<section class="mode-section" data-mode="sosial" id="sosial-section" style="display:none;">',
    SECTION + '\n<section class="mode-section" data-mode="sosial" id="sosial-section" style="display:none;">');
}
if (!s.includes('src="auto-tab.js"')) {
  s = s.replace('</body>', '<script src="auto-tab.js"></script>\n</body>');
}
// c493: QA send viser bare biler boten har rutet til «qa» (auto-tab.js → window.qaAutoSkjul).
if (!s.includes('window.qaAutoSkjul(b)')) {
  s = s.replace(
    "    if (qaFeCreatedAtSet(b)) return false;\n    return true;\n  }",
    "    if (qaFeCreatedAtSet(b)) return false;\n    /* c493: vurderes/auto skjules til boten har rutet bilen til QA (auto-score.json). */\n    try { if (typeof window.qaAutoSkjul === 'function' && window.qaAutoSkjul(b)) return false; } catch (eAu) {}\n    return true;\n  }"
  );
}
if (!s.includes('c493: QA send')) {
  s = s.replace('<!-- c492', '<!-- c493: QA send viser bare biler rutet til QA. Vurderes/auto skjules. auto-score.json > 15 min gammel → alt vises. -->\n<!-- c492');
  s = s.replace(/Peasy Pulse v16\.08\.c492/g, 'Peasy Pulse v16.08.c493').replace(/>v16\.08\.c492</g, '>v16.08.c493<');
}
if (!s.includes('c492: Ny fane Auto')) {
  s = s.replace('<!-- c491', '<!-- c492: Ny fane Auto (skygge). Poengsum per QA-kort fra auto-score.json. Sender ingenting. -->\n<!-- c491');
  s = s.replace(/Peasy Pulse v16\.08\.c491/g, 'Peasy Pulse v16.08.c492').replace(/>v16\.08\.c491</g, '>v16.08.c492<');
}

fs.writeFileSync(src, s);
const keys = ['window.qaAutoSkjul(b)', 'c493', 'id="btn-auto"', "{id:'auto',group:'Analyse'}", "m==='laering'||m==='auto'", 'window.loadAuto', '#auto-section{max-width', 'id="auto-section"', 'src="auto-tab.js"', 'c492'];
const ok = keys.every((x) => s.includes(x));
console.log(ok ? 'patched ' + src : 'PATCH INCOMPLETE ' + src);
if (!ok) { keys.forEach((x) => console.log(' ', x, s.includes(x))); process.exit(1); }
