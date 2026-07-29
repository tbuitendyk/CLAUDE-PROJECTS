#!/usr/bin/env bash
# classifier-cycle10-walkforward.sh -- does the edge survive in a DIFFERENT
# stretch of history?
#
# WHY THIS AND NOT LIVE MONEY. Cycle 9 showed the edge beats noise after fees
# on every money statistic, 19/19. But every one of those 19 scrambles was
# drawn from the SAME ~4.5-month held-back window. A null answers "better than
# noise in this period". It cannot answer "holds in another period", because
# the noise shares the period. If that window happened to suit this strategy,
# nothing inside cycle 9 could reveal it.
#
# So: the identical test, with the data ending 2025-06 instead of running to
# the present. The held-back slice therefore falls on an entirely different
# stretch of market history, and none of it overlaps cycle 9's window.
#
# Both arms ride in ONE job now (the r=0 real arm shipped today), so the real
# census and its 19 scrambles share one build, one data range and one moment.
# That is the fault that cost cycle 8 its comparison, now impossible.
#
# READING RULE, fixed before firing:
#   * real beats all 19 -> the edge is not a property of one period. That is
#     the first result worth taking toward execution costs on a real venue.
#   * beats 18 of 19    -> weaker in this window. Report, do not act.
#   * anything weaker   -> cycle 9's result was period-specific. The edge does
#     not generalise, and that is the answer, not a prompt to try more windows
#     until one works.
#   Sanity retained: the scrambles must LOSE money.
#
# EXPECTATION, recorded before the numbers exist: cycle 9's margin was wide
# ($1,089 over the luckiest scramble) so I expect direction to survive. What
# I doubt is the SIZE — 86% of the gross edge went to fees, and a different
# period with different volatility could easily push net through zero.
#
# NO LIVE MONEY follows from this run whatever it says. Even a clean pass
# leaves 16% headroom over ASSUMED costs; the next question after this is
# execution cost measured on the venue, not assumed in a simulator.
#
# 19 scrambles + 1 real arm x 170 units = 3400 units, ~5 hours.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/require-previous-audit.sh"

curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ZECUSDT","XLMUSDT","XRPUSDT","UNIUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","DOTUSDT",
                 "BCHUSDT","DOGEUSDT","LINKUSDT","ADAUSDT","BNBUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": false,
    "startMonth": "2018-01",
    "endMonth": "2025-06",
    "permute": {"geometry": true, "decision": true, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "holdout": true,
    "trailing": false,
    "edgeScreen": true,
    "labelShiftFrac": 0.5,
    "labelShiftReps": 19,
    "labelShiftScope": "window",
    "promoteK": 50,
    "minTrades": 10,
    "label": "L10 walkforward 2025-06",
    "description": "Does the edge survive in a DIFFERENT stretch of history? Cycle 9 showed it beats noise after fees 19/19, but all 19 scrambles came from the same ~4.5-month held-back window, so they cannot test whether that window was special. This is the identical test with data ending 2025-06, putting the held-back slice on a non-overlapping period. Both arms ride in one job (the r=0 real arm shipped today), so they share one build and one data range. Rule fixed before firing: beats all 19 = the edge is not period-specific and execution cost on a real venue becomes the next question; 18 of 19 = weaker, report but do not act; weaker = cycle 9 was period-specific and the edge does not generalise. NO LIVE MONEY follows from this run whatever it says — even a clean pass leaves only 16% headroom over ASSUMED trading costs, and 86% of the gross edge already goes to fees."
  }'
echo
