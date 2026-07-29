#!/usr/bin/env bash
# mailvm-postfix-restart.sh -- restart ONLY postfix on HOMSMAIL03.
#
# WHY THIS EXISTS RATHER THAN JUST BOUNCING THE VM. Outbound mail failed on
# both 587 and 465 with read timeouts, while IMAP on the SAME guest answered
# normally and returned the full mailbox. That combination rules out the two
# things a VM restart would fix -- the guest being down, and the guest being
# starved of CPU -- because dovecot would have suffered too. It isolates the
# fault to postfix. Restarting the whole mail server to fix one wedged daemon
# means an avoidable outage on the owner's live mail, so this does the
# smaller thing first and leaves mailvm-restart.sh as the escalation.
#
# NOTE ON host-health.sh: it reported VMState="poweroff" for both guests at
# the same moment IMAP was serving mail from one of them. That reading is
# wrong and must not be trusted; it is tracked separately.
set -uo pipefail
GUEST=192.168.56.129
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@${GUEST}"

echo "== before =="
$SSH 'systemctl is-active postfix; systemctl show -p ActiveEnterTimestamp --value postfix; ss -lntp | grep -E ":(25|465|587)\b" || echo "  NOTHING LISTENING on 25/465/587"' || {
  echo "FAILED: cannot reach the guest over ssh at all -- this is bigger than postfix."
  echo "  escalate to mailvm-restart.sh"
  exit 1
}

echo
echo "== queue depth before =="
$SSH 'mailq | tail -1' || true

echo
echo "== restarting postfix =="
$SSH 'systemctl restart postfix' || { echo "restart command failed"; exit 1; }
sleep 5

echo
echo "== after =="
$SSH 'systemctl is-active postfix; systemctl show -p ActiveEnterTimestamp --value postfix; ss -lntp | grep -E ":(25|465|587)\b" || echo "  NOTHING LISTENING"' || exit 1

# A restart that reports "active" while nothing listens on the submission
# ports is the failure mode that matters, so assert the ports rather than the
# unit state.
echo
if $SSH 'ss -lnt | grep -qE ":(587|465)\b"'; then
  echo "PASS -- submission ports are listening again."
else
  echo "FAIL -- postfix claims to be up but 587/465 are not listening."
  echo "  escalate to mailvm-restart.sh"
  exit 2
fi

echo
echo "== recent postfix log (why it wedged) =="
$SSH 'journalctl -u postfix --no-pager -n 25 2>/dev/null || tail -25 /var/log/mail.log' || true
