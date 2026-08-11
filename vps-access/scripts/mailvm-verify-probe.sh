#!/usr/bin/env bash
# mailvm-verify-probe.sh -- READ-ONLY: test the hypothesis that /var/log/mail.log
# has NUL/binary bytes making `grep` skip it, so the verifier finds nothing and
# reads genuine owner mail as UNVERIFIED. Strips NULs (tr -d) before grepping and
# checks: (a) today's real submission/sasl counts, (b) the owner's specific
# message-id -> queue id -> sasl_username. Prints log metadata only, no bodies.
set -uo pipefail
MID='f35f9a808ae2e.b0f0bebeb9b6f8@homeandofficemicro.com'   # the owner's phone message
OWNER='theodore@homeandofficemicro.com'
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129 \
  "MID='$MID' OWNER='$OWNER' bash -s" <<'R' 2>&1
TODAY=$(date -u '+%Y-%m-%d')
echo "== does mail.log contain NUL bytes? =="
if LC_ALL=C grep -qP '\x00' /var/log/mail.log 2>/dev/null; then
  echo "  YES — mail.log has NUL bytes; plain grep will treat it as binary and skip matches"
  echo "  first NUL near byte: $(LC_ALL=C grep -aboP '\x00' /var/log/mail.log 2>/dev/null | head -1 | cut -d: -f1)"
else
  echo "  no NUL bytes found"
fi
echo
echo "== REAL counts today, NULs stripped =="
strip() { tr -d '\000' < /var/log/mail.log; }
echo "  submission/smtpd today : $(strip | grep "^$TODAY" | grep -c 'postfix/submission/smtpd')"
echo "  sasl_username today    : $(strip | grep "^$TODAY" | grep -c 'sasl_username=')"
echo "  to=<claude@> today     : $(strip | grep "^$TODAY" | grep -c 'to=<claude@homeandofficemicro.com>')"
echo "  sasl by OWNER today    : $(strip | grep "^$TODAY" | grep -c "sasl_username=$OWNER")"
echo
echo "== the owner's message-id, NULs stripped: queue id + its client/sasl line =="
QIDS=$( { tr -d '\000' < /var/log/mail.log; tr -d '\000' < /var/log/mail.log.1 2>/dev/null; } \
        | grep -F "message-id=<$MID>" | sed -n 's/.*\]: \([^:]*\): message-id=.*/\1/p' | sort -u )
echo "  queue ids for the message: ${QIDS:-NONE FOUND}"
for q in $QIDS; do
  echo "  ---- $q ----"
  { tr -d '\000' < /var/log/mail.log; tr -d '\000' < /var/log/mail.log.1 2>/dev/null; } \
    | grep -F "$q:" | grep -E 'client=|sasl_username=|from=' | sed 's/^/    /' | cut -c1-200
done
echo
echo "== all sasl_username=OWNER submissions today (NULs stripped) =="
strip | grep "^$TODAY" | grep "sasl_username=$OWNER" | sed 's/^/  /' | cut -c1-180 | tail -6 || echo "  none"
R
