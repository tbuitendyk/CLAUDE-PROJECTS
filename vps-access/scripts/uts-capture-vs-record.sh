#!/usr/bin/env bash
# READ-ONLY. For every per-trade capture on the box: each captured survivor's
# test and held-back trades added up, set beside the money the set itself
# recorded for that survivor on the same windows, with the trade counts, and
# whether the survivor carries a field bar. A capture that holds exactly the
# trades the setting takes adds up to the record; one that does not, does not.
# Reads files only. Nothing written, nothing started.
set -uo pipefail
cd /opt/ultimate-trading-system
timeout 240 node -e '
const fs=require("fs"),zlib=require("zlib"),path=require("path");
const dir="data/stagesets";
const files=fs.readdirSync(dir).filter((f)=>f.endsWith("-capture.json.gz"));
console.log(`captures on the box: ${files.length}`);
for (const f of files) {
  let c=null; try{c=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,f))).toString("utf8"));}catch(e){console.log(f+": unreadable");continue;}
  const sv=c.survivors||[];
  let same=0, differ=0, gated=0; const ex=[];
  for (const s of sv) {
    const g=/field/.test(String(s.label||"")); if(g) gated++;
    const sum=(w)=>Math.round((s.entries[w]||[]).reduce((a,e)=>a+(Number(e.usd)||0),0)*100)/100;
    const t=sum("test"), h=sum("hold");
    const rt=s.money&&s.money.test!=null?Math.round(s.money.test*100)/100:null;
    const rh=s.money&&s.money.hold!=null?Math.round(s.money.hold*100)/100:null;
    const nt=(s.entries.test||[]).length, rnt=s.trades?s.trades.test:null;
    const ok=rt!=null&&Math.abs(t-rt)<0.02&&(rh==null||Math.abs(h-rh)<0.02);
    if(ok) same++; else { differ++; if(ex.length<2) ex.push(`${String(s.label).slice(0,70)}${g?" [field bar]":""}: test trades captured ${nt} vs recorded ${rnt}, money captured ${t} vs recorded ${rt}; held-back captured ${h} vs recorded ${rh}`); }
  }
  console.log(`- ${c.id} taken ${String(c.at).slice(0,16)} release ${c.release}: ${sv.length} survivors, ${gated} with a field bar | add up to the record ${same} | do not ${differ}`);
  for (const x of ex) console.log("    e.g. "+x);
}'
