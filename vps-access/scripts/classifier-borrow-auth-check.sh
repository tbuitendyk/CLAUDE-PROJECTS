#!/usr/bin/env bash
# classifier-borrow-auth-check.sh -- READ-ONLY: can this key actually borrow,
# and is it talking to an endpoint Binance still serves?
#
# WHY THIS EXISTS (2026-09-21). Every live SHORT from 2026-08-24 to 2026-09-21
# failed at the borrow with `401 {"code": -1002, "msg": "You are not authorized
# to execute this request."}` -- six attempts a day, no order ever sent, while
# longs filled normally. The cause was the PATH: Binance removed
# POST /sapi/v1/margin/loan on 2024-03-31 in favour of
# POST /sapi/v1/margin/borrow-repay (type=BORROW|REPAY).
#
# But -1002 has a second possible cause that looks identical from the journal:
# an API key without margin permission. Waiting for the next 01:20 entry to
# find out costs another day of shorts, so this answers it in advance from
# READS alone -- maxBorrowable and the key's own restrictions both require the
# same permission a real borrow does.
#
# Signed GETs only. It borrows nothing, repays nothing, places no order and
# writes nothing to the journal.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX" 'python3 - <<PY
import importlib.util, json, hashlib
spec = importlib.util.spec_from_file_location("mx", "/home/admin/mx_executor.py")
mx = importlib.util.module_from_spec(spec); spec.loader.exec_module(mx)
bx = mx.Binance(mx.load_env()); bx.sync_clock()

src = open("/home/admin/mx_executor.py", "rb").read()
print("== the executor on this box ==")
print("  sha256:", hashlib.sha256(src).hexdigest()[:16] + "...")
print("  borrow path in code:", "borrow-repay" if b"borrow-repay" in src else "RETIRED /margin/loan")

print()
print("== CAN IT BORROW? GET /sapi/v1/margin/maxBorrowable (same permission a real borrow needs) ==")
code, body = bx._http("GET", "/sapi/v1/margin/maxBorrowable",
                      {"asset": bx.base_asset, "isolatedSymbol": bx.symbol}, signed=True)
print("  HTTP", code, json.dumps(body)[:260])
if code == 200:
    print("  -> BORROW IS AUTHORIZED. amount is the ceiling, in", bx.base_asset)
elif code == 401:
    print("  -> NOT AUTHORIZED. The key lacks margin permission; that is a setting on")
    print("     Binance API Management, not something code can fix.")

print()
print("== IS THE LIVE PATH SERVED? GET /sapi/v1/margin/borrow-repay (history read, borrows nothing) ==")
code, body = bx._http("GET", "/sapi/v1/margin/borrow-repay",
                      {"asset": bx.base_asset, "isolatedSymbol": bx.symbol,
                       "type": "BORROW", "current": 1, "size": 5}, signed=True)
print("  HTTP", code, json.dumps(body)[:400])

print()
print("== IS THE OLD PATH REALLY GONE? GET /sapi/v1/margin/loan (the one that 401d all month) ==")
code, body = bx._http("GET", "/sapi/v1/margin/loan",
                      {"asset": bx.base_asset, "isolatedSymbol": bx.symbol,
                       "current": 1, "size": 5}, signed=True)
print("  HTTP", code, json.dumps(body)[:260])

print()
print("== what the key is permitted to do ==")
code, body = bx._http("GET", "/sapi/v1/account/apiRestrictions", {}, signed=True)
print("  HTTP", code, json.dumps(body)[:400])
PY'
echo "(read-only -- borrowed nothing, placed nothing)"
