#!/usr/bin/env bash
# uts-books-weekdays.sh -- READ-ONLY. For every book: its Members train choice,
# the chunk shape and 24/5 of the setting it trades, and the record sets it was
# greenlit from -- so a book trading a 24/5 setting priced from members trained
# on every day (the one old set that permuted 24/5 at stage 3) can be found
# before "as trained by Construct" is asked to rebuild it (3.285.0, task #114).
# GETs through the service only; prints no keys and no account names.
set -uo pipefail
B=http://127.0.0.1:8094
curl -s --max-time 30 "$B/api/live/setups" > /tmp/uts-books.json
python3 - <<'PY'
import json, urllib.request
d = json.load(open('/tmp/uts-books.json'))
rows = d.get('setups', [])
print(f"books on the box: {len(rows)}")
for s in rows:
    sid = s.get('id')
    try:
        full = json.load(urllib.request.urlopen(f"http://127.0.0.1:8094/api/live/setups/{sid}", timeout=30))
    except Exception as e:
        print(f"{sid} | could not be read: {e}")
        continue
    cfg = full.get('configSnapshot') or {}
    br = cfg.get('branch') or {}
    src = cfg.get('source') or cfg.get('greenlight') or {}
    keys = sorted(k for k in cfg.keys())
    print(f"{sid} | {full.get('name')} | state {full.get('state')} | Members train {json.dumps(full.get('trainPolicy'))}")
    print(f"   branch: geometry {br.get('geometry')} | 24/5 {br.get('weekdaysOnly')} | decision {br.get('decision')} | band {br.get('band')}")
    for k in ('stage4Id', 'fromSet', 'setId', 'parentId', 'stage3Id', 'stage2Id', 'label', 'survivor'):
        if k in cfg: print(f"   {k}: {cfg.get(k)}")
    if isinstance(src, dict) and src:
        print(f"   source: {json.dumps({k: src.get(k) for k in list(src.keys())[:8]})[:400]}")
    c = cfg.get('construct') or {}
    if c: print(f"   construct: setId {c.get('setId')} | hoursFrom {c.get('hoursFrom')} | lost {c.get('lost')}")
    print(f"   config keys: {', '.join(keys)[:400]}")
PY
rm -f /tmp/uts-books.json
