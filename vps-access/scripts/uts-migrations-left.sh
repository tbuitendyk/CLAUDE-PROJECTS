#!/usr/bin/env bash
# uts-migrations-left.sh -- READ-ONLY. For every record set on this box, does
# each one-off migration still have work to do on it? Changes nothing.
#
# Why it exists: the owner's standing order is that one-off code written to
# repair an earlier design fault is DELETED once it has served every set. The
# only honest way to know a migration is finished is to ask every set on disk,
# using the engine's OWN predicates rather than a second copy of them -- a copy
# would be the same two-vocabularies fault the migrations exist to clear up.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
const st = require("./lib/stages");
const sets = st.listSets() || [];
const checks = [
  ["always gate strip (3.44.0)",      (d) => st.needsAlwaysStrip(d)],
  ["setting names v3 (3.49.x)",       (d) => st.settingsBehind(d) > 0],
  ["per-unit fold (3.52.0)",          (d) => st.foldBehind(d)],
  ["board null stamp",                (d) => st.needsBoardNullStamp(d)],
  ["sealed window fill (3.51.0)",     (d) => st.sealedBehind(d)],
  ["tuning-slice money (3.46.0)",     (d) => st.tuningMoneyBehind(d)],
  ["four controls fill (3.70.0)",     (d) => st.needsControlFill(d)],
];
const tally = new Map(checks.map(([n]) => [n, []]));
const rows = [];
for (const s of sets) {
  let d = null;
  try { d = st.getSet(s.id); } catch (e) { rows.push([s.id, s.stage, s.name, "UNREADABLE " + e.message]); continue; }
  if (!d) { rows.push([s.id, s.stage, s.name, "MISSING"]); continue; }
  const left = [];
  for (const [name, fn] of checks) {
    let v = false;
    try { v = !!fn(d); } catch (e) { v = "threw: " + e.message; }
    if (v === true) { left.push(name); tally.get(name).push(s.id); }
    else if (v !== false) { left.push(name + " (" + v + ")"); tally.get(name).push(s.id); }
  }
  rows.push([s.id, s.stage, s.name, left.length ? left.join("; ") : "-", d.rich ? "rich" : "no rich"]);
}
console.log(sets.length + " record set(s) on disk");
console.log("");
for (const r of rows) console.log("  " + String(r[0]).padEnd(26) + " s" + r[1] + " " + String(r[2]).slice(0,22).padEnd(23) + (r[4]||"").padEnd(9) + r[3]);
console.log("");
console.log("== per migration, how many sets still need it ==");
for (const [name, ids] of tally) console.log("  " + name.padEnd(32) + ids.length + (ids.length ? "  " + ids.join(",") : "  DONE - nothing on this box needs it"));
'
