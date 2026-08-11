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

# The break-vs-error asymmetry is DELIBERATE (re-review):
#   rc==2  a CONFIRMED break — the instrument is proven drifted → HALT the box.
#   rc==1  the detector could not RUN (data hiccup, transient error) → do NOT
#          halt; pilot-mirror.js has already stamped an ok:false verdict in
#          mirror.json and the VPS alert timer pages the owner on that. Auto-
#          halting on a transient detector fault would be a self-inflicted outage;
#          a proven break stops trading, an unproven one escalates to a human.
# The one gap that guarantee has is node dying BEFORE it writes its own verdict
# (crash on startup, post-deploy syntax error) — handled below so the alert can
# still see a dead detector instead of a silently-stale file.
[ -f "$APPDIR/pilot-mirror.js" ] || { echo "no pilot-mirror.js in $APPDIR"; exit 1; }

MIRROR_JSON="$APPDIR/data/pilot/mirror.json"
before_mtime=$(stat -c %Y "$MIRROR_JSON" 2>/dev/null || echo 0)
OUT=$(cd "$APPDIR" && node pilot-mirror.js 2>&1); rc=$?
printf '%s\n' "$OUT" | sed 's/^/  /'

if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
  # abnormal exit that is NOT a break. If node did not refresh mirror.json (it
  # died before its own catch could write the ok:false verdict), write a fail-
  # closed one here so the alert timer's ok:false / staleness condition fires —
  # a dead drift detector must never read as silent-green.
  after_mtime=$(stat -c %Y "$MIRROR_JSON" 2>/dev/null || echo 0)
  if [ "$after_mtime" = "$before_mtime" ]; then
    mkdir -p "$(dirname "$MIRROR_JSON")"
    printf '{"utc":"%s","checked":0,"breaks":0,"pending":0,"ok":false,"error":"pilot-mirror exited %s without writing a verdict","results":[]}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" > "$MIRROR_JSON.tmp$$" \
      && mv "$MIRROR_JSON.tmp$$" "$MIRROR_JSON"
    echo "  (wrote fail-closed mirror.json: node exited $rc without a verdict — alert will page)"
  fi
fi

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
