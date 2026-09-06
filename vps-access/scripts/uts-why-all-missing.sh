#!/usr/bin/env bash
# uts-why-all-missing.sh -- READ-ONLY. Why the missing-units count reads as the
# whole plan. Prints what the plan holds, what the record store holds, and what
# the two have in common. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
echo "== is anything running =="
curl -sf --max-time 20 http://127.0.0.1:8094/api/stagesets | python3 -c 'import sys,json; d=json.load(sys.stdin); print("running:", d.get("running") or "nothing")' 2>/dev/null || echo "(no answer)"
node -e '
const st = require("./lib/stages");
const rowstore = require("./lib/rowstore");
let doc = null;
for (const s of (st.listSets() || [])) { if (s && s.id && String(s.name).includes("S1 #3")) doc = st.getSet(s.id); }
if (!doc) { console.log("no S1 #3"); process.exit(0); }
console.log("set " + doc.id + "  stage " + doc.stage + "  status " + doc.status);
const plan = doc.plan || {};
console.log("plan.units          " + plan.units);
console.log("plan.unitList       " + (Array.isArray(plan.unitList) ? plan.unitList.length + " entries" : JSON.stringify(plan.unitList)));
console.log("counts              " + JSON.stringify(doc.counts));
console.log("rowstore count      " + rowstore.count(doc.id, "records"));
let rows = [];
try { rows = rowstore.readAll(doc.id, "records"); } catch (e) { console.log("readAll THREW: " + e.message); }
console.log("readAll             " + rows.length + " rows");
if (rows.length) {
  console.log("first row keys      " + Object.keys(rows[0]).join(","));
  console.log("first five u        " + rows.slice(0,5).map(r => JSON.stringify(r.u)).join(", "));
  console.log("u typeof            " + typeof rows[0].u);
  const us = rows.map(r => r.u).filter(u => Number.isInteger(u));
  console.log("integer u values    " + us.length + "   min " + Math.min(...us) + "  max " + Math.max(...us));
}
if (Array.isArray(plan.unitList) && plan.unitList.length) console.log("plan[0]             " + JSON.stringify(plan.unitList[0]));
const gaps = st.missingUnitsOf(doc);
console.log("missingUnitsOf      " + (gaps ? JSON.stringify({ total: gaps.total, have: gaps.have, missing: gaps.missing.length }) : "null"));
console.log("refusal             " + JSON.stringify(st.unitFillRefusal(doc)));
'
