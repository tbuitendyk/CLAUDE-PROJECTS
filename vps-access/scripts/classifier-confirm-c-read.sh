#!/usr/bin/env bash
# classifier-confirm-c-read.sh -- READ-ONLY reader for confirm run C
# (bracketlab-20260807-085851-triples-confirm-c-ltc-sharpen), computing
# exactly the rule stamped in its launcher BEFORE it fired:
#  R1: the LTC-led LTC+XRP+BCH declared-cell HOLD skill (pnl minus
#      always-long) must beat ALL 19 null draws (p-floor 1/20 = 0.05).
#      Raw hold money printed beside skill (run A's lesson).
# Also prints the sibling orderings for context (not the candidate).
set -uo pipefail
node -e '
const fs = require("fs");
const f = "/opt/general-classifier/data/batches/bracketlab-20260807-085851-triples-confirm-c-ltc-sharpen.json";
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
const idx = {};
for (const r of rows) {
  const e = (idx[key(r)] ||= { real: null, nulls: {} });
  if (r.nullDealSeed == null) { if (!e.real) e.real = r; }
  else if (!e.nulls[r.nullDealSeed]) e.nulls[r.nullDealSeed] = r;
}
const candKey = Object.keys(idx).find((k) => k.split("+")[0] === "LTCUSDT");
for (const k of Object.keys(idx).sort((a,b) => (a===candKey?-1:b===candKey?1:0))) {
  const e = idx[k];
  if (!e.real) continue;
  const h = e.real.holdout || {};
  const rs = skill(e.real);
  const ns = Object.entries(e.nulls).map(([s,r]) => [Number(s), skill(r)]).filter(([,x]) => x != null).sort((a,b)=>a[1]-b[1]);
  const beat = ns.filter(([,x]) => rs > x).length;
  const tag = k === candKey ? "CANDIDATE (declared)" : "sibling ordering (context only)";
  console.log(`\n== ${k} — ${tag} ==`);
  console.log(`REAL: raw hold $${(h.pnl??NaN).toFixed(2)} (${h.trades??"?"}t) | alwaysLong $${(h.holds?h.holds.alwaysLong:NaN).toFixed(2)} | skill $${(rs??NaN).toFixed(2)}`);
  if (ns.length) {
    console.log(`nulls: n=${ns.length}  range $${ns[0][1].toFixed(2)} .. $${ns[ns.length-1][1].toFixed(2)}  median $${ns[Math.floor(ns.length/2)][1].toFixed(2)}`);
    const above = ns.filter(([,x]) => x >= rs);
    console.log(`draws at or above real: ${above.length}` + (above.length ? " -> seeds " + above.map(([s])=>s).join(",") : ""));
    console.log(`VERDICT: real beats ${beat}/${ns.length} (needs ${ns.length}/${ns.length}; p-floor ${(1/(ns.length+1)).toFixed(3)}) -> ${beat===ns.length?"PASS":"FAIL"}`);
  }
}
'
