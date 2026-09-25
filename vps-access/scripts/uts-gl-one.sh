#!/usr/bin/env bash
# uts-gl-one.sh <set id> -- READ-ONLY. One held or reserve set as Greenlight
# reads it: the verdict it stands on, whether it is refused and why, the
# survivor by depth, and what the live executor does not do yet for it. GET only.
set -uo pipefail
ID=${1:?usage: uts-gl-one.sh <set id>}
case "$ID" in s4-*) ;; *) echo "not a Stage 4 set id"; exit 1;; esac
curl -s --max-time 280 "http://127.0.0.1:8094/api/live/greenlight/stage4/$ID" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('error'): print('error:', d['error']); sys.exit(0)
dp = d.get('depthPick') or {}
print(f\"{d.get('id')} | {d.get('kind')} | {d.get('name')}\")
print(f\"   verdict: {'PASS' if (d.get('block') or {}).get('pass') else 'no pass'} | stands: {d.get('standing') or 'yes'}\")
print(f\"   refused: {d.get('refused')}\")
print(f\"   by depth: {dp.get('label')}\")
print(f\"   not yet startable: {d.get('notYet')}\")
print(f\"   survivors: {len(d.get('survivors') or [])}\")
"
