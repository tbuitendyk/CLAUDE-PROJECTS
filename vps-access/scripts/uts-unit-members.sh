#!/usr/bin/env bash
# uts-unit-members.sh -- READ-ONLY. Why a unit's members panel on Boards says it
# could not read them: for every record set whose name holds the text given,
# its status, its records and the number each carries, the rows the Boards
# table is drawn from and the number each row carries, and what the members
# reader answers for each of those numbers. Changes nothing.
#   usage: uts-unit-members.sh <part of the record set's name>
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
PART="${1:-S1-LTC}"
sudo -u uts timeout 120 nice -n 10 node -e '
const stages = require("./lib/stages");
const part = process.argv[1];
const hits = stages.listSets().filter((x) => String(x.name || "").includes(part));
if (!hits.length) { console.log(`no record set has "${part}" in its name`); process.exit(0); }
for (const s of hits) {
  const doc = stages.getSet(s.id);
  console.log(`${s.id} "${s.name}" stage ${s.stage} status ${doc.status} · plan units ${(doc.plan || {}).units} · counts ${JSON.stringify(doc.counts || null)}`);
  let recs = [];
  try { recs = stages.allRecords(s.id) || []; } catch (e) { console.log("   records could not be read:", e.message); }
  console.log(`   ${recs.length} record(s); their numbers: ${JSON.stringify(recs.slice(0, 20).map((r) => r.u))}; first record holds: ${recs[0] ? Object.keys(recs[0]).join(", ") : "-"}`);
  if (s.stage === 1) {
    let t = null;
    try { t = stages.stage1Table(s.id, 0, 20, null); } catch (e) { console.log("   the table could not be read:", e.message); }
    const rows = (t && t.rows) || [];
    console.log(`   the table: ${rows.length} row(s) of ${t ? t.total : "?"}; the numbers they carry: ${JSON.stringify(rows.map((r) => r.u))}`);
    for (const r of rows.slice(0, 5)) {
      try {
        const m = stages.unitMembers(s.id, r.u);
        console.log(`   members for number ${r.u}: ${m ? `${m.members} member(s), scored ${m.scored}` : "none found (the screen says it could not read them)"}`);
      } catch (e) { console.log(`   members for number ${r.u}: the reader failed: ${e.message}`); }
    }
  }
}
' "$PART"
