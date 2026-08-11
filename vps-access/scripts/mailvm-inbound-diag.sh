#!/usr/bin/env bash
# mailvm-inbound-diag.sh -- ONE SSH session, READ-ONLY: why is inbound mail not
# arriving (webmail sees no new mail => server-side delivery problem)?
# Checks: services, mail queue depth + oldest + deferral reasons, disk fullness
# (/, /var/vmail), amavis/clamd handoff listeners, last REAL inbound activity in
# mail.log, and recent delivery errors. No changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
timeout -k 5 60 $SSH 'bash -s' <<'R' 2>&1
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)   up: $(cut -d. -f1 /proc/uptime)s   date: $(date '+%H:%M:%S %Z')"
echo "== disk (full disk stops delivery cold) =="
df -h / /var/vmail 2>/dev/null | awk 'NR==1||/\/dev/' | sed 's/^/  /'
echo "== services =="
for s in postfix dovecot postgresql amavis clamav-daemon iredapd nginx; do
  printf "  %-14s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
echo "== content-filter listeners (amavis 10024/10025, iredapd 7777) =="
ss -ltnH 2>/dev/null | awk '{print $4}' | grep -oE ':(10024|10025|7777)$' | sort -u | tr '\n' ' '; echo
echo "== mail queue =="
mailq 2>/dev/null | tail -1
echo "-- oldest queued + why (first 12 lines) --"
mailq 2>/dev/null | head -12 | sed 's/^/  /'
echo "== last inbound connect from OUTSIDE (is anything even arriving?) =="
grep -E 'postfix/smtpd.*connect from' /var/log/mail.log 2>/dev/null | grep -v '127.0.0.1' | tail -3 | sed 's/^/  /' || echo "  (none logged)"
echo "== last successful local delivery (dovecot/lda|lmtp 'saved' / postfix 'status=sent' to dovecot) =="
grep -iE 'dovecot.*(saved|stored)|status=sent.*(dovecot|lmtp|virtual)' /var/log/mail.log 2>/dev/null | tail -3 | sed 's/^/  /' || echo "  (none)"
echo "== recent errors/defers (last 12) =="
grep -iE 'status=deferred|error|fatal|warning.*(amavis|clam|connect|timeout)' /var/log/mail.log 2>/dev/null | tail -12 | sed 's/^/  /' || echo "  (none)"
R
echo "ssh_rc=$? (124=timed out)"
