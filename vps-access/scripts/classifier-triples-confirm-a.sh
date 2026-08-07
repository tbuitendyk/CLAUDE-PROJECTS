#!/usr/bin/env bash
# classifier-triples-confirm-a.sh -- CONFIRM run A for the 193433 discovery
# prospects (fired 2026-08-07, owner's word: "fire what you think is best").
#
# ORIGIN (labelled): both candidates come off discovery board
# bracketlab-20260805-193433-real -- a 20,400-unit wide pass, winner-
# selected, so every number it printed is inflated by selection. This run
# is the narrow phase: fair 70/15/15 structure, one declared cell, nulls.
#
# RUN A candidate: LTCUSDT+XRPUSDT+BCHUSDT on daily-4d argmax.
# (RUN B, fired only after A's audit: DOGEUSDT+ADAUSDT+DOTUSDT daily-3d
# directional -- same declared cell, its own launcher.)
#
# DECLARED CELL (one per run, no execution shopping): market entry
# (directional gate, no rails by construction), tHours 161,
# quorumContexts 1 (1-of-8) -- the shape of BOTH candidates' promoted
# discovery rows. FIXED ON PURPOSE, revisit after both runs read:
# quorum+tHours (matches both promoted rows; the stronger LTC slim row
# was q1/4 t137h and is deliberately NOT chased -- that would be
# re-shopping the menu); universe fixed to the 6 prospect coins; fee at
# engine default.
#
# READING RULES, stamped before launch:
#  R1 (the verdict): the named triple's declared cell on the HOLD window
#     must beat the same cell in ALL 9 null draws (rank test, p-floor
#     1/10 -- DERIVED from draw count). Passing = the direction survives
#     fair structure; it is still one measurement, not a result.
#  R2 (breadth, context only): triples with positive hold vsCtl among
#     all 60, real vs each null draw's count. Direction check only; no
#     threshold is declared because any would be GUESSED.
#  R3 (no rescue, no burial): failing R1 does NOT retire the candidate
#     (one measurement never does); passing R1 does NOT promote it past
#     "survived once -- replicate before anything real".
#  R4 (instrument): thin cells print as thin (minTrades 10), never as
#     zero-skill; the audit quotes draw counts beside every number.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["LTCUSDT","XRPUSDT","BCHUSDT","DOGEUSDT","ADAUSDT","DOTUSDT"],
    "sizes": {"singles": false, "doubles": false, "triples": true},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-4d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "declared": {"entry": "market", "tHours": 161, "quorumContexts": 1},
    "windowLayout": "split70",
    "labelShiftReps": 9,
    "promoteK": 50,
    "minTrades": 10,
    "label": "triples-confirm-a-ltc-xrp-bch"
  }'
echo
