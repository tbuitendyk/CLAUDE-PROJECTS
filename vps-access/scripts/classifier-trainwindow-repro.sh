#!/usr/bin/env bash
# classifier-trainwindow-repro.sh -- READ-ONLY. Decisive check on a
# contradiction: the discovery board's XLM/directional row traded 240 of 325
# periods (74% committee participation), but rebuilding that same specification
# with members trained on ALL data to the freeze gives a 3% call rate. Those
# cannot both be the same committee.
#
# The only structural difference is the TRAINING WINDOW: the discovery run
# trained on its first 70% of history; the forward books train on everything up
# to 2026-06-30. This scores both constructions on the SAME periods so the
# difference is attributable to nothing else.
#
# If confirmed, the forward books are testing the RECIPE retrained, not the
# SELECTED models — a different experiment from the one their own header claims.
set -uo pipefail
node -e '
const bracketLib = require("/opt/general-classifier/lib/bracket");
const { buildCombo, trainMembers, quorumCall, specsFor, splitAndLabel } = require("/opt/general-classifier/lib/bracketwork");
const CASES = [
  { coin: "XLMUSDT", ctx1: "DOTUSDT", ctx2: "TRXUSDT", decision: "directional" },
  { coin: "LTCUSDT", ctx1: "XRPUSDT", ctx2: "BCHUSDT", decision: "argmax" },
];
(async () => {
  console.log("TRAINING-WINDOW REPRODUCTION — same specification, same scored periods, two training sets\n");
  for (const c of CASES) {
    const combo = { trade: c.coin, ctx1: c.ctx1, ctx2: c.ctx2, size: 3 };
    const branch = { geometry: "daily-4d", decision: c.decision, band: "auto", weekdaysOnly: false };
    const { geo, maps, chunks } = await buildCombo(combo, branch, { allLoaded: true });
    // The discovery construction: 70/15/15, band auto on the training slice.
    const split = splitAndLabel(chunks, branch, true);
    const { trainChunks, testChunks, holdChunks, bandPct } = split;
    const scored = [...testChunks, ...holdChunks];
    const views = bracketLib.comboViews(3, geo.featureHours / 24).views;
    const specs = specsFor(3, "slim");
    // A) as the discovery run built it: train on the first 70% only
    const mA = await trainMembers(specs, views, trainChunks, scored, branch, maps, geo);
    // B) as the forward books build it: train on everything before the scored
    //    slice as well (i.e. train+test), then score the same hold periods
    const mB = await trainMembers(specs, views, [...trainChunks, ...testChunks], holdChunks, branch, maps, geo);
    const rate = (arrs) => arrs.reduce((a, cl) => a + cl.filter((v) => v !== 0).length, 0) / (arrs.length * arrs[0].length);
    const cA = mA.map((m) => m.calls);
    const cB = mB.map((m) => m.calls);
    // Compare on the HOLD periods only, which both constructions score.
    const cAhold = cA.map((cl) => cl.slice(testChunks.length));
    const qA = holdChunks.map((_, i) => quorumCall(cAhold, i, 1)).filter((v) => v !== 0).length;
    const qB = holdChunks.map((_, i) => quorumCall(cB, i, 1)).filter((v) => v !== 0).length;
    console.log("== " + c.coin + " " + c.decision + "  (band auto = " + bandPct.toFixed(2) + "%, "
      + trainChunks.length + " train / " + testChunks.length + " test / " + holdChunks.length + " hold)");
    console.log("   A) trained on first 70% (as the board did) : member call rate "
      + (100*rate(cAhold)).toFixed(1) + "%  committee " + qA + "/" + holdChunks.length);
    console.log("   B) trained on train+test (as books do)     : member call rate "
      + (100*rate(cB)).toFixed(1) + "%  committee " + qB + "/" + holdChunks.length);
    console.log("   -> same specification, same scored periods; difference is the training window alone");
  }
})().catch((e) => console.log("ERROR:", e.message));
'
