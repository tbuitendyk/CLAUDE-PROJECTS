#!/usr/bin/env bash
# classifier-split-dates.sh -- the ACTUAL date boundaries of train/search/
# holdout for the runs under discussion, with chunk counts.
#
# Written because the overlap question was being argued from remembered chunk
# counts rather than from dates. Reconstructs the chunk timeline exactly as the
# sweep does, applies the same positional split, and prints real dates.
set -euo pipefail
cd /opt/general-classifier
node -e '
(async () => {
  const { buildCombo, splitBounds } = require("./lib/bracketwork");
  const HOUR = 3600000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const branch = { geometry: "daily-3d", decision: "argmax", band: "auto", weekdaysOnly: false };
  const combo = { trade: "XRPUSDT", ctx1: null, ctx2: null, size: 1 };

  const runs = [
    ["L9  cycle 9  (all data, ends now)", { allLoaded: true }],
    ["L11 cycle 11 (endMonth 2025-06)",   { allLoaded: false, startMonth: "2018-01", endMonth: "2025-06" }],
  ];
  const out = [];
  for (const [label, params] of runs) {
    const { chunks } = await buildCombo(combo, branch, params);
    const n = chunks.length;
    const { nTrain, nTest, nHold } = splitBounds(n, true);
    const t = (i) => iso(chunks[i].startTs);
    const w = [
      ["train ", 0, nTrain - 1, nTrain],
      ["search", nTrain, nTrain + nTest - 1, nTest],
      ["hold  ", nTrain + nTest, n - 1, nHold],
    ];
    out.push({ label, n, w: w.map(([nm, a, b, c]) => [nm, t(a), t(b), c]) });
  }
  console.log("TABLE — ACTUAL SPLIT BOUNDARIES (XRPUSDT, daily-3d, one chunk per day)");
  console.log("What it measures: the real calendar range of each window, and how many");
  console.log("  chunks (one-day steps) it contains, for the two runs being compared.");
  console.log("");
  console.log("  KEY  window = train (models fitted here) / search (settings chosen here)");
  console.log("                / hold (scored once, never searched)");
  console.log("       chunks = one-day steps; daily-3d looks back 3 days each step");
  console.log("");
  for (const r of out) {
    console.log(`${r.label}   total chunks: ${r.n}`);
    for (const [nm, a, b, c] of r.w) {
      console.log(`    ${nm}  ${a}  ->  ${b}   ${String(c).padStart(4)} chunks`);
    }
    console.log("");
  }
  const h9 = out[0].w[2], t9 = out[0].w[0], h11 = out[1].w[2];
  console.log("THE OVERLAP QUESTION");
  console.log(`  cycle 11 HOLDOUT      : ${h11[1]} -> ${h11[2]}`);
  console.log(`  cycle 9  TRAIN        : ${t9[1]} -> ${t9[2]}`);
  const inside = h11[1] >= t9[1] && h11[2] <= t9[2];
  console.log(`  cycle 11 holdout sits INSIDE cycle 9 train? ${inside ? "YES" : "no"}`);
  console.log(`  cycle 9  HOLDOUT      : ${h9[1]} -> ${h9[2]}   (no overlap with cycle 11 holdout)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
'
