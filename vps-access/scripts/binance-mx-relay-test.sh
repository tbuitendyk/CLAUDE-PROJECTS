#!/usr/bin/env bash
# binance-mx-relay-test.sh -- prove (or disprove) that Binance's trading API
# is reachable through the owner's Mexico host, using an SSH dynamic-forward
# SOCKS proxy.
#
# WHY SSH -D AND NOT WIREGUARD FOR THIS TEST: a dynamic forward changes NO
# system state on this VPS — no interface, no routing table, no iptables, no
# packages. Only a process that is explicitly pointed at 127.0.0.1:1080 uses
# it, which is the same application-layer split the production design calls
# for. Killing the ssh process undoes everything. Safe to run while jobs are
# in flight.
#
# Order matters: step 2 is decisive. If the Mexico box is ITSELF 451'd, no
# amount of tunnelling from here helps and we stop.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/mx-endpoint.sh"
HOST_IP="$MX_HOST"
HOST="$MX_SSH"
PORT="$MX_SOCKS_PORT"
SSHOPT=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes -o ServerAliveInterval=15)

echo "== 0. locate the key =="
KEY=""
for cand in /root/aws-mex-deb13.pem /root/.ssh/aws-mex-deb13.pem /home/admin/aws-mex-deb13.pem \
            /etc/deploy-control/aws-mex-deb13.pem /opt/aws-mex-deb13.pem; do
  [ -f "$cand" ] && KEY="$cand" && break
done
if [ -z "$KEY" ]; then
  echo "  key not in the usual places; searching filesystem…"
  KEY=$(find / -maxdepth 5 -name 'aws-mex-deb13.pem' -not -path '*/proc/*' 2>/dev/null | head -1)
fi
if [ -z "$KEY" ]; then
  echo "  KEY NOT FOUND: aws-mex-deb13.pem is not on this VPS."
  echo "  Place it (root-owned, chmod 600) and re-run. Nothing else attempted."
  exit 1
fi
echo "  using key: $KEY"
chmod 600 "$KEY" 2>/dev/null || true

echo "== 1. ssh reachability =="
if ! ssh -i "$KEY" "${SSHOPT[@]}" "$HOST" 'echo "  SSH OK: $(hostname) / $(uname -sr)"'; then
  echo "  SSH FAILED — cannot reach ${HOST_IP}:22 from this VPS. Stopping."
  exit 2
fi

echo "== 2. DECISIVE: does the Mexico host itself reach the Binance trading API? =="
ssh -i "$KEY" "${SSHOPT[@]}" "$HOST" '
  code=$(curl -s -m 20 -o /tmp/b.out -w "%{http_code}" https://api.binance.com/api/v3/ping || echo ERR)
  echo "  api.binance.com/ping -> HTTP $code"
  [ "$code" = "200" ] || { echo "  body: $(head -c 200 /tmp/b.out)"; }
  echo "  its public IP: $(curl -s -m 20 https://api.ipify.org)"
'
MXCODE=$(ssh -i "$KEY" "${SSHOPT[@]}" "$HOST" 'curl -s -m 20 -o /dev/null -w "%{http_code}" https://api.binance.com/api/v3/ping' 2>/dev/null || echo ERR)
if [ "$MXCODE" != "200" ]; then
  echo "  >> Mexico host is NOT cleared for Binance (HTTP $MXCODE). A relay cannot fix this. Stopping."
  exit 3
fi
echo "  >> Mexico host IS cleared. Proceeding to the tunnel."

echo "== 3. geolocation of the exit IP (must read Mexico, not merely non-US) =="
for svc in "https://ipinfo.io/${HOST_IP}/json" "http://ip-api.com/json/${HOST_IP}"; do
  echo "  $svc"
  curl -s -m 15 "$svc" | head -c 400 | sed 's/^/    /'
  echo
done

echo "== 4. SOCKS tunnel up (no system state changed) =="
pkill -f "ssh -i ${KEY} -D ${PORT}" 2>/dev/null || true
sleep 1
ssh -i "$KEY" -D "$PORT" -N -f "${SSHOPT[@]}" "$HOST"
sleep 3
if ! pgrep -f "\-D ${PORT}" >/dev/null; then echo "  tunnel failed to start"; exit 4; fi
echo "  SOCKS5 listening on 127.0.0.1:${PORT}"

echo "== 5. Binance through the tunnel, from THIS vps =="
for ep in "api/v3/ping" "api/v3/time"; do
  code=$(curl -s -m 25 --socks5-hostname "127.0.0.1:${PORT}" -o /tmp/t.out -w '%{http_code}' "https://api.binance.com/${ep}" || echo ERR)
  echo "  $ep -> HTTP $code $( [ "$code" = "200" ] && cat /tmp/t.out | head -c 80 )"
done
echo "  IP Binance would see: $(curl -s -m 25 --socks5-hostname 127.0.0.1:${PORT} https://api.ipify.org || echo '?')"
echo "  (direct, untouched):  $(curl -s -m 15 https://api.ipify.org || echo '?')"

echo "== 6. symbol filters through the tunnel (clip sizing) =="
curl -s -m 30 --socks5-hostname "127.0.0.1:${PORT}" \
  "https://api.binance.com/api/v3/exchangeInfo?symbols=%5B%22DOTUSDT%22,%22DOGEUSDT%22%5D" -o /tmp/xi.json
python3 - <<'EOF' 2>/dev/null || echo "  (no exchangeInfo — see above)"
import json
d = json.load(open("/tmp/xi.json"))
for s in d.get("symbols", []):
    f = {x["filterType"]: x for x in s["filters"]}
    print(f"  {s['symbol']}: status={s['status']} "
          f"minNotional={(f.get('NOTIONAL') or f.get('MIN_NOTIONAL') or {}).get('minNotional','?')} "
          f"stepSize={f.get('LOT_SIZE',{}).get('stepSize','?')} oco={s.get('ocoAllowed')}")
EOF

echo "== done. tunnel left UP. to remove: pkill -f 'ssh -i ${KEY} -D ${PORT}' =="
