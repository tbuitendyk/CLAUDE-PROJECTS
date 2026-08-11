#!/usr/bin/env bash
# pilot-unhalt.sh -- clear a stuck HALT on the box after its cause is resolved,
# then run ONE cycle so the flat-book sweep clears any leftover dust, and print
# status. Safe on a LIVE box: ARM gates all entries, so no position can open —
# the cycle only reconciles, sweeps sub-clip dust, and reports.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
$SSH "$BOX" 'bash -s' <<'R'
echo "== before =="
python3 ~/mx_executor.py status | python3 -c "import sys,json;d=json.load(sys.stdin);print('  halted',d['halted'],'armed',d['armed'])"
echo "== unhalt =="
python3 ~/mx_executor.py unhalt --source=owner --reason=reconcile-dust-fixed-batch-2g
echo "== one cycle (reconcile + sweep; ARM absent so nothing opens) =="
python3 ~/mx_executor.py run; echo "  exit $?"
echo "== after =="
python3 ~/mx_executor.py status
echo "== journal tail =="
tail -10 ~/pilot/journal.jsonl | sed 's/^/  /'
R
