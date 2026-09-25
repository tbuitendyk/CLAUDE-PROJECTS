#!/usr/bin/env bash
# uts-gl-list.sh -- READ-ONLY. Every greenlight on the box: its name, the
# survivor and how it was picked, the trade shape it was frozen with, the
# field gate, the frozen stop and sizing, and the channels on the Trade tab.
# GETs only.
set -uo pipefail
B=http://127.0.0.1:8094
curl -s --max-time 60 "$B/api/live/greenlights" > /tmp/uts-gl-list.json
curl -s --max-time 60 "$B/api/live/configs" > /tmp/uts-gl-configs.json
python3 - <<'PY'
import json
g = json.load(open('/tmp/uts-gl-list.json')).get('greenlights') or []
c = {x['id']: x for x in (json.load(open('/tmp/uts-gl-configs.json')).get('configs') or [])}
for x in g:
    cfg = x.get('configSnapshot') or {}
    cell = cfg.get('cell') or {}
    f = cfg.get('field') or {}
    fr = x.get('frozen') or {}
    print(f"{x.get('id')} | {x.get('createdUtc','')[:16]} | {'NUKED' if x.get('revoked') else 'live'} | {x.get('name')}")
    print(f"   set: {(x.get('sourceSet') or {}).get('name')}")
    print(f"   pick: {(x.get('pick') or {}).get('by')} | {(x.get('pick') or {}).get('label')}")
    print(f"   pair: {(cfg.get('combo') or {}).get('trade')} + {(cfg.get('combo') or {}).get('ctx1')} + {(cfg.get('combo') or {}).get('ctx2')} | {(cfg.get('branch') or {}).get('geometry')} | band {(cfg.get('branch') or {}).get('band')} | decision {(cfg.get('branch') or {}).get('decision')} | weekdaysOnly {(cfg.get('branch') or {}).get('weekdaysOnly')}")
    print(f"   cell: {json.dumps(cell)}")
    print(f"   agreement: {json.dumps(cfg.get('agreement'))}")
    print(f"   field gate: {json.dumps(f.get('gate'))} | field {f.get('id')}")
    print(f"   frozen stop: {json.dumps(fr.get('stop'))[:300]}")
    print(f"   training: {json.dumps(cfg.get('training'))[:300]}")
    cc = c.get(x.get('id')) or {}
    print(f"   Trade tab: status {cc.get('status')} | channels {json.dumps(cc.get('channels'))}")
print(f"== {len(g)} greenlight(s)")
PY
