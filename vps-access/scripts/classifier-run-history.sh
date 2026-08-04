#!/usr/bin/env bash
# classifier-run-history.sh -- READ-ONLY: every batch doc from 2026-08-03 0600
# onward, chronological: id, kind, status, description, notes.
set -uo pipefail
node -e '
const fs = require("fs"), path = require("path");
const dir = "/opt/general-classifier/data/batches";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
for (const f of files) {
  let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
  if (!d.startedAt || d.startedAt < "2026-08-03T06:00") continue;
  const p = d.params || {};
  console.log(`${d.startedAt.slice(5, 16)} | ${d.id} | ${d.status}`);
  if (p.campaign) console.log(`    campaign: ${p.campaign}`);
  if (d.description) console.log(`    desc: ${String(d.description).slice(0, 160)}`);
  if (p.plantedGate) console.log("    (planted check)");
  if (p.declared) console.log(`    declared: ${JSON.stringify(p.declared).slice(0, 120)}`);
  if (d.notes) console.log(`    notes: ${String(d.notes).slice(0, 100)}`);
}
'
