#!/usr/bin/env bash
# mx-tunnel-up.sh -- bring up (or refresh) the Binance execution tunnel: an
# SSH dynamic forward to the Mexico host exposing SOCKS5 on 127.0.0.1:1080.
#
# APPLICATION-LAYER BY CONSTRUCTION: no interface, no route, no iptables, no
# packages. Only a client explicitly pointed at 127.0.0.1:1080 uses Mexico;
# everything else on this VPS keeps its direct line. Safe with jobs running.
#
# The ssh process is fully detached (setsid + all three fds redirected) —
# otherwise it inherits stdout and hangs deploy-control's output capture
# forever, which is exactly what bit the first two attempts.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/mx-endpoint.sh"
KEY="$MX_KEY"
HOST="$MX_SSH"
PORT="$MX_SOCKS_PORT"

echo "== clearing any existing tunnel =="
pkill -f "ssh .*-D ${PORT}" 2>/dev/null && sleep 1 || true

echo "== starting detached SOCKS forward =="
setsid ssh -i "$KEY" \
  -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -D "$PORT" -N "$HOST" </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true
sleep 4

if pgrep -f -- "-D ${PORT}" >/dev/null; then
  echo "  SOCKS5 up on 127.0.0.1:${PORT} (pid $(pgrep -f -- "-D ${PORT}" | head -1))"
else
  echo "  FAILED to start"; exit 4
fi

echo "== Binance through the tunnel, from this VPS =="
for ep in ping time; do
  c=$(timeout 30 curl -s -m 25 --socks5-hostname 127.0.0.1:${PORT} -o /tmp/t.out -w '%{http_code}' \
      "https://api.binance.com/api/v3/$ep" 2>/dev/null || echo ERR)
  echo "  api/v3/$ep -> HTTP $c $( [ "$c" = "200" ] && head -c 60 /tmp/t.out )"
done
echo "  IP Binance sees : $(timeout 30 curl -s -m 25 --socks5-hostname 127.0.0.1:${PORT} https://api.ipify.org 2>/dev/null || echo ?)"
echo "  direct untouched: $(timeout 20 curl -s -m 15 https://api.ipify.org 2>/dev/null || echo ?)"

echo "== symbol filters (clip sizing) through the tunnel =="
timeout 40 curl -s -m 30 --socks5-hostname 127.0.0.1:${PORT} \
  "https://api.binance.com/api/v3/exchangeInfo?symbols=%5B%22DOTUSDT%22,%22DOGEUSDT%22,%22AVAXUSDT%22%5D" -o /tmp/xi.json 2>/dev/null
python3 - <<'PY' 2>/dev/null || echo "  (no exchangeInfo)"
import json
d=json.load(open('/tmp/xi.json'))
for s in d.get('symbols',[]):
    f={x['filterType']:x for x in s['filters']}
    n=(f.get('NOTIONAL') or f.get('MIN_NOTIONAL') or {})
    print(f"  {s['symbol']}: {s['status']} minNotional={n.get('minNotional','?')} "
          f"step={f.get('LOT_SIZE',{}).get('stepSize','?')} tick={f.get('PRICE_FILTER',{}).get('tickSize','?')} "
          f"oco={s.get('ocoAllowed')} otoco={s.get('otoAllowed')}")
PY
echo "== tunnel left UP. teardown: pkill -f 'ssh .*-D ${PORT}' =="
