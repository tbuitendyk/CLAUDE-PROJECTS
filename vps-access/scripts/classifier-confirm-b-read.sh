#!/usr/bin/env bash
# classifier-confirm-b-read.sh -- READ-ONLY reader for confirm run B
# (bracketlab-20260807-053117-triples-confirm-b-doge-ada-dot), computing
# exactly the rules stamped in its launcher BEFORE it fired:
#  R1: DOGE-led DOGE+ADA+DOT declared-cell HOLD skill (pnl minus
#      always-long) beats ALL 9 of its null draws (p-floor 1/10).
#      Raw hold money printed beside skill (run A's lesson).
#  R2 (context, null-relative): count of the 60 triples whose real
#      skill beats all 9 of their OWN null draws.
set -uo pipefail
node -e '
const fs = require("fs");
const f = "/opt/general-classifier/data/batches/bracketlab-20260807-053117-triples-confirm-b-doge-ada-dot.json";
const d = JSON.parse(fs.readFileSync(f, "utf8"));
console.log("doc:", d.id, d.status, "| replication rows:", (d.replication||[]).length);
const rows = d.replication || [];
const key = (r) => [r.trade, r.ctx1, r.ctx2].join("+");
const skill = (r) => {
  const h = r.holdout;
  if (!h || h.pnl == null) return null;
  const long = h.holds ? h.holds.alwaysLong : null;
  return long == null ? null : h.pnl - long;
};
// index: key -> {real, nulls:{seed:row}}
const idx = {};
for (const r of rows) {
  const e = (idx[key(r)] ||= { real: null, nulls: {} });
  if (r.nullDealSeed == null) { if (!e.real) e.real = r; }
  else if (!e.nulls[r.nullDealSeed]) e.nulls[r.nullDealSeed] = r;
}
const CAND = "DOGEUSDT+ADAUSDT+DOTUSDT";
// find the candidate entry regardless of ctx order (trade must be DOGE)
const candKey = Object.keys(idx).find((k) => {
  const p = k.split("+");
  return p[0] === "DOGEUSDT" && p.slice(1).sort().join("+") === "ADAUSDT+DOTUSDT";
});
console.log("\n== R1: candidate " + candKey + ", declared cell, HOLD window ==");
const e = idx[candKey];
const h = e.real.holdout || {};
const rs = skill(e.real);
console.log(`REAL: raw hold $${(h.pnl??NaN).toFixed(2)} (${h.trades??"?"}t) | alwaysLong $${(h.holds?h.holds.alwaysLong:NaN).toFixed(2)} | skill $${(rs??NaN).toFixed(2)}`);
let beat = 0, tot = 0;
for (const [seed, nr] of Object.entries(e.nulls)) {
  const ns = skill(nr); tot++;
  const win = rs != null && ns != null && rs > ns;
  if (win) beat++;
  const nh = nr.holdout || {};
  console.log(`null${seed}: raw $${(nh.pnl??NaN).toFixed(2)} | skill $${(ns??NaN).toFixed(2)} ${win?"< real":">= REAL"}`);
}
console.log(`R1 VERDICT: real beats ${beat}/${tot} null draws (needs ${tot}/${tot}; p-floor ${(1/(tot+1)).toFixed(3)})`);
// R2 (null-relative): triples whose real beats ALL its own nulls
let r2 = 0, r2n = 0;
for (const [k, v] of Object.entries(idx)) {
  const s0 = v.real ? skill(v.real) : null;
  const ns = Object.values(v.nulls).map(skill).filter((x) => x != null);
  if (s0 == null || ns.length === 0) continue;
  r2n++;
  if (ns.every((x) => s0 > x)) r2++;
}
console.log(`\n== R2 (context, null-relative): triples beating ALL their own nulls: ${r2}/${r2n} (chance per triple 1/${tot+1} -> expect ~${(r2n/(tot+1)).toFixed(1)}) ==`);
'
