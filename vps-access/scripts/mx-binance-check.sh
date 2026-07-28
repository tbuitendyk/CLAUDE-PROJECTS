#!/usr/bin/env bash
# mx-binance-check.sh -- ONLY the decisive question, no backgrounded
# processes: does the Mexico host reach Binance's trading API? (A
# backgrounded ssh -f inherits stdout and hangs deploy-control's
# capture_output forever, so tunnel setup lives in a separate script that
# fully detaches.)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/mx-endpoint.sh"
KEY=/root/.ssh/aws-mex-deb13.pem
HOST="$MX_SSH"
S=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes)
echo "== ssh =="
timeout 30 ssh "${S[@]}" "$HOST" 'echo "  OK $(hostname) $(uname -sr)"' </dev/null || { echo "  SSH FAILED"; exit 2; }
echo "== Binance from the Mexico host =="
timeout 90 ssh "${S[@]}" "$HOST" '
  for ep in ping time; do
    c=$(curl -s -m 15 -o /tmp/b.out -w "%{http_code}" "https://api.binance.com/api/v3/$ep" 2>/dev/null || echo ERR)
    echo "  api/v3/$ep -> HTTP $c"
    [ "$c" != "200" ] && echo "    body: $(head -c 160 /tmp/b.out)"
  done
  echo "  egress IP: $(curl -s -m 15 https://api.ipify.org 2>/dev/null || echo ?)"
  echo "  data portal: $(curl -s -m 15 -o /dev/null -w %{http_code} https://data.binance.vision/ 2>/dev/null || echo ERR)"
' </dev/null || echo "  (remote probe timed out)"
