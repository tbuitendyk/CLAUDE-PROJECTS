#!/usr/bin/env bash
# mailvm-outlook-diag2.sh -- READ-ONLY: clock / logging / reachability / cert
# checks for the Outlook connect + send/receive problem. The mail.log is stale
# (2 days), and vboxadd (guest-additions time sync) was failed -- a wrong guest
# clock breaks TLS handshakes, greylisting, DKIM. No changes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
echo "== guest clock (compare to your real local time!) =="
date; echo "  uptime: $(cut -d. -f1 /proc/uptime)s"
echo "== time sync status =="
timedatectl 2>/dev/null | grep -iE 'Local time|Universal|synchronized|NTP' | sed 's/^/  /'
systemctl is-active systemd-timesyncd chronyd ntp 2>/dev/null | paste -sd' ' | sed 's/^/  timesync svc: /'
echo "== rsyslog + mail.log freshness =="
echo "  rsyslog: $(systemctl is-active rsyslog 2>/dev/null)"
stat -c '  mail.log mtime: %y  size: %s' /var/log/mail.log 2>/dev/null
echo "  --- actual last 4 mail.log lines ---"
tail -4 /var/log/mail.log 2>/dev/null | sed 's/^/    /'
echo "== recent IMAP/POP logins (last 6) =="
grep -iE 'imap-login|pop3-login' /var/log/mail.log 2>/dev/null | grep -iE 'Login|Aborted|failed' | tail -6 | sed 's/^/  /' || echo "  (none)"
echo "== recent submission activity (587/465, last 6) =="
grep -E 'postfix/submission' /var/log/mail.log 2>/dev/null | tail -6 | sed 's/^/  /' || echo "  (none)"
echo "== amavis/iredapd listeners (want 10024 10025 7777) =="
ss -ltnH 2>/dev/null | awk '{print $4}' | grep -oE ':(10024|10025|10026|7777)$' | sort -u | tr '\n' ' '; echo
echo "== TLS cert validity (Outlook rejects if clock outside these) =="
for c in $(ls /etc/letsencrypt/live/*/fullchain.pem /etc/ssl/certs/iRedMail.crt /etc/ssl/certs/iRedMail_CA.pem 2>/dev/null); do
  echo "  $c"; openssl x509 -in "$c" -noout -subject -dates 2>/dev/null | sed 's/^/    /'
done
R
