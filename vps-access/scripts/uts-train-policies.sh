#!/usr/bin/env bash
# uts-train-policies.sh -- READ-ONLY. Every book's Members train choice, and
# whether it still carries the old training date inside its frozen
# configuration: the fallback lib/live/trainpolicy.js resolveFreeze reads for a
# book with no choice (task #113, 2026-09-27). GETs through the service only;
# prints no keys and no account names. Nothing written, nothing started.
set -uo pipefail
B=http://127.0.0.1:8094
curl -s --max-time 30 "$B/api/live/setups" > /tmp/uts-setups.json
python3 - <<'PY'
import json, urllib.request
d = json.load(open('/tmp/uts-setups.json'))
rows = d.get('setups', [])
print(f"books on the box: {len(rows)}")
leaning = 0
for s in rows:
    sid = s.get('id')
    try:
        full = json.load(urllib.request.urlopen(f"http://127.0.0.1:8094/api/live/setups/{sid}", timeout=30))
    except Exception as e:
        print(f"{sid} | could not be read: {e}")
        continue
    tp = full.get('trainPolicy')
    old = (full.get('configSnapshot') or {}).get('trainThrough')
    uses = (not tp) and isinstance(old, int) and old > 0
    if uses:
        leaning += 1
    print(f"{sid} | {full.get('name')} | state {full.get('state')} | channel {full.get('channel')} | Members train {json.dumps(tp)} | old date {old} | uses the fallback: {'YES' if uses else 'no'}")
print(f"books that use the fallback: {leaning}")
PY
