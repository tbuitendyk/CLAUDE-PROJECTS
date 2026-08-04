#!/usr/bin/env bash
# classifier-campaign-backfill.sh -- ONE-TIME (owner order, 2026-08-04):
# stamp the owner's current campaign name onto the seven Aug-3 runs, so the
# whole first cycle groups in the picker. Touches ONLY params.campaign on the
# named docs; every other stored byte is untouched.
set -uo pipefail
node -e '
const fs = require("fs"), path = require("path");
const dir = "/opt/general-classifier/data/batches";
const camp = JSON.parse(fs.readFileSync("/opt/general-classifier/data/campaign.json", "utf8")).name;
if (!camp) { console.log("NO CAMPAIGN SET — set one in the lab first; nothing changed"); process.exit(1); }
const ids = [
  "bracketlab-20260803-0609-planted-gate",
  "bracketlab-20260803-0611-null9-census",
  "bracketlab-20260803-0834-planted-gate",
  "bracketlab-20260803-0940-null9-census-declared",
  "bracketlab-20260803-1026-null9-census-trail",
  "bracketlab-20260803-1031-null9-census-trail",
  "bracketlab-20260803-1805-planted-gate",
];
for (const id of ids) {
  const f = path.join(dir, `${id}.json`);
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    const before = d.params.campaign || null;
    d.params.campaign = camp;
    fs.writeFileSync(f, JSON.stringify(d));
    console.log(`${id}: campaign ${before ? `"${before}" -> ` : ""}"${camp}"`);
  } catch (e) { console.log(`${id}: FAILED — ${e.message}`); }
}
'
