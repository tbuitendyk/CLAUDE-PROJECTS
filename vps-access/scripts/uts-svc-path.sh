#!/usr/bin/env bash
# READ-ONLY. What the trading service answers for the exact path the Compute
# tab asks for -- which is where nginx sends it. No auth needed: this is the
# proxy target, behind the password. Changes nothing.
set -uo pipefail
for p in /svc/api/compute /api/compute-config /api/last-death?unit=x; do
  code=$(curl -s -o /tmp/b -w '%{http_code}' --max-time 8 "http://127.0.0.1:8094$p")
  echo "8094 $p -> HTTP $code"
  head -c 120 /tmp/b; echo
done
echo
echo "== is there a static svc folder that could be answering? =="
ls -la /opt/ultimate-trading-system/public/ | grep -i svc || echo "(no svc under public/)"
