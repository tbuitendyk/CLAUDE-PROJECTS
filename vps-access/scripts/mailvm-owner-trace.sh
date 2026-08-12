#!/usr/bin/env bash
# mailvm-owner-trace.sh -- ONE SSH, READ-ONLY: did the owner's recent message
# reach the server, and where did it land? Traces the last ~2h: authenticated
# submissions by the owner, deliveries to claude@, spam/junk verdicts, and the
# claude@ mailbox folder state (INBOX unseen + Junk contents).
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129 'bash -s' <<'R' 2>&1
NOW=$(date '+%F %T %Z'); echo "guest time: $NOW"
CUT=$(date -d '2 hours ago' '+%Y-%m-%dT%H:%M')
recent(){ awk -v c="$CUT" '$0 >= c' /var/log/mail.log 2>/dev/null; }
echo "== owner authenticated submissions (last 2h) =="
recent | grep -F 'sasl_username=theodore@homeandofficemicro.com' | tail -6 | sed 's/^/  /' || echo "  (none -- the send never reached postfix as an authenticated submission)"
echo "== deliveries addressed to claude@ (last 2h) =="
recent | grep -iE 'to=<claude@homeandofficemicro.com>' | tail -8 | sed 's/^/  /' || echo "  (none)"
echo "== spam/quarantine verdicts (last 2h) =="
recent | grep -iE 'amavis.*(spam|blocked|quarantine)' | tail -5 | sed 's/^/  /' || echo "  (none)"
echo "== claude@ mailbox folder state =="
echo "  -- folders --"
doveadm mailbox list -u claude@homeandofficemicro.com 2>/dev/null | sed 's/^/     /'
echo "  -- INBOX unseen count --"
doveadm search -u claude@homeandofficemicro.com mailbox INBOX UNSEEN 2>/dev/null | wc -l | sed 's/^/     /'
echo "  -- last 5 in INBOX (date/from/subject) --"
doveadm fetch -u claude@homeandofficemicro.com 'date.received hdr.from hdr.subject' mailbox INBOX all 2>/dev/null | tail -20 | sed 's/^/     /'
echo "  -- Junk/Spam folder recent --"
for f in Junk Spam "Junk E-mail"; do
  doveadm fetch -u claude@homeandofficemicro.com 'date.received hdr.subject' mailbox "$f" all 2>/dev/null | tail -12 | sed "s/^/     [$f] /"
done
R
