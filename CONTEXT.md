# peasy-auto — Project Context
Last updated: 2026-03-06

## What this system does
Automated car valuation bot for Peasy (used car buying service). Runs on a Mac Mini at home.
- Fetches pending cars from ERP (biladministrasjon.no)
- Looks up car specs from Vegvesen API
- Searches Finn.no for comparable cars to determine market value
- Checks heftelser (encumbrances) and owner history
- Writes valuation back to ERP
- Sends results via Telegram
- Also monitors Tesla Model 3 inventory for price drops

## Server
- **Machine**: Mac Mini (mike-sin-mac-mini)
- **User**: bot
- **Local IP**: 192.168.32.172 (use when on same WiFi)
- **Tailscale IP**: 100.121.97.112 (use when remote)
- **Node path**: ~/.nvm/versions/node/v24.14.0/bin/node
- **Bot files**: ~/peasy-auto/
- **Start bot**: `pkill -f peasy-auto.js && sleep 2 && nohup ~/.nvm/versions/node/v24.14.0/bin/node peasy-auto.js > nohup.out 2>&1 &`
- **Watch logs**: `tail -f ~/peasy-auto/nohup.out`
- **Schedule**: Mon-Fri 07:00-18:00 hourly, Tesla always on

## Key files
- `peasy-auto.js` — main bot (heavily patched, this is the live version)
- `erp-patch.js` — patches ERP token + fetchPendingCars
- `heftelser-patch.js` — patches writeARValueToERP with encumbrance + owners
- `finn-search-patch.js` — improved Finn search fallback logic
- `finn-model-patch.js` — adds getFinnModelParam() for accurate make/model lookup
- `dedupe-patch.js` — fixes duplicate car processing
- `processed-cars.json` — tracks already-processed cars
- `nohup.out` — live bot log
- `.env` — credentials (ERP_USER, ERP_PASS, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, VEGVESEN_API_KEY)

## APIs used
- **ERP**: https://api.biladministrasjon.no
  - Login: POST /auth/login → returns token
  - Fetch pending: GET /c2b_module/driveno/processing/estimating_ar_final?per_page=50
  - Fetch pending: GET /c2b_module/driveno/processing/estimating_ar_temp?per_page=50
  - Write valuation: PUT /c2b_module/driveno/{erpId} ← currently returns 500, needs fixing
  - Get car detail: GET /c2b_module/driveno/{erpId}
- **Vegvesen**: https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke={regNr}
- **Finn.no**: Playwright browser scraping (not a JSON API)
- **Telegram**: Standard bot API for sending messages and receiving /run /status commands
- **Tesla**: https://www.tesla.com/inventory/api/v4/inventory-results

## What's working
- ✅ ERP login and token refresh
- ✅ Fetching pending cars from ERP
- ✅ Vegvesen spec lookup
- ✅ Finn.no search with gradual fallback (9 steps)
- ✅ Tesla Model 3 price monitoring
- ✅ Telegram notifications
- ✅ Heftelser check
- ✅ Duplicate car prevention (dedupe-patch applied 2026-03-06)
- ✅ Finn make/model ID lookup via getFinnModelParam() (applied 2026-03-06)
- ✅ Price rounding to nearest 1000 kr
- ✅ Mac Mini sleep prevention (pmset applied 2026-03-06)

## Open problems / next tasks

### 1. ERP write returning 500
PUT to /c2b_module/driveno/{erpId} returns 500 Internal Server Error.
Need to intercept what the ERP frontend sends when manually toggling fields in browser (Chrome DevTools → Network tab) to find the correct payload structure.
Fields to toggle:
- encumbrance_is_checked
- encumbrance_has_debt
- encumbrance_comment
- encumbrance_date
- owners_is_checked
- owners_check_date
- Finance identified flag
- Auction type (auto: <35k price → lower price auction)

### 2. Finn search accuracy
- GLC was returning GLE results (wrong model, ~3x price difference)
- getFinnModelParam() added to look up Finn make/model IDs dynamically
- Uses Finn's internal API — needs live testing with real cars to verify
- Tesla works via hardcoded variant IDs in getTeslaVariant()

### 3. Email automation (future)
- IMAP/SMTP: mail.uniweb.no, port 143/587, STARTTLS
- Email: post@peasy.no
- Plan:
  - Trigger standard valuation email template from ERP
  - BCC post@peasy.no on all outgoing valuations
  - Seller question → bot drafts reply → saves to Utkast (drafts)
  - Customer rejection → bot receives copy → creates deviation report
  - Customer accepts → no action needed

## Deployment workflow
1. Write/edit patch files locally or in Claude
2. SCP to Mini: `scp ~/Downloads/patch.js bot@192.168.32.172:~/peasy-auto/`
3. Run patch: `ssh bot@192.168.32.172 "cd ~/peasy-auto && ~/.nvm/versions/node/v24.14.0/bin/node patch.js"`
4. Restart bot: `ssh bot@192.168.32.172 "pkill -f peasy-auto.js; sleep 2; cd ~/peasy-auto && nohup ~/.nvm/versions/node/v24.14.0/bin/node peasy-auto.js > nohup.out 2>&1 &"`

## Backup
- Mini: ~/peasy-auto-backup-20260306.tar.gz
- MacBook: ~/Downloads/peasy-auto-backup-20260306.tar.gz
