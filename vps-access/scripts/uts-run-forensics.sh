#!/usr/bin/env bash
# uts-run-forensics.sh -- READ-ONLY. What happened to the runs on this box: every
# run's state, how far each got, when it was picked up, when the service
# restarted, and what the deployed code says about resuming each one. Changes
# nothing and starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1

echo "== is anything going right now =="
curl -sf --max-time 20 http://127.0.0.1:8094/api/batches -o /tmp/uts-b.json \
  && python3 -c 'import json;d=json.load(open("/tmp/uts-b.json"));print("  running:",d.get("running"))' \
  || echo "  the service did not answer"

echo
echo "== every run =="
node -e '
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "data", "batches");
const batch = require("./lib/batch");
const rowstore = require("./lib/rowstore");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (d.kind !== "bracketlab") continue;
  const p = d.perf || {};
  const pl = d.plan || {};
  console.log(`\n${d.id}`);
  console.log(`  status      ${d.status}`);
  console.log(`  started     ${d.startedAt}`);
  console.log(`  finished    ${d.finishedAt || "-"}`);
  console.log(`  phase       ${p.phase}   units ${p.unitsDone}/${p.unitsTotal}   runs ${p.runsDone}/${p.runsTotal}`);
  console.log(`  plan        ${pl.units} unit(s), ${pl.slimRuns} first-pass, ${pl.promoteRuns} second-pass`);
  console.log(`  progress    ${String(d.progress).slice(0, 110)}`);
  console.log(`  error       ${d.error ? String(d.error).slice(0, 160) : "-"}`);
  console.log(`  leaders     ${(d.leaders || []).length}   failures ${(d.failures || []).length}   modelFiles ${d.modelFiles || 0}`);
  for (const [k, v] of Object.entries(d.rowCounts || {})) {
    console.log(`  rows ${k.padEnd(12)} doc says ${String(v).padStart(12)}   on disk ${String(rowstore.count(d.id, k)).padStart(12)}  (${rowstore.formatOf(d.id, k)})`);
  }
  for (const r of (d.resumes || [])) {
    console.log(`  PICKED UP   ${r.at}  skipped ${r.skippedUnits} unit(s), ${r.remainingUnits} to go`
      + (r.skippedPromoted != null ? `, ${r.skippedPromoted} already scored in full` : "")
      + `, engine ${r.engineVersion}, prices ${String(r.dataDigest).slice(0, 12)}`);
  }
  try {
    const c = batch.resumeContents(d.id);
    console.log(`  RESUMABLE   ${c.resumable}${c.why.length ? "  -- " + c.why.join("; ") : ""}`);
    console.log(`              first pass ${c.unitsScored}/${c.unitsPlanned}, scored in full ${c.promotedScored}`);
  } catch (e) { console.log(`  resumeContents threw: ${e.message}`); }
}
'

echo
echo "== when the service stopped and started =="
journalctl -u ultimate-trading-system --since '-8 hours' --no-pager 2>/dev/null \
  | grep -E 'Started|Stopping|Stopped|Scheduled restart|Consumed|listening' | tail -24 | cut -c1-150

echo
echo "== and this session's deploys, which restart it =="
journalctl -u ultimate-trading-system --since '-8 hours' --no-pager -o short-iso 2>/dev/null \
  | grep -cE 'Started Ultimate' | sed 's/^/  starts in the last 8 hours: /'

echo
df -h / | tail -1 | sed 's/^/disk  /'
