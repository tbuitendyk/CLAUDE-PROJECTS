#!/usr/bin/env bash
# classifier-triples-confirm-d.sh -- RUN D: re-measure the withdrawn LTC pass
# on the CORRECTED null (engine 1.42.0, QC 80 per-slice deals). Byte-for-byte
# the same job as run C — same universe, same declared cell, same layout, same
# 19 seeds — so the ONLY thing that differs is the null construction. One
# variable, per the owner's rule.
#
# READING RULE, stamped before launch (unchanged from run C):
#  R1: the LTC-led triple's declared-cell HOLD skill must beat ALL 19 draws
#      (p-floor 1/20 = 0.05, DERIVED from draw count). Raw money printed
#      beside skill.
#  EXPECTATION, on the record before the numbers exist: the candidate FAILS.
#      The fix removes the directional-lean credit that plausibly produced the
#      whole +$670.85 margin, and run C's own sibling arms (z +3.30 / -4.04)
#      say the old null was under-dispersed.
#  If it FAILS: the lead is PARKED, not retired (no candidate dies on one
#      measurement), and the chain from the 20,400-unit discovery board has
#      produced nothing tradeable.
#  If it PASSES: the money objections still block promotion — $13.03 net on
#      310 trades, break-even fee $0.1460/leg against $0.125 charged, and
#      always-short made $478.32 on the same window. A pass would buy a fresh
#      PERIOD test, nothing more.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["LTCUSDT","XRPUSDT","BCHUSDT"],
    "sizes": {"singles": false, "doubles": false, "triples": true},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-4d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "declared": {"entry": "market", "tHours": 161, "quorumContexts": 1},
    "windowLayout": "split70",
    "labelShiftReps": 19,
    "promoteK": 50,
    "minTrades": 10,
    "label": "triples-confirm-d-ltc-corrected-null"
  }'
echo
