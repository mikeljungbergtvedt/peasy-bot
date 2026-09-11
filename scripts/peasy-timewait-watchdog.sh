#!/bin/bash
# Count TIME_WAIT sockets every minute (launchd StartInterval=60).
# Alert Telegram if total > 8000. Log always. Do NOT touch sysctl / msl.
set -u

PEASY_HOME="${PEASY_HOME:-/Users/bot/peasy-auto}"
LOG="${PEASY_TIMEWAIT_LOG:-$PEASY_HOME/logs.nosync/timewait.log}"
ALERT_STAMP="${PEASY_TIMEWAIT_ALERT_STAMP:-$PEASY_HOME/logs.nosync/timewait.alerted}"
THRESHOLD="${PEASY_TIMEWAIT_THRESHOLD:-8000}"
ALERT_EVERY_SEC="${PEASY_TIMEWAIT_ALERT_EVERY_SEC:-900}"
ENV_FILE="${PEASY_ENV:-$PEASY_HOME/.env}"

mkdir -p "$(dirname "$LOG")"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

read_env() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | sed -e "s/^${key}=//" -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# macOS Mini: netstat -an -p tcp. Linux CI: ss or netstat -ant.
timewait_lines() {
  if netstat -an -p tcp >/dev/null 2>&1; then
    netstat -an -p tcp 2>/dev/null | grep TIME_WAIT || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ant 2>/dev/null | grep TIME_WAIT || true
  elif netstat -ant >/dev/null 2>&1; then
    netstat -ant 2>/dev/null | grep TIME_WAIT || true
  else
    true
  fi
}

count_lines() {
  local n
  n="$(wc -l | tr -d ' ')"
  [ -n "$n" ] || n=0
  echo "$n"
}

# Telegram: 149.154/20, 91.108/16, 95.161. Meta: 157.240, 31.13, 69.171, 66.220, 185.60, 163.70
TG_RE='149\.154\.|91\.108\.|95\.161\.'
META_RE='157\.240\.|31\.13\.|69\.171\.|66\.220\.|185\.60\.|163\.70\.'

if [ "${1:-}" = '--counts' ]; then
  total="${2:-0}"
  tg="${3:-0}"
  meta="${4:-0}"
else
  lines="$(timewait_lines)"
  total="$(printf '%s\n' "$lines" | grep TIME_WAIT | count_lines)"
  tg="$(printf '%s\n' "$lines" | grep TIME_WAIT | grep -E "$TG_RE" | count_lines)"
  meta="$(printf '%s\n' "$lines" | grep TIME_WAIT | grep -E "$META_RE" | count_lines)"
fi

echo "$(ts) TIME_WAIT total=${total} telegram=${tg} meta=${meta} threshold=${THRESHOLD}" | tee -a "$LOG"

if [ "${1:-}" = '--print-only' ]; then
  echo "total=$total telegram=$tg meta=$meta"
  exit 0
fi

if [ "$total" -le "$THRESHOLD" ]; then
  exit 0
fi

now="$(date +%s)"
last=0
[ -f "$ALERT_STAMP" ] && last="$(awk '{print $1}' "$ALERT_STAMP" | head -1)"
if [ -n "$last" ] && [ "$((now - last))" -lt "$ALERT_EVERY_SEC" ]; then
  echo "$(ts) TIME_WAIT over threshold but alert suppressed (${ALERT_EVERY_SEC}s debounce)" >> "$LOG"
  exit 0
fi

token="${TELEGRAM_TOKEN:-$(read_env TELEGRAM_TOKEN)}"
chat="${TELEGRAM_CHAT_ID:-$(read_env TELEGRAM_CHAT_ID)}"
text="⚠️ Mini TIME_WAIT ${total} (telegram ${tg}, meta ${meta}). Terskel ${THRESHOLD}. Ikke sysctl — sjekk outbound backoff / sju prosesser."

if [ -z "$token" ] || [ -z "$chat" ]; then
  echo "$(ts) ALERT skipped — TELEGRAM_TOKEN/CHAT_ID missing" | tee -a "$LOG"
  echo "$now skipped" > "$ALERT_STAMP"
  exit 0
fi

# Single curl. No retry loop — watchdog must not add TIME_WAIT.
curl -sS --max-time 15 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
  -d "chat_id=${chat}" \
  --data-urlencode "text=${text}" >/dev/null 2>>"$LOG" || true
echo "$now sent total=$total" > "$ALERT_STAMP"
echo "$(ts) ALERT sent total=${total} telegram=${tg} meta=${meta}" | tee -a "$LOG"
