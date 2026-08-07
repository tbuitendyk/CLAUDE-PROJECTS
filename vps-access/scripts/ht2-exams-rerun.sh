#!/usr/bin/env bash
# ht2-exams-rerun.sh -- re-run BOTH HT v2 entrance exams on the current engine.
# The gate is version-scoped by design (R4): 1.42/1.43/1.44 each re-locked it,
# because a changed engine is a new instrument. This re-earns the clearance so
# history tuning is AVAILABLE if the owner wants it — it does not run anything
# against a real coin.
# Exam A must PASS (find the late-only planted rule) and exam B must NOT pass
# (find nothing in the stationary pair). Both outcomes are required.
set -uo pipefail
fire() {
  curl -sS -X POST http://127.0.0.1:8093/api/httwo -H "Content-Type: application/json" \
    -d "{\"examPair\":\"$1\"}"
  echo
}
wait_idle() {
  for i in $(seq 1 90); do
    s=$(curl -sS http://127.0.0.1:8093/api/batches | python3 -c "import sys,json;print(json.load(sys.stdin).get('running') or '')" 2>/dev/null || echo "")
    [ -z "$s" ] && return 0
    sleep 4
  done
  echo "(still busy after wait)"
}
echo "== exam A (late-rule pair — must FIND it) =="; wait_idle; fire PLANTEDLATEUSDT
echo "== waiting for exam A =="; sleep 6; wait_idle
echo "== exam B (stationary pair — must find NOTHING) =="; fire PLANTEDUSDT
echo "== waiting for exam B =="; sleep 6; wait_idle
echo "== gate now reads =="
curl -sS http://127.0.0.1:8093/api/httwo/exams
echo
