#!/usr/bin/env bash
# uts-agree-params.sh -- READ-ONLY. What the newest stage 3 launch actually
# asked for on the agreement side, and what shares its records carry. Fires
# nothing, writes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-ap-sets.json || { echo "no answer"; exit 1; }
ID=$(python3 -c '
import json
s=[x for x in (json.load(open("/tmp/uts-ap-sets.json")).get("sets") or []) if str(x.get("stage"))=="3"]
print(s[0]["id"] if s else "")')
[ -n "$ID" ] || { echo "no stage 3 set"; exit 1; }
echo "stage 3 set: $ID"
curl -sf --max-time 60 "$B/api/stageset/$ID" -o /tmp/uts-ap-doc.json || echo "(set doc did not answer)"
curl -sf --max-time 90 "$B/api/stageset/$ID/ranked?from=0&n=400" -o /tmp/uts-ap-r.json || echo "(ranked did not answer)"
python3 <<'PY'
import json
def L(p):
    try: return json.load(open(p))
    except Exception: return {}
doc=(L('/tmp/uts-ap-doc.json') or {}).get('set') or {}
p=doc.get('params') or {}
print()
print("  what the launch asked for on the agreement side")
for k in ('agreeRule','agreePermuteRule','agreePct','agreePermutePct','agreeBothModels',
          'agreePermuteBoth','agreePersist','agreePermutePersist'):
    print(f"    {k:<22} {p.get(k)!r}")
print()
print("  and on the rest")
for k in ('decision','permuteDecision','band','permuteBand','weekdaysOnly','permuteWeekdays','singles','doubles','triples'):
    if k in p: print(f"    {k:<22} {p.get(k)!r}")
r=L('/tmp/uts-ap-r.json')
rows=r.get('rows') or []
sh=sorted({x.get('agreePct') for x in rows})
rl=sorted({x.get('agreeRule') for x in rows})
pe=sorted({x.get('agreePersist') for x in rows}, key=lambda v:(v is None, v))
bo=sorted({bool(x.get('agreeBoth')) for x in rows})
mem=sorted({x.get('members') for x in rows}, key=lambda v:(v is None, v))
print()
print(f"  across the first {len(rows)} ranked rows of {r.get('total')}:")
print(f"    shares present    {sh}")
print(f"    rules present     {rl}")
print(f"    +hold present     {pe}")
print(f"    +both present     {bo}")
print(f"    members per row   {mem}")
sp=(r.get('spread') or {}).get('shareMin')
print(f"    share min/median/avg/max over the WHOLE table: {sp}")
PY
