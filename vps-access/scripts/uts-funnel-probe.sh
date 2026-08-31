#!/usr/bin/env bash
# READ-ONLY. How LONG the Funnel's read takes on the real board, and how big the
# answer is. The tab shows nothing while it waits, so a slow read and a broken
# one look identical from the screen.
#
# The set named here is already totalled; nothing here starts work.
set -uo pipefail

PORT=8094
SET=s3-mte0oajo-1

# the body the tab actually sends, not a stripped-down one
BODY='{"step":1,"rule":{"ranges":{},"allowed":{},"floors":{}},"target":null,"dial":null,"dialA":null,"dialB":null,"floor":20,"rebuilt":false}'

echo "== the body the tab sends, timed =="
curl -s -o /tmp/funnel-read.json \
  -w '  status %{http_code}   %{size_download} bytes   %{time_total} seconds\n' \
  -X POST -H 'Content-Type: application/json' --data "$BODY" \
  "http://127.0.0.1:${PORT}/api/funnel/${SET}/read"

echo
echo "== again, warm =="
curl -s -o /dev/null \
  -w '  status %{http_code}   %{size_download} bytes   %{time_total} seconds\n' \
  -X POST -H 'Content-Type: application/json' --data "$BODY" \
  "http://127.0.0.1:${PORT}/api/funnel/${SET}/read"

echo
echo "== for comparison, the ranked table the Boards section draws =="
curl -s -o /dev/null \
  -w '  status %{http_code}   %{size_download} bytes   %{time_total} seconds\n' \
  "http://127.0.0.1:${PORT}/api/stageset/${SET}/ranked?from=0&n=100"

echo
echo "== what the service is using =="
systemctl show ultimate-trading-system -p MemoryCurrent 2>/dev/null || true
journalctl -u ultimate-trading-system --since "-15 min" --no-pager 2>/dev/null | tail -8 || true
