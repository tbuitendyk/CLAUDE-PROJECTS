#!/usr/bin/env bash
# classifier-bracket-market-smoke.sh -- end-to-end proof that the bracket lab
# can now run the GENERAL CLASSIFIER'S OWN TRADE: market entry at the open in
# the called direction, no rails, exit at t.
#
# Small on purpose (3 assets, one branch) — this verifies the plumbing, not a
# hypothesis. It exercises the three things that did not exist before:
#   * a declared MARKET cell being found by matchesDeclared (dMult is null
#     there, which the old equality check would never have matched);
#   * classification metrics on the replication rows;
#   * per-period call export.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["DOTUSDT","XLMUSDT","ZECUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "directional", "band": "auto", "weekdaysOnly": false},
    "declared": {"entry": "market", "tHours": 65, "quorumRatio": 0.3333},
    "emitCalls": true,
    "promoteK": 25,
    "minTrades": 10
  }'
echo
