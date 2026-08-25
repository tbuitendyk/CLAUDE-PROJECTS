#!/usr/bin/env bash
# uts-planted-gate-forensics.sh -- READ-ONLY. Why did the latest planted-gate
# run produce no real money rows? Reads the gate run's stored record and the
# fabricated pair's cache state. Changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
ID=bracketlab-20260825-225010-planted-gate
curl -sf --max-time 30 "$B/api/batch/$ID" -o /tmp/uts-pgf.json \
  || { echo "could not read the gate run $ID"; exit 1; }
curl -sf --max-time 20 "$B/api/data-state" -o /tmp/uts-pgd.json || true
python3 <<'PY'
import json
d = json.load(open('/tmp/uts-pgf.json'))
doc = d.get('batch') or d
print(f"id: {doc.get('id')}")
print(f"status: {doc.get('status')}  started {doc.get('startedAt')}  finished {doc.get('finishedAt')}")
print(f"error: {doc.get('error')}")
print(f"progress: {doc.get('progress')}")
p = doc.get('params') or {}
for k in ('plantedGate','engineVersion','universe','symbols','sizes','labelShiftReps','edgeScreen','windowLayout','declared','promoteTopK','detailK'):
    if k in p:
        v = p[k]
        s = json.dumps(v)
        print(f"params.{k}: {s[:220]}")
print(f"failures: {len(doc.get('failures') or [])}")
for f in (doc.get('failures') or [])[:3]:
    print(f"  {f.get('key')}: {str(f.get('error'))[:200]}")
rc = doc.get('rowCounts') or {}
print(f"rowCounts: {json.dumps(rc)[:300]}")
ec = doc.get('edgeCensus') or []
print(f"edgeCensus rows in doc: {len(ec)}")
reals = [r for r in ec if r.get('nullDealSeed') is None]
print(f"  of them real: {len(reals)}; with holdPnl: {sum(1 for r in reals if r.get('holdPnl') is not None)}")
if reals[:2]:
    print(f"  first real row keys: {sorted(reals[0].keys())[:24]}")
lead = doc.get('leaders') or []
print(f"leaders: {len(lead)}")
perf = doc.get('perf') or {}
print(f"perf: {json.dumps(perf)[:200]}")
try:
    ds = json.load(open('/tmp/uts-pgd.json'))
    for s in ds.get('symbols', []):
        if 'PLANTED' in s.get('symbol',''):
            print(f"cache: {s.get('symbol')} {s.get('from')}..{s.get('to')} candles={s.get('candles')} planted={s.get('planted')}")
except Exception as e:
    print(f"(data-state unreadable: {e})")
PY
