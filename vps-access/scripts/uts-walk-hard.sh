#!/usr/bin/env bash
# uts-walk-hard.sh -- READ-ONLY. Tears into the owner's last walk rather than
# reading it out. Four things: how many rows beat all their copies against how
# many would by chance; how many DISTINCT coins the strong rows come from,
# because the same coin at four bands is not four findings; whether a row leans
# on one big window (its figure with the best window dropped); and the same
# strong rows net of the round trip. Starts nothing, writes nothing.
set -uo pipefail
curl -s -m 120 -o /tmp/uts-wh.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-wh.json","utf8"));
if (j.none || j.running) { console.log(j.running ? `running ${j.done}/${j.of}` : "nothing walked"); process.exit(0); }
const a = j.asked || {}; const rows = j.rows || [];
const C = 0.25;
console.log(`THE RUN · window ${a.windowMonths}mo · warm-up ${a.warmUpMonths}mo · bands ${JSON.stringify(a.bands)} · sweet spot ${a.sweetSpot} · usual move ${a.usual} · leaning ${a.signsMode} · ${a.scrambles} copies · floor ${a.floor}`);
const cop = a.scrambles == null ? 10 : a.scrambles;
const scored = rows.filter((r) => r.asGood != null);
const zero = scored.filter((r) => r.asGood === 0);
const one = scored.filter((r) => r.asGood <= 1);
console.log(`ROWS ${rows.length} (${scored.length} scored) · beat ALL ${cop} copies: ${zero.length} · all-but-one: ${one.length}`);
console.log(`   by chance alone, beating all ${cop} happens about 1 row in ${cop + 1}, so of ${scored.length} rows expect about ${(scored.length / (cop + 1)).toFixed(1)}`);
console.log(`   so the excess over chance is about ${(zero.length - scored.length / (cop + 1)).toFixed(1)} rows`);
const coins = new Set(one.map((r) => r.coin));
const pairs = new Set(one.map((r) => `${r.coin}|${r.geometry}`));
console.log(`   those ${one.length} rows come from ${coins.size} DISTINCT coins and ${pairs.size} coin-and-shape pairs -- the same coin at four bands is one finding, not four`);
// which way do they lean? if they all say the same thing it is one phenomenon
console.log(`\nDOES ONE BIG WINDOW CARRY IT? the figure with the single best window dropped.`);
const f = (v,d=3) => (v==null?"   —  ":((v>0?"+":"")+Number(v).toFixed(d)).padStart(7));
const strong = one.filter((r) => r.windows >= 8 && r.perTrade != null);
strong.sort((x,y) => (x.asGood-y.asGood) || ((y.windowsUp/y.windows)-(x.windowsUp/x.windows)));
console.log(`coin  shape        band  copies  up/win  trades   per trade      net   drop best   net of that   worst window`);
for (const r of strong) {
  const w = (r.scan||[]).filter((s) => !s.thin && s.n && s.perTrade != null);
  let bn = 0, bs = 0, bi = -1, bv = -1e9;
  w.forEach((s, i) => { if (s.perTrade > bv) { bv = s.perTrade; bi = i; } });
  w.forEach((s, i) => { if (i !== bi) { bn += s.n; bs += s.perTrade * s.n; } });
  const dropped = bn ? bs / bn : null;
  console.log(`${r.coin.replace("USDT","").padEnd(5)} ${r.geometry.padEnd(11)} ${String(r.band).padStart(4)}  ${String(r.asGood).padStart(2)}/${cop}   ${String(r.windowsUp).padStart(2)}/${String(r.windows).padStart(2)}  ${String(r.trades).padStart(6)}  ${f(r.perTrade)}% ${f(r.perTrade - C)}%  ${f(dropped)}% ${f(dropped == null ? null : dropped - C)}%   ${f(r.worst,2)}%`);
}
' 2>&1 | head -60
rm -f /tmp/uts-wh.json
