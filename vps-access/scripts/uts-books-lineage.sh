#!/usr/bin/env bash
# uts-books-lineage.sh -- READ-ONLY. Which record sets each greenlight and each
# book comes from, walked up the chain to the stage 3 set, so a delete asked for
# on one set can say what it would take away from a book (2026-09-28, before
# S3 #1b's deletion: it is the parent of 15 Stage 4 sets). GETs only; prints no
# keys and no account names.
set -uo pipefail
B=http://127.0.0.1:8094
curl -s --max-time 60 "$B/api/live/greenlights" > /tmp/uts-l-gl.json
curl -s --max-time 60 "$B/api/live/setups" > /tmp/uts-l-su.json
curl -s --max-time 60 "$B/api/stagesets" > /tmp/uts-l-sets.json
python3 - <<'PY'
import json, urllib.request
g = json.load(open('/tmp/uts-l-gl.json')).get('greenlights') or []
d = json.load(open('/tmp/uts-l-sets.json'))
sets = {x.get('id'): x for x in (d if isinstance(d, list) else d.get('sets', [])) if isinstance(x, dict) and x.get('id')}
def chain(sid):
    out = []
    while sid and sid in sets and len(out) < 8:
        x = sets[sid]; out.append(f"{x.get('id')} ({x.get('name')})"); sid = (x.get('parent') or {}).get('id')
    if sid and sid not in sets: out.append(f"{sid} (not on the box)")
    return out
print(f"greenlights: {len(g)}")
for x in g:
    src = x.get('sourceSet') or {}
    print(f"{x.get('id')} | {'NUKED' if x.get('revoked') else 'live'} | {x.get('name')}")
    print(f"   from: {' <- '.join(chain(src.get('id'))) or json.dumps(src)[:200]}")
su = json.load(open('/tmp/uts-l-su.json')).get('setups') or []
print(f"books: {len(su)}")
for s in su:
    full = json.load(urllib.request.urlopen(f"http://127.0.0.1:8094/api/live/setups/{s['id']}", timeout=30))
    keys = [k for k in full.keys() if 'green' in k.lower() or 'config' in k.lower() or 'source' in k.lower()]
    print(f"{s['id']} | {full.get('name')} | state {full.get('state')} | {', '.join(f'{k}={json.dumps(full.get(k))[:120]}' for k in keys if k != 'configSnapshot')}")
PY
rm -f /tmp/uts-l-gl.json /tmp/uts-l-su.json /tmp/uts-l-sets.json
