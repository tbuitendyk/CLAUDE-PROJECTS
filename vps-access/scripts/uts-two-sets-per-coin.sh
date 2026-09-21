#!/usr/bin/env bash
# uts-two-sets-per-coin.sh -- READ-ONLY. Two named stage 3 sets side by side,
# per coin: the best record of each by beat the kept null money, and every
# plateau share at the control's best share. Reads the stores and the agreed
# answers; writes nothing, starts nothing.
#   arg: best+<withId>+<controlId>  |  like+<withId>+<controlId>
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-two-sets-per-coin.js" /tmp/uts-two-sets-per-coin.js
node --max-old-space-size=600 /tmp/uts-two-sets-per-coin.js "${1:-}"
