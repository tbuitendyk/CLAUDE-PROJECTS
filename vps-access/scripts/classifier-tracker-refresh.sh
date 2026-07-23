#!/usr/bin/env bash
# classifier-tracker-refresh.sh -- trigger the tracker's on-demand price
# refresh (fills pending entry prices, updates floating market price), then
# print the pending/settled week lines so the result is visible.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/tracker/refresh | python3 -c "
import json, sys
t = json.load(sys.stdin)
if not t.get('initialized'):
    print('tracker not initialized')
    raise SystemExit
for pair, p in t['pairs'].items():
    lp = p.get('lastPrice')
    print(f\"{pair}: lastPrice={lp['price']} (as of {lp['at']})\" if lp else f'{pair}: no lastPrice yet')
    for w in p['weeks']:
        print(f\"  {w['weekOf']} vote={w['vote']} status={w['status']} entry={w['entry']} exit={w['exit']} pnl={(w['pnl'] or {}).get('vote')}\")
"
