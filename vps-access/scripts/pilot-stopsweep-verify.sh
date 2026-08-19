#!/usr/bin/env bash
# pilot-stopsweep-verify.sh -- READ-ONLY: run the protective-stop tune in the
# deployed classifier over full history and PRINT the result. Persists nothing and
# touches neither stop-sweep.json nor the live engine — it only proves the heavy
# integration path (buildCombo -> frozen committee -> tuner) works on real data
# before the owner drives it from the bracket-lab control.
#
# IT SCANS A PROFILE NOW (2026-08-19). It used to read the hardcoded BOOKS array,
# so the number it printed described a pre-registered research book rather than
# anything the owner runs. It takes a setup id and scans THAT profile against
# THAT profile's own training cutoff; with no argument it scans the live one.
#
# Persists nothing and touches neither the stop in force nor the engine. The
# owner chooses a value from the Constructing screen; this only shows the answer.
set -uo pipefail
APP=/opt/general-classifier
cd "$APP" || { echo "no $APP"; exit 1; }
SID="${1:-}"
SID="$SID" node -e '
const { computeSetupStop } = require("./lib/stopsweep");
const reg = require("./lib/live/setups");
const { resolveFreeze } = require("./lib/live/trainpolicy");
(async () => {
  const want = process.env.SID
    || (reg.listSetups().find((s) => s.state === "live")
        || reg.listSetups().find((s) => ["paper", "stopped"].includes(s.state)) || {}).id;
  if (!want) { console.log("no profile to scan"); return; }
  const s = reg.getSetup(want);
  if (!s) { console.log("no such profile " + want); return; }
  const cfg = s.configSnapshot || {};
  const freeze = resolveFreeze(s);
  console.log("scanning " + s.id + " (" + (s.name || "unnamed") + "), "
    + s.state + ", trained through " + new Date(freeze.throughMs).toISOString().slice(0, 10)
    + " [" + freeze.mode + "]");
  const book = { id: s.id, combo: cfg.combo, branch: cfg.branch, members: cfg.members, cell: cfg.cell };
  const t0 = Date.now();
  const r = await computeSetupStop(book, { trainThrough: freeze.throughMs, scoreFrom: freeze.throughMs + 1 });
  const pct = (v) => (v == null ? "n/a" : (v * 100).toFixed(3) + "%");
  // winner MAEs, deepest first: shows whether ONE outlier is forcing the stop, and
  // how much tighter the stop would be if the k deepest winners were sacrificed.
  // LOOSER-stop probe: stops ABOVE the deepest winner (11.4%) preserve every winner
  // and cut only the very deepest losers — is a tail-only stop net-positive? (Same
  // both-sides accounting on the already-computed per-entry table.)
  const per = r.perEntry || [];
  const clip = r.clipUsd || 10;
  const fee = r.feePerLeg || 0.001;
  const looseProbe = [0.12, 0.15, 0.20, 0.25, 0.30, 0.40].map((S) => {
    const stoppedNet = -S - 2 * fee;
    let w = 0; let l = 0; let net = 0;
    for (const p of per) {
      if (p.maePct > S) {
        const delta = (stoppedNet - p.netPct) * clip;
        net += delta;
        if (p.winner) w++; else l++;
      }
    }
    return { stop: pct(S), winnersCut: w, losersCut: l, net: Math.round(net * 100) / 100 };
  });
  console.log("STOP_VERIFY_OK " + JSON.stringify({
    stopPct: r.stopPct,
    stopPctHuman: pct(r.stopPct),
    clipUsd: r.clipUsd,
    looseProbe,
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
