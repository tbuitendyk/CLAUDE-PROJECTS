#!/usr/bin/env bash
# pilot-mirror.sh -- VPS tick step: run the mirror check and, on a MIRROR_BREAK,
# trip the box HALT so no new position opens on an instrument that no longer
# reproduces (review findings 26 + 7). Exits still run — a break stops NEW
# entries, never abandons an open position.
#
# The recompute needs the engine + candle cache, so it runs in the deployed
# classifier on the VPS. The halt is carried to the box over the same SSH path
# the arm reconcile uses. If the box is unreachable, the dead-man master switch
# still self-disarms the box within ARM_MAX_AGE_S, so a break plus a dead tunnel
# still ends in "stopped", never "trading on a broken mirror".
set -uo pipefail

APPDIR="${APPDIR:-/opt/general-classifier}"
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

[ -f "$APPDIR/pilot-mirror.js" ] || { echo "no pilot-mirror.js in $APPDIR"; exit 1; }

OUT=$(cd "$APPDIR" && node pilot-mirror.js 2>&1); rc=$?
printf '%s\n' "$OUT" | sed 's/^/  /'

if [ "$rc" -eq 2 ]; then
  echo "== MIRROR_BREAK -> halting the box (details in data/pilot/mirror.json) =="
  # fixed, injection-safe reason; the specifics live in mirror.json / the screen
  if [ -f "$KEY" ]; then
    $SSH "$BOX_USER@$BOX_HOST" \
      "python3 ~/mx_executor.py halt --source=mirror --reason=mirror-break-see-mirror-json" \
      2>&1 | sed 's/^/  /' || echo "  (box unreachable; dead-man self-disarms — still fail-safe)"
  else
    echo "  no key at $KEY; cannot reach box (dead-man self-disarms — still fail-safe)"
  fi
  exit 2
fi
exit "$rc"
