#!/usr/bin/env bash
# classifier-nav-diag.sh -- read-only: compact stop-sweep summary (server-side
# field selection so big curves never truncate in transit).
set -uo pipefail
curl -s --max-time 10 http://127.0.0.1:8093/api/pilot/stopsweep | python3 -c "
import json, sys
s = json.load(sys.stdin)
print('status:', s.get('status'), '| book:', s.get('bookId'), '| clip:', s.get('clipUsd'))
print('tightest no-winner-lost stop:', s.get('stopPct'))
print('counts:', s.get('counts'))
print('binding:', s.get('binding'))
fh = s.get('fullHistory') or {}
print('span:', str(fh.get('firstChunkUtc'))[:10], '->', str(fh.get('lastChunkUtc'))[:10], '| chunks:', fh.get('chunks'))
for r in (s.get('curve') or []):
    print('  sacrifice %2d: stop %.4f  cut %dW/%dL  winner\$ %-8.2f loss\$ %-8.2f NET\$ %.2f' % (
        r.get('sacrificeTopWinners',0), r.get('stopPct') or 0, r.get('winnersForfeited',0),
        r.get('losersCut',0), r.get('winnerProfitForfeitedUsd') or 0, r.get('loserPnlDeltaUsd') or 0, r.get('netPnlDeltaUsd') or 0))
"
