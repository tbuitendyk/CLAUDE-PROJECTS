#!/usr/bin/env bash
# READ-ONLY. Which record sets on the box stand on SIZED trades -- a stage 3
# set priced with a field named, or with confirm past off -- and everything
# built from them: the test history numbers kept beside each, the Stage 4
# sets cut from them (their floors and kept units), the held and reserve
# sets and half-life sets read from those, their captures and the choices
# applied on Tune, and any greenlight or setup standing on them. Reads files
# only. Nothing written, nothing started.
set -uo pipefail
cd /opt/ultimate-trading-system
timeout 240 node -e '
const fs=require("fs"),path=require("path");
const s=require("./lib/stages");
const dir="data/stagesets";
const all=s.listSets().map((x)=>s.getSet(x.id)).filter(Boolean);
const sized=(p)=>{const f=p.fieldId!=null&&String(p.fieldId)!==""&&String(p.fieldId)!=="none";const c=(p.confirm&&p.confirm!=="off")||!!p.permuteConfirm;return {f,c};};
const s3=all.filter((d)=>d.stage===3);
console.log(`stage 3 sets: ${s3.length}`);
const sizedS3=new Set();
for(const d of s3){const z=sized(d.params||{});const rich=fs.existsSync(path.join(dir,String(d.id).replace(/[^A-Za-z0-9._-]+/g,"_")+".funnelrich"));
  if(z.f||z.c) sizedS3.add(d.id);
  console.log(`- ${d.id} ${String(d.name||"").slice(0,60)} | release ${d.engineVersion||"?"} | field ${z.f?"yes":"no"} confirm ${z.c?"yes":"no"} | test history numbers ${rich?"yes":"no"} | status ${d.status||"?"}`);}
const s4=all.filter((d)=>d.stage===4);
const byId=new Map(all.map((d)=>[d.id,d]));
const rootOf=(d)=>{let x=d,n=0;while(x&&x.stage===4&&n<10){const up=x.derived?byId.get(x.derived.from):(x.from?byId.get(x.from):null);if(!up||up.stage!==4)break;x=up;n++;}return x;};
console.log(`\nStage 4 sets: ${s4.length} (on a sized stage 3 set marked *)`);
for(const d of s4){const p=(d.parent||{}).id;const star=sizedS3.has(p)?"*":" ";const R=d.rule||{};const fl=Object.keys(R.floors||{});
  const sizing=Object.values(d.stopChoices||{}).filter((c)=>c&&c.sizing&&c.sizing.on).length;const stops=Object.values(d.stopChoices||{}).filter((c)=>c&&Object.prototype.hasOwnProperty.call(c,"stopPct")).length;
  console.log(`${star} ${d.id} ${d.kind}${d.derived?" half-life":""} | parent ${p} | survivors ${(d.survivors||[]).length} | floors ${fl.join(",")||"none"} | kept units ${Array.isArray(d.keptUnits)?d.keptUnits.length:"not recorded"} | capture ${d.capture?"yes":"no"} | sized on Tune ${sizing}, stops ${stops} | ${String(d.name||"").slice(0,50)}`);}
let gls=[];try{gls=require("./lib/live/greenlight").listGreenlights();}catch(e){console.log("greenlights unreadable: "+e.message);}
console.log(`\ngreenlights: ${gls.length}`);
for(const g of gls){const sid=(g.sourceSet||{}).id||null;const src=sid?byId.get(sid):null;const p=src?(src.parent||{}).id:((g.sourceRun||{}).id||null);
  console.log(`- ${g.id} target ${g.target} | set ${sid} | stage 3 ${p}${sizedS3.has(p)?" (sized)":""} | revoked ${!!g.revoked} | setup ${g.setupId||g.shuttledTo||"none"} | ${String(g.createdUtc||"").slice(0,16)}`);}
'
