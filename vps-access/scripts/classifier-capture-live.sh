#!/usr/bin/env bash
# classifier-capture-live.sh -- READ-ONLY: describe the SHAPES the deployed
# classifier serves to the Constructing and Trading tabs. Not the data — the
# shapes: which fields exist, of what type, how long the arrays are, and which
# state flags are set.
#
# WHY SHAPES AND NOT DATA. The browser check runs on a build box, and its honest
# limit was "it proves the software behaves, not that it behaves on YOUR data".
# The actual risk inside that limit is narrow: a SHAPE the live box produces and
# the fixture box never does — an F1 pilot holding an open position, a halt
# carrying a reason, an incident row, a setup on two books. Naming those is
# enough to build them locally and drive a real browser at them, which is better
# than shipping the owner's live numbers into a scratch container to look at.
#
# STRICTLY GET, and it prints no money: values are replaced by their type and
# size, with only booleans and counts kept. Nothing here writes, arms or
# launches. The owner interprets numbers; this reports structure.
set -uo pipefail
python3 - <<'PY'
import json, subprocess

B = "http://127.0.0.1:8093"
def get(p):
    try:
        r = subprocess.run(["curl","-sS","-m","25",f"{B}/{p}"], capture_output=True, text=True, timeout=40)
        return json.loads(r.stdout)
    except Exception:
        return None

def shape(v, depth=0):
    """Structure only. Numbers become 'num' — this must never print money."""
    if v is None: return "null"
    if isinstance(v, bool): return f"bool:{v}"
    if isinstance(v, (int, float)): return "num"
    if isinstance(v, str): return "str" if v else "str:empty"
    if isinstance(v, list):
        if not v: return "[]"
        if depth >= 2: return f"[{len(v)}x...]"
        return f"[{len(v)}x {shape(v[0], depth+1)}]"
    if isinstance(v, dict):
        if depth >= 2: return "{...}"
        return "{" + ",".join(f"{k}:{shape(x, depth+1)}" for k, x in sorted(v.items())) + "}"
    return type(v).__name__

out = {}
for p in ["api/live/configs","api/live/setups","api/live/targets","api/pilot",
          "api/live/greenlights","api/campaigns","api/data-state","api/pilot/fixed-stop"]:
    out[p] = shape(get(p))

# the two facts that decide whether the fixture box can reproduce the live box
pilot = get("api/pilot") or {}
opens = pilot.get("openPositions") or []
cfgs  = (get("api/live/configs") or {}).get("configs") or []
setups = (get("api/live/setups") or {}).get("setups") or []
notable = {
    "pilot_present": pilot.get("present") is not False,
    "pilot_armed": bool(pilot.get("armed")),
    "pilot_halted": bool(pilot.get("halted")),
    "pilot_haltReason_present": pilot.get("haltReason") is not None,
    "pilot_open_positions": len(opens),
    "pilot_open_sides": sorted({str(o.get("side")) for o in opens}),
    "pilot_incidents": len(pilot.get("incidents") or []),
    "pilot_closedRecent": len(pilot.get("closedRecent") or []),
    "configs_total": len(cfgs),
    "configs_with_paper": sum(1 for c in cfgs if (c.get("channels") or {}).get("paper")),
    "configs_with_real": sum(1 for c in cfgs if (c.get("channels") or {}).get("real")),
    "configs_with_BOTH": sum(1 for c in cfgs
                             if (c.get("channels") or {}).get("paper") and (c.get("channels") or {}).get("real")),
    "setups_total": len(setups),
    "setup_states": sorted({str(s.get("state")) for s in setups}),
}
for s in setups[:8]:
    st = get(f"api/live/setups/{s.get('id')}/status") or {}
    ops = st.get("openPositions") or []
    notable.setdefault("setup_status", []).append({
        "state": s.get("state"),
        "open_total": len(ops),
        "open_paper": sum(1 for o in ops if o.get("paper")),
        "open_real": sum(1 for o in ops if not o.get("paper")),
        "incidents": len(st.get("incidents") or []),
    })

print(json.dumps({"shapes": out, "notable": notable}, indent=1)[:7000])
PY
