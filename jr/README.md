# Jr module

Shared origin-CV + chef dossier-read. See the repo-root [README](../README.md).

`writes_erp` is always false. Pulse (`mikeljungbergtvedt.github.io`) is not this repo.

```
origin-cv.js        buildOriginCv + km lock + car.info identity
read-dossier.js     Easy/V3/V3G/Bot4 leser {erpId}-{REGNR}.json
analog-comps.js     analog-regler, alltid tall, aldri 0 comps, cap ask*0.95
chef-runner.js      dossier → Finn-utpris JSON (Claude+Grok eller dry-run)
finn-query.js       q=merke+modell, no year/km/kW
dossier.js          chef JSON (Easy / V3 / V3G / Bot4)
erp-readonly.js     writes_erp=false fetch guard
runner.js           Mini-loop: liste 3 hvert ~1 min, nye biler → dossier
mini-pull.sh        git fetch peasy-bot, kopierer BARE jr/ → /Users/bot/peasy-auto/jr
com.peasy.jr.plist  launchd Jr-loop (ikke --once)
com.peasy.jr-pull.plist  launchd Mini-pull, WorkingDirectory=/Users/bot/peasy-auto
```

## Mini-path

Dossier: `/Users/bot/peasy-auto/jr/dossiers/{erpId}-{REGNR}.json`  
Override: `JR_DOSSIER_DIR`.

Sjefer (Easy V7 bor **bare på Mini**, ikke i denne PR-en):

```js
const jr = require('/Users/bot/peasy-auto/jr/read-dossier');
const hit = jr.loadForChef({ chef: 'easy', internnr: erpId, regnr });
if (hit.ok) {
  // bruk hit.origin_cv + hit.finn + hit.comps — ikke eget Finn/car.info-søk
} // else: gammel søk, allerede logget
```

Finn-utpris:

```bash
node jr/chef-runner.js /Users/bot/peasy-auto/jr/dossiers/4202-EL54991.json
```

Uten `ANTHROPIC_API_KEY` / `XAI_API_KEY` → dry-run analog (alltid et tall).

## Mini-pull (kun jr/)

`mini-pull.sh` henter `github.com/mikeljungbergtvedt/peasy-bot` og kopierer **bare** `jr/` til `/Users/bot/peasy-auto/jr`.

- Overstyrer aldri `/Users/bot/peasy-auto/peasy-auto.js` (Easy V7)
- Sletter ikke Mini-backups (`*.bak`, `*backup*`)
- Ingen `rsync --delete`
