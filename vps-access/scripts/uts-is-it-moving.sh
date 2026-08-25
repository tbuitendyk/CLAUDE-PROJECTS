#!/usr/bin/env bash
# uts-is-it-moving.sh -- READ-ONLY. Is the run actually getting anywhere? Takes
# two readings ninety seconds apart and reports the difference, because "status:
# running" is a word and a counter that has not moved is the thing worth
# knowing. Changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094

snap() {
  curl -sf --max-time 25 "$B/api/batches" -o "$1" 2>/dev/null || return 1
  ID=$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("batches") or [{}])[0].get("id",""))' "$1")
  curl -sf --max-time 25 "$B/api/batch/$ID" -o "$1.doc" 2>/dev/null || return 1
}

echo "== reading one =="
snap /tmp/uts-a.json || { echo "the service did not answer"; exit 1; }
python3 - /tmp/uts-a.json.doc <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
p = d.get('perf') or {}
print(f"  status {d.get('status')}   phase {p.get('phase')}   runs {p.get('runsDone')}/{p.get('runsTotal')}")
print(f"  progress: {str(d.get('progress'))[:100]}")
print(f"  rows {d.get('rowCounts')}")
PY

echo "== waiting ninety seconds =="
sleep 90

echo "== reading two =="
snap /tmp/uts-c.json || { echo "the service did not answer the second time"; exit 1; }
python3 - /tmp/uts-a.json.doc /tmp/uts-c.json.doc <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
pa, pb = a.get('perf') or {}, b.get('perf') or {}
print(f"  status {b.get('status')}   phase {pb.get('phase')}   runs {pb.get('runsDone')}/{pb.get('runsTotal')}")
print(f"  progress: {str(b.get('progress'))[:100]}")
ra, rb = a.get('rowCounts') or {}, b.get('rowCounts') or {}
moved = False
for k in ('slim', 'census', 'replication'):
    d = (rb.get(k) or 0) - (ra.get(k) or 0)
    print(f"  {k:12} {ra.get(k)} -> {rb.get(k)}   ({d:+})")
    if d:
        moved = True
dr = (pb.get('runsDone') or 0) - (pa.get('runsDone') or 0)
print(f"  trainings    {pa.get('runsDone')} -> {pb.get('runsDone')}   ({dr:+})")
if moved or dr:
    left = (pb.get('runsTotal') or 0) - (pb.get('runsDone') or 0)
    rate = dr / 90 if dr else 0
    print('\n  IT IS MOVING.')
    if rate:
        print(f"  {rate*3600:.0f} trainings an hour at this moment, {left} left -> roughly {left/rate/3600:.1f} hours")
else:
    print('\n  NOTHING MOVED IN NINETY SECONDS. It says running and it is not getting anywhere.')
PY
