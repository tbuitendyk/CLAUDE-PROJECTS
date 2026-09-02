#!/usr/bin/env bash
# READ-ONLY. After the kept-scramble fill reports done: what the REAL store now
# holds, read out of the records themselves -- not the progress line. The set
# document, the store's row and block counts, and rows sampled from the first,
# middle and last blocks with their kept figures counted per unit. Changes
# nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const fs = require("fs");
const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1";
const doc = JSON.parse(fs.readFileSync("data/stagesets/" + S + ".json", "utf8"));
console.log("== the set document ==");
console.log("  status      :", doc.status);
console.log("  progress    :", doc.progress);
console.log("  boardNull   :", JSON.stringify(doc.boardNull));
console.log("  params.keepN:", (doc.params || {}).keepN, "  nullN:", (doc.params || {}).nullN);
console.log("  perf        :", JSON.stringify(doc.perf));
const blocks = rowstore.blocksOf(S, "records") || [];
const rows = blocks.reduce((a, b) => a + (b.rows || 0), 0);
console.log("== the store ==");
console.log("  blocks:", blocks.length, "  rows:", rows.toLocaleString(), " (5,248,320 in 3,658 before the fill)");
let tally = null; try { tally = fs.statSync("data/stagesets/" + S + ".tally.json.gz"); } catch (_) {}
console.log("  totals file:", tally ? tally.size + " bytes, " + tally.mtime.toISOString() : "not there yet (rebuilds when a screen asks)");
console.log("== rows sampled from the first, middle and last blocks ==");
const pick = [0, Math.floor(blocks.length / 3), Math.floor(2 * blocks.length / 3), blocks.length - 1];
const perUnit = new Map();
let shown = 0, withF = 0, without = 0, bad = 0;
for (const bi of pick) {
  for (const x of rowstore.readBlocks(S, "records", [bi])) {
    const r = x.row; const t = r.noiseTest; const h = r.noiseHold;
    const u = r.trade + " " + r.geometry;
    if (!perUnit.has(u)) perUnit.set(u, { rows: 0, withF: 0, tenLong: 0, allNumbers: 0 });
    const p = perUnit.get(u); p.rows++;
    if (!Array.isArray(t)) { without++; continue; }
    withF++; p.withF++;
    if (t.length === 10 && Array.isArray(h) && h.length === 10) p.tenLong++;
    if (t.every((v) => typeof v === "number") && h.every((v) => typeof v === "number")) p.allNumbers++; else bad++;
    if (shown < 3) {
      shown++;
      console.log("  RECORD", shown, "-", String(r.label).slice(0, 60), "|", u);
      console.log("     real test money:", r.pnl, " kept test figures:", JSON.stringify(t));
      console.log("     real held-back  :", r.holdout && r.holdout.pnl, " kept held-back:", JSON.stringify(h));
    }
  }
}
console.log("  in those 4 blocks:", withF.toLocaleString(), "rows carry kept figures,", without.toLocaleString(), "carry none,", bad, "carry a non-number");
console.log("== per unit, in those blocks ==");
for (const [u, p] of perUnit) console.log("  " + u.padEnd(22), "rows", String(p.rows).padStart(5), " with figures", String(p.withF).padStart(5), " 10+10 long", String(p.tenLong).padStart(5), " all numbers", String(p.allNumbers).padStart(5));
console.log("== the beside-store and the figures folder (both should be gone) ==");
for (const d of ["data/batches/" + S + "__keptfill.rows", "data/batches/" + S + "__keptfigs"]) { let e = false; try { fs.statSync(d); e = true; } catch (_) {} console.log("  " + d + " :", e ? "STILL THERE" : "gone"); }
' 2>&1 | tail -60
