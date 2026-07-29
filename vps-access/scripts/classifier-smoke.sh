#!/usr/bin/env bash
# classifier-smoke.sh -- a 2-minute correctness check to run BEFORE any long
# job, and an invariant checker that can be pointed at any finished run.
#
# WHY (owner, 2026-07-29): cycle 10 burned 6.8 hours to reveal a bug that a
# two-minute run would have caught. Its "real" arm was silently scrambled and
# came out bit-identical to one of its own scrambles. Nothing crashed; 3400
# units completed; fails=0. A tiny job asking "is the real arm actually
# different from the scrambles?" would have failed in under two minutes.
#
# MODE 1 (default): fire a tiny job — 2 assets, 1 geometry, 2 scrambles — and
# check it. Requires a free engine, so this is a PREFLIGHT, not something to
# run alongside a real job.
#
# MODE 2: put a job id in reports/SMOKE-CHECK-JOB and the invariants run
# against that existing doc instead of firing anything. A committed file
# because the deploy API forwards neither arguments NOR environment variables
# — same reason reports/EDGE-JOB exists. Used to prove the checks work by
# pointing them at a run known to be broken.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
B="http://127.0.0.1:8093"

CHECK_ONLY="$(grep -v '^#' "$HERE/reports/SMOKE-CHECK-JOB" 2>/dev/null | head -1 | tr -d ' \r\n' || true)"
if [ -z "${CHECK_ONLY:-}" ]; then
  echo "== firing a tiny job (2 assets, 1 geometry, 2 scrambles + real arm) =="
  OUT=$(curl -sS -X POST "$B/api/bracketlab" -H "Content-Type: application/json" -d '{
    "universe": ["BTCUSDT","ETHUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "holdout": true, "trailing": false, "edgeScreen": true,
    "labelShiftFrac": 0.5, "labelShiftReps": 2, "labelShiftScope": "window",
    "promoteK": 50, "minTrades": 1,
    "label": "smoke",
    "description": "Two-minute preflight. Checks that the real arm is genuinely unscrambled, that money and scope fields are populated, and that no two arms are bit-identical — the invariant that exposed cycle 10 after 6.8 wasted hours."
  }')
  echo "$OUT"
  JOB=$(printf '%s' "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('batchId',''))")
  [ -n "$JOB" ] || { echo "SMOKE FAIL: no batchId — is a job already running?"; exit 1; }
  echo "== waiting for $JOB =="
  for i in $(seq 1 40); do
    sleep 15
    ST=$(curl -sS "$B/api/batch/$JOB" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))")
    [ "$ST" = "done" ] && break
    case "$ST" in failed|cancelled|error) echo "SMOKE FAIL: status=$ST"; exit 1 ;; esac
  done
else
  JOB="$CHECK_ONLY"
  echo "== invariant check only, against $JOB =="
fi

JOB="$JOB" python3 <<'EOF'
import json, urllib.request, os
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
d=get(f"{B}/api/batch/{os.environ['JOB']}")
rows=d.get("edgeCensus") or []
fails=[]
def chk(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok: fails.append(msg)

print(f"\ndoc {d['id']} status={d['status']} census rows={len(rows)}")
chk(len(rows) > 0, "census has rows")
real=[r for r in rows if not r.get("shiftFrac")]
scr=[r for r in rows if r.get("shiftFrac")]
chk(len(real) > 0, f"a real arm exists ({len(real)} rows)")
chk(len(scr) > 0, f"scrambles exist ({len(scr)} rows)")

# THE INVARIANT THAT CAUGHT CYCLE 10.
if real and scr:
    def net(g): return sum(r["holdPnl"] for r in g if r.get("holdPnl") is not None)
    rn=net(real)
    draws=sorted({r["shiftFrac"] for r in scr})
    ties=[]
    for dd in draws:
        sn=net([r for r in scr if r["shiftFrac"]==dd])
        if rn and abs(sn-rn) < 1e-6: ties.append(dd)
    chk(not ties,
        "the real arm is NOT bit-identical to any scramble"
        + (f" — TIED WITH {['%.3f'%t for t in ties]}: the real arm was scrambled" if ties else ""))
    # per-scramble nets must differ from each other too
    nets=[net([r for r in scr if r["shiftFrac"]==dd]) for dd in draws]
    chk(len(set(round(x,6) for x in nets)) == len(nets),
        "the scrambles differ from each other")

chk(any(r.get("holdPnl") is not None for r in rows), "money is recorded (holdPnl)")
chk(any(r.get("holdTrades") for r in rows), "trade counts are recorded")
chk(any(r.get("holdDirCalls") is not None for r in rows), "directional calls are recorded")
scopes={r.get("shiftScope") for r in rows if r.get("shiftScope")}
want=(d.get("params") or {}).get("labelShiftScope") or "series"
chk(not scopes or scopes == {want}, f"scope tag matches the run ({scopes or 'untagged'} vs {want})")

print()
if fails:
    print(f"SMOKE FAIL — {len(fails)} invariant(s) broken. DO NOT fire a long job.")
    raise SystemExit(1)
print("SMOKE PASS — safe to fire a long job.")
EOF
