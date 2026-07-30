#!/usr/bin/env bash
# classifier-cycle14-both-layouts.sh -- L14: the full 17-asset search rebuilt
# on the corrected instrument, both window layouts in one job.
#
# DECLARED BEFORE THE NUMBERS EXIST (loop protocol):
#
# PURPOSE. Instrument comparison and board rebuild. L13's board came from
# 12-seat committees (half echoes, QC 49) judged on a single-era holdout.
# This run produces the board the L15 freeze consult will select from:
# 6 distinct members per committee, two window geometries per setup.
#
# READING RULE (committed now):
#  - Primary read: paired per-setup HOLDOUT money per trade between the two
#    arms, and survivor overlap between the arms' top-10s. High overlap =
#    the ranking reflects setups, not the era the eval windows landed in.
#  - The board for L15 selection is the INTERLACED arm sorted by holdout
#    money (era-spanning verdicts), with the chronological arm as context.
#  - NO candidate is retired on this run. Gates judge the instrument.
#  - Cross-arm totals are cross-population; never quote them as one number.
#  - No numeric threshold is declared because no pass/fail is claimed here;
#    selection happens at the L15 consult with per-setup + selection-aware
#    nulls on the picked survivors (declared position: both, before freeze).
#
# HELD FIXED, ON PURPOSE (search-shape rule; revisit at L16+):
#  - singles only     owner 2026-07-30: full depth on singles first
#  - trailing off     first L16 knob, one variable per run
#  - fee/grid default bit-comparable with the recorded boards
#  - seed 1           reproducibility; alternate seeds are a later
#                     robustness knob, not varied here
#  - sharedBand ON    DERIVED: this is an arm comparison, so the band must
#                     not be a second difference channel
#  - 0 scrambles      nulls run on SELECTED survivors at L15 (declared),
#                     not on all 340 units (~15h of box time for numbers
#                     nobody reads)
#
# EXPECTATION: ~340 promoted units at 6 trainings each ~= L13's 2,040
# trainings ~= 25 minutes on 4 workers. Checked on the remaining-time
# schedule, never polled short.
set -uo pipefail
B="http://127.0.0.1:8093"
bash "$(dirname "${BASH_SOURCE[0]}")/require-previous-audit.sh" || exit 1
OUT=$(curl -sS -X POST "$B/api/bracketlab" -H "Content-Type: application/json" -d '{
  "sizes": {"singles": true, "doubles": false, "triples": false},
  "allLoaded": true,
  "permute": {"geometry": true, "decision": true, "band": false, "weekdays": false},
  "set": {"band": "auto", "weekdaysOnly": false},
  "holdout": true, "trailing": false, "edgeScreen": true,
  "windowLayout": "both", "interlaceSeed": 1, "sharedBand": true,
  "minTrades": 10,
  "label": "l14-both-layouts",
  "description": "L14: full 17-asset x 5-shape x 2-decision search on the corrected 6-member instrument, chronological + interlaced arms in one job, shared band, seed 1. Board for the L15 freeze consult per the committed reading rule in classifier-cycle14-both-layouts.sh."
}')
echo "$OUT"
