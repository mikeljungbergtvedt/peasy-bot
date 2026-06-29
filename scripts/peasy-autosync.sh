#!/bin/bash
# Auto-pull peasy-bot fra GitHub. Kjøres av com.peasy.autosync.plist hvert 60 sek.
# Hvis det er ny commit på origin/main: pull + restart begge bots.
set -e
cd /Users/bot/peasy-auto
LOGFILE=/Users/bot/peasy-auto/logs.nosync/autosync.log
mkdir -p /Users/bot/peasy-auto/logs.nosync
git fetch --quiet origin main 2>>"$LOGFILE" || exit 0
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') autosync: $LOCAL -> $REMOTE" >> "$LOGFILE"
  git pull --quiet origin main >>"$LOGFILE" 2>&1
  /bin/launchctl kickstart -k "gui/$(id -u)/com.peasy.auto" >>"$LOGFILE" 2>&1 || true
  /bin/launchctl kickstart -k "gui/$(id -u)/com.peasy.v2bot" >>"$LOGFILE" 2>&1 || true
  echo "$(date '+%Y-%m-%d %H:%M:%S') autosync: pulled + restarted" >> "$LOGFILE"
fi
