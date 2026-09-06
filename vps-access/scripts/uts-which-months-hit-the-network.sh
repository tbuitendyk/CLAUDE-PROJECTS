#!/usr/bin/env bash
# uts-which-months-hit-the-network.sh -- READ-ONLY. With the data box set to a
# month RANGE (not all loaded data), every unit asks for every month in that
# range. A month with a whole-month bundle on disk is read from disk; a month
# WITHOUT one goes to the network, every time, for every unit. This lists which
# months those are, per coin, for the range a named run used.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
const st = require("./lib/stages");
const b = require("./lib/binance");
const fs = require("fs");
const path = require("path");
for (const s of (st.listSets() || [])) {
  if (!s || !s.id) continue;
  let d = null; try { d = st.getSet(s.id); } catch (e) { continue; }
  if (!d || !Array.isArray(d.failures) || !d.failures.length) continue;
  const p = d.params || {};
  if (p.allLoaded) { console.log(d.name + ": all loaded data -- never touches the network"); continue; }
  console.log("=== " + d.name + "  range " + p.startMonth + " .. " + p.endMonth);
  const coins = new Set(p.universe || []);
  const inRange = (mm) => mm >= p.startMonth && mm <= p.endMonth;
  let worst = 0;
  for (const c of [...coins].sort()) {
    const bundles = new Set((b.cachedMonths(c) || []).filter(inRange));
    const days = new Set((b.cachedDayMonths(c) || []).filter(inRange));
    // every month the range asks for
    const want = [];
    let [y, m] = p.startMonth.split("-").map(Number);
    const [ey, em] = p.endMonth.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) { want.push(y + "-" + String(m).padStart(2, "0")); m++; if (m > 12) { m = 1; y++; } }
    const noBundle = want.filter((mm) => !bundles.has(mm));
    if (noBundle.length > worst) worst = noBundle.length;
    console.log("  " + c.padEnd(10) + want.length + " month(s) asked for, " + noBundle.length + " with no whole-month file on disk"
      + (noBundle.length ? "  -> " + noBundle.join(", ") + (noBundle.some((mm) => days.has(mm)) ? "  (day files present)" : "") : ""));
  }
  console.log("  worst case: " + worst + " network call(s) per coin per unit");
  console.log("");
}
'
