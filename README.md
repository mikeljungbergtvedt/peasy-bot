# Peasy Jr — shared origin-CV (trinn 1)

Empty checkout is fine: `jr/` is self-contained. The rest of this repo is the live Easy / V2 chefs.

## Who owns what

| Piece | Where | Role |
|---|---|---|
| **Cursor / this repo** | `github.com/mikeljungbergtvedt/peasy-bot` | Source of truth. Agents commit here. |
| **Mini runner** | Mike's Mac Mini, `/Users/bot/peasy-auto` | Live process. Copies files from this repo and runs them. |
| **Pulse** | `mikeljungbergtvedt.github.io` | Separate site. Measurements / dashboards. Jr does **not** live there. |

Jr writes dossier JSON for the chefs (Easy, V3, V3G, Bot4). Pulse may later *read* those measurements. Do not push Jr code into the github.io repo.

Easy V7 (`peasy-auto.js`) lives **only on Mini**. Mini-pull copies **only** `jr/` — never overwrite `peasy-auto.js`.

## Trinn 1 rules

- **`writes_erp: false`** — Jr never PUT/POSTs to ERP (login + GET only).
- **`origin.km`** comes from ERP **liste 3** nested `drive_no_car_data.mileage` only. Not XLSX column 22, not a stale queue mileage.
- **car.info** may add plate *identity* (make / model). It **never** overwrites `origin.km`.
- **Finn** `q = merke + modell`. No year, no km, no kW — not in `q`, not as filters.
- **No `own_sold`** — Peasy / Autoringen / Drive sold comps are dropped.
- **Dossier JSON** — one origin-CV, same bytes for Easy, V3, V3G and Bot4.
- **Sjefer leser dossier** — `jr/read-dossier.js` (`{erpId}-{REGNR}.json`). Mangler dossier → gammel søk + logg.
- **Finn-utpris** — `jr/chef-runner.js` (Claude+Grok eller analog dry-run). Alltid et tall. Cap ask×0.95.

## Mini install

```bash
# Jr-loop (~1 min, writes_erp false) — ikke --once
cp /Users/bot/peasy-auto/jr/com.peasy.jr.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.peasy.jr.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.peasy.jr.plist

# Mini-pull: git fetch peasy-bot, kopier BARE jr/ (Easy V7 urørt)
cp /Users/bot/peasy-auto/jr/com.peasy.jr-pull.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.peasy.jr-pull.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.peasy.jr-pull.plist
```

Dossier Mini: `/Users/bot/peasy-auto/jr/dossiers/{erpId}-{REGNR}.json` (`JR_DOSSIER_DIR`).

V3G / Bot4 / Easy V7 bor på Mini. Pek dem på `require('/Users/bot/peasy-auto/jr/read-dossier')`. Ikke overskriv Mini `peasy-auto.js`.

## Tests

```bash
npm test
```

No tokens, `.env`, or live ERP required.
