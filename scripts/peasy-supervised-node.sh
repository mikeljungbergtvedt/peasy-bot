#!/bin/bash
# launchd wrapper: run a peasy node entry, record crashes, stop after a visible limit.
# Usage: peasy-supervised-node.sh <label> <absolute-or-home-relative-script>
# Exit 0 after crash-loop so KeepAlive (Crashed=true, SuccessfulExit=false) does not respawn.
set -u

LABEL="${1:?label required}"
SCRIPT="${2:?script required}"
PEASY_HOME="${PEASY_HOME:-/Users/bot/peasy-auto}"
STATE_DIR="${PEASY_STATE_DIR:-$PEASY_HOME/logs.nosync}"
LIMIT="${PEASY_CRASH_LIMIT:-8}"
WINDOW="${PEASY_CRASH_WINDOW_SEC:-900}"
STAMP="$STATE_DIR/${LABEL}.restarts"
FLAG="$STATE_DIR/${LABEL}.CRASHLOOP"
SUP_LOG="$STATE_DIR/${LABEL}.supervisor.log"

if [ -n "${PEASY_NODE:-}" ] && [ -x "$PEASY_NODE" ]; then
  NODE="$PEASY_NODE"
elif [ -x /Users/bot/.nvm/versions/node/v24.14.0/bin/node ]; then
  NODE=/Users/bot/.nvm/versions/node/v24.14.0/bin/node
else
  NODE="$(command -v node || true)"
fi

if [ -z "$NODE" ]; then
  echo "peasy-supervised-node: node not found" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
now="$(date +%s)"
ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

if [ -f "$STAMP" ]; then
  awk -v now="$now" -v w="$WINDOW" '$1 >= now-w {print}' "$STAMP" > "$STAMP.tmp" || true
  mv "$STAMP.tmp" "$STAMP"
fi

if [ ! -f "$SCRIPT" ]; then
  if [ -f "$PEASY_HOME/$SCRIPT" ]; then
    SCRIPT="$PEASY_HOME/$SCRIPT"
  fi
fi

export PEASY_PROCESS_LABEL="$LABEL"
export PATH="$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PEASY_HOME" || exit 1

set +e
"$NODE" "$SCRIPT"
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  exit 0
fi

echo "$now" >> "$STAMP"
count="$(wc -l < "$STAMP" | tr -d ' ')"
echo "$(ts) [supervisor] $LABEL crash rc=$rc count=${count}/${LIMIT} window=${WINDOW}s script=$SCRIPT" | tee -a "$SUP_LOG"

if [ "$count" -ge "$LIMIT" ]; then
  echo "$count $now rc=$rc" > "$FLAG"
  echo "$(ts) [supervisor] CRASHLOOP $LABEL — $count failures in ${WINDOW}s. Exit 0 so launchd will not keep restarting. Clear $FLAG to allow start." | tee -a "$SUP_LOG"
  exit 0
fi

exit "$rc"
