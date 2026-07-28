#!/usr/bin/env bash
# mx-verify-egress.sh -- prove the tunnel reaches the RIGHT far end.
#
# A SOCKS listener coming up proves only that ssh started. If the instance's
# public IP has moved (EC2 addresses change on stop/start), the forward fails
# or lands somewhere unintended, and the symptom is Binance calls timing out —
# not an error that names the cause. This asserts the exit is where it should
# be, and says plainly what it found when it is not.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/mx-endpoint.sh"

echo "configured endpoint : ${MX_HOST} (socks 127.0.0.1:${MX_SOCKS_PORT})"
if ! pgrep -f -- "-D ${MX_SOCKS_PORT}" >/dev/null; then
  echo "VERDICT: FAIL — no SOCKS forward is running. Bring it up with mx-tunnel-up.sh"
  exit 4
fi

exit_ip=$(timeout 30 curl -s -m 25 --socks5-hostname "127.0.0.1:${MX_SOCKS_PORT}" https://api.ipify.org 2>/dev/null || echo "")
direct_ip=$(timeout 20 curl -s -m 15 https://api.ipify.org 2>/dev/null || echo "")
echo "egress IP via tunnel: ${exit_ip:-unreachable}"
echo "direct IP (untouched): ${direct_ip:-unreachable}"

if [ -z "$exit_ip" ]; then
  echo "VERDICT: FAIL — nothing exits through the tunnel."
  exit 5
fi
if [ "$exit_ip" = "$direct_ip" ]; then
  echo "VERDICT: FAIL — tunnel egress equals the direct IP; traffic is NOT going through Mexico."
  exit 6
fi

geo=$(timeout 20 curl -s -m 15 "http://ip-api.com/json/${exit_ip}?fields=country,countryCode,org,as" 2>/dev/null || echo "")
echo "egress identity     : ${geo:-unknown}"
cc=$(printf '%s' "$geo" | sed -n 's/.*"countryCode":"\([^"]*\)".*/\1/p')
org=$(printf '%s' "$geo" | sed -n 's/.*"org":"\([^"]*\)".*/\1/p')

ok=1
[ "$cc" = "$MX_EXPECT_COUNTRY" ] || { echo "  MISMATCH: country '$cc' != expected '$MX_EXPECT_COUNTRY'"; ok=0; }
case "$org" in *"$MX_EXPECT_ORG_MATCH"*) ;; *) echo "  MISMATCH: org '$org' does not contain '$MX_EXPECT_ORG_MATCH'"; ok=0;; esac

if [ "$exit_ip" != "$MX_HOST" ]; then
  echo "  NOTE: egress IP differs from the configured endpoint — expected if MX_HOST is a"
  echo "        DNS name or the instance sits behind NAT; suspicious if it is a pinned IP."
fi

if [ "$ok" -eq 1 ]; then
  echo "VERDICT: PASS — tunnel egress is in ${MX_EXPECT_COUNTRY} on ${MX_EXPECT_ORG_MATCH}."
else
  echo "VERDICT: FAIL — the tunnel is up but exits somewhere unexpected. Do NOT trade through it."
  exit 7
fi
