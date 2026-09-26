#!/usr/bin/env bash
# uts-stage-check-status.sh -- READ-ONLY. The stage-engine check's standing for
# the release the box runs: running or not and at which step, and the last
# check's verdict and sentences. Nothing written, nothing started.
set -uo pipefail
curl -sS -m 30 http://127.0.0.1:8094/api/stage-gate/status | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("no answer"); sys.exit(0)
print("state:", d.get("state"), "· release:", d.get("release"), "· busy:", d.get("blockedBy") or "none")
r = d.get("run")
if r: print("run:", r.get("id"), "· step:", r.get("step"), "· done:", r.get("done"), "· error:", r.get("error"), "· started:", r.get("startedAt"))
l = d.get("last")
if l:
    print("last check:", l.get("id"), l.get("at"), "release", l.get("release"), "PASS" if l.get("pass") else "FAIL", "· took", round((l.get("elapsedMs") or 0)/1000), "s")
    for s in (l.get("sentences") or [])[:12]: print("  -", str(s)[:220])
print("detail:", d.get("detail"))'
