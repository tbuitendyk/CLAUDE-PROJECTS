#!/usr/bin/env bash
# pilot-stop-state.sh -- classify the owner's fixed-stop.json into ONE of three
# carry states for the box (CONTROL BUG 3/4, 2026-08-11 e2e review). Single source
# of truth so the carry logic and its test agree.
#
#   SET <v>  file parses; stopPct is a valid live stop (>= 0.5% floor, < 1). The
#            value is emitted at FULL precision (the old .6f truncated a sub-1e-6
#            value to a fake "0.000000" the box read as NO stop).
#   CLEAR    file absent, or stopPct is null / <= 0 -> the owner INTENDS no stop;
#            clearing the box stop is correct.
#   ERROR    file PRESENT but unreadable/invalid, or a positive-but-off-shape value
#            (below the 0.5% noise floor, or >= 1). A corrupt file must NEVER read
#            as "clear the stop" — a disk glitch would then silently strip a
#            protective stop the owner set. Caller retains the current box stop and
#            surfaces the condition.
#
# Usage: pilot-stop-state.sh <fixed-stop.json>   (stdout: "SET <v>" | "CLEAR" | "ERROR")
set -uo pipefail
python3 - "${1:-}" <<'PY'
import json, sys, os
p = sys.argv[1] if len(sys.argv) > 1 else ""
FLOOR = 0.005   # must match the /api/pilot/stop-apply floor (CONTROL BUG 2)
if not p or not os.path.exists(p):
    print("CLEAR"); sys.exit(0)
try:
    with open(p) as f:
        d = json.load(f)
except Exception:
    print("ERROR"); sys.exit(0)
if not isinstance(d, dict):
    print("ERROR"); sys.exit(0)
v = d.get("stopPct")
if v is None:
    print("CLEAR")
elif isinstance(v, bool):
    print("ERROR")                       # bool is an int subclass; not a stop
elif isinstance(v, (int, float)) and v <= 0:
    print("CLEAR")                       # explicit no-stop
elif isinstance(v, (int, float)) and FLOOR <= v < 1:
    print(f"SET {float(v):.10f}")        # full precision — no truncation-to-zero
else:
    print("ERROR")                       # below floor / >= 1 / wrong type: do NOT clear
PY
