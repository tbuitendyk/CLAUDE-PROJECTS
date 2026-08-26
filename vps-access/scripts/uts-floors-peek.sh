#!/usr/bin/env bash
# uts-floors-peek.sh -- READ-ONLY. The every-coin floors, exercised once:
# 100+ comparisons, share at least 85%, avg vs always-long at least $0.
set -uo pipefail
B=http://127.0.0.1:8094
ID=$(curl -sf --max-time 20 "$B/api/batches" | python3 -c '
import json, sys, urllib.request
ids = [b.get("id") for b in (json.load(sys.stdin).get("batches") or []) if b.get("id")]
best, most = "", -1
for i in ids[:10]:
    try:
        d = json.load(urllib.request.urlopen("http://127.0.0.1:8094/api/batch/" + i, timeout=15))
        doc = d.get("batch") or d
        n = ((doc.get("rowCounts") or {}).get("replication")) or 0
    except Exception:
        n = 0
    if n > most: best, most = i, n
print(best)')
[ -n "$ID" ] || { echo "no run"; exit 1; }
T0=$(date +%s%N)
curl -sf --max-time 30 "$B/api/batch/$ID/replication-coins?minPairs=100&minShare=85&minVsLong=0&offset=0&limit=5" -o /tmp/uts-fl.json \
  || { echo "did not answer"; exit 1; }
T1=$(date +%s%N)
python3 - "$(( (T1 - T0) / 1000000 ))" <<'PY'
import json, sys
d = json.load(open('/tmp/uts-fl.json'))
pg = d.get('page') or {}
print("answered in %s ms: %s rows clear all three floors (of 235,620); narrowed out %s" %
      (sys.argv[1], pg.get('total'), format(d.get('narrowedOut', 0), ',')))
for r in (d.get('rows') or []):
    print("  %5.1f%% (%s/%s)  avgHold $%.2f  avgVsL $%.2f  %s %s %s" %
          ((r.get('share') or 0) * 100, r.get('beat'), r.get('pairs'),
           r.get('avgHold') or 0, r.get('avgVsLong') or 0, r.get('trade'), r.get('geometry'), r.get('label')))
PY
