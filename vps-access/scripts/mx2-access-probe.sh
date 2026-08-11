#!/usr/bin/env bash
# mx2-access-probe.sh -- READ-ONLY probe of the NEW Mexico trading box.
#
# Owner (chat, 2026-08-11), verbatim command from the VPS:
#   ssh -i "aws-mex-deb13-new.pem" admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
#
# The old endpoint (78.12.190.144, aws-mex-deb13.pem) is superseded; this
# script probes the NEW one without touching mx-endpoint.sh yet -- config
# changes follow only after access is confirmed, with the standard email.
#
# What this establishes, in order of importance:
#   1. Can the VPS reach the box at all (key present, ssh answers)?
#   2. DECISIVE: does api.binance.com answer from the box (no HTTP 451)?
#      If it is 451'd there too, no executor on this box helps and we stop.
#   3. LTCUSDT order filters -- the minimum clip the pilot may trade, and
#      whether margin (needed for SHORT legs) is allowed on the symbol.
#   4. Box basics: clock sync (signed requests die on drift), tooling.
#
# Places no orders, writes nothing on the box, uses no API keys.
set -uo pipefail

HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
RUSER=admin

KEY=""
for k in /root/.ssh/aws-mex-deb13-new.pem /root/aws-mex-deb13-new.pem \
         /home/*/aws-mex-deb13-new.pem /root/.ssh/aws-mex-deb13.pem; do
  [ -f "$k" ] && KEY="$k" && break
done
if [ -z "$KEY" ]; then
  echo "NO KEY FOUND: aws-mex-deb13-new.pem is not on this VPS."
  echo "Looked in /root/.ssh, /root, /home/*. Contents of /root/.ssh:"
  ls -l /root/.ssh 2>/dev/null | sed 's/^/  /'
  exit 1
fi
echo "using key: $KEY (perms $(stat -c %a "$KEY" 2>/dev/null))"
# ssh refuses group/world-readable keys; fix perms in place if needed
[ "$(stat -c %a "$KEY" 2>/dev/null)" != "600" ] && chmod 600 "$KEY" && echo "  (tightened to 600)"

echo "== ssh to $RUSER@$HOST =="
timeout 60 ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 \
    -o StrictHostKeyChecking=accept-new "$RUSER@$HOST" 'bash -s' <<'R'
echo "== box identity =="
echo "  $(uname -sr)  user=$(whoami)  utc=$(date -u '+%Y-%m-%d %H:%M:%S')"
echo "== clock sync (signed Binance requests reject on drift) =="
timedatectl 2>/dev/null | grep -Ei 'synchronized|ntp' | sed 's/^/  /' || echo "  (timedatectl unavailable)"
echo "== tooling =="
for t in node curl python3 jq git; do
  if command -v "$t" >/dev/null 2>&1; then
    printf '  %-8s %s\n' "$t" "$("$t" --version 2>&1 | head -1)"
  else
    printf '  %-8s MISSING\n' "$t"
  fi
done
echo "== home directory (what already lives here) =="
ls -la "$HOME" 2>/dev/null | sed -n '2,10p' | sed 's/^/  /'
echo "== egress identity =="
curl -sS -m 10 https://ipinfo.io 2>/dev/null | tr -d '\n' | head -c 260; echo
echo "== DECISIVE: Binance trading API from this box =="
for u in https://api.binance.com/api/v3/ping https://api.binance.com/api/v3/time; do
  code=$(curl -sS -o /tmp/bprobe -w '%{http_code}' -m 12 "$u" 2>/dev/null || echo FAIL)
  echo "  $u -> HTTP $code  body: $(head -c 100 /tmp/bprobe 2>/dev/null)"
done
echo "== LTCUSDT filters (minimum clip + margin/short availability) =="
curl -sS -m 12 "https://api.binance.com/api/v3/exchangeInfo?symbol=LTCUSDT" -o /tmp/xinfo 2>/dev/null
if command -v python3 >/dev/null 2>&1; then
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/xinfo'))
    s = d['symbols'][0]
    print(f"  status={s['status']} spot={s.get('isSpotTradingAllowed')} margin={s.get('isMarginTradingAllowed')}")
    for f in s['filters']:
        if f['filterType'] in ('LOT_SIZE', 'PRICE_FILTER', 'NOTIONAL', 'MIN_NOTIONAL'):
            keep = {k: v for k, v in f.items() if k != 'filterType'}
            print(f"  {f['filterType']}: {keep}")
except Exception as e:
    print(f"  (parse failed: {e}; first 200 bytes follow)")
    print('  ' + open('/tmp/xinfo', errors='replace').read()[:200])
PY
else
  echo "  (no python3; raw excerpt)"; head -c 300 /tmp/xinfo; echo
fi
echo "== done (read-only) =="
R
rc=$?
[ $rc -ne 0 ] && echo "SSH FAILED with exit $rc — box unreachable, wrong key, or wrong user."
exit $rc
