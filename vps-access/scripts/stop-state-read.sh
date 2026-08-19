#!/usr/bin/env bash
# stop-state-read.sh -- READ-ONLY: what protective stop is actually in force, and
# whether that is a CHOICE or a default nobody made. Writes nothing.
set -uo pipefail
APP=/opt/general-classifier
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

echo "== what the classifier has recorded as the owner's choice =="
if [ -f "$APP/data/pilot/fixed-stop.json" ]; then
  cat "$APP/data/pilot/fixed-stop.json" | sed 's/^/  /'; echo
else
  echo "  (no file — no choice has ever been recorded)"
fi

echo "== how the carry reads that =="
bash /usr/local/sbin/pilot-stop-state.sh "$APP/data/pilot/fixed-stop.json" 2>/dev/null | sed 's/^/  /' \
  || echo "  (stop-state helper not installed)"

echo "== what the BOX is actually running =="
$SSH "$BOX_USER@$BOX_HOST" 'grep -E "^FIXED_STOP_PCT" ~/.executor-env 2>/dev/null || echo "FIXED_STOP_PCT not set — no stop on any order"' 2>/dev/null | sed 's/^/  /'
echo "(read-only)"
