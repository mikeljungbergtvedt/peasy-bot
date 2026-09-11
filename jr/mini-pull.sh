#!/bin/bash
# Mini pull loop — copies jr/ + shared/ (outbound backoff). Never Easy V7.
#
# git fetch from github.com/mikeljungbergtvedt/peasy-bot, then copy the jr/
# folder. NEVER overwrites /Users/bot/peasy-auto/peasy-auto.js (Easy V7 lives
# only on Mini). NEVER copies peasy-auto.js into dest. NEVER deletes Mini
# backups (*.bak, *backup*, peasy-auto.js.*). No rsync --delete.
#
# launchd: jr/com.peasy.jr-pull.plist  WorkingDirectory=/Users/bot/peasy-auto
# writes_erp=false. Pulse github.io is not this repo.
set -euo pipefail

WORKDIR="${JR_WORKDIR:-/Users/bot/peasy-auto}"
DEST="${JR_PULL_DEST:-$WORKDIR/jr}"
UPSTREAM="${JR_UPSTREAM_DIR:-$WORKDIR/.jr-upstream}"
REPO="${JR_REPO_URL:-https://github.com/mikeljungbergtvedt/peasy-bot.git}"
BRANCH="${JR_PULL_BRANCH:-main}"
LOG="${JR_PULL_LOG:-$WORKDIR/logs.nosync/jr-pull.log}"
SRC_OVERRIDE="${JR_PULL_SRC:-}"

mkdir -p "$(dirname "$LOG")" "$DEST" "$WORKDIR"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
say() { echo "$(ts) jr-pull: $*" | tee -a "$LOG"; }

# ---------------------------------------------------------------------------
# Copy shared/ (outbound backoff) next to Mini peasy-auto. Never Easy V7.
copy_shared() {
  local src_shared="$1"
  local dest_shared="$2"
  if [ ! -d "$src_shared" ]; then
    say "ADVARSEL: shared/ mangler i src: $src_shared"
    return 0
  fi
  mkdir -p "$dest_shared"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude 'peasy-auto.js' --exclude '*.bak' "$src_shared/" "$dest_shared/"
  else
    (
      cd "$src_shared"
      find . -type f ! -name 'peasy-auto.js' ! -name '*.bak' -print0
    ) | while IFS= read -r -d '' rel; do
      mkdir -p "$dest_shared/$(dirname "$rel")"
      cp -p "$src_shared/$rel" "$dest_shared/$rel"
    done
  fi
  say "kopierte shared/ → $dest_shared"
}

# Copy ONLY jr/ → dest. Refuse peasy-auto.js. Do not delete backups.
# ---------------------------------------------------------------------------
copy_jr_only() {
  local src_jr="$1"
  local dest="$2"
  if [ ! -d "$src_jr" ]; then
    say "FEIL: src jr/ mangler: $src_jr"
    return 1
  fi
  if [ -f "$src_jr/peasy-auto.js" ]; then
    say "ADVARSEL: $src_jr/peasy-auto.js ignoreres (Easy V7 bor bare på Mini)"
  fi

  mkdir -p "$dest"

  # Snapshot Mini Easy so we can prove we did not touch it.
  local easy="$WORKDIR/peasy-auto.js"
  local easy_before=""
  if [ -f "$easy" ]; then
    easy_before=$(cksum "$easy" | awk '{print $1" "$2}')
  fi

  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude 'dossiers/' \
      --exclude 'peasy-auto.js' \
      --exclude 'peasy-auto.js.*' \
      --exclude '*.bak' \
      --exclude '*backup*' \
      "$src_jr/" "$dest/"
  else
    # Portable copy without --delete. Skip excluded names.
    (
      cd "$src_jr"
      find . -type f \
        ! -path './dossiers/*' \
        ! -name 'peasy-auto.js' \
        ! -name 'peasy-auto.js.*' \
        ! -name '*.bak' \
        ! -name '*backup*' \
        -print0
    ) | while IFS= read -r -d '' rel; do
      mkdir -p "$dest/$(dirname "$rel")"
      cp -p "$src_jr/$rel" "$dest/$rel"
    done
  fi

  if [ -f "$dest/peasy-auto.js" ]; then
    rm -f "$dest/peasy-auto.js"
    say "FEIL: dest fikk peasy-auto.js — slettet. Copy-script skal ALDRI kopiere Easy."
    return 1
  fi
  if [ -f "$easy" ] && [ -n "$easy_before" ]; then
    local easy_after
    easy_after=$(cksum "$easy" | awk '{print $1" "$2}')
    if [ "$easy_before" != "$easy_after" ]; then
      say "FEIL: Mini peasy-auto.js ble endret — avbryter"
      return 1
    fi
  fi
  say "kopierte kun jr/ → $dest (peasy-auto.js urørt, backups beholdt)"
}

copy_stack_helpers() {
  local src_root="$1"
  copy_shared "$src_root/shared" "$WORKDIR/shared"
}

fetch_upstream() {
  if [ -n "$SRC_OVERRIDE" ]; then
    echo "$SRC_OVERRIDE"
    return 0
  fi
  if [ ! -d "$UPSTREAM/.git" ]; then
    say "kloner $REPO (sparse jr/ + shared/) → $UPSTREAM"
    git clone --depth 1 --branch "$BRANCH" --filter=blob:none --sparse "$REPO" "$UPSTREAM" >>"$LOG" 2>&1
    git -C "$UPSTREAM" sparse-checkout set jr shared >>"$LOG" 2>&1 || true
  else
    say "git fetch $REPO $BRANCH"
    git -C "$UPSTREAM" fetch --depth 1 origin "$BRANCH" >>"$LOG" 2>&1
    git -C "$UPSTREAM" checkout -f "FETCH_HEAD" >>"$LOG" 2>&1 || \
      git -C "$UPSTREAM" checkout -f "origin/$BRANCH" >>"$LOG" 2>&1
    git -C "$UPSTREAM" sparse-checkout set jr shared >>"$LOG" 2>&1 || true
  fi
  echo "$UPSTREAM"
}

if [ "${1:-}" = "--copy-only" ]; then
  # Test hook: copy JR_PULL_SRC/jr → JR_PULL_DEST without git.
  src_root="${JR_PULL_SRC:?JR_PULL_SRC required for --copy-only}"
  copy_jr_only "$src_root/jr" "$DEST"
  copy_stack_helpers "$src_root"
  exit $?
fi

if [ "${JR_SKIP_FETCH:-}" = "1" ]; then
  src_root="${JR_PULL_SRC:?JR_PULL_SRC required when JR_SKIP_FETCH=1}"
  copy_jr_only "$src_root/jr" "$DEST"
  copy_stack_helpers "$src_root"
  exit $?
fi

src_root=$(fetch_upstream)
copy_jr_only "$src_root/jr" "$DEST"
copy_stack_helpers "$src_root"
