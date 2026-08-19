#!/usr/bin/env bash
# unhalt-trace.sh -- READ-ONLY: why is "Clear the halt" not clearing the halt?
# Walks the whole chain and prints what each link actually holds. Writes nothing,
# clears nothing, sends nothing.
set -uo pipefail
APP=/opt/general-classifier
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

echo "== 1. requests the screen has written and nothing has carried =="
ls -la "$APP/data/live/unhalt/" 2>/dev/null | sed 's/^/  /' || echo "  (no unhalt directory)"

echo
echo "== 2. WHO carries them, and how often =="
echo "  the per-profile carry lives in live-produce-and-push.sh, run by:"
systemctl list-timers live-tick.timer --all 2>/dev/null | grep -i live-tick | sed 's/^/    /' || echo "    (live-tick.timer not listed)"
echo "  the BOX-LEVEL carry lives in pilot-produce-and-push.sh, run by:"
systemctl list-timers pilot-sync.timer --all 2>/dev/null | grep -i pilot-sync | sed 's/^/    /' || echo "    (pilot-sync.timer not listed)"

echo
echo "== 3. how long the box will accept a request for =="
$SSH "$BOX_USER@$BOX_HOST" "grep -E '^ARM_REQUEST_FRESH_S|^ARM_CLOCK_SKEW_S' ~/mx_executor.py" 2>/dev/null | sed 's/^/  /'

echo
echo "== 4. what the box recorded about unhalt attempts (last 40) =="
$SSH "$BOX_USER@$BOX_HOST" \
  "grep -E 'UNHALT|HALT_CLEAR|SETUP_HALT' ~/pilot/journal.jsonl 2>/dev/null | tail -40" 2>/dev/null \
  | cut -c1-260 | sed 's/^/  /' || echo "  (box unreachable)"

echo
echo "== 5. is the profile still halted on the box? =="
$SSH "$BOX_USER@$BOX_HOST" 'ls -la ~/pilot/ 2>/dev/null | grep -iE "halt|ARM" || echo "  (no halt/arm files)"' 2>/dev/null | sed 's/^/  /'
echo "(read-only)"
