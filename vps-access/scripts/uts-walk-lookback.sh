#!/usr/bin/env bash
# uts-walk-lookback.sh -- READ-ONLY. The owner's latest walk, read four ways:
# the chance line against how many rows beat all their copies; every row whose
# every counted window went up; the one coin and shape across ALL its look-backs
# and bands so the look-back's own contribution can be seen; and whether the
# same look-back does the same thing on the other coins. Writes nothing.
set -uo pipefail
curl -s -m 180 -o /tmp/uts-wl.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-wl.json","utf8"));
if (j.none || j.running) { console.log(j.running ? `running ${j.done}/${j.of}` : "nothing walked"); process.exit(0); }
const a = j.asked || {}; const rows = j.rows || []; const C = 0.25;
const cop = a.scrambles == null ? 10 : a.scrambles;
console.log(`THE RUN · window ${a.windowMonths}mo · warm-up ${a.warmUpMonths}mo · bands ${JSON.stringify(a.bands)} · look-backs ${JSON.stringify(a.lookbacks)} · sweet spot ${a.sweetSpot} · usual ${a.usual} · leaning ${a.signsMode} · ${cop} copies · floor ${a.floor}`);
const sc = rows.filter((r) => r.asGood != null);
const zero = sc.filter((r) => r.asGood === 0);
console.log(`ROWS ${rows.length} (${sc.length} scored) · beat ALL ${cop}: ${zero.length} · chance would give about ${(sc.length/(cop+1)).toFixed(1)}`);
const f = (v,d=3)=>(v==null?"  —   ":((v>0?"+":"")+Number(v).toFixed(d)).padStart(7));
const drop = (r) => { const w=(r.scan||[]).filter((s)=>!s.thin&&s.n&&s.perTrade!=null); let bi=-1,bv=-1e9; w.forEach((s,i)=>{if(s.perTrade>bv){bv=s.perTrade;bi=i;}}); let n=0,su=0; w.forEach((s,i)=>{if(i!==bi){n+=s.n;su+=s.perTrade*s.n;}}); return n?su/n:null; };
const perfect = rows.filter((r) => r.windows >= 8 && r.windowsUp === r.windows);
perfect.sort((x,y)=>y.windows-x.windows || (x.asGood-y.asGood));
console.log(`\nEVERY COUNTED WINDOW UP, on 8 windows or more: ${perfect.length} row(s)`);
console.log(`coin  shape       back  band  copies  up/win  trades   per trade      net   drop best  net of that`);
for (const r of perfect) console.log(`${r.coin.replace("USDT","").padEnd(5)} ${r.geometry.padEnd(10)} ${String(r.lookback).padStart(5)} ${String(r.band).padStart(5)}  ${String(r.asGood).padStart(2)}/${cop}  ${String(r.windowsUp).padStart(2)}/${String(r.windows).padStart(2)}  ${String(r.trades).padStart(6)} ${f(r.perTrade)}% ${f(r.perTrade-C)}% ${f(drop(r))}% ${f(drop(r)==null?null:drop(r)-C)}%`);
console.log(`\nLTC DAILY 3-DAY ACROSS EVERY LOOK-BACK AND BAND -- is the look-back doing the work?`);
const ltc = rows.filter((r) => r.coin === "LTCUSDT" && r.geometry === "daily-3d");
ltc.sort((x,y)=>(String(x.lookback)==="own"?-1:Number(x.lookback))-(String(y.lookback)==="own"?-1:Number(y.lookback)) || x.band-y.band);
for (const r of ltc) console.log(`  back ${String(r.lookback).padStart(5)} band ${String(r.band).padStart(4)} · ${String(r.asGood).padStart(2)}/${cop} copies · ${String(r.windowsUp).padStart(2)}/${String(r.windows).padStart(2)} up · ${String(r.trades).padStart(5)} trades · ${f(r.perTrade)}% (${f(r.perTrade-C)}% net) · drop best ${f(drop(r))}%`);
console.log(`\nTHE SAME LOOK-BACK ON EVERY OTHER COIN AT THAT SHAPE AND BAND -- one finding or many?`);
const same = rows.filter((r) => String(r.lookback) === "336" && r.geometry === "daily-3d" && r.band === 200);
same.sort((x,y)=>(y.perTrade??-1e9)-(x.perTrade??-1e9));
for (const r of same) console.log(`  ${r.coin.replace("USDT","").padEnd(5)} · ${String(r.asGood).padStart(2)}/${cop} copies · ${String(r.windowsUp).padStart(2)}/${String(r.windows).padStart(2)} up · ${String(r.trades).padStart(5)} trades · ${f(r.perTrade)}% (${f(r.perTrade-C)}% net)`);
' 2>&1 | head -80
rm -f /tmp/uts-wl.json
