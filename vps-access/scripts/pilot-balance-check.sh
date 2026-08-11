#!/usr/bin/env bash
# pilot-balance-check.sh -- READ-ONLY: confirm the isolated LTCUSDT wallet on
# the Mexico box holds the pilot USDT. Signed GET only; places nothing.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX" 'python3 - <<PY
import importlib.util, json
spec=importlib.util.spec_from_file_location("mx","/home/admin/mx_executor.py")
mx=importlib.util.module_from_spec(spec); spec.loader.exec_module(mx)
bx=mx.Binance(mx.load_env()); bx.sync_clock()
code,acct=bx.isolated_account()
if code==200:
    a=acct["assets"][0]
    print("HTTP",code)
    print("base(LTC)  net:",a["baseAsset"]["netAsset"],"free:",a["baseAsset"]["free"])
    print("quote(USDT) net:",a["quoteAsset"]["netAsset"],"free:",a["quoteAsset"]["free"])
    print("marginLevel:",a.get("marginLevel"))
else:
    print("HTTP",code,json.dumps(acct)[:300])
PY'
