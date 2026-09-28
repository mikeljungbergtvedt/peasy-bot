# GB-ML — Finn-trent prismodell for GB-fanen (skyggesti)

reg.nr → Car.info-cache (bare lesing) → Finn-annonser for samme merke/modell → modell → JSON til GB-fanen i Pulse.

* **Ingen håndsatte kronebeløp.** Modellen lærer alt fra Finn-annonser (pris, år, km, hk-variant, drivstoff, gir, selgertype, utstyr).
* **Car.info-pakker (`raw.result.packages.equip/trim/extra`) = fabrikkutstyr.** Disse matches mot annonsenes utstyrsliste, tittel og modellbeskrivelse (pakkenavn, synonymer, typisk innhold) og blir egne features. Øvrige Car.info-attributter mappes til et felles utstyrsvokabular.
* **Hovedpris = modell uten utstyr** (år/km/variant) med 80 %-intervall fra CV-residualer. Utstyrsjustert pris vises som «ikke brukt» fordi enkeltopsjoner utenfor pakkene er ukjent for bilen.
* **Ingen Car.info-kall, ingen betalte oppslag.** Mangler Car.info-cachen for bilen, svarer endepunktet med en feilmelding.
* Rører ikke `estimate()`/`gb-utpris.js`, `/gb-utpris`, ERP, liste 3, QA SEND eller fossefall.

## Filer
| Fil | Rolle |
|---|---|
| `gb-ml.js` | Jobbstyring: cache (default `$TMPDIR/gb-ml`, aldri i repoet), starter `fetch_finn.py` og `train.py`, returnerer `ready` / `running` / `error` straks. |
| `gb-ml-route.js` | `GET /gb-ml?regnr=XX[&force=1]`, Bearer-token. Isolert rute. |
| `gb-ml/fetch_finn.py` | Finner Finn-modellkode for merke+modell (modell → serie → merke hvis < 40 treff, flagges `fallback`), henter søke-API og annonsesider (maks 350, nærmest i årsmodell først), 0,5 s pause. |
| `gb-ml/train.py` | Ridge / Lasso / GradientBoosting, valgt på k-fold CV MAE%. Skriver resultat-JSON. |

## Installere (Mini)
```bash
cd /Users/bot/peasy-auto
python3 -m venv gb-ml/.venv && gb-ml/.venv/bin/pip install -r gb-ml/requirements.txt   # Mini mangler sklearn i dag
```
I `webhook-server.js`, rett etter `const reqPath = ...` (og etter CORS/OPTIONS-blokken), legg inn én linje:
```js
    if (reqPath === '/gb-ml' && await require('./gb-ml-route').handle(req, res, { TOKEN, log })) return;
```
Restart webhook-serveren når Mike godkjenner. Test:
```bash
curl -s -H "Authorization: Bearer $EASY_WEBHOOK_TOKEN" 'http://127.0.0.1:<port>/gb-ml?regnr=EH84013'
# første kall: {"status":"running",...}; ~3–7 min senere: {"status":"ready","result":{...}}
```
Miljøvariabler (valgfrie): `GB_ML_CACHE`, `GB_ML_PYTHON`, `GB_ML_RESULT_TTL_H` (12), `GB_ML_FINN_TTL_H` (24), `GB_ML_MAX_ADS` (350), `GB_ML_DELAY_S` (0.5).

## Manuelt
```bash
gb-ml/.venv/bin/python gb-ml/fetch_finn.py --carinfo cache/carinfo-plate/EH84013.json > /tmp/gb-ml/finn-EH84013.txt
gb-ml/.venv/bin/python gb-ml/train.py --carinfo cache/carinfo-plate/EH84013.json --data /tmp/gb-ml/finn-EH84013.txt \
  --dossier jr/dossiers/5005-EH84013.json --regnr EH84013 --out /tmp/gb-ml/result-EH84013.json
```

## Resultat-JSON (felt GB-fanen bruker)
`ident`, `finn_model` (kode, nivå, fallback), `n_ads`, `pred_base`, `interval_80_base`, `cv_mape_base`, `pred_equip`, `interval_80_equip`,
`cv_mape_equip`, `equip[]` (`status`: `pakke` | `har` | `ukjent`, `kr` = modellens effekt for bilen), `comps[]` (5 nærmeste, `overlap_pct`),
`finn_utpris` (fra dossier), `diff_vs_utpris`, `thin_data`, `fallback`.

Eksempel (EH84013, BMW iX xDrive50 2024, 47 000 km, kjørt 28.09.2026 på 350 Finn-annonser): uten utstyr 754 000 kr (80 %: 700 000–815 000),
CV MAE 4,8 %; med utstyr (ikke brukt) 741 000 kr; Finn-utpris i dossier 727 000.
