#!/usr/bin/env bash
# pilot-shortdust.sh -- ONE-TIME live SHORT dust: open (SELL+auto-borrow) then
# close (BUY+auto-repay) a $10 LTCUSDT short. Proves the short path and that the
# close FULLY repays the borrow. LIVE only around the call, always restored.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"
$SSH "$BOX" 'bash -s' <<'R'
set -uo pipefail
ENV=~/.executor-env
restore(){ sed -i 's/^LIVE=.*/LIVE=0/' "$ENV"; echo "  LIVE restored: $(grep -E ^LIVE= "$ENV")"; }
trap restore EXIT
python3 ~/mx_executor.py status | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  shortdust_done:",d["shortdust_done"],"| halted:",d["halted"])'
sed -i 's/^LIVE=.*/LIVE=1/' "$ENV"; grep -E '^LIVE=' "$ENV" | sed 's/^/  /'
echo "== shortdust: open SELL+borrow -> close BUY+repay (REAL) =="
python3 ~/mx_executor.py shortdust --yes; echo "  exit: $?"
R
echo "== SHORTDUST_DONE + post balance =="
$SSH "$BOX" 'grep SHORTDUST_DONE ~/pilot/journal.jsonl | tail -1' | sed 's/^/  /'
$SSH "$BOX" 'python3 - <<PY
import importlib.util
spec=importlib.util.spec_from_file_location("mx","/home/admin/mx_executor.py")
mx=importlib.util.module_from_spec(spec); spec.loader.exec_module(mx)
bx=mx.Binance(mx.load_env()); bx.sync_clock()
c,acct=bx.isolated_account(); a=acct["assets"][0]
print("  LTC net:",a["baseAsset"]["netAsset"],"free:",a["baseAsset"]["free"],"borrowed:",a["baseAsset"]["borrowed"],"| USDT free:",a["quoteAsset"]["free"])
PY'
