#!/usr/bin/env bash
# nginx-frontdoor-confirm.sh -- keeps the change nginx-frontdoor-apply.sh made:
# stops its 15-minute roll-back timer. Run it only after every site has been
# seen answering from OUTSIDE the box. Changes no web-server file; the backup
# stays in /root/nginx-frontdoor-backup/ for nginx-frontdoor-restore.sh.
set -uo pipefail
UNIT=nginx-frontdoor-deadman
if systemctl is-active --quiet "$UNIT.timer"; then
  systemctl stop "$UNIT.timer" && echo "roll-back timer stopped: the change stays"
elif grep -q proxy_protocol /etc/nginx/nginx.conf; then
  echo "no roll-back timer was running; the change is in place"
else
  echo "THE ROLL-BACK ALREADY RAN: the front door is back as it was"
fi
echo "== the front door =="
awk '/^[[:space:]]*stream[[:space:]]*\{/{on=1} on' /etc/nginx/nginx.conf | grep -E 'proxy_protocol|default|listen'
echo "== the last deploy-door calls, and the address each came from (a call through the front door made after the change should not read 127.0.0.1) =="
grep -h '"POST /run ' /var/log/nginx/access.log 2>/dev/null | tail -3 | awk '{print $4, $1}'
echo "== backups =="
ls -1 /root/nginx-frontdoor-backup/ 2>/dev/null
