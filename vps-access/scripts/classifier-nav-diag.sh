#!/usr/bin/env bash
# classifier-nav-diag.sh -- read-only: UTS-migration live verification.
set -uo pipefail
c() { echo "-- $1 --"; curl -s -o /tmp/d -w '%{http_code}' --max-time 10 "http://127.0.0.1:8093$2"; echo " ($(grep -c "$3" /tmp/d 2>/dev/null || true) marker hits)"; }
c "constructing page" /constructing.html "Constructing"
c "constructing js"   /constructing.js   "heavy-scan"
c "trading page"      /livetrading.html  "Paper Books"
c "index tabs"        /index.html        "constructing.html"
echo "-- /api/live/configs --"; curl -s --max-time 10 http://127.0.0.1:8093/api/live/configs | head -c 200; echo
echo "-- /api/campaigns --"; curl -s --max-time 10 http://127.0.0.1:8093/api/campaigns | head -c 200; echo
echo "-- /api/pilot/heavyscan --"; curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/heavyscan; echo
rm -f /tmp/d
