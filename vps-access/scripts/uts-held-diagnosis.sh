#!/usr/bin/env bash
# READ-ONLY. For one Stage 4 set (its id), the whole board of the coin and shape
# it was cut on, read off the stage 3 records: the test and held-back money of
# every setting side by side, how the two relate, what the scrambled copies
# made on each window, how often each traded, the windows' dates, and where the
# rule's own survivors sit. Nothing written, nothing started.
set -uo pipefail
ID="${1:-}"
case "$ID" in s4-*) ;; *) echo "usage: uts-held-diagnosis.sh <stage 4 set id>" >&2; exit 2 ;; esac
cd /opt/ultimate-trading-system
ID="$ID" node -e '
(async () => {
const s=require("./lib/stages");
const doc=s.getSet(process.env.ID); if(!doc){console.log("no such set");return;}
const p=s.getSet(doc.parent.id); const t=s.readTally(p.id);
console.log(`set ${doc.name} | unit ${doc.unit} | parent ${p.name} (${p.engineVersion}) layout ${(p.params||{}).windowLayout} | fee each way ${JSON.stringify((p.params||{}).fee)}`);
const w=((p.windows||{}).units||{})[doc.unit]||{};
const day=(x)=>x==null?"-":new Date(Number(x)).toISOString().slice(0,10);
for (const k of ["train","test","hold","unread"]) { const x=w[k]; if(x) console.log(`  ${k}: ${day(x.fromTs)} .. ${day(x.toTs)} chunks ${x.chunks??"-"}`); }
const b=await s.funnelBoard(p.id,t,doc.unit);
const rows=b.all;
const num=(v)=>v==null||!Number.isFinite(Number(v))?null:Number(v);
const both=rows.filter((r)=>num(r.avgTest)!=null&&num(r.avgHold)!=null);
const stat=(xs)=>{const a=xs.slice().sort((x,y)=>x-y);const n=a.length;const m=a.reduce((s,v)=>s+v,0)/n;return {n,pos:(100*a.filter((v)=>v>0).length/n).toFixed(1)+"%",mean:m.toFixed(2),med:(n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2).toFixed(2),p10:a[Math.floor(n*0.1)].toFixed(2),p90:a[Math.floor(n*0.9)].toFixed(2)};};
console.log(`settings ${rows.length}, with both figures ${both.length}`);
console.log("test money    ", JSON.stringify(stat(both.map((r)=>num(r.avgTest)))));
console.log("held-back money", JSON.stringify(stat(both.map((r)=>num(r.avgHold)))));
const ranks=(xs)=>{const idx=xs.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]);const out=new Array(xs.length);let i=0;while(i<idx.length){let j=i;while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;const r=(i+j)/2+1;for(let k=i;k<=j;k++)out[idx[k][1]]=r;i=j+1;}return out;};
const corr=(a,b)=>{const n=a.length;const ma=a.reduce((s,v)=>s+v,0)/n,mb=b.reduce((s,v)=>s+v,0)/n;let t=0,sa=0,sb=0;for(let i=0;i<n;i++){t+=(a[i]-ma)*(b[i]-mb);sa+=(a[i]-ma)**2;sb+=(b[i]-mb)**2;}return t/Math.sqrt(sa*sb);};
const T=both.map((r)=>num(r.avgTest)),H=both.map((r)=>num(r.avgHold));
console.log(`rank agreement test vs held-back over every setting: ${corr(ranks(T),ranks(H)).toFixed(3)} (1 same order, 0 none, -1 reversed)`);
const byT=both.map((r,i)=>({r,t:T[i],h:H[i]})).sort((a,b)=>b.t-a.t);
const dec=10;console.log("by test money, best tenth first: mean test | mean held-back | held-back positive | mean test trades | mean held trades");
for(let d=0;d<dec;d++){const sl=byT.slice(Math.floor(d*byT.length/dec),Math.floor((d+1)*byT.length/dec));const m=(f)=>(sl.reduce((s,x)=>s+(f(x)||0),0)/sl.length);console.log(`  tenth ${d+1}: ${m((x)=>x.t).toFixed(2)} | ${m((x)=>x.h).toFixed(2)} | ${(100*sl.filter((x)=>x.h>0).length/sl.length).toFixed(1)}% | ${m((x)=>num(x.r.testTrades)).toFixed(1)} | ${m((x)=>num(x.r.avgTrades)).toFixed(1)}`);}
for (const n of [70,500,5000]) { const sl=byT.slice(0,n); console.log(`top ${n} by test: mean test ${(sl.reduce((s,x)=>s+x.t,0)/n).toFixed(2)} mean held-back ${(sl.reduce((s,x)=>s+x.h,0)/n).toFixed(2)} held-back positive ${(100*sl.filter((x)=>x.h>0).length/n).toFixed(1)}%`); }
const want=new Set((doc.survivors||[]).map((x)=>x.label));
const mine=byT.filter((x)=>want.has(x.r.label));
if(mine.length){const pos=byT.findIndex((x)=>want.has(x.r.label));console.log(`the rule s own ${mine.length}: mean test ${(mine.reduce((s,x)=>s+x.t,0)/mine.length).toFixed(2)} mean held-back ${(mine.reduce((s,x)=>s+x.h,0)/mine.length).toFixed(2)} | best test rank among them ${pos+1} | mean test trades ${(mine.reduce((s,x)=>s+(num(x.r.testTrades)||0),0)/mine.length).toFixed(1)} held trades ${(mine.reduce((s,x)=>s+(num(x.r.avgTrades)||0),0)/mine.length).toFixed(1)}`);}
const K=both[0]&&Array.isArray(both[0].noiseTest)?both[0].noiseTest.length:0;
if(K){const mt=(f)=>both.reduce((s,r)=>{const xs=(f(r)||[]).map(num).filter((v)=>v!=null);return s+(xs.length?xs.reduce((a,v)=>a+v,0)/xs.length:0);},0)/both.length;
console.log(`scrambled copies (${K}): mean over settings of the copies mean -- test ${mt((r)=>r.noiseTest).toFixed(2)} vs real ${(T.reduce((s,v)=>s+v,0)/T.length).toFixed(2)} | held-back ${mt((r)=>r.noiseHold).toFixed(2)} vs real ${(H.reduce((s,v)=>s+v,0)/H.length).toFixed(2)}`);
const beats=(real,cp)=>(cp||[]).map(num).filter((v)=>v!=null&&real>v).length;
const hist=(f,g)=>{const h=new Array(K+1).fill(0);for(const r of both)h[beats(f(r),g(r))]++;return h.map((c)=>(100*c/both.length).toFixed(1)).join(" ");};
console.log(`share of settings beating 0..${K} copies, test:      ${hist((r)=>num(r.avgTest),(r)=>r.noiseTest)}`);
console.log(`share of settings beating 0..${K} copies, held-back: ${hist((r)=>num(r.avgHold),(r)=>r.noiseHold)}`);}
const vl=both.map((r)=>num(r.avgVsLong)).filter((v)=>v!=null);
if(vl.length) console.log(`held-back money minus always long: mean ${(vl.reduce((s,v)=>s+v,0)/vl.length).toFixed(2)} (n ${vl.length})`);
const rich=s.readFunnelRich(p.id); const tc=rich&&rich.testControls?rich.testControls[doc.unit]:null;
if(tc) console.log(`the four on the TEST window by hold length (first 4): ${Object.entries(tc).slice(0,4).map(([k,v])=>`${k}: long ${v.alwaysLong} short ${v.alwaysShort} buy&hold ${v.buyHold} short&hold ${v.shortHold}`).join(" | ")}`);
})().catch((e)=>console.log("failed:",e.message));'
