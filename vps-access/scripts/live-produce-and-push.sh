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

echo "== carry the allowlist (fail-closed twin on the box) =="
ALLOW="$APPDIR/data/live/setups-allow.json"
if [ -f "$ALLOW" ]; then
  scp -q -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      "$ALLOW" "$BOX_USER@$BOX_HOST:~/pilot/setups-allow.json" \
    && echo "  allowlist carried" || echo "  allowlist carry FAILED (box keeps its previous list)"
fi

echo "== ship intents =="
OUTBOX="$APPDIR/data/live/outbox"
shopt -s nullglob
shipped=0
for f in "$OUTBOX"/intent2-*.json; do
  base=$(basename "$f")
  if scp -q -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      "$f" "$BOX_USER@$BOX_HOST:~/pilot/intents/$base"; then
    mv "$f" "$f.shipped"
    shipped=$((shipped+1))
  else
    echo "  ship FAILED for $base (kept in outbox; retried next tick)"
  fi
done
echo "  shipped $shipped intent(s)"
