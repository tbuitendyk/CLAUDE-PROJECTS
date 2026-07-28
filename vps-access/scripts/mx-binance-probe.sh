#!/usr/bin/env bash
# mx-binance-probe.sh -- the decisive question: does the Mexico host reach
# Binance's trading API? Then, if so, does a SOCKS forward carry that access
# back to this VPS. Every ssh/curl is hard-bounded; no system state is
# changed here (dynamic forward only), so it is safe with jobs in flight.
set -uo pipefail
KEY=/root/.ssh/aws-mex-deb13.pem
HOST=admin@78.12.190.144
PORT=1080
S=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes)

echo "== 1. ssh in =="
timeout 30 ssh "${S[@]}" "$HOST" 'echo "  OK: $(hostname) $(uname -sr)"' || { echo "  SSH FAILED"; exit 2; }

echo "== 2. DECISIVE — Binance from the Mexico host itself =="
timeout 60 ssh "${S[@]}" "$HOST" '
  for ep in ping time; do
    c=$(curl -s -m 15 -o /tmp/b.out -w "%{http_code}" "https://api.binance.com/api/v3/$ep" 2>/dev/null || echo ERR)
    echo "  api/v3/$ep -> HTTP $c"
    [ "$c" != "200" ] && echo "    $(head -c 150 /tmp/b.out)"
  done
  echo "  its egress IP: $(curl -s -m 15 https://api.ipify.org 2>/dev/null || echo ?)"
' || echo "  (remote probe timed out)"

MX=$(timeout 40 ssh "${S[@]}" "$HOST" 'curl -s -m 15 -o /dev/null -w "%{http_code}" https://api.binance.com/api/v3/ping' 2>/dev/null || echo ERR)
echo "== verdict on the Mexico host: HTTP $MX =="
[ "$MX" = "200" ] || { echo "  NOT cleared — a relay cannot fix this. Stopping."; exit 3; }

echo "== 3. SOCKS forward up (no system state changed) =="
pkill -f "ssh .* -D ${PORT} " 2>/dev/null || true
sleep 1
timeout 30 ssh "${S[@]}" -D "$PORT" -N -f "$HOST" || { echo "  tunnel failed"; exit 4; }
sleep 3
pgrep -f -- "-D ${PORT}" >/dev/null && echo "  SOCKS5 up on 127.0.0.1:${PORT}" || { echo "  tunnel not running"; exit 4; }

echo "== 4. Binance from THIS vps, through the tunnel =="
for ep in ping time; do
  c=$(timeout 30 curl -s -m 25 --socks5-hostname 127.0.0.1:${PORT} -o /tmp/t.out -w '%{http_code}' "https://api.binance.com/api/v3/$ep" 2>/dev/null || echo ERR)
  echo "  api/v3/$ep -> HTTP $c $( [ "$c" = "200" ] && head -c 60 /tmp/t.out )"
done
echo "  IP Binance sees: $(timeout 30 curl -s -m 25 --socks5-hostname 127.0.0.1:${PORT} https://api.ipify.org 2>/dev/null || echo ?)"
echo "  direct (untouched): $(timeout 20 curl -s -m 15 https://api.ipify.org 2>/dev/null || echo ?)"

echo "== 5. symbol filters through the tunnel =="
timeout 40 curl -s -m 30 --socks5-hostname 127.0.0.1:${PORT} \
  "https://api.binance.com/api/v3/exchangeInfo?symbols=%5B%22DOTUSDT%22,%22DOGEUSDT%22%5D" -o /tmp/xi.json 2>/dev/null
python3 - <<'PY' 2>/dev/null || echo "  (no exchangeInfo)"
import json
d=json.load(open('/tmp/xi.json'))
for s in d.get('symbols',[]):
    f={x['filterType']:x for x in s['filters']}
    print(f"  {s['symbol']}: {s['status']} minNotional={(f.get('NOTIONAL') or f.get('MIN_NOTIONAL') or {}).get('minNotional','?')} "
          f"step={f.get('LOT_SIZE',{}).get('stepSize','?')} oco={s.get('ocoAllowed')}")
PY
echo "== tunnel left UP (pkill -f 'ssh .* -D ${PORT} ' to remove) =="
