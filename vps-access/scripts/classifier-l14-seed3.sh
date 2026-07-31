#!/usr/bin/env bash
# classifier-l14-seed3.sh -- seed check, run 2 of 2 (owner, 2026-07-31):
# L14's interlaced arm rerun with block-placement seed 3. Everything else
# identical to L14. The chronological arm ignores the seed, so L14's stands.
#
# READS, DECLARED BEFORE ANY NUMBER EXISTS (thresholds labeled):
#  R1 top-10 overlap of this seed's board vs L14's chronological board.
#     L14 seed 1 gave 1/10. Stays <=3/10 => the low-overlap (era-luck)
#     finding is seed-robust. [threshold GUESSED]
#  R2 aggregate held-back money across all 170 setups keeps its sign
#     (seed 1: clearly negative). [qualitative]
#  R3 ATOM daily-1d argmax: held-back money positive AND beats always-long
#     under this seed too. [derived from its shortlist status]
#  R4 top-10 overlap BETWEEN interlaced seeds. If the seeds agree with each
#     other no better than with the chronological board (<=3/10), a
#     single-seed board is mostly window-placement noise and L15 selection
#     must not come from one seed. [threshold GUESSED]
# No candidate is retired on this run; gates judge the instrument.
# Expectation: ~170 units, ~11 min.
set -uo pipefail
bash "$(dirname "${BASH_SOURCE[0]}")/require-previous-audit.sh" || exit 1
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab -H "Content-Type: application/json" -d '{
  "sizes": {"singles": true, "doubles": false, "triples": false},
  "allLoaded": true,
  "permute": {"geometry": true, "decision": true, "band": false, "weekdays": false},
  "set": {"band": "auto", "weekdaysOnly": false},
  "holdout": true, "trailing": false, "edgeScreen": true,
  "windowLayout": "interlaced", "interlaceSeed": 3, "sharedBand": true,
  "minTrades": 10,
  "label": "l14-seed3",
  "description": "Seed check 2/2: L14 interlaced arm under block seed 3, reads R1-R4 declared in classifier-l14-seed3.sh before firing."
}'
