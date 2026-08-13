#!/usr/bin/env bash
# classifier-nav-diag.sh -- read-only: stop-tuner visibility check.
set -uo pipefail
echo "-- /api/pilot/convictionsweep --"
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/convictionsweep | head -c 200; echo
echo "-- /api/pilot/stop-candidates --"
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/stop-candidates | head -c 400; echo
echo "-- /api/pilot/stopsweep (state) --"
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/stopsweep | head -c 300; echo
echo "-- /api/pilot/fixed-stop (applied) --"
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/fixed-stop | head -c 200; echo
