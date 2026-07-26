#!/usr/bin/env bash
# classifier-consensus-clone.sh -- start a consensus screen whose params are
# an exact mirror of an existing batch doc, with the pair list swapped for a
# single symbol. Exists so a pre-registered confirmation run (VERDICTS.md A2)
# provably shares band/geometry/decision/months/shifts with its reference.
#
# Usage via run-script:  arg = "<refDocId>@<PAIR>"
#   e.g. "consensus-20260726-0038@AVAXUSDT"
# Prints the request body it sent and the service's JSON response. Rejected
# with 409 by the service if a batch is already running.
set -euo pipefail
ARG="${1:-}"
if [[ "$ARG" != *@* ]]; then
  echo "usage: run-script classifier-consensus-clone.sh <refDocId>@<PAIR>" >&2
  exit 1
fi
REF="${ARG%@*}"
PAIR="${ARG##*@}"
DOC="/opt/general-classifier/data/batches/${REF}.json"
if [[ ! -f "$DOC" ]]; then
  echo "no such batch doc: $REF" >&2
  exit 1
fi
DOC="$DOC" PAIR="$PAIR" python3 - <<'EOF'
import json, os, urllib.request
p = json.load(open(os.environ["DOC"]))["params"]
body = {
    "startMonth": p.get("startMonth", "2018-01"),
    "endMonth": p.get("endMonth", "2026-06"),
    "compareSymbol": p.get("compareSymbol", "BTCUSDT"),
    "pairs": [os.environ["PAIR"].upper()],
    "nullShifts": p.get("nullShifts", 0),
    "geometry": p.get("geometry", "weekly-8d"),
    "decision": p.get("decision", "argmax"),
    "dormantPct": p.get("dormantPct", "auto"),
    "weekdaysOnly": bool(p.get("weekdaysOnly", False)),
    "allLoaded": bool(p.get("allLoaded", False)),
}
print("request:", json.dumps(body))
req = urllib.request.Request(
    "http://127.0.0.1:8093/api/consensus",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    print("response:", urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError as e:
    print("response:", e.code, e.read().decode())
    raise SystemExit(1)
EOF
