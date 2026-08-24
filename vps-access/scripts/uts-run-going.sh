#!/usr/bin/env bash
# uts-run-going.sh -- READ-ONLY. Is a sweep going right now? Asked before any
# deploy, because a deploy restarts the trading service and a run that was going
# is marked as stopped by it. Changes nothing.
set -uo pipefail
curl -sf --max-time 20 http://127.0.0.1:8094/api/batches -o /tmp/uts-batches.json \
  || { echo "the trading service did not answer, so this cannot say"; exit 1; }
python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-batches.json'))
r = d.get('running')
print('A RUN IS GOING RIGHT NOW:' if r else 'nothing is going right now')
if r:
    print(' ', r if isinstance(r, str) else json.dumps(r)[:300])
rows = d.get('batches') or []
print(f'{len(rows)} run(s) recorded')
for b in rows[:5]:
    print(f"  {b.get('id')}  {b.get('status')}  {str(b.get('progress'))[:70]}")
PY
