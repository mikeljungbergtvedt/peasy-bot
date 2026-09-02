# Peasy Jr — shared origin-CV (trinn 1)

Empty checkout is fine: `jr/` is self-contained. The rest of this repo is the live Easy / V2 chefs.

## Who owns what

| Piece | Where | Role |
|---|---|---|
| **Cursor / this repo** | `github.com/mikeljungbergtvedt/peasy-bot` | Source of truth. Agents commit here. |
| **Mini runner** | Mike's Mac Mini, `/Users/bot/peasy-auto` | Live process. Copies files from this repo and runs them. |
| **Pulse** | `mikeljungbergtvedt.github.io` | Separate site. Measurements / dashboards. Jr does **not** live there. |

Jr writes dossier JSON for the chefs (Easy, V3, V3G). Pulse may later *read* those measurements. Do not push Jr code into the github.io repo.

## Trinn 1 rules

- **`writes_erp: false`** — Jr never PUT/POSTs to ERP (login + GET only).
- **`origin.km`** comes from ERP **liste 3** nested `drive_no_car_data.mileage` only. Not XLSX column 22, not a stale queue mileage.
- **car.info** may add plate *identity* (make / model). It **never** overwrites `origin.km`.
- **Finn** `q = merke + modell`. No year, no km, no kW — not in `q`, not as filters.
- **No `own_sold`** — Peasy / Autoringen / Drive sold comps are dropped.
- **Dossier JSON** — one origin-CV, same bytes for Easy, V3 and V3G.

## Mini install

```bash
# on Mini, after pulling this branch into /Users/bot/peasy-auto
cp jr/com.peasy.jr.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.peasy.jr.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.peasy.jr.plist

# one-shot
node jr/runner.js --once
```

Existing chefs still restart as before (`com.peasy.auto`, `com.peasy.v2watcher`). V3G lives only on Mini (`v3g/`); point it at `require('../jr/origin-cv')` or the dossier file. This checkout has no `v3g/`.

Dossiers default to `jr/dossiers/` (override with `JR_DOSSIER_DIR`, Mini: `/Users/bot/peasy-jr/dossiers`).

## Tests

```bash
node test-origin-cv.js
```

No tokens, `.env`, or live ERP required.
