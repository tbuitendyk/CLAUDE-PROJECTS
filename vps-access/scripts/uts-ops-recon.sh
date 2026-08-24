#!/usr/bin/env bash
# uts-ops-recon.sh -- READ-ONLY. What would be needed to give the owner a
# service control that still answers when the main service is wedged: which
# units exist, which ports they hold, how nginx routes to them, and whether
# anything on this box is trading real money. Changes nothing.
set -uo pipefail
echo "== units that look like this project =="
systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null \
  | grep -iE 'trading|uts|classifier|balancer|construct' | cut -c1-120
echo
echo "== every node process and the port it holds =="
ss -lntp 2>/dev/null | awk 'NR>1{print}' | grep -i node | sed 's/^/  /' | cut -c1-140
echo
echo "== what unit owns each of those pids =="
for P in $(ss -lntpH 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
  U=$(ps -o unit= -p "$P" 2>/dev/null | tr -d ' ')
  D=$(tr '\0' ' ' < "/proc/$P/cmdline" 2>/dev/null | cut -c1-70)
  W=$(readlink "/proc/$P/cwd" 2>/dev/null)
  echo "  pid $P  unit=${U:-?}  cwd=${W:-?}"
  echo "        $D"
done
echo
echo "== nginx: where /uts goes =="
grep -rn -A6 'location .*\buts\b' /etc/nginx/sites-enabled/ 2>/dev/null | cut -c1-150 | head -40
echo
echo "== nginx files that mention 8093 or 8094 =="
grep -rln '809[0-9]' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sed 's/^/  /'
echo
echo "== is anything armed with real money? (read-only peek at the live side) =="
for D in /opt/ultimate-trading-system/data /opt/classifier/data; do
  [ -d "$D" ] || continue
  echo "  $D:"
  ls -1 "$D" 2>/dev/null | head -12 | sed 's/^/    /'
done
echo
echo "== can a helper run systemctl? =="
id
echo "  systemd version: $(systemctl --version 2>/dev/null | head -1)"
echo "  sudoers.d: $(ls /etc/sudoers.d 2>/dev/null | tr '\n' ' ')"
echo
echo "== how the deploy installs things =="
ls -1 /root/claude-projects/vps-access/scripts/ 2>/dev/null | head -30
