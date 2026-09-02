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
if (hit.ok && hit.skipOwnSearch) {
  // bruk hit.origin_cv + hit.pool / hit.comps (flat {price, km, url, title, year})
} else if (hit.ok) {
  // dossier finnes, origin.km låst — men mapped comps tom: KJØR eget Finn-søk
} else {
  // gammel søk, allerede logget
}
```

`hit.ok` betyr bare at dossier-filen finnes. **Sjefer skal ikke hoppe over eget Finn-søk når `skipOwnSearch` er false.** 2. sep 2026 (~15:15 Oslo) hoppet Mini-hook på `hit.ok` og leste `dossier.comps` / `dossier.finn.ads` med bare `price|ask|finn_price` og `km|mileage`. Jr lagrer ofte `price.amount`, `soldPrice`, `asking_price`, `finnkode` — pool ble 0, Bot4 sa «ingen markedsevidens» og V3G fikk `finn_utpris` null. `loadForChef` mapper nå til flat `{price, km, url, title, year}` med `price>0`; `skipOwnSearch=true` bare når `pool.length>=1`. Tom pool: `ok=true`, `skipOwnSearch=false`, `origin_cv` med låst ERP-km. Chef-runner/analog-comps gir aldri 0 comps som ferdig svar.

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
