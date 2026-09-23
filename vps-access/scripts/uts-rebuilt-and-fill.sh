#!/usr/bin/env bash
# uts-rebuilt-and-fill.sh -- READ-ONLY. (1) Every Stage 4 set rebuilt in place:
# what it was rebuilt from, and its survivors before and after. (2) For every
# Stage 4 set whose coin and shape reads a field, the field completion numbers
# Tune shows at 25, 33 and 100%, asked of the running service. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
echo "== (1) rebuilt in place"
sudo -u uts timeout 60 node -e '
const fs = require("fs"); const path = require("path");
const D = "data/stagesets";
for (const f of fs.readdirSync(D).filter((x) => /^s4-[a-z0-9]+-[0-9]+\.json$/.test(x))) {
  const d = JSON.parse(fs.readFileSync(path.join(D, f), "utf8"));
  if (!d.rebuilt) continue;
  const r = d.rebuilt;
  console.log(`- ${d.id} "${String(d.name).slice(0, 70)}": rebuilt ${String(r.at).slice(0, 16)} from release ${r.fromRelease} under ${r.release}; survivors ${r.survivorsBefore} before, ${r.survivorsNow} now, ${r.keptOfBefore} of the old ones kept`);
}' 2>&1 | tail -c 2500
echo "== (2) field completion, as Tune shows it"
ids=$(sudo -u uts node -e '
const fs = require("fs"); const s = require("./lib/stages");
for (const x of s.listFunnelSets().filter((d) => !d.exam)) { try { if (s.fieldPairOfSet(x)) console.log(x.id); } catch (_) {} }' 2>/dev/null)
for id in $ids; do
  curl -sS -m 30 "http://127.0.0.1:8094/api/funnel/set/$id/capture" | python3 -c '
import sys, json
d = json.load(sys.stdin); f = d.get("fieldFill") or {}
if f.get("why"): print("-", d.get("id"), "cannot be measured:", f["why"]); sys.exit(0)
rows = f.get("rows") or []
def row(p):
    r = rows[p]; t = r["total"] or 1
    return f"{p}%: evidence {round(100*r[\"evidence\"])}%, building {r[\"building\"]}, partial {r[\"partial\"]}, full {r[\"full\"]} of {r[\"total\"]} days ({round(100*(r[\"partial\"]+r[\"full\"])/t)}% traded)"
print(f"- {d.get(\"id\")} {str(d.get(\"name\",\"\"))[:55]} | window {f.get(\"windowDays\")} d | " + " | ".join(row(p) for p in (25, 33, 100) if len(rows) > p))
'
done
