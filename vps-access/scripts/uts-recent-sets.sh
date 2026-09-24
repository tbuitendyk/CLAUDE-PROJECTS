#!/usr/bin/env bash
# uts-recent-sets.sh -- READ-ONLY. The newest record sets on the box, any stage:
# name, status, when made and finished, what they last said and any error --
# and the service's own log lines about starts and failures over the last
# hours. For a start that seemed to vanish. Changes nothing.
#   usage: uts-recent-sets.sh [how many, default 8]
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
N="${1:-8}"
sudo -u uts timeout 60 node -e '
const stages = require("./lib/stages");
const n = Number(process.argv[1]) || 8;
const rows = stages.listSets().slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, n);
for (const s of rows) {
  const d = stages.getSet(s.id) || {};
  console.log(`${s.id} · stage ${s.stage} · "${s.name}" · ${d.status} · made ${d.createdAt || "?"} · finished ${d.finishedAt || "-"} · units ${(d.plan || {}).units ?? "?"}`);
  if (d.error) console.log(`   error: ${String(d.error).slice(0, 300)}`);
  if (d.progress) console.log(`   last said: ${String(d.progress).slice(0, 200)}`);
}
' "$N"
echo "== the service log, last 6 hours, starts and failures"
journalctl -u ultimate-trading-system --since "6 hours ago" --no-pager 2>/dev/null | grep -i -E "stage ?1|stage1|error|fail|refus|interrupt" | tail -25 || true
