#!/usr/bin/env bash
# uts-reptotals-peek.sh -- READ-ONLY, QUICK. One look at the replication
# totals' state and one timing of an unrelated page, so the long watcher's job
# can be done in short calls that fit the endpoint. Changes nothing itself;
# asking the table is what starts its background build, by design.
set -uo pipefail
B=http://127.0.0.1:8094
ID=$(curl -sf --max-time 20 "$B/api/batches" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("batches") or [{}])[0].get("id",""))')
[ -n "$ID" ] || { echo "no run"; exit 1; }
T0=$(date +%s%N)
curl -sf --max-time 30 "$B/api/batch/$ID/replication?offset=0&limit=5" -o /tmp/uts-rt.json || { echo "the table endpoint did not answer"; exit 1; }
T1=$(date +%s%N)
python3 - "$(( (T1 - T0) / 1000000 ))" <<'PY'
import json, sys
d = json.load(open('/tmp/uts-rt.json'))
t = d.get('totals') or {}
if d.get('building'):
    print(f"BUILDING: {d.get('scanned',0):,} of {d.get('of',0):,} rows scanned")
elif t.get('upToDate'):
    top = d['scored'][0] if d.get('scored') else None
    print(f"FRESH: {d.get('configs')} configurations over {d.get('total'):,} rows"
          + (f" — top line {top['label']!r}, beat its own nulls {top['nullBeat']}/{top['nullPairs']}" if top else ''))
else:
    print(f"BEHIND: totals cover {t.get('asOfRows',0):,} of {d.get('total',0):,}")
if d.get('buildError'):
    print('BUILD ERROR:', d['buildError'])
print(f"the table endpoint answered in {sys.argv[1]} ms")
PY
printf 'an unrelated page during this: '
curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 15 "$B/construct.html" || echo 'no answer in 15s'
