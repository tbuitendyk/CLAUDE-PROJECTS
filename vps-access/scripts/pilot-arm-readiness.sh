#!/usr/bin/env bash
# pilot-arm-readiness.sh -- READ-ONLY: will a START actually stick and open the
# trade, or will something silently override it? Checks the two things that would
# turn a genuine START back off, or leave it on with nothing happening: a
# reproduce-check BREAK (that profile's new entries are halted) and a HALT flag
# (entries skipped). Prints both plus the box ARM state. No writes, no orders.
#
# The brake changed shape (2026-08-19): a break used to force-disarm the whole
# MACHINE via the dead-man. It now halts only the profile whose decisions stopped
# reproducing, so the master switch stays where the owner put it and the other
# profiles keep trading. Open positions keep their scheduled exits either way.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
APP=/opt/general-classifier

echo "== VPS: reproduce-check per profile (a break halts THAT profile's new entries) =="
M="$APP/data/live/mirror.json"
if [ -f "$M" ]; then
  python3 - "$M" <<'READINESS'
import json, sys
d = json.load(open(sys.argv[1]))
print("  as of %s | profiles %s | breaks %s | errors %s"
      % (d.get("utc"), d.get("setups"), d.get("breaks"), d.get("errors")))
rows = d.get("results") or []
for r in rows:
    if r.get("breaks"):
        verdict = "BREAK - this profile's new entries are halted"
    elif r.get("error"):
        verdict = "error - %s" % r.get("error")
    else:
        verdict = "clean"
    print("    %-28s checked=%-3s pending=%-3s %s"
          % (r.get("setup_id"), r.get("checked"), r.get("pending"), verdict))
if not rows:
    print("    (no profile has been checked yet)")
READINESS
else
  echo "  (no verdict file yet — nothing recorded to diverge; treated as clean)"
fi

echo "== box: halt + ARM =="
$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
echo "  HALT flag present: $([ -f ~/pilot/HALT ] && echo 'YES — entries blocked until unhalted' || echo 'no (good)')"
echo "  ARM file present:  $([ -f ~/pilot/ARM ] && echo YES || echo 'no (STOPPED — owner has not pressed START)')"
BOX
echo "(read-only)"
