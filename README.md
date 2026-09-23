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
- **Sjefer leser dossier** — `jr/read-dossier.js` (`{erpId}-{REGNR}.json`). `hit.ok` ≠ hopp over Finn; `skipOwnSearch` er true bare når mapped comps ≥ 1. Mangler dossier eller tom pool → eget Finn-søk + logg.
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

## Fossefall tables live — Mike verifies after merge

This does not change `.env` and it does not deploy to the Mini. `FOSSEFALL_TABLES_LIVE=1` stays a Mini-only step you already set. Do not restart until you have copied the files below onto the Mini yourself.

Mini `peasy-auto.js` is ahead of this repo. Mini-pull that only copies `jr/` will not pick this up. After merge, copy these four files over the Mini tree (merge `peasy-auto.js` by hand if the Mini file has local patches you still need):

- `fossefall.js`
- `eval-card-hybrid.js`
- `ab-arm.js` (new: even erpId → A writes ERP, odd → B, Easy logs `ERP: skrives av B`)
- `peasy-auto.js`

Then restart Easy. Do not send to the customer from this PR.

### What the next liste-3 car should show

1. Log `Kalkyle [fossefall-satser]` with `klarg 1000` and a celle-id. The old primary line `easy-cost-v7` / klarg 5000 is the legacy motor and must not be the band that is written.
2. Even erpId (A): log `ERP band fra fossefall A: <lav>-<hoy> celle <pris|km>`. Odd erpId (B): log `ERP: skrives av B` and do **not** log `ERP band fra fossefall A`. The QA card still has the fossefall block.
3. QA card (Telegram and ERP comment) contains `FOSSEFALL`, `Celle:`, `Midt:`, `Spenn:`, `Klargjøring: 1 000`, `Ståtid:`, and `A / B / Ordna: samme midt og spenn`. Empty table cell is `PRIS MANUELT` and is not cached.
4. ERP status on an odd car says `ERP: skrives av B`, not `D lav/høy feilet`.

### Cars already stuck (`Cache: allerede skrevet`)

A bare timestamp in `peasy-cache.json` is not a finished fossefall pass while tables are live. The next run re-prices those liste-3 cars only. Even ids get a new ERP band from fossefall A. Odd ids get a new QA card and Easy still does not PUT. If the old ERP comment has no `FOSSEFALL` line, Easy posts one updated comment.

Safe one-car path, if you do not want the whole liste-3 queue to re-price:

1. In Telegram, tap **Slett cache** on that car, or delete only that erpId key from `/Users/bot/peasy-auto/peasy-cache.json`.
2. `/run` (or wait for the next pass).
3. Do not delete the whole cache file.

### Pulse «1» vs liste 3

`pulse-status.json` is `{ liste3, venter }`. `liste3` is how many cars are on liste 3. `venter` is how many of those are **not** a finished pricing stamp.

Pulse paints two badges, not the liste size:

- `⏳ N pris` = `venter` (fallback) or, once QA has loaded, cars whose ERP `price_final_min` is still empty
- `⏳ N send` = `liste3 - venter`, or cars that already have `price_final_min`

QA overwrites the badges for 5 minutes from that ERP split. So liste 3 can be 5, json can say `venter: 0` (all stamped), and the badge can still show `⏳ 1 pris` or `⏳ 1 send` because one car has or lacks a final price. That is the Pulse display contract, not a wrong `liste3` count. This PR only changes `venter`: a pre-fossefall timestamp no longer counts as priced, so `venter` stays up until the fossefall card is actually stamped. Odd cars stay on the `pris` badge until B writes `price_final_min`; Easy does not write those.
