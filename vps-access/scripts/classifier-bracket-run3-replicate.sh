#!/usr/bin/env bash
# classifier-bracket-run3-replicate.sh -- Run 3: replicate ONE declared
# execution config across all 17 single assets.
#
# The config was derived MECHANICALLY from the FINISHED bracketlab-20260728-0804
# doubles board (classifier-bracketlab-top.sh's recurrence tally). Rule, fixed
# before reading: take each knob's modal value counted over DISTINCT trade
# assets, break ties on row count.
#
#     gate    active  2 assets / 32 rows   (the only gate that ever won)
#     tHours  161h    2 assets / 23 rows
#     dMult   1.0x    2 assets / 11 rows   (ties 1.5x on assets, wins on rows)
#     quorum  25%     NO MODE -- see below
#
# The quorum tally is a four-way tie (3/16, 6/16, 8/16, 12/16 all at 2 assets
# / 3 rows), i.e. the rung carries no signal, which is itself consistent with
# every earlier finding that committee diversity does not move the weights.
# 25% is therefore the one knob here NOT derived from the board: it is the
# ratio the slim stage's winning rung corresponds to (1 of 4) and the lowest
# bar in the menu. That is the weak link in this declaration and it is on the
# record as such.
#
# Branch is the one every top row shared: daily-3d, auto band, argmax, 24/7.
# 17 assets x 1 branch = 17 units, one look apiece, so the read is a plain
# binomial with no search tax to subtract.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ZECUSDT","XLMUSDT","XRPUSDT","UNIUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","DOTUSDT",
                 "BCHUSDT","DOGEUSDT","LINKUSDT","ADAUSDT","BNBUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "declared": {"gate": "active", "dMult": 1.0, "tHours": 161, "quorumRatio": 0.25},
    "promoteK": 25,
    "minTrades": 10
  }'
echo
