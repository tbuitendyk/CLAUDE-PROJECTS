#!/usr/bin/env bash
# READ-ONLY. Do the settings the fill would price match the rows already on
# disk? If they do not, the fill fails on the first block after pricing a whole
# unit. Prices nothing; enumerates only.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const stages = require("./lib/stages");
const rowstore = require("./lib/rowstore");
const id = "s3-mte0oajo-1";
const doc = stages.getSet(id);
console.log("set status:", doc.status);
const shape = stages.relaunchShapeOf ? stages.relaunchShapeOf(doc) : null;
if (!shape) { console.log("relaunchShapeOf is not exported"); process.exit(0); }
console.log("units the fill would walk :", shape.records.length);
console.log("settings it would price   :", shape.settings.length.toLocaleString());
const blocks = rowstore.blocksOf(id, "records") || [];
const rows = blocks.reduce((a,b)=>a+(b.rows||0),0);
console.log("rows on disk              :", rows.toLocaleString());
console.log("rows / units              :", (rows/shape.records.length).toLocaleString());
console.log(rows/shape.records.length === shape.settings.length
  ? "MATCH - every row on disk has a setting to price"
  : "MISMATCH - the fill would refuse; the difference is " + (rows/shape.records.length - shape.settings.length));
// and are the labels really unique, since the join is by label
const seen = new Set(); let dupes = 0;
for (const st of shape.settings) { if (seen.has(st.label)) dupes++; else seen.add(st.label); }
console.log("duplicate setting labels  :", dupes, dupes ? "(the join by label would collide)" : "(the join by label is safe)");
' 2>&1 | tail -12
