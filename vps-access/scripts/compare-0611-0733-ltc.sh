#!/usr/bin/env bash
# compare-0611-0733-ltc.sh -- read-only: why is the LTC daily-4d argmax row
# #30 on the 0611 board but #29 on the 0733 board? Prints the settings that
# differ between the two runs, and each board's rows 26-33 with the LTC row's
# exact money in both. Writes nothing.
set -euo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob, math
def load(pat):
    f = sorted(glob.glob(f'data/batches/*{pat}*.json'))
    assert f, pat
    return json.load(open(f[0]))
a = load('20260803-0611-null9-census')
b = load('20260804-0733-null9-census')
for tag, d in (('0611', a), ('0733', b)):
    p = d.get('params', {})
    print(f"{tag}: engine={d.get('engineVersion')} layout={p.get('windowLayout')} months={p.get('startMonth')}..{p.get('endMonth')} allLoaded={p.get('allLoaded')} fee={p.get('feePerLeg')} minTrades={p.get('minTrades')}")
pa, pb = a.get('params', {}), b.get('params', {})
keys = sorted(set(pa) | set(pb))
diff = [k for k in keys if json.dumps(pa.get(k), sort_keys=True, default=str) != json.dumps(pb.get(k), sort_keys=True, default=str)]
print('param fields that differ:', diff or 'NONE')
def board(d):
    rows = [r for r in d.get('edgeCensus', []) if r.get('nullDealSeed') is None and not r.get('shiftFrac') and r.get('searchPnl') is not None]
    mt = (d.get('params') or {}).get('minTrades') or 10
    rows.sort(key=lambda r: (((r.get('searchTrades') or 0) >= mt), r.get('searchPnl') or -9e9), reverse=True)
    return rows
def m(v):
    return '   none ' if v is None else f'{v:+8.2f}'
for tag, d in (('0611', a), ('0733', b)):
    rows = board(d)
    print(f'--- {tag}: {len(rows)} ranked real money rows; positions 26-33 by test-window money:')
    for i, r in enumerate(rows[25:33], start=26):
        print(f"  {i:3d}. {r['trade']:9s} {r['geometry']:9s} {r['decision']:11s} q{r.get('cellQuorum')} {str(r.get('cellGate')):11s} t{r.get('cellTHours')}h test {m(r.get('searchPnl'))} hold {m(r.get('holdPnl'))} trades {r.get('searchTrades')} band {r.get('bandPct')}")
    for i, r in enumerate(rows):
        if r['trade']=='LTCUSDT' and r['geometry']=='daily-4d' and r['decision']=='argmax':
            print(f"  LTC daily-4d argmax: position {i+1} test {m(r.get('searchPnl'))} hold {m(r.get('holdPnl'))} trades {r.get('searchTrades')} band {r.get('bandPct')} stamps={'yes' if r.get('windowStamps') else 'NO'}")
EOF
