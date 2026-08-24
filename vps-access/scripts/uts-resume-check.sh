#!/usr/bin/env bash
# uts-resume-check.sh -- READ-ONLY. Asks the DEPLOYED code the same question the
# screen asks it: can this run be picked up, how much of it is already done, and
# what would refuse it. Also prints what the rows now cost on disk and what the
# one-off conversion found. Starts nothing and changes nothing.
set -uo pipefail
ROOT=/opt/ultimate-trading-system
cd "$ROOT" || exit 1
node -e '
const fs = require("fs"), path = require("path");
const batch = require("./lib/batch");
const rowstore = require("./lib/rowstore");
const dir = path.join(__dirname, "data", "batches");
const runs = fs.readdirSync(dir).filter((f) => f.endsWith(".rows")).map((f) => f.replace(/\.rows$/, ""));
for (const id of runs) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, id + ".json"), "utf8"));
  console.log(id);
  console.log(`  status ${doc.status}, phase ${(doc.perf || {}).phase}`);
  for (const name of ["slim", "census", "replication"]) {
    const f = rowstore.storeFile(id, name);
    let sz = 0; try { sz = fs.statSync(f).size; } catch (_) {}
    console.log(`  ${name.padEnd(12)} ${String(rowstore.formatOf(id, name)).padEnd(9)} `
      + `${rowstore.count(id, name).toLocaleString().padStart(12)} rows  ${(sz / (1 << 30)).toFixed(2)} GB`);
  }
  let r;
  try { r = batch.resumeContents(id); } catch (e) { console.log(`  resumeContents threw: ${e.message}`); continue; }
  console.log(`  RESUMABLE: ${r.resumable}${r.why.length ? "  -- " + r.why.join("; ") : ""}`);
  console.log(`  engine ${r.engineVersion} vs ${r.engineNow}; price files ${r.dataFingerprint}`);
  console.log(`  units ${r.unitsScored}/${r.unitsPlanned} scored, ${r.unitsLeft} left`);
  console.log(`  scored in full: ${r.promotedScored}  (${r.promotedUnnamed} of them cannot say which unit they are)`);
  console.log(`  failures so far ${r.failures}, times picked up ${r.resumes}`);
  const rep = path.join(dir, id + ".rows", "squash-report.json");
  if (fs.existsSync(rep)) {
    const s = JSON.parse(fs.readFileSync(rep, "utf8"));
    console.log(`  -- the one-off conversion, ${s.at} --`);
    for (const [k, v] of Object.entries(s.collections)) {
      console.log(`     ${k.padEnd(12)} ${(v.plainBytes / (1 << 30)).toFixed(2)} GB -> ${(v.squashedBytes / (1 << 30)).toFixed(2)} GB, `
        + `${v.rows.toLocaleString()} rows, ${v.tornLinesDropped} unreadable line(s) dropped`);
    }
    console.log(`     replication holds ${s.replicationWholeUnits} whole unit(s)`
      + `${s.replicationPartialUnits ? " and 1 cut in the middle" : ""}`);
    console.log(`     census rows owning no replication rows: ${s.gapIfEveryCensusRowOwnsReplicationRows}`
      + ` or ${s.gapIfNoCellRowsOwnNone}, depending on whether a no-cell row should own any`
      + ` (${s.censusNoCellRows} reached no cell)`);
  }
}
'
echo "-- what the rest of the run will need room for --"
for d in /opt/ultimate-trading-system/data/models/*/; do
  [ -d "$d" ] || continue
  N=$(find "$d" -maxdepth 1 -type f | wc -l)
  SZ=$(du -sh "$d" 2>/dev/null | cut -f1)
  echo "  $(basename "$d"): $N model dump(s), $SZ"
done
du -sh /opt/ultimate-trading-system/data 2>/dev/null | sed 's/^/  all data: /'
df -h / | tail -1 | sed 's/^/disk  /'
