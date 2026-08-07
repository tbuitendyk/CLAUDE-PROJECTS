#!/usr/bin/env bash
# classifier-silence-test.sh -- READ-ONLY. The declared test of the hypothesis
# that the `directional` decision rule goes SILENT out of sample while `argmax`
# merely thins.
#
# CONFOUND REMOVED ON PURPOSE: the books that raised the question were
# LTC+argmax vs XLM+directional, so coin and rule moved together and neither
# could be blamed. This runs BOTH rules on BOTH coins — four committees, same
# training cutoff, same forward window.
#
# READING RULE, declared in the audit before this ran: if `directional` members
# drop by an order of magnitude while `argmax` members drop by less than half,
# the hypothesis stands and every directional candidate is suspect.
#
# HONEST LIMIT: the "training era" rate below is measured IN SAMPLE (members
# trained on those periods), so it is an upper bound, not a fair out-of-sample
# baseline. Both rules carry the same optimism, so the COMPARISON of drops is
# fair even though the absolute levels are not. Stated rather than buried.
set -uo pipefail
node -e '
const bracketLib = require("/opt/general-classifier/lib/bracket");
const { scoreDiff } = require("/opt/general-classifier/lib/dataset");
const { buildCombo, trainMembers, quorumCall, specsFor } = require("/opt/general-classifier/lib/bracketwork");
const fb = require("/opt/general-classifier/lib/forwardbook");
const CASES = [
  { coin: "LTCUSDT", ctx1: "XRPUSDT", ctx2: "BCHUSDT", decision: "argmax",      band: 1.69 },
  { coin: "LTCUSDT", ctx1: "XRPUSDT", ctx2: "BCHUSDT", decision: "directional", band: 1.69 },
  { coin: "XLMUSDT", ctx1: "DOTUSDT", ctx2: "TRXUSDT", decision: "argmax",      band: 1.61 },
  { coin: "XLMUSDT", ctx1: "DOTUSDT", ctx2: "TRXUSDT", decision: "directional", band: 1.61 },
];
(async () => {
  console.log("SILENCE TEST — per-member directional-call rate, in-sample vs forward");
  console.log("(in-sample rate is an UPPER BOUND: members trained on those periods)\n");
  console.log("coin      decision      in-sample   forward   drop     committee fwd");
  const out = {};
  for (const c of CASES) {
    const combo = { trade: c.coin, ctx1: c.ctx1, ctx2: c.ctx2, size: 3 };
    const branch = { geometry: "daily-4d", decision: c.decision, band: c.band, weekdaysOnly: false };
    const { geo, maps, chunks } = await buildCombo(combo, branch, { allLoaded: true });
    for (const ch of chunks) ch.label = scoreDiff(ch.diffPct / 100, Math.abs(c.band) / 100);
    const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
    const { trainChunks, fwdChunks } = fb.splitFrozen(chunks, fb.TRAIN_THROUGH, fb.SCORE_FROM, outcomeMs);
    const views = bracketLib.comboViews(3, geo.featureHours / 24).views;
    const specs = specsFor(3, "slim");
    const recent = trainChunks.slice(-300);
    // One training pass; predict over recent-training THEN forward, then split.
    const members = await trainMembers(specs, views, trainChunks, [...recent, ...fwdChunks], branch, maps, geo);
    const inS = members.map((m) => m.calls.slice(0, recent.length));
    const fwd = members.map((m) => m.calls.slice(recent.length));
    const rate = (arrs) => arrs.reduce((a, cl) => a + cl.filter((v) => v !== 0).length, 0) / (arrs.length * arrs[0].length);
    const ri = rate(inS), rf = rate(fwd);
    const qFwd = fwdChunks.map((_, i) => quorumCall(fwd, i, 1)).filter((v) => v !== 0).length;
    out[c.coin + "/" + c.decision] = { ri, rf };
    console.log(c.coin.padEnd(10) + c.decision.padEnd(14)
      + (100*ri).toFixed(1).padStart(8) + "%" + (100*rf).toFixed(1).padStart(9) + "%"
      + ("x" + (ri > 0 ? (rf/ri).toFixed(2) : "n/a")).padStart(8)
      + (qFwd + "/" + fwdChunks.length).padStart(16));
  }
  console.log("\nREADING (rule declared before this ran):");
  for (const coin of ["LTCUSDT", "XLMUSDT"]) {
    const a = out[coin + "/argmax"], d = out[coin + "/directional"];
    if (!a || !d) continue;
    const ra = a.ri > 0 ? a.rf/a.ri : NaN, rd = d.ri > 0 ? d.rf/d.ri : NaN;
    console.log("  " + coin + ": argmax retains " + (100*ra).toFixed(0) + "% of its call rate, directional retains "
      + (100*rd).toFixed(0) + "%");
  }
  console.log("  hypothesis stands only if directional drops ~10x AND argmax drops less than half, on BOTH coins.");
})().catch((e) => console.log("ERROR:", e.message));
'
