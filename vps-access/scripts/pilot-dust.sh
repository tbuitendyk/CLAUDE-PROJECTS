#!/usr/bin/env bash
# pilot-dust.sh -- run the ONE-TIME dust trade on the Mexico box: a single $10
# LTCUSDT buy->sell round trip on isolated margin, LIVE for this run only.
# Purpose is plumbing (PILOT-F1.md gate 4): prove real fills, real fee-per-leg,
# and reconciliation. P&L is void as evidence. The master switch stays OFF, so
# the model still drives nothing after this. LIVE is flipped to 1 ONLY around
# the dust call and restored to 0 no matter how the call exits.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"

$SSH "$BOX" 'bash -s' <<'R'
set -uo pipefail
ENV=~/.executor-env
restore() { sed -i 's/^LIVE=.*/LIVE=0/' "$ENV"; echo "  LIVE restored to $(grep -E "^LIVE=" "$ENV")"; }
trap restore EXIT

echo "== pre-flight =="
grep -qE '^LIVE=' "$ENV" || echo 'LIVE=0' >> "$ENV"
python3 ~/mx_executor.py status | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  dust_done:",d["dust_done"],"| halted:",d["halted"])'

echo "== flip LIVE=1 for the dust call only =="
sed -i 's/^LIVE=.*/LIVE=1/' "$ENV"
grep -E '^LIVE=' "$ENV" | sed 's/^/  /'

echo "== dust: one \$10 LTCUSDT buy -> sell (REAL) =="
python3 ~/mx_executor.py dust --yes
echo "  dust exit: $?"
R
rc=$?
echo "== journal tail (post-dust) =="
$SSH "$BOX" 'tail -14 ~/pilot/journal.jsonl 2>/dev/null' | sed 's/^/  /'
exit $rc
