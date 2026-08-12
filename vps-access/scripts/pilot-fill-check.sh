#!/usr/bin/env bash
# pilot-fill-check.sh -- READ-ONLY: did the armed box open the entry? Shows the
# recent ENTRY lifecycle (intent seen -> order sent/ack -> fill, or any skip/drift
# reason) and the current open position(s). No writes, no orders.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"

$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
J=~/pilot/journal.jsonl
echo "== recent ENTRY lifecycle (last 10) =="
grep -aE '"event":"(INTENT_SEEN|INTENT_DUPLICATE|INTENT_INVALID|INTENT_STALE|ORDER_SENT|ORDER_ACK|ORDER_REJECT|ENTRY_FILL|ENTRY_INFLIGHT|ENTRY_SKIPPED|KILL_PRICE_DRIFT)"' "$J" 2>/dev/null | tail -10 | sed 's/^/  /'
echo "== current open positions (ENTRY_FILL not yet EXIT_FILL) =="
python3 - "$J" <<'PY'
import json,sys
ev=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
opens={}
for e in ev:
    c=e.get("chunk_start")
    if e.get("event")=="ENTRY_FILL": opens[c]=e
    if e.get("event")=="EXIT_FILL": opens.pop(c,None)
if not opens: print("  (none open)")
for c,e in opens.items():
    print("  chunk=%s side=%s qty=%s price=%s fee_quote=%s fill_dev=%s" % (
        c, e.get("side"), e.get("qty"), e.get("price"),
        e.get("fee_quote"), e.get("fill_deviation")))
PY
BOX
echo "(read-only)"
