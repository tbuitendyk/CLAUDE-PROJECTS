#!/usr/bin/env bash
# uts-coins-peek.sh -- READ-ONLY, QUICK. One look at the every-coin view's
# state: fresh (with its top rows), building (with progress), or behind.
# Asking is what starts its background rebuild, by design. Also times an
# unrelated page during the ask. Changes nothing else.
set -uo pipefail
B=http://127.0.0.1:8094
ID=$(curl -sf --max-time 20 "$B/api/batches" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("batches") or [{}])[0].get("id",""))')
[ -n "$ID" ] || { echo "no run"; exit 1; }
T0=$(date +%s%N)
curl -sf --max-time 30 "$B/api/batch/$ID/replication-coins?sort=share&minPairs=100&offset=0&limit=5" -o /tmp/uts-cn.json \
  || { echo "the every-coin endpoint did not answer"; exit 1; }
T1=$(date +%s%N)
python3 - "$(( (T1 - T0) / 1000000 ))" <<'PY'
import json, sys
d = json.load(open('/tmp/uts-cn.json'))
t = d.get('totals') or {}
if d.get('building') and not d.get('rows'):
    print(f"BUILDING: {d.get('scanned',0):,} of {d.get('of',0):,} rows scanned")
elif t.get('upToDate'):
    print(f"FRESH: {d['page']['total']:,} coin rows (floor removed {d.get('narrowedOut',0):,}); the top five by share with 100+ comparisons:")
    for r in d.get('rows', []):
        print(f"  {r['share']*100:5.1f}%  {r['beat']:>6}/{r['pairs']:<6} {r['trade']:10} {r['geometry']:9} {r['label']}")
else:
    print(f"BEHIND: as of {t.get('asOfRows',0):,} of {d.get('total',0):,}")
if d.get('buildError'):
    print('BUILD ERROR:', d['buildError'])
print(f"answered in {sys.argv[1]} ms")
PY
printf 'an unrelated page during this: '
curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 15 "$B/construct.html" || echo 'no answer in 15s'
