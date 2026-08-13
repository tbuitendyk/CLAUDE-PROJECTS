#!/usr/bin/env bash
# classifier-nav-diag.sh -- read-only: dump both sweep results for analysis.
set -uo pipefail
echo "===STOPSWEEP==="
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/stopsweep
echo; echo "===CONVICTION==="
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/convictionsweep
echo; echo "===APPLIED-STOP==="
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/fixed-stop
echo
