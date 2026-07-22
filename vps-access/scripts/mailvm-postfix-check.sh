#!/usr/bin/env bash
# mailvm-postfix-check.sh -- ONE SSH session: report iRedMail service states,
# and if postfix is not active after boot, start it. Single connection, no
# bursts (repeated SSH handshakes saturate sshd on the single core).
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)   up: $(cut -d. -f1 /proc/uptime)s"
echo "services:"
for s in postgresql postfix dovecot amavis clamav-daemon iredapd nginx; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
if [ "$(systemctl is-active postfix 2>/dev/null)" != active ]; then
  echo "postfix NOT active -> starting it..."
  systemctl start postfix 2>&1 | sed 's/^/  /'
  sleep 2
  echo "postfix now: $(systemctl is-active postfix 2>/dev/null)"
  echo "-- postfix status tail --"; systemctl --no-pager status postfix 2>&1 | tail -8 | sed 's/^/  /'
fi
echo "listening on 25/587? $(ss -ltn 2>/dev/null | grep -E ':25 |:587 ' | wc -l) socket(s)"
R
