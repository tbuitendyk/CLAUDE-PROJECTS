#!/usr/bin/env bash
# mailvm-outlook-diag.sh -- READ-ONLY: why can't Outlook connect / send+receive?
# Prime suspect after the outage+reboot: fail2ban banned the client IP from all
# the failed retries. Checks banned IPs per jail, listening mail ports, service
# states, and recent auth/connection errors in mail.log. No changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "== listening mail ports (want 25/143/465/587/993, maybe 110/995) =="
ss -ltnH 2>/dev/null | awk '{print $4}' | grep -oE ':(25|110|143|465|587|993|995)$' | sort -u | sed 's/^/  port/'
echo "== service states =="
for s in postfix dovecot amavis clamav-daemon iredapd postgresql; do printf "  %-14s %s\n" "$s" "$(systemctl is-active $s 2>/dev/null)"; done
echo "== fail2ban jails =="
jails=$(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p' | tr -d ' ')
echo "  $jails"
echo "== banned IPs per jail =="
for j in $(echo "$jails" | tr ',' ' '); do
  st=$(fail2ban-client status "$j" 2>/dev/null)
  tot=$(echo "$st" | sed -n 's/.*Currently banned:[[:space:]]*//p' | head -1)
  ips=$(echo "$st" | sed -n 's/.*Banned IP list:[[:space:]]*//p')
  printf "  [%-18s] banned=%s  %s\n" "$j" "${tot:-?}" "${ips:-}"
done
echo "== recent auth failures / bans / lost connections (mail.log, last 30) =="
grep -iE 'authentication fail|auth failed|SASL.*fail|password mismatch|Ban |Found |lost connection|Connection refused|too many' /var/log/mail.log 2>/dev/null | tail -30 | sed 's/^/  /'
R
