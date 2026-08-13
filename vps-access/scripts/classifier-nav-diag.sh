#!/usr/bin/env bash
# classifier-nav-diag.sh -- read-only: does /api/pilot carry the data the
# status-box history renders from (decisions[] with votes/side/fate)?
set -uo pipefail
curl -s --max-time 15 http://127.0.0.1:8093/api/pilot | python3 -c "
import sys, json
d = json.load(sys.stdin)
dec = d.get('decisions') or []
print('present:', d.get('present'), '| liveStatus:', bool(d.get('liveStatus')))
print('decisions:', len(dec))
for x in dec[-6:]:
    print(' ', (x.get('chunk_start') or '')[:16], 'votes=', x.get('votes'), 'side=', x.get('side'), 'fate=', (x.get('fate') or '')[:40])
"
