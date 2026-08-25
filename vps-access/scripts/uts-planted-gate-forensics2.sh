#!/usr/bin/env bash
# uts-planted-gate-forensics2.sh -- READ-ONLY, part two. (a) What the KEPT
# gate record says (the small file that outlives the run), and (b) whether
# the gate run's stored census rows are themselves healthy. Changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
ID=bracketlab-20260825-225010-planted-gate
WD=$(systemctl show -p WorkingDirectory --value ultimate-trading-system 2>/dev/null || true)
echo "service working directory: ${WD:-unknown}"
REC="${WD}/data/gate-records/${ID}.json"
if [ -n "${WD}" ] && [ -f "$REC" ]; then
  echo "== kept gate record =="
  python3 -c "
import json
r = json.load(open('$REC'))
print('pass:', r.get('pass'), ' engine:', r.get('engineVersion'), ' recordedAt:', r.get('recordedAt'))
for s in (r.get('sentences') or []): print(' ', s)
"
else
  echo "no kept record at $REC"
fi
echo "== the stored census rows =="
curl -sf --max-time 20 "$B/api/batch/$ID/rows?name=census&from=0&n=10" -o /tmp/uts-pgr.json \
  || { echo "the rows endpoint did not answer"; exit 1; }
python3 <<'PY'
import json
d = json.load(open('/tmp/uts-pgr.json'))
rows = d.get('rows') or []
print(f"total stored: {d.get('total')}  fetched: {len(rows)}")
for r in rows:
    print(f"  trade={r.get('trade')} shiftFrac={r.get('shiftFrac')} nullDealSeed={r.get('nullDealSeed')} "
          f"holdPnl={r.get('holdPnl')} holdAlwaysLong={r.get('holdAlwaysLong')} key={str(r.get('key'))[:40]}")
PY
