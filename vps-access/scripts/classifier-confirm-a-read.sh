#!/usr/bin/env bash
# classifier-confirm-a-read.sh -- READ-ONLY reader for confirm run A
# (bracketlab-20260807-022033-triples-confirm-a-ltc-xrp-bch), computing
# EXACTLY the rules stamped in the launcher before the run fired:
#  R1: candidate LTC+XRP+BCH declared-cell HOLD skill (pnl minus the
#      always-long drift control) must beat the same quantity in ALL 9
#      null draws (rank test, p-floor 1/10).
#  R2 (context): count of the 60 triples with positive hold skill, real
#      vs each null draw.
set -uo pipefail
node -e '
const fs = require("fs");
const f = "/opt/general-classifier/data/batches/bracketlab-20260807-022033-triples-confirm-a-ltc-xrp-bch.json";
const d = JSON.parse(fs.readFileSync(f, "utf8"));
console.log("doc:", d.id, d.status, "| replication rows:", (d.replication||[]).length);
const rows = d.replication || [];
if (rows.length) console.log("row fields:", Object.keys(rows[0]).join(","));
const comboKey = (r) => [r.trade, r.ctx1, r.ctx2].join("+");
const skill = (r) => {
  const h = r.holdout;
  if (!h || h.pnl == null) return null;
  const long = h.holds ? h.holds.alwaysLong : null;
  return long == null ? null : h.pnl - long;
};
const isCand = (r) => {
  const s = new Set([r.trade, r.ctx1, r.ctx2]);
  return s.has("LTCUSDT") && s.has("XRPUSDT") && s.has("BCHUSDT");
};
// R1: candidate rows by arm
const cand = rows.filter(isCand);
const realCand = cand.filter((r) => r.nullDealSeed == null);
console.log("\n== R1: candidate LTC+XRP+BCH, declared cell, HOLD window ==");
for (const r of realCand) {
  const h = r.holdout || {};
  console.log(`REAL  ${comboKey(r)}: hold $${(h.pnl??NaN).toFixed(2)} (${h.trades??"?"}t) alwaysLong $${(h.holds?h.holds.alwaysLong:NaN).toFixed(2)} skill $${(skill(r)??NaN).toFixed(2)}`);
}
const nullsBySeed = {};
for (const r of cand.filter((r) => r.nullDealSeed != null)) {
  (nullsBySeed[r.nullDealSeed] ||= []).push(r);
}
const realSkill = realCand.length ? skill(realCand[0]) : null;
let beaten = 0, total = 0;
for (const [seed, rs] of Object.entries(nullsBySeed)) {
  const s0 = skill(rs[0]);
  total++;
  const win = realSkill != null && s0 != null && realSkill > s0;
  if (win) beaten++;
  console.log(`null${seed} ${comboKey(rs[0])}: skill $${(s0??NaN).toFixed(2)} ${win?"< real":">= real"}`);
}
console.log(`R1 VERDICT: real beats ${beaten}/${total} null draws` + (total?` (needs ${total}/${total}; p-floor ${ (1/(total+1)).toFixed(3) })`:""));
// R2: breadth
const bySeedPos = {};
const seenReal = new Set();
let realPos = 0, realN = 0;
for (const r of rows) {
  const s = skill(r);
  if (s == null) continue;
  if (r.nullDealSeed == null) {
    const k = comboKey(r);
    if (seenReal.has(k)) continue;
    seenReal.add(k); realN++;
    if (s > 0) realPos++;
  } else {
    const b = (bySeedPos[r.nullDealSeed] ||= { pos: 0, n: 0 });
    b.n++; if (s > 0) b.pos++;
  }
}
console.log(`\n== R2 (context only): positive-hold-skill triples ==`);
console.log(`REAL: ${realPos}/${realN}`);
for (const [seed, b] of Object.entries(bySeedPos)) console.log(`null${seed}: ${b.pos}/${b.n}`);
'
