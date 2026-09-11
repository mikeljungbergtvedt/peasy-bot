#!/bin/bash
# peasy-ctl — status / install hints for Mini launchd jobs.
# Does not claim a restart was done. Code-only helper.
set -u

PEASY_HOME="${PEASY_HOME:-/Users/bot/peasy-auto}"
STATE_DIR="${PEASY_STATE_DIR:-$PEASY_HOME/logs.nosync}"
LAUNCH_DIR="${HOME:-/Users/bot}/Library/LaunchAgents"

LABELS=(
  com.peasy.auto
  com.peasy.v3g
  com.peasy.v2-bot
  com.peasy.v2-watcher
  com.peasy.bot4
  com.peasy.jr
  com.peasy.track
  com.peasy.timewait
)

SHORT_OF() {
  case "$1" in
    com.peasy.auto) echo peasy-auto ;;
    com.peasy.v3g) echo v3g ;;
    com.peasy.v2-bot) echo v2-bot ;;
    com.peasy.v2-watcher) echo v2-watcher ;;
    com.peasy.bot4) echo bot4 ;;
    com.peasy.jr) echo jr ;;
    com.peasy.track) echo peasy-track ;;
    com.peasy.timewait) echo timewait ;;
    *) echo "$1" ;;
  esac
}

cmd="${1:-status}"

case "$cmd" in
  status)
    echo "=== peasy-ctl status (launchd + crash-loop + TIME_WAIT) ==="
    echo "home=$PEASY_HOME"
    if command -v launchctl >/dev/null 2>&1; then
      echo "-- launchctl --"
      launchctl list 2>/dev/null | awk 'NR==1 || /com\.peasy\./' || true
    else
      echo "launchctl not on this host (plist files are still in repo)"
    fi
    echo "-- crash-loop flags (visible limit: 8 / 15 min) --"
    for l in "${LABELS[@]}"; do
      short="$(SHORT_OF "$l")"
      flag="$STATE_DIR/${short}.CRASHLOOP"
      restarts="$STATE_DIR/${short}.restarts"
      if [ -f "$flag" ]; then
        echo "CRASHLOOP $l $(cat "$flag")"
      elif [ -f "$restarts" ]; then
        echo "restarts $l $(wc -l < "$restarts" | tr -d ' ') in window file"
      else
        echo "ok $l (no crash stamp)"
      fi
    done
    if [ -f "$STATE_DIR/timewait.log" ]; then
      echo "-- last TIME_WAIT --"
      tail -n 3 "$STATE_DIR/timewait.log"
    fi
    ;;
  install-hint)
    echo "Kopier plists til LaunchAgents og load. Dette scriptet restarter ikke Mini."
    echo "  mkdir -p $LAUNCH_DIR $PEASY_HOME/logs.nosync"
    echo "  cp $PEASY_HOME/launchd/com.peasy.*.plist $LAUNCH_DIR/"
    echo "  cp $PEASY_HOME/com.peasy.auto.plist $LAUNCH_DIR/"
    echo "  cp $PEASY_HOME/jr/com.peasy.jr.plist $LAUNCH_DIR/"
    echo "  for p in com.peasy.auto com.peasy.v3g com.peasy.v2-bot com.peasy.v2-watcher com.peasy.bot4 com.peasy.jr com.peasy.track com.peasy.timewait; do"
    echo "    launchctl unload $LAUNCH_DIR/\$p.plist 2>/dev/null || true"
    echo "    launchctl load \$LAUNCH_DIR/\$p.plist"
    echo "  done"
    echo "  $PEASY_HOME/scripts/peasy-ctl.sh status"
    ;;
  clear-crashloop)
    short="${2:?short label (peasy-auto|v3g|v2-bot|v2-watcher|bot4|jr|peasy-track)}"
    rm -f "$STATE_DIR/${short}.CRASHLOOP" "$STATE_DIR/${short}.restarts"
    echo "cleared $short crash-loop stamps (load plist again on Mini)"
    ;;
  *)
    echo "usage: peasy-ctl.sh status|install-hint|clear-crashloop <label>"
    exit 1
    ;;
esac
