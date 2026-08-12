#!/usr/bin/env bash
# pilot-arm-readiness.sh -- READ-ONLY: will a START actually stick and open the
# trade, or will something silently override it? Checks the two things that would
# turn a genuine START back off without the owner seeing why: a MIRROR BREAK (the
# dead-man forces disarm) and a HALT flag (entries skipped). Prints both plus the
# box ARM state. No writes, no orders.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
APP=/opt/general-classifier

echo "== VPS: mirror state (breaks>=1 => START is force-disarmed by the dead-man) =="
M="$APP/data/pilot/mirror.json"
if [ -f "$M" ]; then
  python3 -c "import json;d=json.load(open('$M'));print('  ',json.dumps({k:d.get(k) for k in ('ok','breaks','checked','pending','utc','note')}))"
  brk=$(python3 -c "import json;print(int(json.load(open('$M')).get('breaks',0)))" 2>/dev/null || echo '?')
  [ "$brk" = "0" ] && echo "  => mirror CLEAN (breaks=0): a START will NOT be force-disarmed" \
                    || echo "  => MIRROR BREAK (breaks=$brk): a START WOULD be reverted — investigate first"
else
  echo "  (no mirror.json yet — nothing recorded to diverge; treated as clean)"
fi

echo "== box: halt + ARM =="
$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
echo "  HALT flag present: $([ -f ~/pilot/HALT ] && echo 'YES — entries blocked until unhalted' || echo 'no (good)')"
echo "  ARM file present:  $([ -f ~/pilot/ARM ] && echo YES || echo 'no (STOPPED — owner has not pressed START)')"
BOX
echo "(read-only)"
