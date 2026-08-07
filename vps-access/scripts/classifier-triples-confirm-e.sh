#!/usr/bin/env bash
# classifier-triples-confirm-e.sh -- RUN E: third measurement of the same
# candidate, on engine 1.43.0 (QC 81 committee-preserving null). Identical to
# runs C and D in every respect except the null construction. One variable.
#
# WHY AGAIN: run D's pass was measured against a control the real arm
# out-participated — real traded 310 of 364 held-back periods while all 19
# draws traded 255-296, because dealing members independently broke up their
# agreement and the committee only trades when its members are not tied. The
# 1.43.0 null permutes every member by the SAME order, so the null arm now
# makes exactly the same number of up/down/aside calls as the real arm and
# differs only in WHEN it makes them.
#
# READING RULE, stamped before launch (unchanged): R1 — the LTC-led triple's
# declared-cell HOLD skill must beat ALL 19 draws (p-floor 0.05). Raw money
# printed beside skill.
# EXPECTATION, on the record: genuinely uncertain this time. The participation
# advantage that inflated the real arm is gone, which argues for a FAIL; but
# my last stated expectation (run D) was WRONG in the same direction, so it is
# recorded as uncertain rather than dressed up as a prediction.
# INSTRUMENT CHECK built into the read: null trade counts must now bracket the
# real arm's 310 instead of sitting entirely below it. If they do not, 1.43.0
# did not do what it claims and the verdict is void regardless of which way
# it falls.
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
    "label": "triples-confirm-e-ltc-joint-null"
  }'
echo
