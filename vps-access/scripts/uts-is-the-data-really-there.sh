#!/usr/bin/env bash
# uts-is-the-data-really-there.sh -- READ-ONLY. The interface says the price
# data runs to a given month. This checks, month by month and hour by hour,
# whether that is true on disk -- separating three cases that look identical to
# the loader: a whole-month file, a month held as day files, and nothing at all.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
const b = require("./lib/binance");
const st = require("./lib/stages");
let target = null;
for (const s of (st.listSets() || [])) { if (s && s.id && String(s.name).includes("S1 #3")) target = st.getSet(s.id); }
if (!target) { console.log("no S1 #3 on this box"); process.exit(0); }
const p = target.params || {};
console.log("S1 #3  status " + target.status + "   range " + p.startMonth + " .. " + p.endMonth + "   allLoaded=" + p.allLoaded);
console.log("");
const want = [];
{ let [y, m] = p.startMonth.split("-").map(Number); const [ey, em] = p.endMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) { want.push([y, m]); m++; if (m > 12) { m = 1; y++; } } }
console.log("coin       says-to    bundle  dayfile  EMPTY (no bundle, no day file, no candles at all)");
for (const c of (p.universe || []).slice().sort()) {
  const cov = b.coveredMonths(c) || [];
  const bundles = new Set(b.cachedMonths(c) || []);
  const dayM = new Set(b.cachedDayMonths(c) || []);
  let nb = 0, nd = 0; const empty = [];
  for (const [y, m] of want) {
    const mm = y + "-" + String(m).padStart(2, "0");
    if (bundles.has(mm)) { nb++; continue; }
    if (dayM.has(mm) && b.monthFromDayFiles(c, y, m)) { nd++; continue; }
    empty.push(mm);
  }
  console.log("  " + c.padEnd(10) + (cov[cov.length - 1] || "-").padEnd(10) + String(nb).padEnd(8) + String(nd).padEnd(9)
    + (empty.length ? empty.length + ": " + empty.join(" ") : "none"));
}
console.log("");
console.log("== how many candles the last two months actually hold, per coin ==");
for (const c of (p.universe || []).slice().sort().slice(0, 4)) {
  for (const mm of ["2026-08", "2026-09"]) {
    const [y, m] = mm.split("-").map(Number);
    const rows = b.monthFromDayFiles(c, y, m);
    console.log("  " + c.padEnd(10) + mm + "  " + (rows ? rows.length + " candles from day files" : "no day files"));
  }
}
'
