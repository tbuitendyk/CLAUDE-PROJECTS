#!/usr/bin/env bash
# classifier-cycle1-edge-screen.sh -- CYCLE 1: does the committee predict
# anything, anywhere?
#
# This is deliberately NOT a P&L screen. Every hunt so far ranked cells by
# money, which fuses two questions that have to be asked separately: does the
# classifier predict, and does the execution monetise a prediction? A null
# result on money could always have been either. With acc/edge now recorded —
# and bestEdge picking the quorum rung by EDGE rather than by dollars — the
# first question can finally be asked on its own.
#
# 17 assets x 5 chunk shapes x both decision modes = 170 units. Holdout ON, so
# every unit reports what its edge-selected rung did on a slice no search
# touched. Trailing OFF: execution is irrelevant to this question and would
# multiply the menu 12x for nothing.
#
# READING RULE, fixed before firing:
#   * The number that counts is HOLDOUT edge at the edge-selected rung, never
#     search-window edge — the rung was chosen on the search window, so its
#     edge there is selected-for by construction and means nothing.
#   * Expect roughly half the units positive on holdout edge by chance. A
#     geometry or decision mode is interesting only if it is positive on a
#     clear majority of the 17 assets, and that is a LEAD requiring its own
#     declared test, not a result.
#   * If holdout edge is a coin flip everywhere, then no execution tuning can
#     help and the honest move is to stop tuning execution. That is a real
#     answer and worth the box time.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ZECUSDT","XLMUSDT","XRPUSDT","UNIUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","DOTUSDT",
                 "BCHUSDT","DOGEUSDT","LINKUSDT","ADAUSDT","BNBUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": true, "decision": true, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "holdout": true,
    "trailing": false,
    "promoteK": 50,
    "minTrades": 10
  }'
echo
