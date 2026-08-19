#!/usr/bin/env bash
# name-drift-read.sh -- READ-ONLY: the name on each config and the name on each
# setup derived from it, side by side, so a disagreement is visible instead of
# being something you notice by flipping between tabs. Writes nothing.
set -uo pipefail
cd /opt/general-classifier || { echo "no /opt/general-classifier"; exit 1; }
node -e '
const gl = require("./lib/live/greenlight");
const reg = require("./lib/live/setups");
const gls = gl.listGreenlights();
const sts = reg.listSetups();
let drift = 0;
for (const g of gls) {
  const mine = sts.filter((s) => s.provenanceRef === g.id);
  console.log("");
  console.log("config " + g.id);
  console.log("  name on the config : " + JSON.stringify(g.name || null));
  if (!mine.length) { console.log("  (no setup derived from it yet)"); continue; }
  for (const s of mine) {
    const same = (s.name || null) === (g.name || null);
    if (!same) drift++;
    console.log("  name on setup " + s.id + " : " + JSON.stringify(s.name || null)
      + "  [" + s.state + "]" + (same ? "" : "   <-- DIFFERENT"));
  }
}
const orphan = sts.filter((s) => !gls.some((g) => g.id === s.provenanceRef));
for (const s of orphan) console.log("\nsetup " + s.id + " has no config behind it (provenanceRef "
  + JSON.stringify(s.provenanceRef) + ") — a rename on any config can never reach it");
console.log("");
console.log(drift ? drift + " setup name(s) disagree with their config" : "every setup name matches its config");
'
echo "(read-only)"
