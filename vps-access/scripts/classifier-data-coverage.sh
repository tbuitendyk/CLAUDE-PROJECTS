#!/usr/bin/env bash
# classifier-data-coverage.sh -- read-only: per-symbol cache coverage tail
# (last cached month per asset) plus which July/August files exist for DOT
# as a probe of what the refresh actually fetched.
set -uo pipefail
curl -sS --max-time 10 http://127.0.0.1:8093/api/data-state | python3 -c '
import sys, json
for s in json.load(sys.stdin)["symbols"]:
    print(f"{s[\"symbol\"]:10s} {s[\"months\"]:4d} months  {s[\"from\"]} .. {s[\"to\"]}")
'
echo "-- DOT cache files for 2026-07/08 (monthly + daily):"
ls /opt/general-classifier/data/cache/ | grep -E 'DOTUSDT-1h-2026-0[78]' | head -8 || echo "none"
