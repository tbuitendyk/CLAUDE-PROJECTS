#!/usr/bin/env bash
# binance-trade-reachability.sh -- read-only, KEYLESS probe of Binance's
# TRADING API surface from this VPS (the data portal is a separate host and
# is known-good). Answers one question: is api.binance.com usable from here,
# or is the split tunnel required? Also pulls the symbol filters we need for
# clip sizing (minNotional / stepSize / tickSize) when it IS reachable.
# Touches no keys, places no orders, restarts nothing. Safe while jobs run.
set -euo pipefail

probe() { # name url
  local name="$1" url="$2" code body
  body=$(curl -sS -m 15 -o /tmp/bin-probe.out -w '%{http_code}' "$url" 2>/tmp/bin-probe.err || echo "ERR")
  code="$body"
  if [[ "$code" == "ERR" ]]; then
    echo "  $name: NETWORK ERROR — $(head -c 120 /tmp/bin-probe.err)"
  else
    echo "  $name: HTTP $code $( [[ "$code" == "200" ]] && echo OK || head -c 160 /tmp/bin-probe.out )"
  fi
}

echo "== trading API (api.binance.com) =="
probe "ping        " "https://api.binance.com/api/v3/ping"
probe "server time " "https://api.binance.com/api/v3/time"

echo "== alternate trading hosts =="
for h in api1 api2 api3 api-gcp; do
  probe "$h        " "https://${h}.binance.com/api/v3/ping"
done

echo "== data hosts (known-good baseline) =="
probe "data portal " "https://data.binance.vision/"
probe "data mirror " "https://api.binance.vision/api/v3/ping"

echo "== egress identity =="
echo "  direct exit IP: $(curl -sS -m 15 https://api.ipify.org || echo '?')"

echo "== symbol filters (only if the trading API answered) =="
if curl -sS -m 15 -o /tmp/bin-info.json "https://api.binance.com/api/v3/exchangeInfo?symbols=%5B%22DOTUSDT%22,%22AVAXUSDT%22,%22UNIUSDT%22,%22DOGEUSDT%22%5D" 2>/dev/null; then
  python3 - <<'EOF' 2>/dev/null || echo "  (could not parse exchangeInfo — likely blocked)"
import json
d = json.load(open("/tmp/bin-info.json"))
for s in d.get("symbols", []):
    f = {x["filterType"]: x for x in s["filters"]}
    print(f"  {s['symbol']}: status={s['status']} "
          f"minNotional={f.get('NOTIONAL',{}).get('minNotional') or f.get('MIN_NOTIONAL',{}).get('minNotional','?')} "
          f"stepSize={f.get('LOT_SIZE',{}).get('stepSize','?')} tickSize={f.get('PRICE_FILTER',{}).get('tickSize','?')} "
          f"oco={s.get('ocoAllowed')} otoco={s.get('otoAllowed')}")
EOF
else
  echo "  (trading API unreachable — expected while the US 451 stands)"
fi
