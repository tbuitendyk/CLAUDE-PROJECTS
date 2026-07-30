#!/usr/bin/env bash
# classifier-trailing-cost-probe.sh -- measure what trailing stops COST in
# runtime before committing to a long run.
#
# Trailing multiplies the execution menu roughly twelvefold (4 trail distances
# x 3 arm thresholds). Cycle 11 took 6.6 hours with trailing OFF. Guessing the
# multiplier would either waste a day or under-scope the test, so: fire two
# identical tiny jobs, one with trailing off and one on, and time them.
#
# This is the owner's "run small code tests rather than 9 hours" applied to
# scoping rather than correctness.
set -euo pipefail
B="http://127.0.0.1:8093"
run_one() {
  local TRAIL="$1" LABEL="$2"
  local OUT
  OUT=$(curl -sS -X POST "$B/api/bracketlab" -H "Content-Type: application/json" -d "{
    \"universe\": [\"BTCUSDT\",\"ETHUSDT\"],
    \"sizes\": {\"singles\": true, \"doubles\": false, \"triples\": false},
    \"allLoaded\": true,
    \"permute\": {\"geometry\": false, \"decision\": false, \"band\": false, \"weekdays\": false},
    \"set\": {\"geometry\": \"daily-3d\", \"decision\": \"argmax\", \"band\": \"auto\", \"weekdaysOnly\": false},
    \"holdout\": true, \"trailing\": $TRAIL, \"edgeScreen\": true,
    \"labelShiftFrac\": 0.5, \"labelShiftReps\": 1, \"labelShiftScope\": \"window\",
    \"promoteK\": 50, \"minTrades\": 1,
    \"label\": \"cost probe $LABEL\",
    \"description\": \"Runtime cost probe for trailing stops. Two identical tiny jobs, trailing off then on, to measure the multiplier before scoping a long run.\"
  }")
  local JOB
  JOB=$(printf '%s' "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('batchId',''))")
  [ -n "$JOB" ] || { echo "  FAILED to start ($LABEL): $OUT"; return 1; }
  local T0 T1 ST
  T0=$(date +%s)
  for i in $(seq 1 120); do
    sleep 10
    ST=$(curl -sS "$B/api/batch/$JOB" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))")
    [ "$ST" = "done" ] && break
    case "$ST" in failed|cancelled|error) echo "  $LABEL: status=$ST"; return 1 ;; esac
  done
  T1=$(date +%s)
  echo "  trailing=$TRAIL  ->  $((T1-T0))s   ($JOB)"
  echo "$((T1-T0))" > "/tmp/probe-$LABEL"
}
echo "== timing two identical tiny jobs (2 assets, 1 geometry, 1 scramble + real) =="
run_one false off
run_one true on
OFF=$(cat /tmp/probe-off 2>/dev/null || echo 0)
ON=$(cat /tmp/probe-on 2>/dev/null || echo 0)
if [ "$OFF" -gt 0 ] && [ "$ON" -gt 0 ]; then
  python3 -c "
off=$OFF; on=$ON
m=on/off
print()
print(f'trailing multiplier: {m:.2f}x  ({off}s -> {on}s)')
base=397.6
print(f'cycle 11 took {base:.0f} min with trailing off')
print(f'same shape with trailing on: ~{base*m:.0f} min = {base*m/60:.1f} h')
print()
if base*m/60 > 12:
    print('TOO LONG for one feedback cycle. Scope down — and say WHICH')
    print('variable is being reduced, so it is a decision and not inertia.')
else:
    print('acceptable — run the full shape, one variable changed.')
"
fi
