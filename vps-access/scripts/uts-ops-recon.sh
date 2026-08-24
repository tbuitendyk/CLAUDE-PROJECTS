#!/usr/bin/env bash
# uts-ops-recon.sh -- READ-ONLY. How the site routes to the trading service, how
# a unit gets installed here, and what protects the address. Changes nothing.
set -uo pipefail
echo "== nginx config files in play =="
nginx -T 2>/dev/null | grep -nE '^# configuration file' | sed 's/^/  /' | head -20
echo
echo "== every location that proxies to a local port, with its file =="
nginx -T 2>/dev/null | awk '
  /^# configuration file/ {f=$4}
  /location/ {loc=$0; lf=f}
  /proxy_pass/ {gsub(/^[ \t]+/,"",loc); gsub(/^[ \t]+/,"",$0); printf "  %-52s %-42s %s\n", loc, $0, lf}
' | grep -E '8[0-9]{3}|4416' | head -25
echo
echo "== auth in front of it =="
nginx -T 2>/dev/null | grep -nE 'auth_basic|satisfy|allow |deny ' | sed 's/^/  /' | head -15
echo
echo "== timeouts =="
nginx -T 2>/dev/null | grep -nE 'proxy_read_timeout|proxy_connect_timeout|proxy_send_timeout|client_max_body' | sed 's/^/  /' | head -10
echo
echo "== the trading system unit file =="
cat /etc/systemd/system/ultimate-trading-system.service 2>/dev/null | sed 's/^/  /'
echo
echo "== how a deploy installs it =="
sed -n '1,80p' /root/claude-projects/vps-access/scripts/deploy-uts.sh 2>/dev/null | sed 's/^/  /'
