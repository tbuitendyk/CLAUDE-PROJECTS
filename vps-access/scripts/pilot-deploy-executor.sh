#!/usr/bin/env bash
# pilot-deploy-executor.sh -- ship mx_executor.py to the Mexico box and run the
# NO-ORDER dry chain: verify the owner's env file, run status, run one dry
# cycle (clock sync + signed READ of the isolated account + balance snapshot),
# and print the journal tail. With LIVE=0, no ARM flag, and no intents present,
# no order of any kind can be placed by this script.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/executor/mx_executor.py"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

[ -f "$SRC" ] || { echo "no executor at $SRC"; exit 1; }
echo "== ship executor (sha256 $(sha256sum "$SRC" | cut -c1-16)...) =="
scp -q -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$SRC" "$BOX:~/mx_executor.py" || { echo scp failed; exit 1; }

$SSH "$BOX" 'bash -s' <<'R'
echo "== box-side verify =="
echo "  executor sha256: $(sha256sum ~/mx_executor.py | cut -c1-16)..."
if [ ! -f ~/.executor-env ]; then echo "  NO ~/.executor-env — stop"; exit 1; fi
perms=$(stat -c %a ~/.executor-env)
[ "$perms" = "600" ] || { chmod 600 ~/.executor-env; echo "  env perms were $perms — tightened to 600"; }
echo "  env keys present: $(grep -cE '^(BINANCE_KEY|BINANCE_SECRET)=' ~/.executor-env)/2"
LIVE=$(grep -E '^LIVE=' ~/.executor-env | cut -d= -f2)
echo "  LIVE=$LIVE"
echo "== status (read-only) =="
python3 ~/mx_executor.py status
if [ "$LIVE" = "0" ]; then
  # initial dry deploy: exercise the READ path (clock sync + signed account read)
  echo "== one dry run cycle (signed READS only: clock, account, balance) =="
  python3 ~/mx_executor.py run; echo "  exit: $?"
else
  # in-place update of an already-live box: DO NOT run a cycle here (the
  # pilot-exec.timer does that). ARM is the gate; with it absent nothing opens.
  echo "== LIVE=$LIVE — executor updated in place; pilot-exec.timer runs cycles =="
  echo "  ARM: $([ -f ~/pilot/ARM ] && echo 'PRESENT' || echo 'ABSENT — STOPPED, opens nothing new')"
  echo "  baseline: $([ -f ~/pilot/arm-baseline.json ] && cat ~/pilot/arm-baseline.json || echo 'none (fresh arm-auth state)')"
fi
echo "== journal tail =="
tail -12 ~/pilot/journal.jsonl 2>/dev/null | sed 's/^/  /'
R
