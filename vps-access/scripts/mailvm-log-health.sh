#!/usr/bin/env bash
# mailvm-log-health.sh -- READ-ONLY: is postfix still writing /var/log/mail.log,
# and if not, where did the submission/sasl lines go? The verification rule
# (claude-mail-recent.sh) greps mail.log for a message-id's queue id and its
# sasl_username; if logging moved or stopped, EVERY recent message reads
# UNVERIFIED regardless of who really sent it. This prints log metadata only
# (timestamps, service state, config), never a message body.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129 'bash -s' <<'R' 2>&1
echo "== wall clock on the mail VM =="
date -u '+  now(UTC) %Y-%m-%dT%H:%M:%SZ'; date '+  now(local) %Y-%m-%dT%H:%M:%S%z'
echo
echo "== mail.log: size + the LAST line actually written =="
ls -la /var/log/mail.log | sed 's/^/  /'
echo "  last line:"; tail -1 /var/log/mail.log | sed 's/^/    /' | cut -c1-220
echo "  last timestamp in file: $(tail -1 /var/log/mail.log | grep -oE '^[0-9T:.-]+' | head -1)"
echo
echo "== last 12 lines of mail.log (what is being logged right now) =="
tail -12 /var/log/mail.log | sed 's/^/  /' | cut -c1-200
echo
echo "== any lines at all today (UTC date), and any postfix/submission today? =="
TODAY=$(date -u '+%Y-%m-%d')
echo "  total lines stamped $TODAY : $(grep -c "^$TODAY" /var/log/mail.log 2>/dev/null || echo 0)"
echo "  submission/smtpd today     : $(grep -c "postfix/submission/smtpd" <(grep "^$TODAY" /var/log/mail.log) 2>/dev/null || echo 0)"
echo "  sasl_username today        : $(grep "^$TODAY" /var/log/mail.log 2>/dev/null | grep -c 'sasl_username=' || echo 0)"
echo "  deliveries to claude@ today: $(grep "^$TODAY" /var/log/mail.log 2>/dev/null | grep -c 'to=<claude@homeandofficemicro.com>' || echo 0)"
echo
echo "== service state: rsyslog, postfix, dovecot =="
for u in rsyslog postfix dovecot; do
  printf '  %-9s ' "$u"; systemctl is-active "$u" 2>/dev/null || echo inactive
done
echo "  rsyslog last restart: $(systemctl show -p ActiveEnterTimestamp --value rsyslog 2>/dev/null)"
echo
echo "== where does postfix think its log goes? (maillog_file, syslog) =="
postconf -n 2>/dev/null | grep -iE 'maillog_file|syslog' | sed 's/^/  /' || echo "  (postconf unavailable)"
echo "  rsyslog mail rule:"; grep -rhiE 'mail\.\*|mail\.log|/var/log/mail' /etc/rsyslog.conf /etc/rsyslog.d/ 2>/dev/null | grep -v '^#' | sed 's/^/    /' | head -8
echo
echo "== is postfix logging to journald instead? (last 6 submission entries) =="
journalctl -t postfix/submission/smtpd --since '-30h' -n 6 --no-pager 2>/dev/null | sed 's/^/  /' | cut -c1-200 || echo "  (no journald postfix entries / no access)"
echo
echo "== newest sasl_username ANYWHERE under /var/log (which file, when) =="
grep -rhoE '^[0-9T:.-]+.*sasl_username=[^,]+' /var/log/mail.log /var/log/mail.log.1 2>/dev/null | tail -1 | cut -c1-160 | sed 's/^/  mail.log*: /'
R
