#!/usr/bin/env bash
# READ-ONLY. Asks the Funnel's read route what it says for the set on the box,
# because the tab renders nothing and a blank screen carries no error to read.
#
# The set named here is already totalled, so this reads a tally that exists and
# starts no work. It POSTs one request and prints the status and the body.
set -uo pipefail

PORT=8094
SET=s3-mte0oajo-1

echo "== does the route exist at all =="
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  --data '{"step":1}' \
  "http://127.0.0.1:${PORT}/api/funnel/${SET}/read" || echo 000)
echo "POST /api/funnel/${SET}/read -> HTTP ${code}"

echo
echo "== the first 1200 characters of what it answered =="
curl -s -X POST -H 'Content-Type: application/json' --data '{"step":1}' \
  "http://127.0.0.1:${PORT}/api/funnel/${SET}/read" | head -c 1200
echo
echo

echo "== for comparison, a route that is known to work =="
curl -s -o /dev/null -w 'GET /api/stageset/%{url_effective} -> %{http_code}\n' \
  "http://127.0.0.1:${PORT}/api/stageset/${SET}/ranked?from=0&n=1" || true

echo
echo "== what the service last logged =="
journalctl -u ultimate-trading-system -n 25 --no-pager 2>/dev/null | tail -25 || echo "(no journal access)"
