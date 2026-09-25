#!/bin/bash
# deploy.sh — legg ut filer fra en peasy-bot-branch på Mini og restart A og B/Ordna sammen.
#
#   bash scripts/deploy.sh <branch> <fil> [fil ...]          legg ut, test, restart begge
#   bash scripts/deploy.sh <branch> <fil> [fil ...] --dry    vis bare hva som ville skjedd
#
# A = com.peasy.auto, B og Ordna = com.peasy.v3g. Begge laster fossefall.js, så begge restartes alltid.
# Stopper uten å røre noe hvis en live-fil er endret utenfor git (matcher ingen commit).
# Feiler node --check eller en test, legges de gamle filene tilbake og ingenting restartes.
set -euo pipefail

LIVE="${PEASY_HOME:-/Users/bot/peasy-auto}"
SRC="${PEASY_DEPLOY_SRC:-/tmp/pb}"
LABELS="${PEASY_DEPLOY_LABELS:-com.peasy.auto com.peasy.v3g}"
TESTS="${PEASY_DEPLOY_TESTS:-fossefall.test.js takst-celler.test.js ab-kontroll.test.js publiser-maalinger.test.js eval-card-hybrid.test.js statid-forslag.test.js}"
LAUNCHCTL="${LAUNCHCTL:-launchctl}"

BRANCH="${1:-}"
[ -n "$BRANCH" ] || { echo "Bruk: deploy.sh <branch> <fil> [fil ...] [--dry]"; exit 2; }
shift
DRY=0
FILES=()
for a in "$@"; do
  if [ "$a" = "--dry" ]; then DRY=1; else FILES+=("$a"); fi
done
[ "${#FILES[@]}" -gt 0 ] || { echo "Oppgi filene som skal ut, f.eks. peasy-auto.js fossefall.js"; exit 2; }

[ -d "$SRC/.git" ] || { echo "Fant ikke git-klonen i $SRC. Klon peasy-bot dit først."; exit 2; }
cd "$SRC"
git fetch -q origin "$BRANCH"
git checkout -q -B "$BRANCH" FETCH_HEAD
COMMIT="$(git rev-parse --short HEAD)"
echo "Branch $BRANCH @ $COMMIT"

# 1. Sjekk hver fil: finnes i branchen, og live-versjonen er en kjent git-versjon.
for f in "${FILES[@]}"; do
  [ -f "$SRC/$f" ] || { echo "STOPP: $f finnes ikke i $BRANCH"; exit 1; }
  if [ -f "$LIVE/$f" ]; then
    if cmp -s "$LIVE/$f" "$SRC/$f"; then
      echo "  $f: allerede lik branchen"
      continue
    fi
    kjent=0
    for h in $(git log -n 40 --format=%H -- "$f" 2>/dev/null); do
      if git show "$h:$f" 2>/dev/null | cmp -s - "$LIVE/$f"; then kjent=1; break; fi
    done
    if [ "$kjent" -ne 1 ]; then
      echo "STOPP: live $f er endret utenfor git (matcher ingen av de siste 40 versjonene). Ingenting er rørt."
      exit 1
    fi
    echo "  $f: oppdateres"
  else
    echo "  $f: ny fil"
  fi
done

if [ "$DRY" -eq 1 ]; then echo "Tørrkjøring: ingenting kopiert eller restartet."; exit 0; fi

# 2. Backup og kopi.
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$LIVE/_transit/deploy-$STAMP"
mkdir -p "$BACKUP"
for f in "${FILES[@]}"; do
  if [ -f "$LIVE/$f" ]; then mkdir -p "$BACKUP/$(dirname "$f")"; cp -p "$LIVE/$f" "$BACKUP/$f"; fi
done
rull_tilbake() {
  echo "Legger tilbake gamle filer fra $BACKUP"
  for f in "${FILES[@]}"; do
    if [ -f "$BACKUP/$f" ]; then cp -p "$BACKUP/$f" "$LIVE/$f"; else rm -f "$LIVE/$f"; fi
  done
}
KOPI_TID="$(date +%s)"
for f in "${FILES[@]}"; do
  mkdir -p "$LIVE/$(dirname "$f")"
  cp "$SRC/$f" "$LIVE/$f"
done

# 3. Syntaks og tester i live-mappa. Feil → tilbake, ingen restart.
cd "$LIVE"
for f in "${FILES[@]}"; do
  case "$f" in *.js) node --check "$f" || { echo "FEIL: node --check $f"; rull_tilbake; exit 1; } ;; esac
done
for t in $TESTS; do
  if [ -f "$t" ]; then
    node "$t" >/dev/null 2>"$BACKUP/test-feil.txt" || { echo "FEIL: $t"; cat "$BACKUP/test-feil.txt"; rull_tilbake; exit 1; }
    echo "  test OK: $t"
  fi
done

# 4. Restart A og B/Ordna.
UIDN="$(id -u)"
for l in $LABELS; do
  "$LAUNCHCTL" kickstart -k "gui/$UIDN/$l" && echo "  restartet $l"
done

# 5. Kontroll: hver prosess skal ha startet etter kopien.
sleep "${PEASY_DEPLOY_WAIT:-8}"
alt_ok=1
for l in $LABELS; do
  pid="$("$LAUNCHCTL" print "gui/$UIDN/$l" 2>/dev/null | awk '/^[[:space:]]*pid = /{print $3; exit}' || true)"
  if [ -z "$pid" ]; then echo "FEIL: $l kjører ikke"; alt_ok=0; continue; fi
  start="$(LC_ALL=C ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ' | sed 's/^ //;s/ $//' || true)"
  start_s="$(LC_ALL=C date -j -f "%a %b %d %T %Y" "$start" +%s 2>/dev/null || LC_ALL=C date -d "$start" +%s 2>/dev/null || echo 0)"
  if [ "$start_s" -ge "$KOPI_TID" ]; then
    echo "  OK $l: pid $pid, startet $start (etter kopien)"
  else
    echo "FEIL: $l pid $pid startet $start, FØR kopien. Kjører gammel kode."; alt_ok=0
  fi
done

VER="$(sed -n "s/^const VERSION = '\([^']*\)'.*/\1/p" peasy-auto.js | head -1)"
FV="$(node -e "process.stdout.write(String(require('./fossefall').FOSSEFALL_VERSION))" 2>/dev/null || echo '?')"
echo "peasy-auto $VER · fossefall $FV · backup $BACKUP"
mkdir -p "$LIVE/logs.nosync"
echo "$STAMP $BRANCH@$COMMIT ${FILES[*]} peasy-auto=$VER fossefall=$FV ok=$alt_ok" >> "$LIVE/logs.nosync/deploy.log"
[ "$alt_ok" -eq 1 ] && echo "Ferdig: A og B/Ordna kjører samme kode." || { echo "Ferdig med FEIL over. Sjekk før du går videre."; exit 1; }
