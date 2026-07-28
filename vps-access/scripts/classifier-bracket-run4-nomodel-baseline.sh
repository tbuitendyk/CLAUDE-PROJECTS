#!/usr/bin/env bash
# classifier-bracket-run4-nomodel-baseline.sh -- Run 4: the MODEL-FREE
# baseline. Identical to Run 3 in every respect except the gate.
#
#     Run 3   active gate, d1.0x, t161h, quorum 25%   -> 6/17 positive dollars
#     Run 4   ALWAYS gate, d1.0x, t161h               -> ?
#
# Run 3 lost to its control on 16 of 17 assets, and backing the control out of
# those rows put the model-free bracket in profit on 14 of 17. That control is
# the BEST of 35 always-cells picked per asset in-sample, so 14/17 is a
# search-inflated number and cannot be quoted. This run replaces it with ONE
# always-cell declared in advance -- the same distance and horizon Run 3 used,
# so the pair is a clean single-variable comparison: classifier on, classifier
# off, everything else held.
#
# DECLARED READING RULE, fixed before firing. This is a diagnostic baseline,
# not a candidate hunt, and nothing here earns a paper book on its own:
#   * dollars positive on >=12 of 17  -> the bracket mechanic itself carries
#     the edge and the classifier layer is subtracting from it. That reframes
#     the whole hunt and needs its own null before anything else happens.
#   * 8 to 11                          -> coin flip; the 14/17 was search
#     inflation and the mechanic has nothing either.
#   * <8                               -> neither layer has anything on this
#     geometry; the search boards were reading drift end to end.
# Declared AFTER seeing Run 3 -- disclosed, because that is what the timing
# was, and the reading rule above is what makes the look honest.
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
    "declared": {"gate": "always", "dMult": 1.0, "tHours": 161, "quorumRatio": 0.25},
    "promoteK": 25,
    "minTrades": 10
  }'
echo
