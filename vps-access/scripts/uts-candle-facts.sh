#!/usr/bin/env bash
# uts-candle-facts.sh -- read-only. Answers one question the data audit raised:
# of the candle months that hold fewer hours than the month has, how many are a
# pair's FIRST or LAST cached month (partial because the pair had not started
# trading yet, or because the month is not over), and how many are a month in
# the MIDDLE, which has no innocent explanation.
#
# The audit reported 304 short months. Reporting that number without splitting
# it would read as an alarm when most of it may be ordinary.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
node -e '
const fs=require("fs"),path=require("path");
const dir="/opt/ultimate-trading-system/data/cache";
const HOUR=3600000;
const hoursIn=(y,m)=>(Date.UTC(m===12?y+1:y,m===12?0:m,1)-Date.UTC(y,m-1,1))/HOUR;
const bySym={}; const intervals={};
for(const f of fs.readdirSync(dir)){
  const m=/^([A-Z0-9]+)-([0-9]+[mhd])-(\d{4})-(\d{2})(-(\d{2}))?\.json$/.exec(f);
  if(!m){ console.log("  unrecognised name:",f); continue; }
  intervals[m[2]]=(intervals[m[2]]||0)+1;
  if(m[2]!=="1h"||m[6]) continue;
  (bySym[m[1]]=bySym[m[1]]||[]).push({f,y:+m[3],mo:+m[4],key:`${m[3]}-${m[4]}`});
}
console.log("intervals cached:",JSON.stringify(intervals));
console.log("symbols:",Object.keys(bySym).length);
let edgeShort=0,midShort=0,midGap=0,edgeGap=0; const worst=[];
for(const [sym,list] of Object.entries(bySym)){
  list.sort((a,b)=>a.key.localeCompare(b.key));
  const first=list[0].key,last=list[list.length-1].key;
  for(const it of list){
    const rows=JSON.parse(fs.readFileSync(path.join(dir,it.f),"utf8"));
    if(!Array.isArray(rows)) continue;
    const expect=hoursIn(it.y,it.mo);
    const edge=it.key===first||it.key===last;
    const ts=rows.map(r=>r&&r.ts);
    const holes=ts.filter((t,i)=>i>0&&t-ts[i-1]>HOUR).length;
    if(rows.length<expect){ if(edge) edgeShort++; else { midShort++; worst.push(`${sym} ${it.key}: ${rows.length}/${expect}`); } }
    if(holes){ if(edge) edgeGap++; else midGap++; }
  }
}
console.log("");
console.log("SHORT months (fewer hours than the month has):");
console.log("  at a pair first/last cached month (expected):",edgeShort);
console.log("  in the MIDDLE of a pair history (no innocent explanation):",midShort);
console.log("");
console.log("months with a HOLE in the middle:");
console.log("  at a pair first/last month:",edgeGap);
console.log("  in the MIDDLE of a pair history:",midGap);
console.log("");
worst.sort((a,b)=>(+a.split(": ")[1].split("/")[0])-(+b.split(": ")[1].split("/")[0]));
console.log("the 15 worst middle-of-history short months:");
worst.slice(0,15).forEach(w=>console.log("  "+w));
'
