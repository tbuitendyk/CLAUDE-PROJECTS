#!/usr/bin/env bash
# READ-ONLY. For the Stage 4 sets cut on or after a date (YYYY-MM-DD, default
# 2026-09-23): the coin and shape each was cut on, what its recorded sealed
# window holds (how many units, whether this one is among them, and a few of
# the keys it does hold), and where the parent's release is -- the fields the
# footing line on Held and Reserve reads. Nothing written.
set -uo pipefail
SINCE="${1:-2026-09-23}"
case "$SINCE" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "usage: uts-footing-probe.sh YYYY-MM-DD" >&2; exit 2 ;; esac
cd /opt/ultimate-trading-system
SINCE="$SINCE" node -e '
const s=require("./lib/stages");
const since=process.env.SINCE;
const docs=s.listSets().filter((x)=>x.stage===4).map((x)=>s.getSet(x.id)).filter((d)=>d&&!d.exam&&String(d.createdAt||"")>=since);
console.log(`stage 4 sets cut on or after ${since}: ${docs.length}`);
for (const d of docs) {
  const sealed=d.sealed||{}; const us=Array.isArray(sealed.units)?sealed.units:[];
  const keys=us.map((u)=>s.unitKeyOf(u));
  console.log(`- ${d.name} (${d.id}) kind ${d.kind} release ${d.release} unit ${d.unit||"all units together"}`);
  console.log(`   sealed: layout ${sealed.layout||"-"} sealed ${sealed.sealed} units ${us.length} missing ${sealed.missing??"-"} this unit among them: ${d.unit?keys.includes(d.unit):"-"} why: ${sealed.why||"-"}`);
  console.log(`   sealed unit keys (first 6): ${keys.slice(0,6).join("  ")}`);
  const trades=[...new Set(us.map((u)=>`${u.trade}|${u.geometry}`))];
  console.log(`   same coin and shape without the alongside coins among them: ${d.unit?trades.includes(d.unit.split("|")[0]+"|"+d.unit.split("|")[3]):"-"}`);
  const p=s.getSet((d.parent||{}).id)||{};
  const pp=p.params||{};
  console.log(`   parent ${p.name||"-"}: set.parent.release ${(d.parent||{}).release??"none"} | parent.params.engineVersion ${pp.engineVersion??"none"} | parent.release ${p.release??"none"} | parent.engineVersion ${p.engineVersion??"none"} | parent.recordsVersion ${p.recordsVersion??"none"} | params keys with version: ${Object.keys(pp).filter((k)=>/ersion/i.test(k)).join(",")||"none"}`);
  const gp=s.getSet(pp.from||(p.parent||{}).id)||{};
  console.log(`   grandparent ${gp.name||"-"}: units are ${(gp.params||{}).unitsMode||(gp.params||{}).combos||"?"}`);
}'
