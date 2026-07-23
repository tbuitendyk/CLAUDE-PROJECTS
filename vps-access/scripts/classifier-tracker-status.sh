#!/usr/bin/env bash
# classifier-tracker-status.sh -- compact live-tracker state: initialized or
# not (from the on-disk state file, which only exists once init's training
# phase has completed), plus per-pair week/book counts via the local API.
set -euo pipefail
STATE=/opt/general-classifier/data/tracker/state.json
if [[ -f "$STATE" ]]; then
  echo "state.json: present ($(stat -c%s "$STATE") bytes)"
else
  echo "state.json: absent (tracker not initialized, or init still training)"
fi
curl -sS http://127.0.0.1:8093/api/tracker | python3 -c "
import json, sys
t = json.load(sys.stdin)
if not t.get('initialized'):
    print('api: initialized=false')
    raise SystemExit
print(f\"api: initialized=true createdAt={t['createdAt']}\")
for pair, p in t['pairs'].items():
    weeks = p['weeks']
    live = sum(1 for w in weeks if w.get('live'))
    vb = p['books']['vote']
    print(f\"{pair}: band ±{p['bandPct']:.2f}% weeks={len(weeks)} (live={live}) votePnl={vb['pnl']:+.2f} trades={vb['trades']} wins={vb['wins']}\")
"
