#!/usr/bin/env bash
# READ-ONLY. For every record set on the box: which one-off migrations have
# been applied to it, read off the set documents ON DISK (the service's list
# view trims the plan) and the first record of each set's store -- the 3.44.0
# gate strip (gates), the 3.46.0 tuning-slice money (money on stage 1/2
# records), the 3.51.0 sealed window (reserve on stage 2 records), the 3.52.0
# per-unit fold (unitSettings / foldedPerUnit), the records version. Nothing
# started, nothing written.
set -uo pipefail
D=/opt/ultimate-trading-system/data
for f in "$D"/stagesets/s[123]-*.json; do
  id=$(basename "$f" .json)
  node -e '
const fs=require("fs");const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));const plan=d.plan||{};
console.log(`${String(d.name).padEnd(8)} stage ${d.stage} ${d.id.padEnd(16)} ${d.status} engine ${d.engineVersion||(d.params||{}).engineVersion||"-"} recordsVersion ${d.recordsVersion??"-"}`);
console.log(`         gates ${JSON.stringify(d.gates??null)} | unitSettings ${Array.isArray(plan.unitSettings)?plan.unitSettings.length+" units, pricings "+plan.pricings:"none"} | foldedPerUnit ${JSON.stringify(plan.foldedPerUnit||null)} | boardNull ${d.boardNull?"yes":"no"} | settings ${plan.settings} units ${plan.units}`);
' "$f"
  node -e '
const rs=require("/opt/ultimate-trading-system/lib/rowstore");const id=process.argv[1];
let rows=[];try{rows=rs.readBlocks(id,"records",[0])||[]}catch(e){console.log("         records: cannot read the first block -- "+e.message);process.exit(0)}
const x=rows[0];if(!x){console.log("         records: the first block is empty");process.exit(0)}const row=x.row||x;
console.log(`         first record: money ${"money" in row?("present ("+row.money+")"):"ABSENT"} | reserve ${"reserve" in row?(row.reserve?"present":"null"):"ABSENT"} | si ${row.si??"-"} u ${row.u??"-"} | ${Object.keys(row).length} fields | ${rs.count(id,"records")} records`);
' "$id"
done
