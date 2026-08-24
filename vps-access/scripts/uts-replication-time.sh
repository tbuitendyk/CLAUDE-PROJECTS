#!/usr/bin/env bash
# uts-replication-time.sh -- READ-ONLY. How long the Replication table actually
# takes to build, and how big the answer is. Writes nothing under data/; it
# calls the same lib/replication.js the screen calls, on the deployed code.
#
# Worth measuring rather than assuming: rank() streams every recorded row on
# every request and there is nothing cached in front of it, so the cost of
# drawing that table is the cost of reading the whole collection.
#
# DETACHED, because the first attempt at this ran past the ten minutes the
# endpoint will hold a connection open and came back with nothing -- which
# proves only that it is slower than the transport, not how slow. Start it, then
# read the log with this same script.
set -uo pipefail
LOG=/var/log/uts-replication-time.log

if pgrep -f 'uts-replication-time-inner' >/dev/null 2>&1; then
  echo "still timing (pid $(pgrep -f 'uts-replication-time-inner' | head -1))"
  echo "---- so far ----"; cat "$LOG" 2>/dev/null; exit 0
fi
if [ "${1:-}" != "again" ] && [ -s "$LOG" ] && grep -q '^done' "$LOG" 2>/dev/null; then
  cat "$LOG"; exit 0
fi

cat > /tmp/uts-replication-time-inner.js <<'JS'
const fs = require("fs"), path = require("path");
const ROOT = "/opt/ultimate-trading-system";
const rowstore = require(ROOT + "/lib/rowstore");
const replication = require(ROOT + "/lib/replication");
const dir = path.join(ROOT, "data", "batches");
const id = fs.readdirSync(dir).filter((f) => f.endsWith(".rows")).map((f) => f.replace(/\.rows$/, ""))[0];
if (!id) { console.log("no run with a row store"); process.exit(0); }
const doc = JSON.parse(fs.readFileSync(path.join(dir, id + ".json"), "utf8"));
console.log(id);
console.log(`  ${rowstore.count(id, "replication").toLocaleString()} replication rows, `
  + `${(fs.statSync(rowstore.storeFile(id, "replication")).size / (1 << 30)).toFixed(2)} GB on disk`);
// A bare walk first: what it costs merely to READ every row, with no arithmetic
// on top. That separates the cost of the store from the cost of the table.
let t0 = process.hrtime.bigint();
let n = 0;
rowstore.each(id, "replication", () => { n++; });
console.log(`  walking all ${n.toLocaleString()} rows and doing nothing: `
  + `${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1)} s`);
for (let i = 0; i < 2; i++) {
  t0 = process.hrtime.bigint();
  const out = replication.rank(doc, { offset: 0, limit: 100 });
  const s = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`  rank() call ${i + 1}: ${s.toFixed(1)} s, ${out.rows ? out.rows.length : "?"} of ${out.total} `
    + `line(s) back, ${(Buffer.byteLength(JSON.stringify(out)) / (1 << 10)).toFixed(0)} KB of payload`);
}
console.log("  (the second call is the same work again: there is nothing cached in front of it)");
console.log("done " + new Date().toISOString());
JS

: > "$LOG"
setsid nohup node /tmp/uts-replication-time-inner.js >>"$LOG" 2>&1 < /dev/null &
sleep 20
echo "started; run this script again to read it"
echo "---- so far ----"; cat "$LOG" 2>/dev/null
