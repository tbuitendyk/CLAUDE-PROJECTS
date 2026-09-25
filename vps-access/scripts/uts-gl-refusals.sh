#!/usr/bin/env bash
# uts-gl-refusals.sh -- READ-ONLY. Every held and reserve set on the box, as
# Greenlight reads it: the verdict it stands on, why it is refused (if it is),
# and the survivor by depth with the shape it was priced in. GETs only.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
for f in $(sudo ls $D | grep -E '^s4-.*\.json$' | grep -v -- '-tunescans'); do
  id=${f%.json}
  kind=$(sudo python3 -c "import json;d=json.load(open('$D/$f'));print(d.get('kind') or 'funnel')" 2>/dev/null)
  [ "$kind" = "held" ] || [ "$kind" = "reserve" ] || continue
  curl -s --max-time 120 "http://127.0.0.1:8094/api/live/greenlight/stage4/$id" | python3 -c "
import sys, json
d = json.load(sys.stdin)
dp = d.get('depthPick') or {}
sv = next((x for x in (d.get('survivors') or []) if x.get('label') == dp.get('label')), {})
print(f\"{d.get('id')} | {d.get('kind')} | {d.get('name')}\")
print(f\"   verdict: {'PASS' if (d.get('block') or {}).get('pass') else 'no pass'} | stands: {d.get('standing') or 'yes'}\")
print(f\"   refused: {d.get('refused')}\")
print(f\"   by depth: {dp.get('label')}\")
"
done
echo '== done'
