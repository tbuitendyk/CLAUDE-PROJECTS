#!/usr/bin/env bash
# classifier-latest-declared.sh -- READ-ONLY: newest bracketlab doc's declared
# config and a sample of its replication rows, to verify what a running
# replication sweep is actually scoring.
set -uo pipefail
node -e '
const fs = require("fs"), path = require("path");
const dir = "/opt/general-classifier/data/batches";
const f = fs.readdirSync(dir).filter((x) => x.startsWith("bracketlab-") && x.endsWith(".json")).sort().pop();
const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
console.log("doc:", d.id, "status:", d.status, "phase:", d.perf && d.perf.phase);
console.log("declared:", JSON.stringify(d.params.declared));
console.log("replication rows:", (d.replication || []).length);
for (const r of (d.replication || []).slice(0, 5)) {
  console.log(`  ${r.trade}: quorum ${r.quorum}/${r.members} pnl ${r.pnl}`);
}
'
