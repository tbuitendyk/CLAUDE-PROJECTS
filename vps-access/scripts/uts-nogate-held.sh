#!/usr/bin/env bash
# READ-ONLY. One Stage 4 set's survivors on the held-back window with the coin
# history field gate, and with it removed: every call the members made taken
# at size 1 -- the gate's placed trades at size 1 plus the calls it blocked at
# size 1, both already priced by the stage 3 simulator at the set's fee and
# stored on each record (field.hold.at1 + field.hold.blockedAt1). The same for
# the test window, and the same for the rest of the coin and shape's board.
# Nothing priced, written or started.
set -uo pipefail
ID="${1:-}"
case "$ID" in s4-*) ;; *) echo "usage: uts-nogate-held.sh <stage 4 set id>" >&2; exit 2 ;; esac
cd /opt/ultimate-trading-system
ID="$ID" node -e '
const s=require("./lib/stages"); const rowstore=require("./lib/rowstore");
const doc=s.getSet(process.env.ID); if(!doc){console.log("no such set");process.exit(0);}
const pid=doc.parent.id; const t=s.readTally(pid);
const unit=s.unitsOfSet(t,pid).find((u)=>u.key===doc.unit);
const want=new Map((doc.survivors||[]).map((x,i)=>[x.label,i]));
const num=(v)=>v==null||!Number.isFinite(Number(v))?null:Number(v);
const mine=[]; const rest={n:0,gated:0,hold:0,holdNo:0,test:0,testNo:0,holdPos:0,holdNoPos:0};
for (const bi of unit.blocks) {
  for (const x of (rowstore.readBlocks(pid,"records",[bi])||[])) {
    const r=x.row;
    if (r.trade!==unit.trade||r.geometry!==unit.geometry||(r.ctx1||null)!==unit.ctx1||(r.ctx2||null)!==unit.ctx2) continue;
    const h=num((r.holdout||{}).pnl), tt=num(r.pnl);
    const fh=r.field&&r.field.hold, ft=r.field&&r.field.test;
    const hNo=fh&&num(fh.at1)!=null?num(fh.at1)+(num(fh.blockedAt1)||0):h;
    const tNo=ft&&num(ft.at1)!=null?num(ft.at1)+(num(ft.blockedAt1)||0):tt;
    if (want.has(r.label)) mine.push({i:want.get(r.label),label:r.label,gated:!!fh,h,hNo,tt,tNo,placed:fh?fh.placed:null,blocked:fh?(fh.blockedSign||0)+(fh.blockedMin||0):null,silent:fh?fh.silent:null,tr:fh?fh.trades:num((r.holdout||{}).trades),trNo:fh?(fh.trades||0)+(fh.blockedN||0):num((r.holdout||{}).trades)});
    else { rest.n++; if(fh) rest.gated++; rest.hold+=h||0; rest.holdNo+=hNo||0; rest.test+=tt||0; rest.testNo+=tNo||0; if(h>0) rest.holdPos++; if(hNo>0) rest.holdNoPos++; }
  }
}
mine.sort((a,b)=>a.i-b.i);
const m=(k)=>mine.reduce((a,x)=>a+(x[k]||0),0)/mine.length;
const pos=(k)=>mine.filter((x)=>x[k]>0).length;
console.log(`${doc.name}`);
console.log(`unit ${doc.unit} | survivors found ${mine.length} of ${want.size} | carrying the gate ${mine.filter((x)=>x.gated).length} | fee each way ${JSON.stringify((s.getSet(pid).params||{}).fee)}`);
console.log(`THE ${mine.length}, HELD-BACK: with the gate avg ${m("h").toFixed(2)} (${pos("h")} positive) | gate removed avg ${m("hNo").toFixed(2)} (${pos("hNo")} positive) | trades a setting: ${m("tr").toFixed(1)} with, ${m("trNo").toFixed(1)} without`);
console.log(`THE ${mine.length}, TEST:      with the gate avg ${m("tt").toFixed(2)} (${pos("tt")} positive) | gate removed avg ${m("tNo").toFixed(2)} (${pos("tNo")} positive)`);
console.log(`THE REST OF THE BOARD (${rest.n}, ${rest.gated} gated), HELD-BACK: with the gate avg ${(rest.hold/rest.n).toFixed(2)} (${(100*rest.holdPos/rest.n).toFixed(1)}% positive) | gate removed avg ${(rest.holdNo/rest.n).toFixed(2)} (${(100*rest.holdNoPos/rest.n).toFixed(1)}% positive)`);
console.log(`THE REST, TEST: with the gate avg ${(rest.test/rest.n).toFixed(2)} | gate removed avg ${(rest.testNo/rest.n).toFixed(2)}`);
console.log("each survivor, held-back: with gate | gate removed | calls placed / blocked / silent | the setting (up to the gate)");
for (const x of mine) console.log(`${String(x.i+1).padStart(2)} ${x.h==null?"-":x.h.toFixed(2).padStart(8)} | ${x.hNo==null?"-":x.hNo.toFixed(2).padStart(8)} | ${x.placed??"-"}/${x.blocked??"-"}/${x.silent??"-"} | ${String(x.label).split(" · field")[0].slice(0,48)}`);
'
