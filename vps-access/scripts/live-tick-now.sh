#!/usr/bin/env bash
# live-tick-now.sh -- READ-NOTHING-BACK manual run of the hourly tick: refresh
# the candles each trading profile needs, recompute its recent decisions against
# that fresh data, then produce and push its intents. Same script the timer runs,
# so what you see here is what happens on the hour.
#
# Replaces the old per-config tick runner, which ran a script that only ever
# served one hardcoded book. The coverage report below follows the PROFILES —
# it asks the registry which pairs are being traded rather than naming three.
set -uo pipefail
APP=/opt/general-classifier
echo "== running live-tick.sh =="
timeout 300 /usr/local/sbin/live-tick.sh 2>&1 | tail -40

echo "== data coverage after refresh (the pairs actually in use) =="
# WHICH PAIRS MATTER — asked of the service, which answers from lib/live/pairs.js.
# This used to be re-derived here in JS, in two sibling scripts, and again in the
# refresher: four copies of one rule, which had already drifted (one looked in
# configSnapshot.members[], which carries no symbol, so it silently reported a
# single pair as the whole set). An unreadable registry is reported as unknown,
# never as an empty list — "no pairs" reads as "nothing needs watching".
pairs_in_use() {
  local body
  body=$(curl -sS -m 8 http://127.0.0.1:8093/api/live/pairs 2>/dev/null) || { echo "__ERR__"; return; }
  python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print("__ERR__"); raise SystemExit
if d.get("error"):
    print("__ERR__"); raise SystemExit
print(" ".join(d.get("pairs") or []))
' <<<"$body"
}
PAIRS=$(pairs_in_use)
if [ "$PAIRS" = "__ERR__" ]; then
  echo "  cannot read which pairs are in use (classifier service down?) — coverage UNKNOWN"
elif [ -z "${PAIRS// }" ]; then
  echo "  (no setup is in paper/live/stopped, so nothing needs refreshing)"
else
  for s in $PAIRS; do
    latest=$(ls -1 "$APP"/data/cache/${s}-1h-*.json 2>/dev/null | sort | tail -1)
    echo "  $s newest day-file: $(basename "${latest:-none}")"
  done
fi
