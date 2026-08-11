#!/usr/bin/env bash
# pilot-flatten.sh -- ONE-TIME cleanup: sell the actual free LTC left open by the
# aborted dust buy, returning the isolated wallet to flat. Reads the REAL free
# base balance and sells it floored to the lot step (so the fee-shrunk quantity
# sells cleanly). LIVE only around the sell, always restored to 0.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"
$SSH "$BOX" 'bash -s' <<'R'
set -uo pipefail
ENV=~/.executor-env
restore(){ sed -i 's/^LIVE=.*/LIVE=0/' "$ENV"; echo "  LIVE restored: $(grep -E ^LIVE= "$ENV")"; }
trap restore EXIT
sed -i 's/^LIVE=.*/LIVE=1/' "$ENV"
python3 - <<PY
import importlib.util, json, math, time
spec=importlib.util.spec_from_file_location("mx","/home/admin/mx_executor.py")
mx=importlib.util.module_from_spec(spec); spec.loader.exec_module(mx)
bx=mx.Binance(mx.load_env()); bx.sync_clock()
code,acct=bx.isolated_account()
a=acct["assets"][0]
free=float(a["baseAsset"]["free"]); borrowed=float(a["baseAsset"]["borrowed"])
print("free LTC:",free,"borrowed:",borrowed,"USDT free:",a["quoteAsset"]["free"])
if free < 0.001:
    print("nothing to flatten (free < lot step)"); raise SystemExit(0)
qty=math.floor(free/0.001)*0.001
qty=round(qty,3)
print("selling",qty,"LTC (AUTO_REPAY)")
c,body=bx.margin_order("SELL",qty,"AUTO_REPAY")
print("HTTP",c,json.dumps(body)[:300])
mx.jlog("DUST_CLEANUP_SELL", http=c, qty=qty, body=json.dumps(body)[:200])
PY
R
echo "== post-flatten balance =="
$SSH "$BOX" 'python3 - <<PY
import importlib.util
spec=importlib.util.spec_from_file_location("mx","/home/admin/mx_executor.py")
mx=importlib.util.module_from_spec(spec); spec.loader.exec_module(mx)
bx=mx.Binance(mx.load_env()); bx.sync_clock()
c,acct=bx.isolated_account(); a=acct["assets"][0]
print("  LTC net:",a["baseAsset"]["netAsset"],"free:",a["baseAsset"]["free"],"| USDT free:",a["quoteAsset"]["free"])
PY'
