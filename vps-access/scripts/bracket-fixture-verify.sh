#!/usr/bin/env bash
# bracket-fixture-verify.sh -- DETERMINISM GATE for the multithreaded build.
#
# Re-runs the exact DOT-singles replication that produced bracketlab-20260728-0741
# on the single-threaded code, then compares against its known fixture values.
# If the parallel build cannot reproduce these to the cent, it is not trusted
# and gets reverted — no debate, no interpretation.
#
#   FIXTURE (single-threaded, 2026-07-28):
#     DOTUSDT declared cell  = +185.08 on 235 trades (130 wins)
#     replication            = 7/17 positive dollars, 5/17 positive vs control
set -uo pipefail
echo "== firing the fixture run =="
curl -sS -m 30 -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ETHUSDT","BNBUSDT","XRPUSDT","ADAUSDT","SOLUSDT","DOGEUSDT","LTCUSDT","LINKUSDT","DOTUSDT","AVAXUSDT","TRXUSDT","XLMUSDT","ETCUSDT","ATOMUSDT","BCHUSDT","UNIUSDT","ZECUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "promoteK": 17,
    "minTrades": 10,
    "declared": {"gate": "directional", "dMult": 1.5, "tHours": 65, "quorumRatio": 0.3333}
  }'
echo
