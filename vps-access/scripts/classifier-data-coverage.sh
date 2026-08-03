#!/usr/bin/env bash
# classifier-data-coverage.sh -- read-only: per-symbol cache coverage tail.
set -uo pipefail
curl -sS --max-time 10 http://127.0.0.1:8093/api/data-state | python3 -c '
import sys, json
for s in json.load(sys.stdin)["symbols"]:
    sym = s["symbol"]; months = s["months"]; frm = s["from"]; to = s["to"]
    print(f"{sym:10s} {months:4d} months  {frm} .. {to}")
'
