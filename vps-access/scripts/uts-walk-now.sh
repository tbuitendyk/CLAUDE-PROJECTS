#!/usr/bin/env bash
# READ-ONLY. What Walk it forward is doing right now: how far, how fast, how
# long left, what it was ASKED for, and -- the question that matters -- whether
# the look-backs it was asked to try are actually carried by the records, since
# one the records do not carry is left out rather than guessed. Writes nothing.
set -uo pipefail
curl -sS -m 30 http://127.0.0.1:8094/api/coins/walk \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,300));return}
if(d.none){console.log("no walk has been run this life of the service");return}
const a=d.asked||{};
const el=d.startedAt?Math.round((Date.now()-d.startedAt)/1000):null;
const rate=el&&d.done?d.done/el:null;
console.log("running: "+(d.running?"YES":"no")+(d.stopping?" (stopping)":"")+"   error: "+(d.error||"none"));
console.log("progress: "+d.done+" of "+d.of+(d.of?"  ("+(100*d.done/d.of).toFixed(1)+"%)":""));
if(el!=null)console.log("elapsed: "+Math.floor(el/60)+"m "+(el%60)+"s"+(rate?"   rate "+rate.toFixed(2)+"/s":""));
if(rate&&d.running&&d.of>d.done)console.log("left:    about "+Math.round((d.of-d.done)/rate/60)+" min");
if(d.finishedAt)console.log("finished: "+new Date(d.finishedAt).toISOString());
console.log("workers: "+(d.workers==null?"—":d.workers)+"   cpu "+(d.cpu&&d.cpu.busy!=null?d.cpu.busy+"% of "+d.cpu.cores:"—"));
console.log("\nASKED FOR:");
console.log("  coins        : "+((a.only&&a.only.length)?a.only.join(","):"(blank = every coin read)"));
console.log("  window months: "+a.windowMonths+"   history before first window: "+a.warmUpMonths);
console.log("  bands        : "+(a.bands?a.bands.join(","):"(default)"));
console.log("  look-backs   : "+(a.lookbacks&&a.lookbacks.length?a.lookbacks.join(","):"(blank = each shape own span only)"));
console.log("  sweet spot   : "+(a.sweetSpot?"on":"off")+"   usual move: "+a.usual+"   leaning: "+a.signsMode+"   copies: "+a.scrambles+"   floor: "+a.floor);
console.log("  name         : "+(a.name||"(auto)"));
if(d.saved)console.log("\nSAVED as "+d.saved.id+" \""+d.saved.name+"\" with "+d.saved.rows+" row(s)");
if(d.saveError)console.log("\nCOULD NOT SAVE: "+d.saveError);
console.log("\nrows in hand: "+(d.rows?d.rows.length:"(none yet -- they arrive when it lands)"));
// AND THE QUESTION THAT MATTERS: is the data there for what it was asked?
const want=(a.lookbacks||[]).map(Number);
if(!want.length){console.log("\nnothing to check: no look-back was asked for, so every shape walks its own span");process.exit(0)}
process.env.WANT=JSON.stringify(want);
})'
WANT_JSON=$(curl -sS -m 30 http://127.0.0.1:8094/api/coins/walk | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d={};try{d=JSON.parse(r)}catch(e){}process.stdout.write(JSON.stringify(((d.asked||{}).lookbacks)||[]))})')
echo
echo "== are those look-backs actually in the records? =="
curl -sS -m 90 http://127.0.0.1:8094/api/coins/records \
| WANT="$WANT_JSON" node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer");return}
const want=JSON.parse(process.env.WANT||"[]").map(Number);
const have=new Set(((d.lookbacks||{}).inRecords||[]).map(Number));
if(!want.length){console.log("  the walk asked for no look-back, so this does not apply");return}
const miss=want.filter(h=>!have.has(h));
console.log("  asked for "+want.length+": "+want.join(","));
console.log("  in the records: "+[...have].sort((a,b)=>a-b).join(","));
console.log(miss.length?"  MISSING (silently walked at nothing): "+miss.join(","):"  every one is carried -- nothing is being dropped");
const coins=(d.rows||[]).filter(x=>x.read).length;
const shapes=(d.shapes||[]).length;
console.log("  coins read "+coins+"  shapes "+shapes);
})'
