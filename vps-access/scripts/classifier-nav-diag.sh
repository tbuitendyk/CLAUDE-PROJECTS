#!/usr/bin/env bash
# classifier-nav-diag.sh -- read-only: verify the latest UI markers are on disk
# AND actually served by the node service. No restarts, no writes.
set -uo pipefail
echo "== deploy checkout rev =="
git -C "$HOME/deploy-general-classifier" rev-parse --short HEAD 2>/dev/null || echo "no checkout"
check() { # <label> <urlpath> <marker>
  CODE=$(curl -s -o /tmp/diag-page -w '%{http_code}' --max-time 10 "http://127.0.0.1:8093$2")
  HIT=$(grep -c "$3" /tmp/diag-page 2>/dev/null || true)
  echo "  $1: GET $2 -> $CODE, marker '$3' hits: $HIT"
}
echo "== served by the node service =="
check "pilot history"   /pilot.html       "Daily decision history"
check "pilot dark nav"  /pilot.html       "f1 live pilot"
check "index LT tab"    /index.html       "livetrading.html"
check "livetrading nav" /livetrading.html "Back to the app"
echo "== same markers on disk under /opt =="
for f in pilot.html index.html livetrading.html; do
  echo "  $f: mtime $(stat -c %y /opt/general-classifier/public/$f 2>/dev/null | cut -c1-19)"
done
grep -c "Daily decision history" /opt/general-classifier/public/pilot.html | sed 's/^/  pilot.html history-marker on disk: /'
rm -f /tmp/diag-page
