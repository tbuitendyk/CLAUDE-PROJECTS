#!/usr/bin/env bash
# pilot-preband-drop.sh -- ONE-OFF, DELETE AFTER USE (owner, 2026-08-19).
#
# Removes ~/pilot/journal.jsonl.preband, the copy taken before the band
# correction rewrote the journal's INTENT_SEEN events. The correction has been
# verified — journal and decision records agree, mirror clean — so the copy has
# served its purpose and the owner has asked for it gone.
#
# While it is here it also prints the newest BALANCE and RUN_STATUS lines, which
# is the check that the executor deploy actually took: both should now carry the
# margin fields that were missing until today.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new \
  "$BOX" 'bash -s' <<'R'
P=~/pilot/journal.jsonl.preband
if [ -f "$P" ]; then
  rm -f "$P" && echo "deleted $P"
else
  echo "already gone: $P"
fi
echo "== newest BALANCE (should carry margin_level) =="
grep '"event": *"BALANCE"' ~/pilot/journal.jsonl | tail -1 || echo "  none yet"
echo "== newest RUN_STATUS (should carry margin_floor) =="
grep '"event": *"RUN_STATUS"' ~/pilot/journal.jsonl | tail -1 || echo "  none yet"
echo "== margin env on the box =="
grep -E '^MARGIN_FLOOR=' ~/.executor-env 2>/dev/null || echo "  MARGIN_FLOOR not set (no floor — as intended until the owner sets one)"
R
