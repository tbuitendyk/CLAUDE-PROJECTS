#!/usr/bin/env bash
# READ-ONLY. The rows under active / directional whose ten kept figures all
# equal the real money: what are they? If they made no trades at all, ten
# scrambles of nothing is nothing, and that is right. Same eight blocks.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1";
const blocks = rowstore.blocksOf(S, "records") || [];
const pick = Array.from({ length: 8 }, (_, i) => Math.floor(i * (blocks.length - 1) / 7));
const c = (v) => Math.round(v * 100);
const out = { rows: 0, noTrades: 0, oneTrade: 0, moreTrades: 0, pnlZero: 0, byT: new Map(), byHold: new Map() };
let ex = null;
for (const bi of pick) for (const x of rowstore.readBlocks(S, "records", [bi])) {
  const r = x.row; if (r.gate === "always") continue;
  const t = r.noiseTest || []; if (!t.length || !t.every((v) => c(v) === c(r.pnl))) continue;
  out.rows++;
  if (!r.trades) out.noTrades++; else if (r.trades === 1) out.oneTrade++; else out.moreTrades++;
  if (c(r.pnl) === 0) out.pnlZero++;
  const k = "t" + r.tHours; out.byT.set(k, (out.byT.get(k) || 0) + 1);
  const hk = "hold" + (r.agreePersist || 0); out.byHold.set(hk, (out.byHold.get(hk) || 0) + 1);
  if (r.trades > 1 && !ex) ex = r;
}
console.log("identical-to-real rows under active/directional:", out.rows);
console.log("  no trades:", out.noTrades, " one trade:", out.oneTrade, " more:", out.moreTrades, " pnl exactly 0:", out.pnlZero);
console.log("  by t   :", JSON.stringify(Object.fromEntries([...out.byT.entries()].sort())));
console.log("  by hold:", JSON.stringify(Object.fromEntries([...out.byHold.entries()].sort())));
if (ex) { console.log("  an identical row WITH trades:", String(ex.label).slice(0, 72), "|", ex.trade, ex.geometry, " trades", ex.trades, " pnl", ex.pnl); }
' 2>&1 | tail -20
