#!/usr/bin/env bash
# uts-set-failures.sh -- READ-ONLY. For every record set that finished short of
# its own plan, list the units that failed and the reason each gave, grouped so
# one cause is read once rather than eighteen times. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
const st = require("./lib/stages");
for (const s of (st.listSets() || [])) {
  if (!s || !s.id) continue;
  let d = null; try { d = st.getSet(s.id); } catch (e) { continue; }
  if (!d) continue;
  const f = Array.isArray(d.failures) ? d.failures : [];
  if (!f.length) continue;
  console.log("=== " + d.name + "  (" + d.id + ", stage " + d.stage + ", " + d.status + ")");
  console.log("    plan " + JSON.stringify(d.plan) + "   counts " + JSON.stringify(d.counts));
  const by = new Map();
  for (const x of f) {
    const k = String(x.error || "").slice(0, 300);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(x.unit);
  }
  for (const [why, units] of by) {
    console.log("    " + units.length + " unit(s): " + why);
    console.log("        " + units.join(", "));
  }
  console.log("");
}
'
