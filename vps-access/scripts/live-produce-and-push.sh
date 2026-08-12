#!/usr/bin/env bash
# live-produce-and-push.sh -- generalized-rail tick step (IMPLEMENTATION-PLAN
# 2.4/3.4): run the multi-setup producer, then ship its intents AND the derived
# per-box allowlist to the Mexico box. The RUNNING F1 pilot's
# pilot-produce-and-push.sh is untouched; this is the parallel rail and it
# ships NOTHING while no setup is in paper/live state.
#
# NOT wired to any timer yet — the Phase-10 review gates the box-side deploy;
# until then this script exists for the parallel paper run and manual ticks.
set -uo pipefail

APPDIR="${APPDIR:-/opt/general-classifier}"
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
[ -f "$APPDIR/live-produce.js" ] || { echo "live-produce.js not deployed"; exit 1; }

echo "== produce (all paper/live setups) =="
OUT=$(cd "$APPDIR" && PILOT_SOCKS="${PILOT_SOCKS:-127.0.0.1:1080}" node live-produce.js 2>&1)
rc=$?
echo "$OUT" | tail -3 | sed 's/^/  /'
[ $rc -ne 0 ] && { echo "producer failed"; exit 1; }

SCP="scp -q -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

# R14: carry the allowlist ATOMICALLY (scp to a dot-temp, then mv on the box) so
# the box's fail-closed reader can never load a half-written allowlist. And track
# the result: if the carry FAILED we must NOT ship intents this tick — a fresh
# intent acting against a STALE box allowlist (the box keeps its previous list on
# failure) is exactly what the allowlist exists to prevent. Intents wait in the
# outbox and retry next tick, when the allowlist and the intents can go together.
echo "== carry the allowlist (fail-closed twin on the box), atomically =="
ALLOW="$APPDIR/data/live/setups-allow.json"
allow_ok=1
if [ -f "$ALLOW" ]; then
  if $SCP "$ALLOW" "$BOX_USER@$BOX_HOST:~/pilot/.setups-allow.json.tmp" \
     && $SSH "$BOX_USER@$BOX_HOST" 'mv ~/pilot/.setups-allow.json.tmp ~/pilot/setups-allow.json'; then
    echo "  allowlist carried (atomic)"
  else
    allow_ok=0
    echo "  allowlist carry FAILED — NOT shipping intents this tick (box keeps its previous list)"
  fi
else
  # FAIL-CLOSED (independent review 2026-08-12): a MISSING local allowlist is not
  # "nothing to carry" — it means this tick carried NO fresh list, so shipping
  # intents would act against whatever STALE list the box still holds, exactly what
  # R14 exists to prevent. Withhold intents until a real allowlist is produced.
  allow_ok=0
  echo "  no local allowlist at $ALLOW — NOT shipping intents this tick (fail-closed)"
fi

echo "== ship intents =="
OUTBOX="$APPDIR/data/live/outbox"
shopt -s nullglob
shipped=0
if [ "$allow_ok" -eq 1 ]; then
  for f in "$OUTBOX"/intent2-*.json; do
    base=$(basename "$f")
    # ATOMIC: land under a dot-temp name (the executor's intent loop matches only
    # *.json, so the temp is invisible) then mv into place on the box.
    if $SCP "$f" "$BOX_USER@$BOX_HOST:~/pilot/intents/.$base.tmp" \
       && $SSH "$BOX_USER@$BOX_HOST" "mv ~/pilot/intents/.$base.tmp ~/pilot/intents/$base"; then
      mv "$f" "$f.shipped"
      shipped=$((shipped+1))
    else
      echo "  ship FAILED for $base (kept in outbox; retried next tick)"
    fi
  done
fi
echo "  shipped $shipped intent(s)"

# R15: terminal-state files (shipped intents locally; .done/.dup/.bad on the box)
# are inert once written but accumulate forever. Sweep those older than 7 days so
# the outbox and the box's intents dir stay bounded. Only touches ALREADY-terminal
# files — never a live .json intent, never a decision log — so it cannot affect
# trading. Best-effort: a failed sweep is not a tick failure.
echo "== housekeeping: prune terminal-state files older than 7 days =="
find "$OUTBOX" -maxdepth 1 -type f -name 'intent2-*.json.shipped' -mtime +7 -delete 2>/dev/null || true
$SSH "$BOX_USER@$BOX_HOST" \
  'find ~/pilot/intents -maxdepth 1 -type f \( -name "*.done" -o -name "*.dup" -o -name "*.bad" \) -mtime +7 -delete 2>/dev/null || true' \
  2>/dev/null || echo "  (box prune skipped — box unreachable this tick)"
