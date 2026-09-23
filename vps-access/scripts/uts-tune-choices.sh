#!/usr/bin/env bash
# READ-ONLY. Every Stage 4 record set carrying a stop or a sizing applied on
# Tune: how many survivors it has, which of them carry a sizing or a stop,
# whether that survivor is the one by depth among the captured, and when it
# was applied. Held and reserve sets show what they froze at their press.
# Reads files only.
set -uo pipefail
cd /opt/ultimate-trading-system
timeout 120 node -e '
const s=require("./lib/stages");
const docs=s.listSets().filter((x)=>x.stage===4).map((x)=>s.getSet(x.id)).filter((d)=>d&&d.stopChoices&&Object.keys(d.stopChoices).length);
console.log(`sets with a choice on record: ${docs.length}`);
for(const d of docs){
  const ch=d.stopChoices; const depth=((d.capture||{}).pick||{}).label||null;
  const sized=Object.entries(ch).filter(([,c])=>c&&c.sizing&&c.sizing.on); const stopped=Object.entries(ch).filter(([,c])=>c&&Object.prototype.hasOwnProperty.call(c,"stopPct"));
  console.log(`- ${String(d.name).slice(0,70)} (${d.id}) kind ${d.kind} survivors ${(d.survivors||[]).length} | sized ${sized.length} | stop on record ${stopped.length}`);
  for(const [L,c] of sized.slice(0,3)) console.log(`    sized: ${String(L).slice(0,60)}${L===depth?" [the one by depth]":""} at ${String(c.sizing.at||"").slice(0,16)}`);
}'
