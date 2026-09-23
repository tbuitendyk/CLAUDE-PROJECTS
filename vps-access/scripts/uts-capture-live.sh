#!/usr/bin/env bash
# READ-ONLY. What the RUNNING service says about the per-trade capture of one
# Stage 4 record set on Tune: the capture it holds in memory (still going,
# finished, or failed with the failure in its own words), the dry read Tune
# draws from, the files on disk, and the capture's own preparation replayed up
# to the point where it would hand work to the workers -- which survivors it
# would capture, grouped by half-life, against the retrained members on file.
# Asks the service over its own port and reads files. Nothing written, nothing
# started, no worker run.
set -uo pipefail
ID="${1:-}"
case "$ID" in ""|*[!A-Za-z0-9._-]*) echo "usage: uts-capture-live.sh <set id>" >&2; exit 2 ;; esac
cd /opt/ultimate-trading-system
echo "== service started: $(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value 2>/dev/null) =="
echo "== the capture the running service holds for $ID =="
curl -sS -m 20 "http://127.0.0.1:8094/api/funnel/set/$ID/capture/status" | head -c 2500; echo
echo "== the dry read Tune draws from (capture trimmed) =="
curl -sS -m 90 "http://127.0.0.1:8094/api/funnel/set/$ID/capture" | node -e '
let b="";process.stdin.on("data",(c)=>b+=c).on("end",()=>{try{const d=JSON.parse(b);const c=d.capture;console.log(JSON.stringify({name:d.name,unit:d.unit,survivors:d.survivors,refused:d.refused,running:d.running,capture:c?{at:c.at,captured:c.captured,of:c.survivors,notCaptured:(c.notCaptured||[]).length,missing:(c.missing||[]).length}:null,error:d.error||null}));}catch(e){console.log("unreadable: "+b.slice(0,400));}});'
echo "== files on disk =="
ls -la --time-style=+%Y-%m-%dT%H:%M:%S data/stagesets/ 2>/dev/null | grep -F "$ID" | awk '{print $5, $6, $7}'
echo "== the capture preparation, replayed without workers =="
ID="$ID" timeout 240 node -e '
const s=require("./lib/stages");
(async()=>{
  const doc=s.getSet(process.env.ID);
  if(!doc){console.log("no such set");return;}
  console.log(`name ${String(doc.name).slice(0,100)} | stage ${doc.stage} | kind ${doc.kind} | unit ${doc.unit} | survivors ${(doc.survivors||[]).length} | derived ${doc.derived?doc.derived.from+" run "+doc.derived.run:"no"} | parent ${(doc.parent||{}).id}`);
  const hl=doc.derived?s.readHalfLifeRun(doc.derived.from,doc.derived.run):null;
  if(doc.derived) console.log(`half-life run file: ${hl?"present, layout "+JSON.stringify(hl.layout).slice(0,120)+", half-lives "+hl.halfLives.map((x)=>x.halfLifeMonths+"m/"+(x.members||[]).length+" members").join(" "):"MISSING or unreadable"}`);
  const hls=new Map();for(const sv of doc.survivors||[]){const k=String(sv.halfLife);hls.set(k,(hls.get(k)||0)+1);}
  console.log(`survivors by half-life: ${[...hls.entries()].map(([k,n])=>k+"m x"+n).join(", ")}`);
  let join=null;try{join=await s.funnelVerifyJoin(doc);}catch(e){console.log("join THREW: "+e.message);return;}
  console.log(`join rows ${join.rows.length} | parent ${join.parent&&join.parent.id}`);
  let shape=null;try{shape=s.relaunchShapeOf(join.parent);}catch(e){console.log("shape THREW: "+e.message);return;}
  const idx=shape.records.findIndex((r)=>s.unitKeyOf(r)===doc.unit);
  console.log(`unit in the stage 3 set: ${idx<0?"NOT FOUND":"record "+idx}`);
  if(idx<0)return;
  const want=new Set(join.rows.map((r)=>r.label));
  const held=new Set(shape.heldOn[idx]);
  const onUnit=shape.settings.filter((st)=>want.has(st.label)&&held.has(st.si));
  const missing=[...want].filter((L)=>!onUnit.some((st)=>st.label===L));
  const why=(st)=>((st.entry||"breakout")!=="market"?"price level entry":((st.trailMult??null)!=null?"trailing stop":null));
  const ok=onUnit.filter((st)=>!why(st));
  const bad=onUnit.filter((st)=>why(st));
  console.log(`settings on the unit ${onUnit.length} | would capture ${ok.length} | shape refused ${bad.length}${bad.length?" e.g. "+bad[0].label+" "+why(bad[0]):""} | missing from the block ${missing.length}${missing.length?" e.g. "+missing.slice(0,3).join(" "):""}`);
  const hlOf=new Map((doc.survivors||[]).map((sv)=>[sv.label,sv.halfLife]));
  const groups=new Map();const noHl=[];
  for(const st of ok){const h=hlOf.get(st.label);if(!Number.isFinite(h)){noHl.push(st.label);continue;}groups.set(h,(groups.get(h)||0)+1);}
  console.log(`payload groups by half-life: ${[...groups.entries()].map(([h,n])=>h+"m x"+n+(hl&&!hl.halfLives.find((x)=>x.halfLifeMonths===h)?" NO MEMBERS ON FILE":"")).join(", ")}${noHl.length?" | carry no half-life: "+noHl.length+" e.g. "+noHl[0]:""}`);
  console.log(`labels: set survivors first ${(doc.survivors||[]).slice(0,2).map((x)=>x.label).join(" ")} | join rows first ${join.rows.slice(0,2).map((x)=>x.label).join(" ")}`);
})().catch((e)=>console.log("replay THREW: "+(e&&e.stack||e).toString().slice(0,600)));'
echo "== service log, last 8 hours: starts, stops, captures, worker faults =="
journalctl -u ultimate-trading-system --since "8 hours ago" --no-pager 2>/dev/null | grep -iE "Started|Stopping|capture|heap|out of memory|killed|worker|exited|FATAL" | tail -30
