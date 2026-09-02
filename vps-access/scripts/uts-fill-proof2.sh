#!/usr/bin/env bash
# READ-ONLY. Do the kept figures actually DIFFER from the real money, and for
# which settings? A scrambled forecast cannot move a trade that ignores the
# forecast, so identical figures on `always`-gate rows would be right and
# identical figures everywhere would mean nothing was scrambled. Counted per
# gate and per entry, over eight blocks spread through the store.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1";
const blocks = rowstore.blocksOf(S, "records") || [];
const pick = Array.from({ length: 8 }, (_, i) => Math.floor(i * (blocks.length - 1) / 7));
const by = new Map();
const key = (r) => (r.gate || "?") + " / " + (r.entry || "?");
let example = null;
for (const bi of pick) for (const x of rowstore.readBlocks(S, "records", [bi])) {
  const r = x.row; const t = r.noiseTest || []; const h = r.noiseHold || [];
  const k = key(r);
  if (!by.has(k)) by.set(k, { rows: 0, testSame: 0, testDiff: 0, holdSame: 0, holdDiff: 0, testAllEqual: 0 });
  const p = by.get(k); p.rows++;
  const c = (v) => Math.round(v * 100);
  const tSame = t.length && t.every((v) => c(v) === c(r.pnl));
  const hSame = h.length && r.holdout && h.every((v) => c(v) === c(r.holdout.pnl));
  if (tSame) p.testSame++; else p.testDiff++;
  if (hSame) p.holdSame++; else p.holdDiff++;
  if (t.length && t.every((v) => c(v) === c(t[0]))) p.testAllEqual++;
  if (!tSame && !example) example = r;
}
console.log("gate / entry".padEnd(26), "rows".padStart(6), "test: same as real".padStart(19), "differ".padStart(8), "| held: same".padStart(12), "differ".padStart(8), "| 10 test all equal".padStart(20));
for (const [k, p] of [...by.entries()].sort()) console.log(k.padEnd(26), String(p.rows).padStart(6), String(p.testSame).padStart(19), String(p.testDiff).padStart(8), String(p.holdSame).padStart(14), String(p.holdDiff).padStart(8), String(p.testAllEqual).padStart(20));
if (example) { console.log(); console.log("one row whose kept figures differ from the real:"); console.log("  ", String(example.label).slice(0, 70), "|", example.trade, example.geometry); console.log("   real test", example.pnl, " kept", JSON.stringify(example.noiseTest)); console.log("   real held", example.holdout && example.holdout.pnl, " kept", JSON.stringify(example.noiseHold)); }
else console.log("NO ROW IN THESE BLOCKS HAS KEPT FIGURES THAT DIFFER FROM THE REAL MONEY");
' 2>&1 | tail -40
