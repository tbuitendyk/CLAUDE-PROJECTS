#!/usr/bin/env bash
# uts-set-file-kinds.sh -- READ-ONLY. Every kind of file or folder named after a
# record set in data/stagesets, the set's id replaced by <id>, with how many
# there are -- so the deletion of a set can be held to every kind that exists.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 60 node -e '
const fs = require("fs");
const kinds = {};
for (const f of fs.readdirSync("data/stagesets")) {
  const m = /^(s[1-4]-[a-z0-9]+-[0-9]+)([-.].*)$/.exec(f);
  const k = m ? "<id>" + m[2].replace(/s[1-4]-[a-z0-9]+-[0-9]+/g, "<id>").replace(/-reserve-.*\.json\.gz$/, "-reserve-<unit>.json.gz").replace(/-h[0-9]+\./, "-h<n>.") : (fs.statSync("data/stagesets/" + f).isDirectory() ? f + "/ (folder)" : "(other) " + f);
  kinds[k] = (kinds[k] || 0) + 1;
}
for (const [k, n] of Object.entries(kinds).sort()) console.log(String(n).padStart(5), k);
' 2>&1 | tail -c 4000
