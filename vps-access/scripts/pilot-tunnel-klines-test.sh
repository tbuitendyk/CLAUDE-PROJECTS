#!/usr/bin/env bash
# READ-ONLY: prove current LTC/XRP/BCH hourly klines are fetchable from the VPS
# through the Mexico SOCKS tunnel (the data path the live signal needs).
set -uo pipefail
P=1080
pgrep -f -- "-D ${P}" >/dev/null || { echo "tunnel not up"; exit 1; }
now=$(date -u +%s)000
for sym in LTCUSDT XRPUSDT BCHUSDT; do
  out=$(timeout 30 curl -s -m 25 --socks5-hostname 127.0.0.1:${P} \
    "https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=2" 2>/dev/null || echo ERR)
  last=$(printf '%s' "$out" | python3 -c "
import sys,json
try:
  k=json.load(sys.stdin); t=k[-1][0]; import datetime
  print(datetime.datetime.utcfromtimestamp(t/1000).strftime('%Y-%m-%d %H:%M UTC'), 'open',k[-1][1])
except Exception as e: print('parse-fail', str(e)[:60])
")
  echo "  ${sym}: latest hourly candle -> ${last}"
done
