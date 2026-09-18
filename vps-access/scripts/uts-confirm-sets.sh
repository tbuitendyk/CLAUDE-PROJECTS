#!/usr/bin/env bash
# READ-ONLY. Which record sets on the box carry the `confirm` dial, how many
# rows each holds, how many of those rows have it past `off`, and what any
# child set standing on them is. Nothing is written, nothing is started, no
# file is opened for anything but reading. This is the survey D1 is priced off.
set -uo pipefail
D=/opt/ultimate-trading-system/data
echo "== record set stores =="
ls -1 "$D" 2>/dev/null | head -30
echo
echo "== every set, its stage, its rows, and whether confirm is on its rows =="
node -e '
const fs=require("fs"),path=require("path");
const D="/opt/ultimate-trading-system/data";
const dirs=fs.existsSync(D)?fs.readdirSync(D):[];
const roots=dirs.filter(d=>{try{return fs.statSync(path.join(D,d)).isDirectory()}catch(e){return false}});
for(const r of roots){
  const p=path.join(D,r);
  let files=[];try{files=fs.readdirSync(p)}catch(e){continue}
  const metas=files.filter(f=>/meta|\.json$/.test(f));
  if(!metas.length)continue;
  for(const f of metas.slice(0,40)){
    const fp=path.join(p,f);
    let st;try{st=fs.statSync(fp)}catch(e){continue}
    if(!st.isFile()||st.size>60*1024*1024)continue;
    let d;try{d=JSON.parse(fs.readFileSync(fp,"utf8"))}catch(e){continue}
    if(!d||typeof d!=="object")continue;
    const stage=d.stage??d.params?.stage??null;
    const hasConfirmParam=d.params&&("confirm" in d.params);
    if(stage==null&&!hasConfirmParam)continue;
    console.log("  "+r+"/"+f+"  stage "+stage+"  name "+(d.name||d.id||"—")
      +"  rows "+(d.rows??d.count??"?")
      +"  release "+(d.release||"—")
      +(hasConfirmParam?("  params.confirm="+JSON.stringify(d.params.confirm)):"")
      +(d.parent?("  parent "+(d.parent.id||d.parent)):""));
  }
}
'
echo
echo "== disk =="
du -sh "$D" 2>/dev/null | tail -1
df -h "$D" 2>/dev/null | tail -1
