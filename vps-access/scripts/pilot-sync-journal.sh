#!/usr/bin/env bash
# pilot-sync-journal.sh -- pull the executor's append-only journal from the
# Mexico box to the deployed classifier, where /api/pilot and the live screen
# read it. Read-only both ends: copies a file, changes nothing, trades nothing.
#
# The journal is append-only, so a plain overwrite-copy is always a superset of
# what the screen last saw; there is no merge to get wrong. Runs on a short VPS
# timer so the screen is close to real-time (it honestly shows the sync age).
set -uo pipefail

APPDIR="${APPDIR:-/opt/general-classifier}"
DEST="$APPDIR/data/pilot"
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"

[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
mkdir -p "$DEST"

echo "== pull journal from box =="
scp -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new \
    "$BOX_USER@$BOX_HOST:~/pilot/journal.jsonl" "$DEST/journal.jsonl.tmp"
rc=$?
if [ $rc -ne 0 ]; then
  # no journal yet is normal before the first run; only warn
  echo "  journal not present on box yet (or unreachable) — screen will show 'no pilot journal yet'"
  exit 0
fi
mv "$DEST/journal.jsonl.tmp" "$DEST/journal.jsonl"
lines=$(wc -l < "$DEST/journal.jsonl" 2>/dev/null || echo 0)
echo "  synced $lines journal lines to $DEST/journal.jsonl"
