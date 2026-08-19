#!/usr/bin/env bash
# live-tick-now.sh -- READ-NOTHING-BACK manual run of the hourly tick: refresh
# the candles each trading profile needs, recompute its recent decisions against
# that fresh data, then produce and push its intents. Same script the timer runs,
# so what you see here is what happens on the hour.
#
# Replaces the old per-config tick runner, which ran a script that only ever
# served one hardcoded book. The coverage report below follows the PROFILES —
# it asks the registry which pairs are being traded rather than naming three.
set -uo pipefail
APP=/opt/general-classifier
echo "== running live-tick.sh =="
timeout 300 /usr/local/sbin/live-tick.sh 2>&1 | tail -40

echo "== data coverage after refresh (pairs the live profiles actually trade) =="
PAIRS=$(cd "$APP" && node -e '
try {
  const s = require("./lib/live/setups");
  const want = new Set();
  for (const x of s.listSetups()) {
    if (["paper", "live", "stopped"].includes(x.state)) {
      if (x.tradedPair) want.add(x.tradedPair);
      for (const m of (x.configSnapshot && x.configSnapshot.members) || []) if (m.symbol) want.add(m.symbol);
    }
  }
  console.log([...want].join(" "));
} catch (e) { console.log(""); }
' 2>/dev/null)
if [ -z "${PAIRS// }" ]; then
  echo "  (no profile is in paper/live/stopped, so nothing needs refreshing)"
else
  for s in $PAIRS; do
    latest=$(ls -1 "$APP"/data/cache/${s}-1h-*.json 2>/dev/null | sort | tail -1)
    echo "  $s newest day-file: $(basename "${latest:-none}")"
  done
fi
