#!/usr/bin/env bash
# pilot-entry-timers-check.sh -- READ-ONLY: confirm the prime-at-01:00 entry
# timers are installed and scheduled for the next 01:00 window, on BOTH hosts.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

echo "== VPS: pilot-tick-entry (produce the 01:00 intent with the live open) =="
systemctl is-enabled pilot-tick-entry.timer 2>/dev/null | sed 's/^/  enabled: /'
systemctl list-timers pilot-tick-entry.timer --all 2>/dev/null | grep -i pilot-tick-entry | sed 's/^/  /' || echo "  (not listed)"

echo "== box: pilot-exec-entry (fill right after the intent lands) =="
$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
systemctl is-enabled pilot-exec-entry.timer 2>/dev/null | sed 's/^/  enabled: /'
systemctl list-timers pilot-exec-entry.timer --all 2>/dev/null | grep -i pilot-exec-entry | sed 's/^/  /' || echo "  (not listed)"
echo "  master switch (ARM) now: $([ -f ~/pilot/ARM ] && echo 'ARMED — RUNNING' || echo STOPPED)"
BOX
echo "(read-only)"
