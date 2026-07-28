#!/usr/bin/env bash
# mailvm-trace-msgid.sh -- READ-ONLY: show how the two most recent messages to
# claude@ actually appear in the mail log, so the verification rule can be
# built on what this server does rather than what it was assumed to do.
#
# Prints log metadata only: queue ids, client/sasl lines, delivery lines. No
# message bodies.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129 'bash -s' <<'R' 2>&1
echo "== log files present =="
ls -la /var/log/mail.log* /var/log/maillog* 2>/dev/null | sed 's/^/  /' || echo "  none of the usual names"
echo
echo "== journald has postfix? =="
journalctl -u postfix --since '-6h' -n 3 --no-pager 2>/dev/null | sed 's/^/  /' || echo "  no journal access"
echo
echo "== last 3 messages addressed to claude@ (queue ids) =="
qids=$(grep -h "to=<claude@homeandofficemicro.com>" /var/log/mail.log 2>/dev/null | tail -3 \
       | sed -n 's/.*postfix\/[a-z]*\[[0-9]*\]: \([A-F0-9]\{6,\}\):.*/\1/p' | sort -u)
echo "  qids: ${qids:-none}"
for q in $qids; do
  echo "  ---- $q ----"
  grep -h "$q" /var/log/mail.log 2>/dev/null | sed 's/^/    /' | cut -c1-200
done
echo
echo "== do ANY submissions carry sasl_username in the last 6h? =="
grep -h "sasl_username=" /var/log/mail.log 2>/dev/null | tail -5 | sed 's/^/  /' | cut -c1-180 || echo "  none at all"
R
