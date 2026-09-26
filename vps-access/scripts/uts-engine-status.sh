#!/usr/bin/env bash
# uts-engine-status.sh -- READ-ONLY. The new trading engine as the web service
# sees it: each engine record, whether it answers, whether the service is
# following its record, and what it says of itself; the last runs of the
# decisions for setups on an engine. GETs only. Every engine calls this system
# over its own link (3.267.0): there is nothing of it to look at on this machine.
set -uo pipefail
B=http://127.0.0.1:8094
echo "== the engines, as this machine's service sees them =="
curl -s --max-time 30 "$B/api/live/engines" > /tmp/uts-eng.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-eng.json'))
if d.get('error'): print('error:', d['error'])
for e in d.get('engines', []):
    h = e.get('health') or {}
    l = e.get('link') or {}
    print(f"{e['id']} | {e['name']} | default {e['isDefault']} | answers {e['answers']} in {e.get('ms')} ms | release {h.get('release')} | real orders {h.get('realOrders')}")
    print(f"   following its record: {l.get('following')} since {l.get('since')} | why {l.get('why')} | lines kept {e.get('recordsKept')}")
    print(f"   plans {h.get('plans')} | feeds {h.get('feeds')} | keys {h.get('keys')}")
    print(f"   setups on it: {e.get('setups')}")
print(f"default engine: {d.get('default')}")
PY
curl -s --max-time 30 "$B/api/live/engine-produce" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"== decisions for setups on an engine: running {d.get('running')} | last runs: {len(d.get('runs') or [])} ==\")
for r in (d.get('runs') or [])[-5:]:
    print('  ', json.dumps(r)[:700])
"
rm -f /tmp/uts-eng.json
