#!/usr/bin/env bash
# READ-ONLY. For every per-trade capture on the box: how many of its captured
# survivors hold a different NUMBER of trades than their set recorded (test or
# held-back), how many match in number but not in money, how many survivors
# read the field, and how many looks at held-back and at reserve the capture
# has counted. Reads files only.
set -uo pipefail
cd /opt/ultimate-trading-system
timeout 240 node -e '
const fs=require("fs"),zlib=require("zlib"),path=require("path");
const s=require("./lib/stages");
const dir="data/stagesets";
for (const f of fs.readdirSync(dir).filter((x)=>x.endsWith("-capture.json.gz"))) {
  let c=null; try{c=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,f))).toString("utf8"));}catch(e){console.log(f+": unreadable");continue;}
  const doc=s.getSet(c.id); const reads=((doc||{}).capture||{}).reads||[];
  let countDiff=0, moneyOnly=0, same=0, field=0; const ex=[];
  for (const sv of c.survivors||[]) {
    if(/field/.test(String(sv.label||""))) field++;
    const nt=(sv.entries.test||[]).length, nh=(sv.entries.hold||[]).length;
    const rt=sv.trades?sv.trades.test:null, rh=sv.trades?sv.trades.hold:null;
    const sum=(w)=>Math.round((sv.entries[w]||[]).reduce((a,e)=>a+(Number(e.usd)||0),0)*100)/100;
    const mt=sv.money&&sv.money.test!=null?Math.round(sv.money.test*100)/100:null;
    const mh=sv.money&&sv.money.hold!=null?Math.round(sv.money.hold*100)/100:null;
    if (nt!==rt || (rh!=null && nh!==rh)) { countDiff++; if(ex.length<1) ex.push(`${String(sv.label).slice(0,50)}: test ${nt} vs ${rt}, held-back ${nh} vs ${rh}`); }
    else if (Math.abs(sum("test")-mt)>=0.02 || (mh!=null && Math.abs(sum("hold")-mh)>=0.02)) moneyOnly++;
    else same++;
  }
  console.log(`- ${c.id} taken ${String(c.at).slice(0,16)} | ${ (c.survivors||[]).length} survivors, ${field} read the field | different number of trades ${countDiff} | same number, different money ${moneyOnly} | same in both ${same} | looks at held-back ${reads.filter((r)=>r&&r.look!=null).length}, at reserve ${reads.filter((r)=>r&&r.reserveLook!=null).length}, scans run ${reads.length}`);
  for (const x of ex) console.log("    e.g. "+x);
}'
