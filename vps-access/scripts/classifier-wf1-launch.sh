#!/usr/bin/env bash
# classifier-wf1-launch.sh -- WF1: the first real walk-forward sweep.
# 17 coins x 4 daily shapes x 2 decision rules = 136 setups, engine 1.27.0.
#
# WHAT THIS RUN IS FOR. The walk-forward instrument replaces single-draw
# holdout verdicts (QC 57): each setup is scored as a DISTRIBUTION over
# ~25-30 held-out 8-week slices tiling its whole history, with the
# assembly (agreement level x execution cell) re-picked fresh each fold.
# WF1's job is a map: where, if anywhere, does re-picked machinery keep
# beating its own drift control across eras — and each member's per-slice
# held-back edge (memberHoldEdges) is banked as raw material for the
# per-coin calibration ledger. WF1 selects nothing tradeable.
#
# PRECONDITIONS (all hard):
#   - planted calibration on THIS engine version passed every declared
#     criterion (QC 56: tests prove it runs; only a known answer proves
#     it measures);
#   - the one-unit smoke ran end to end;
#   - the previous completed job is audited (gate below).
#
# READING RULES — declared before any number exists. Committed with this
# launcher; the read script prints them back beside the numbers.
#   R1 per-setup description (DERIVED thresholds — zero is the no-skill
#      point for money; half is the no-skill point for fold wins):
#      "supported" = median fold holdout $ > 0 AND positive folds > half.
#      A miss RETIRES NOTHING (gates judge the instrument; only
#      replication judges candidates).
#   R2 skill-vs-drift (DERIVED control, valid under contiguous slices,
#      QC 54): holdout total minus always-long total must be > 0 for a
#      setup to be called anything better than "rode the market".
#   R3 concentration (QC 36/47): a coin's 8 setups are re-cuts of the
#      same days — ONE evidence unit, not eight. No cross-setup total is
#      quoted without the per-coin breakdown beside it.
#   R4 thin-setup floor (GUESSED, revisit at the WF1 audit): fewer than
#      10 scored folds -> the setup is listed as "thin", unranked.
#   R5 what counts as a direction (not a finding): a coin where adjacent
#      geometries AND both decision rules agree on positive median
#      holdout. That nominates the next ONE-VARIABLE drill; nothing in
#      WF1 is a candidate until it replicates out of this instrument.
#
# VARIABLES HELD FIXED ON PURPOSE (QC 42 — named, dated, with a reason):
#   - committee size 1 only (6 members). Contexts double compute and
#     confound the first read; H1a's durability numbers are singles.
#     Revisit: at the WF1 audit.
#   - execution menu = engine defaults, trailing stops absent (as in
#     every bracket-lab default run). Revisit: with the calibration
#     ledger work.
#   - feePerLeg 0.125 (the real-fee constant), passed EXPLICITLY because
#     of QC 43, not inherited silently.
#   - minTradesSlice 5 (GUESSED floor per 8-week slice, carried from the
#     design doc). Revisit: at the WF1 audit.
#
# EXPECTATION (loop step 4): ~136 units at minutes-per-unit with the
# worker pool -> expected 6-12 hours. Checked on the job cadence (first
# check no sooner than half the low estimate), never the mail cadence.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/require-previous-audit.sh"
B="http://127.0.0.1:8093"
BODY='{
  "universe": ["ETHUSDT","BNBUSDT","XRPUSDT","ADAUSDT","SOLUSDT","DOGEUSDT",
               "LTCUSDT","LINKUSDT","DOTUSDT","AVAXUSDT","TRXUSDT","XLMUSDT",
               "ETCUSDT","ATOMUSDT","BCHUSDT","UNIUSDT","ZECUSDT"],
  "permute": { "geometry": true, "decision": true },
  "minTradesSlice": 5,
  "feePerLeg": 0.125,
  "label": "wf1",
  "description": "WF1: first walk-forward map, 17 coins x 4 daily shapes x 2 decisions, engine 1.27.0; reading rules R1-R5 in classifier-wf1-launch.sh"
}'
echo "firing WF1 (136 units)..."
curl -sS --max-time 30 -X POST "$B/api/walkforward" \
  -H 'Content-Type: application/json' -d "$BODY"
echo
