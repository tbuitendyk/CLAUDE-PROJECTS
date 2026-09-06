#!/usr/bin/env bash
# uts-campaign-leftovers.sh -- READ-ONLY. Everything on the box that still
# carries a campaign name, and everything that carries no campaign at all.
# Changes nothing, deletes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
const c = require("./lib/campaign");
console.log("current campaign: " + JSON.stringify(c.getCampaign()));
console.log("");
console.log("== every campaign name anything still carries ==");
let names = [];
try { names = c.campaignNames() || []; } catch (e) { console.log("(" + e.message + ")"); }
if (!names.length) console.log("  (none)");
for (const n of names) console.log("  " + JSON.stringify(n && n.name !== undefined ? n.name : n) + "   " + JSON.stringify(n));
console.log("");
const want = "UPDATED ON R3.46.0 - Five coins - all singles - deep sweep";
console.log("== what \"" + want + "\" holds ==");
try {
  const t = c.campaignTree(want);
  console.log(JSON.stringify(t, null, 2).slice(0, 3000));
} catch (e) { console.log("(" + e.message + ")"); }
console.log("");
console.log("== every record set on the box, and the campaign it carries ==");
for (const s of (require("./lib/stages").listSets() || [])) {
  if (!s || !s.id) continue;
  console.log("  " + String(s.id).padEnd(22) + " s" + s.stage + " " + String(s.name).slice(0,24).padEnd(25) + JSON.stringify((s.params || {}).campaign));
}
console.log("");
console.log("== every sweep run, and the campaign it carries ==");
try {
  for (const r of (require("./lib/batch").listBatches() || [])) {
    console.log("  " + String(r.id).slice(0,34).padEnd(35) + JSON.stringify((r.params || {}).campaign));
  }
} catch (e) { console.log("(" + e.message + ")"); }
'
