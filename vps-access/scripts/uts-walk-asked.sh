#!/usr/bin/env bash
# uts-walk-asked.sh -- READ-ONLY. Exactly what the owner's finished walk was
# asked for, so the same run can be started again after a deploy.
set -uo pipefail
curl -s -m 240 -o /tmp/uts-wa.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/uts-wa.json","utf8"));
console.log("running:", j.running, " of:", j.of, " done:", j.done, " finishedAt:", j.finishedAt);
console.log(JSON.stringify(j.asked, null, 1));
console.log("rows:", (j.rows||[]).length);
const r=(j.rows||[])[0]; if(r) console.log("first row keys:", Object.keys(r).join(","), "| scan entry:", JSON.stringify((r.scan||[])[0]));
' 2>&1 | head -40
rm -f /tmp/uts-wa.json
