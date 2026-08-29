#!/usr/bin/env bash
# uts-rule-by-rule.sh -- READ-ONLY. For each way of turning votes into a call,
# how many settings, what actually agreed, how often they traded, and how they
# did against their null sets. Fires nothing, writes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-rr-sets.json || { echo "no answer"; exit 1; }
ID=$(python3 -c '
import json
s=[x for x in (json.load(open("/tmp/uts-rr-sets.json")).get("sets") or []) if str(x.get("stage"))=="3"]
print(s[0]["id"] if s else "")')
[ -n "$ID" ] || { echo "no stage 3 set"; exit 1; }
echo "stage 3 set: $ID"
echo
printf "  %-11s %8s  %-26s %-22s %-18s %s\n" rule rows "share that agreed min/med/max" "avg held-back trades" "beat null set" "rung"
for r in count conviction voices families unusual; do
  curl -sf --max-time 180 "$B/api/stageset/$ID/ranked?from=0&n=5&rule=$r" -o /tmp/uts-rr-$r.json || { echo "  $r: no answer"; continue; }
  python3 -c "
import json
d=json.load(open('/tmp/uts-rr-$r.json'))
sp=(d.get('spread') or {}).get('agreedMin')
tr=(d.get('spread') or {}).get('tradesMin')
be=(d.get('spread') or {}).get('beatMin')
ru=(d.get('spread') or {}).get('voicesMin')
rows=d.get('rows') or []
def f(s,k):
    return '-' if not s else round(s[k],2)
agree='-' if not sp else f\"{f(sp,'min')}/{f(sp,'median')}/{f(sp,'max')} n={sp['n']}\"
trades='-' if not tr else f\"{f(tr,'min')}/{f(tr,'median')}/{f(tr,'max')}\"
beat='-' if not be else f\"{f(be,'min')}/{f(be,'median')}/{f(be,'max')}\"
rung = rows[0].get('avgRung') if rows else None
mem  = rows[0].get('members') if rows else None
print(f\"  {'$r':<11} {d.get('total'):>8}  {agree:<26} {trades:<22} {beat:<18} {rung} of {mem}\")
"
done
echo
echo "== one conviction setting in full =="
python3 -c "
import json
d=json.load(open('/tmp/uts-rr-conviction.json'))
r=(d.get('rows') or [None])[0]
if not r: print('  none'); raise SystemExit
for k in ('label','agreeRule','avgRung','members','avgAgreed','coins','avgTest','avgHold','avgTrades','beat','pairs','avgLead','coinsInMoney'):
    print(f'    {k:<14} {r.get(k)!r}')
"
