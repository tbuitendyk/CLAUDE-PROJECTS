#!/usr/bin/env bash
# uts-replication-time.sh -- READ-ONLY. How long the Replication table actually
# takes to build now, and how big the answer is. Writes nothing; it calls the
# same lib/replication.js the screen calls, on the deployed code, and times it.
#
# Worth measuring rather than assuming: rank() streams every recorded row on
# every request and there is no cache in front of it, so the cost of drawing
# that table is the cost of reading the whole collection. That was true before
# the rows were squashed too -- this says what it is now, in seconds.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
node -e '
const fs = require("fs"), path = require("path");
const rowstore = require("./lib/rowstore");
const replication = require("./lib/replication");
const dir = path.join(__dirname, "data", "batches");
const id = fs.readdirSync(dir).filter((f) => f.endsWith(".rows")).map((f) => f.replace(/\.rows$/, ""))[0];
if (!id) { console.log("no run with a row store"); process.exit(0); }
const doc = JSON.parse(fs.readFileSync(path.join(dir, id + ".json"), "utf8"));
console.log(id);
console.log(`  ${rowstore.count(id, "replication").toLocaleString()} replication rows, `
  + `${(fs.statSync(rowstore.storeFile(id, "replication")).size / (1 << 30)).toFixed(2)} GB on disk`);
for (const q of [{ offset: 0, limit: 100 }, { offset: 0, limit: 100 }]) {
  const t0 = process.hrtime.bigint();
  const out = replication.rank(doc, q);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const bytes = Buffer.byteLength(JSON.stringify(out));
  console.log(`  rank(offset ${q.offset}, limit ${q.limit}): ${(ms / 1000).toFixed(1)} s, `
    + `${out.rows ? out.rows.length : "?"} of ${out.total} line(s) back, ${(bytes / (1 << 10)).toFixed(0)} KB of payload`);
}
console.log("  (the second call is the same work again: there is no cache in front of it)");
'
