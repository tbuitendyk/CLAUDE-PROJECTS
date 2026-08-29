#!/usr/bin/env bash
# uts-two-totals.sh -- READ-ONLY. Why the ranked table and the every-coin
# table under it report different row counts on the same stage 3 set.
# Asks the two endpoints the page asks, and reads the launch's own choices
# out of the set document. Fires nothing, writes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-tt-sets.json \
  || { echo "the record-set list did not answer"; exit 1; }
ID=$(python3 -c '
import json
sets=[s for s in (json.load(open("/tmp/uts-tt-sets.json")).get("sets") or []) if str(s.get("stage"))=="3"]
print(sets[0]["id"] if sets else "")')
[ -n "$ID" ] || { echo "no stage 3 record set on this box"; exit 1; }
echo "stage 3 set: $ID"
curl -sf --max-time 60 "$B/api/stageset/$ID"                      -o /tmp/uts-tt-doc.json    || echo "  (set document did not answer)"
curl -sf --max-time 90 "$B/api/stageset/$ID/ranked?from=0&n=3"    -o /tmp/uts-tt-ranked.json || echo "  (ranked did not answer)"
curl -sf --max-time 90 "$B/api/stageset/$ID/coins?offset=0&limit=3" -o /tmp/uts-tt-coins.json || echo "  (coins did not answer)"
python3 <<'PY'
import json, os
def load(p):
    try: return json.load(open(p))
    except Exception: return {}
doc = (load('/tmp/uts-tt-doc.json') or {}).get('set') or {}
rk  = load('/tmp/uts-tt-ranked.json')
cn  = load('/tmp/uts-tt-coins.json')
p   = doc.get('params') or {}
plan= doc.get('plan') or {}
perf= doc.get('perf') or {}
R = rk.get('total'); C = cn.get('total')
print()
print(f"  ranked table total ............ {R if R is None else format(R,',')}")
print(f"  every-coin table total ........ {C if C is None else format(C,',')}")
print(f"  plan.settings ................. {plan.get('settings')}")
print(f"  plan.units .................... {plan.get('units')}   (perf.unitsTotal {perf.get('unitsTotal')})")
print()
dec  = 2 if p.get('permuteDecision') else 1
BAND = ['auto',3,5,8]
band = len(BAND) if p.get('permuteBand') else 1
wk   = 2 if p.get('permuteWeekdays') else 1
V = dec*band*wk
print(f"  permuteDecision={bool(p.get('permuteDecision'))} -> {dec}")
print(f"  permuteBand={bool(p.get('permuteBand'))} -> {band}    (menu {BAND})")
print(f"  permuteWeekdays={bool(p.get('permuteWeekdays'))} -> {wk}")
print(f"  so each setting name has {V} variant(s) after the ' · '")
U = plan.get('units') or perf.get('unitsTotal')
if R and V and U:
    base = R/V
    print()
    print(f"  {format(R,',')} ranked / {V} = {base:,.0f} distinct names before the ' · '")
    print(f"  {base:,.0f} x {U} units = {base*U:,.0f}   vs the every-coin total {C if C is None else format(C,',')}"
          + ("   MATCHES" if C is not None and abs(base*U - C) < 0.5 else "   DOES NOT MATCH"))
print()
for r in (rk.get('rows') or [])[:3]:
    print(f"  ranked row label: {r.get('label')!r}")
for r in (cn.get('rows') or [])[:3]:
    print(f"  coin row: cellLabel={r.get('cellLabel')!r} trade={r.get('trade')!r} "
          f"ctx1={r.get('ctx1')!r} ctx2={r.get('ctx2')!r} geometry={r.get('geometry')!r} rows={r.get('rows')}")
PY
