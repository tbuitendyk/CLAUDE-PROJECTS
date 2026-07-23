#!/usr/bin/env bash
# binance-rest-probe.sh -- read-only: can this VPS reach Binance's keyless
# REST data mirrors? (The classifier's live price path depends on it.)
set -euo pipefail
for host in api.binance.vision api.binance.com data.binance.vision; do
  code=$(curl -sS -m 12 -o /tmp/probe.out -w "%{http_code}" "https://$host/api/v3/time" 2>&1 || echo "ERR")
  body=$(head -c 120 /tmp/probe.out 2>/dev/null || true)
  echo "$host -> $code ${body}"
done
