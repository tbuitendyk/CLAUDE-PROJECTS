#!/usr/bin/env bash
# pilot-produce-and-push.sh -- VPS timer step: compute the current F1 intent
# and ship it to the Mexico box. Deterministic, no AI (PILOT-F1.md section 4).
#
# Flow: run pilot-produce.js inside the deployed classifier -> if it yields an
# actionable intent, write it to a temp file and scp it into the box's
# ~/pilot/intents/ where the executor will validate and act on it.
#
# Idempotent by construction: the intent's chunk_start keys the executor's
# dedup, so re-running within the same period ships the same intent and the
# executor ignores the duplicate. Ships NOTHING when nothing is actionable.
set -uo pipefail

APPDIR="${APPDIR:-/opt/general-classifier}"    # deployed classifier root
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }

ARM_ONLY=0
[ "${1:-}" = "--arm-only" ] && ARM_ONLY=1

[ "$ARM_ONLY" = 1 ] || [ -f "$APPDIR/pilot-produce.js" ] || { echo "no pilot-produce.js in $APPDIR"; exit 1; }

# ---- reconcile the owner's MASTER SWITCH to the box ----------------------
# The screen's START/STOP button writes data/pilot/arm-request.json on the VPS.
# We carry that intent to the box's ARM flag here (the executor journals the
# flip, so the screen confirms it). The executor opens NOTHING unless ARM is
# present, so a missing request file leaves the engine stopped by default.
REQ="$APPDIR/data/pilot/arm-request.json"
if [ -f "$REQ" ]; then
  want=$(python3 -c "import json;print('1' if json.load(open('$REQ')).get('armed') else '0')" 2>/dev/null || echo 0)
  mode=$([ "$want" = "1" ] && echo arm || echo disarm)
  echo "== master switch: owner requests $mode =="
  $SSH "$BOX_USER@$BOX_HOST" \
    "cd ~/pilot 2>/dev/null; python3 ~/mx_executor.py $mode --source=owner" \
    2>&1 | sed 's/^/  /' || echo "  (could not reach box to set master switch; will retry next run)"
fi

# In --arm-only mode (the frequent sync) we stop here: no data refresh, no
# signal produced. The hourly tick does the produce+push.
[ "$ARM_ONLY" = 1 ] && exit 0

echo "== produce F1 intent =="
OUT=$(cd "$APPDIR" && node pilot-produce.js 2>&1)
rc=$?
if [ $rc -ne 0 ]; then echo "producer failed:"; echo "$OUT" | sed 's/^/  /'; exit 1; fi

# actionable? (pure text checks; jq is not assumed present on the VPS)
if printf '%s' "$OUT" | grep -q '"actionable":false'; then
  echo "nothing actionable this run (no chunk whose entry has arrived)"; exit 0
fi
if ! printf '%s' "$OUT" | grep -q '"intent"'; then
  echo "no intent in producer output:"; echo "$OUT" | sed 's/^/  /'; exit 1
fi

# extract just the intent object (producer wraps it as {ok,actionable,intent:{...}})
INTENT=$(printf '%s' "$OUT" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['intent']))")
side=$(printf '%s' "$INTENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['side'])")
chunk=$(printf '%s' "$INTENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['chunk_start'])")
echo "  intent: side=$side chunk=$chunk"

if [ "$side" = "FLAT" ]; then
  echo "committee is FLAT this period — no position to open, nothing shipped"; exit 0
fi

TMP=$(mktemp)
printf '%s\n' "$INTENT" > "$TMP"
echo "== ship to box intents/ =="
$SSH "$BOX_USER@$BOX_HOST" 'mkdir -p ~/pilot/intents' || { echo "ssh mkdir failed"; rm -f "$TMP"; exit 1; }
scp -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    "$TMP" "$BOX_USER@$BOX_HOST:~/pilot/intents/intent-$STAMP.json"
rc=$?
rm -f "$TMP"
[ $rc -eq 0 ] && echo "shipped intent-$STAMP.json" || { echo "scp failed"; exit 1; }
