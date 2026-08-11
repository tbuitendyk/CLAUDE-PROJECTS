#!/usr/bin/env bash
# pilot-stopsweep-verify.sh -- READ-ONLY: run the F1 protective-stop tune in the
# deployed classifier over full history and PRINT the result. Persists nothing and
# touches neither stop-sweep.json nor the live engine — it only proves the heavy
# integration path (buildCombo -> frozen committee -> tuner) works on real data
# before the owner drives it from the bracket-lab control.
set -uo pipefail
APP=/opt/general-classifier
cd "$APP" || { echo "no $APP"; exit 1; }
node -e '
const { BOOKS } = require("./lib/forwardbook");
const { computeSetupStop } = require("./lib/stopsweep");
const F1 = BOOKS.find((b) => b.id === "F1");
(async () => {
  const t0 = Date.now();
  const r = await computeSetupStop(F1, {});
  const pct = (v) => (v == null ? "n/a" : (v * 100).toFixed(3) + "%");
  // winner MAEs, deepest first: shows whether ONE outlier is forcing the stop, and
  // how much tighter the stop would be if the k deepest winners were sacrificed.
  console.log("STOP_VERIFY_OK " + JSON.stringify({
    stopPct: r.stopPct,
    stopPctHuman: pct(r.stopPct),
    clipUsd: r.clipUsd,
    counts: r.counts,
    binding: r.binding ? { side: r.binding.side, maeHuman: pct(r.binding.mae) } : null,
    fullHistory: r.fullHistory,
    curve: (r.curve || []).map((c) => ({
      giveUp: c.sacrificeTopWinners, stop: pct(c.stopPct),
      winnersCut: c.winnersForfeited, winnerProfitGivenUp: c.winnerProfitForfeitedUsd,
      losersCut: c.losersCut, loserSaved: c.loserPnlDeltaUsd, net: c.netPnlDeltaUsd,
    })),
    elapsedMs: Date.now() - t0,
  }));
})().catch((e) => { console.error("STOP_VERIFY_FAIL " + (e && e.stack || e)); process.exit(1); });
'
