#!/usr/bin/env bash
# live-tab-check.sh -- READ-ONLY: the Live Trading tab + its API are served,
# and a cross-site state POST (valid JSON) is refused by the CSRF guard.
set -uo pipefail
B=http://127.0.0.1:8093
echo "livetrading.html: HTTP $(curl -sS -o /dev/null -w '%{http_code}' -m 6 $B/livetrading.html)"
echo "GET /api/live/setups     : $(curl -sS -m 6 $B/api/live/setups)"
echo "GET /api/live/greenlights: $(curl -sS -m 6 $B/api/live/greenlights)"
code=$(curl -sS -o /dev/null -w '%{http_code}' -m 6 -X POST \
  -H 'Content-Type: application/json' -H 'Origin: https://evil.example' \
  --data '{"to":"live"}' "$B/api/live/setups/some-id/state")
echo "cross-site state POST -> HTTP $code (expect 403 CSRF)"
echo "(read-only)"
