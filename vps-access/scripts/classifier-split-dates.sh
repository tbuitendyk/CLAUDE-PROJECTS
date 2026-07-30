#!/usr/bin/env bash
# classifier-split-dates.sh -- the ACTUAL date boundaries of train/search/
# holdout for the runs under discussion, with chunk counts.
#
# Written because the overlap question was being argued from remembered chunk
# counts rather than from dates. Reconstructs the chunk timeline exactly as the
# sweep does, applies the same positional split, and prints real dates.
set -euo pipefail
echo "TABLE — ACTUAL SPLIT BOUNDARIES (XRPUSDT, daily-3d, one chunk per day)"
echo "What it measures: the real calendar range of each window and its chunk count,"
echo "  for the two runs being compared. Each run is loaded in its OWN process."
echo ""
echo "  KEY  train  = models fitted here only"
echo "       search = execution settings chosen here"
echo "       hold   = scored once, never searched"
echo "       chunks = one-day steps (daily-3d looks back 3 days each step)"
echo ""
cd /opt/general-classifier
# ONE PROCESS PER RUN. getMap() caches by symbol only and returns the cached
# map on a hit REGARDLESS of the month range, so loading "all data" first and a
# shortened range second in the same process silently reuses the full map. My
# first version of this script did exactly that and reported both runs as
# identical. Separate processes are the fix here; the underlying cache bug is
# logged separately.
for SPEC in "ALL" "TRIM"; do
node -e '
(async () => {
  const SPEC = process.env.SPEC;
  const { buildCombo, splitBounds } = require("./lib/bracketwork");
  const HOUR = 3600000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const branch = { geometry: "daily-3d", decision: "argmax", band: "auto", weekdaysOnly: false };
  const combo = { trade: "XRPUSDT", ctx1: null, ctx2: null, size: 1 };

  const runs = SPEC === "ALL"
    ? [["L9  cycle 9  (all data, ends now)", { allLoaded: true }]]
    : [["L11 cycle 11 (endMonth 2025-06)",   { allLoaded: false, startMonth: "2018-01", endMonth: "2025-06" }]];
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
  for (const r of out) {
    console.log(`${r.label}   total chunks: ${r.n}`);
    for (const [nm, a, b, c] of r.w) {
      console.log(`    ${nm}  ${a}  ->  ${b}   ${String(c).padStart(4)} chunks`);
    }
    console.log("");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
' SPEC="$SPEC"
done
