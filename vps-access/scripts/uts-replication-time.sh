#!/usr/bin/env bash
# uts-replication-time.sh -- READ-ONLY and BOUNDED. What it costs to read the
# replication rows, measured on a fixed slice and scaled, rather than by reading
# all fifty million and finding out the hard way.
#
# The unbounded version of this held a processor for twenty-two minutes, outlived
# the call that started it, and returned nothing, while the owner's page timed
# out. It stops after a fixed number of rows now and says it is extrapolating.
#
# It runs in its own process, so it does not block the service the way the
# screen's own request does -- but it does compete for a processor, so it is
# deliberately short.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
timeout 180 node -e '
const fs = require("fs"), path = require("path");
const rowstore = require("./lib/rowstore");
const dir = path.join(__dirname, "data", "batches");
const id = fs.readdirSync(dir).filter((f) => f.endsWith(".rows")).map((f) => f.replace(/\.rows$/, ""))[0];
if (!id) { console.log("no run with a row store"); process.exit(0); }
const total = rowstore.count(id, "replication");
const SAMPLE = 2000000;
console.log(id);
console.log(`  ${total.toLocaleString()} replication rows, `
  + `${(fs.statSync(rowstore.storeFile(id, "replication")).size / (1 << 30)).toFixed(2)} GB squashed`);
let n = 0;
const t0 = process.hrtime.bigint();
rowstore.each(id, "replication", () => { n++; return n < SAMPLE; });
const s = Number(process.hrtime.bigint() - t0) / 1e9;
console.log(`  read ${n.toLocaleString()} of them in ${s.toFixed(1)} s -- ${Math.round(n / s).toLocaleString()} rows a second`);
const whole = s * total / n;
console.log(`  so ONE pass over all of them is about ${(whole / 60).toFixed(1)} minutes (scaled from the slice above,`);
console.log("  and the table does a little arithmetic per row on top of the reading)");
console.log(`  the Boards screen asks for that table EVERY time it draws, and lib/replication.js`);
console.log("  has nothing cached in front of it, so that is the cost of each draw");
console.log("done");
' || echo "  (the sample itself ran past three minutes and was stopped -- which is its own answer)"
