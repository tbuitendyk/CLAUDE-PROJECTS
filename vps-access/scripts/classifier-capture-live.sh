#!/usr/bin/env bash
# classifier-capture-live.sh -- READ-ONLY: capture what the DEPLOYED classifier
# serves to the Constructing and Trading tabs, as one JSON bundle on stdout.
#
# WHY. The runtime browser check runs against a build box, whose data is not the
# owner's. Its honest limit was "it proves the software behaves, not that it
# behaves on YOUR data" — a page can render perfectly on fixture data and still
# break on a shape only the live box has (an F1 pilot holding an open position, a
# halt with a reason, a real incident row, campaigns with the owner's names).
# This captures those shapes so a browser can be pointed at them, WITHOUT putting
# a browser on the box that runs live trading and without moving any secret.
#
# STRICTLY GET. Nothing here writes, arms, launches or mutates: it is the same
# set of reads the two tabs perform when you open them. It is a health-check
# capture, not an analysis — the numbers are replayed for RENDERING, never
# interpreted here (the owner drives interpretation).
set -uo pipefail
B=http://127.0.0.1:8093
get() { curl -sS -m 25 "$B/$1" 2>/dev/null; }

python3 - <<'PY'
import json, subprocess, sys

B = "http://127.0.0.1:8093"
def get(p):
    try:
        out = subprocess.run(["curl","-sS","-m","25",f"{B}/{p}"],
                             capture_output=True, text=True, timeout=40)
        return json.loads(out.stdout)
    except Exception:
        return None

bundle = {}
# the fixed reads both tabs make on load
for p in ["api/healthz","api/batches","api/campaigns","api/cpu","api/data-state",
          "api/httwo/exams","api/live/configs","api/live/greenlights","api/live/setups",
          "api/live/targets","api/pilot","api/pilot/fixed-stop","api/pilot/stop-candidates",
          "api/planted-gate/status","api/bracketlab/verdict-sources"]:
    bundle[p] = get(p)

# follow-ups keyed off what came back: the runs the boards tab can open...
batches = bundle.get("api/batches") or []
lst = batches if isinstance(batches, list) else (batches.get("batches") or [])
for it in lst[:6]:
    rid = it.get("id") if isinstance(it, dict) else it
    if rid:
        bundle[f"api/batch/{rid}"] = get(f"api/batch/{rid}")

# ...and every live setup's status, which is what the Trading money reads
setups = (bundle.get("api/live/setups") or {})
for s in (setups.get("setups") or [])[:12]:
    sid = s.get("id")
    if sid:
        bundle[f"api/live/setups/{sid}/status"] = get(f"api/live/setups/{sid}/status")

# a caller must be able to tell a captured null (endpoint answered null) from an
# endpoint that was never reached; record which keys failed outright.
bundle["_meta"] = {
    "captured": [k for k, v in bundle.items() if v is not None and k != "_meta"],
    "failed":   [k for k, v in bundle.items() if v is None],
}
print(json.dumps(bundle))
PY
