#!/usr/bin/env bash
# classifier-bracket-run4-doubles-declared.sh -- Run 4: the SAME declared
# config as Run 3, scored on all 272 doubles.
#
# Run 3 (singles) and Run 4 (doubles) together are what actually answer the
# owner's first declared question -- "which doubles show a positive vs-control
# that the singles did not" -- because both sides now use a cell fixed before
# the run instead of the winner of a search.
#
# Replication mode promotes EVERY unit (batch.js promotionSet), so all 272
# declared cells are read, not a P&L-ranked subset. Expect a long job.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ZECUSDT","XLMUSDT","XRPUSDT","UNIUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","DOTUSDT",
                 "BCHUSDT","DOGEUSDT","LINKUSDT","ADAUSDT","BNBUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT"],
    "sizes": {"singles": false, "doubles": true, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "declared": {"gate": "active", "dMult": 1.0, "tHours": 161, "quorumRatio": 0.25},
    "promoteK": 50,
    "minTrades": 10
  }'
echo
