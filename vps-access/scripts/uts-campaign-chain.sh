#!/bin/bash
# read-only: every stage 2 / 3 / 4 set whose campaign differs from its stage 1 root's,
# and every stage 1 set with no campaign
set -e
cd /opt/ultimate-trading-system
sudo -u uts node -e '
const fs=require("fs"),path=require("path");
const D="data/stagesets";
const docs=fs.readdirSync(D).filter(f=>f.endsWith(".json")&&!f.slice(0,-5).includes(".")).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(D,f),"utf8"))}catch(_){return null}}).filter(Boolean);
const byId=new Map(docs.map(d=>[d.id,d]));
const camp=(d)=>((d.params||{}).campaign)||null;
const rootOf=(d)=>{let r=d,h=0;while(r&&r.parent&&h<8){const p=byId.get(r.parent.id);if(!p)return null;r=p;h++;}return r;};
let mism=0,orph=0;
const counts={};
for(const d of docs){ if(d.exam) continue; counts["stage"+d.stage]=(counts["stage"+d.stage]||0)+1;
  if(d.stage===1){ if(!camp(d)) console.log("stage 1 with no campaign:",d.id,d.name); continue; }
  const r=rootOf(d); if(!r){orph++; console.log("no stage 1 root on the box:",d.id,d.name,"campaign",camp(d)); continue;}
  if(camp(d)!==camp(r)){mism++; console.log("differs:",d.id,d.name,"stage",d.stage,"has",JSON.stringify(camp(d)),"root",r.name,"has",JSON.stringify(camp(r)));}
}
console.log("counts",JSON.stringify(counts),"differs",mism,"no root",orph);
console.log("campaigns in force file:", fs.existsSync("data/campaign.json")?fs.readFileSync("data/campaign.json","utf8"):"none");
'
