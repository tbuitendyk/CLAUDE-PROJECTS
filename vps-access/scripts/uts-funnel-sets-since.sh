#!/usr/bin/env bash
# READ-ONLY. The Funnel sets (stage 4) cut on or after a date (YYYY-MM-DD,
# default 2026-09-22): name, id, when, release, the stage 3 set it was cut
# from, its coin and shape (or all units together), what the filter on
# Table 3.C kept when it was cut (3.233.0+), and how many settings it kept.
# Reads the set documents only; nothing started, nothing written.
set -uo pipefail
SINCE="${1:-2026-09-22}"
case "$SINCE" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
  *) echo "usage: uts-funnel-sets-since.sh YYYY-MM-DD" >&2; exit 2 ;;
esac
cd /opt/ultimate-trading-system
SINCE="$SINCE" node -e '
const s=require("./lib/stages");
const since=process.env.SINCE;
const all=s.listSets().filter((x)=>x.stage===4);
const docs=all.map((x)=>s.getSet(x.id)).filter((d)=>d && String(d.createdAt||"")>=since);
console.log(`stage 4 sets on the box: ${all.length}; cut on or after ${since}: ${docs.length}`);
for (const d of docs) {
  console.log(`  ${d.name} (${d.id}) kind ${d.kind||"-"} cut ${String(d.createdAt).slice(0,16)} release ${d.release||"-"}`);
  console.log(`     from ${(d.parent||{}).name||"-"} | ${d.unitName||"all units together"} | keptUnits ${Array.isArray(d.keptUnits)?d.keptUnits.length:"none recorded"} | kept ${JSON.stringify((d.counts||{}).survivors??null)}`);
}'
