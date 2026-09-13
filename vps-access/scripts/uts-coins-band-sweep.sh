#!/usr/bin/env bash
# uts-coins-band-sweep.sh -- READ-ONLY. For one coin, per chunk shape, what the
# gap and the two-way edge come out at under a range of sit-out bands, computed
# here from the served record's own moves and outcomes. The band on the box is
# NOT touched; the screen is not touched; nothing is written.
#
# The two-way edge: two traders with no members, both skipping sit out. On the
# 70/15/15 train part, the colour-blind one learns one direction for the coin;
# the colour-seeing one learns one direction per colour. Both trade test and
# held; the edge is what the second keeps per trade minus the first. Luck is
# the usual size of that number when the colours are dealt at random on a
# stretch that size (closed form; trades open at the same time widen it).
#   uts-coins-band-sweep.sh LTCUSDT
set -uo pipefail
COIN="${1:-}"
curl -s --max-time 60 -H 'Accept-Encoding: identity' http://127.0.0.1:8094/api/coins/records \
| COIN="$COIN" node -e '
const coins = require("/opt/ultimate-trading-system/lib/coins.js");
const { GEOMETRIES } = require("/opt/ultimate-trading-system/lib/dataset.js");
let raw = ""; process.stdin.on("data", (c) => raw += c).on("end", () => {
  const d = JSON.parse(raw);
  const want = String(process.env.COIN || "").toUpperCase();
  const BANDS = [0, 25, 50, 75, 100, 150, 200, 300];
  const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const f = (v, n = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(n));
  for (const r of d.records) {
    if (want && r.coin !== want) continue;
    console.log(`== ${r.coin}`);
    for (const s of d.shapes) {
      const x = r.shapes[s.key]; if (!x || !x.periods) continue;
      const g = GEOMETRIES[s.key]; const hold = g.exitOffsetH - g.entryOffsetH; const k = 1 + 2 * Math.max(0, hold - g.stepHours) / hold;
      const n = x.periods; const parts = coins.partsFor(n, "split70");
      const T = [parts[0].from, parts[0].to]; const P = [parts[1].from, parts[2].to];
      console.log(`-- ${s.label} · ${n} decisions · median |window move| ${x.yardstick.toFixed(2)} · k ${k.toFixed(2)}`);
      console.log("   band  called%  gapP(whole) gapM(whole)  train lean r/f   edge(test+held)  luck   edge/luck");
      for (const band of BANDS) {
        const { reading } = coins.readingsUnderBand(x.move, band);
        const w = coins.gapIn(reading, x.out, 0, n - 1);
        const called = reading.split("").filter((c) => c !== "s").length;
        const gT = coins.gapIn(reading, x.out, T[0], T[1]);
        const Sr = gT.afterRising.n * (gT.afterRising.meanOut || 0), Sf = gT.afterFalling.n * (gT.afterFalling.meanOut || 0);
        const dr = sgn(Sr), df = sgn(Sf), d1 = sgn(Sr + Sf);
        const gP = coins.gapIn(reading, x.out, P[0], P[1]);
        const nr = gP.afterRising.n, nf = gP.afterFalling.n, N = nr + nf;
        let edge = null, luck = null;
        if (gT.afterRising.n && gT.afterFalling.n && N) {
          const SrP = nr * (gP.afterRising.meanOut || 0), SfP = nf * (gP.afterFalling.meanOut || 0);
          edge = (dr * SrP + df * SfP) / N - d1 * (SrP + SfP) / N;
          let sum = 0, sq = 0; for (let i = P[0]; i <= P[1]; i++) { if (reading[i] === "s") continue; sum += x.out[i]; sq += x.out[i] * x.out[i]; }
          const sd = Math.sqrt(Math.max(0, sq / N - (sum / N) * (sum / N)));
          luck = sd * Math.sqrt(k) * Math.sqrt((dr - d1) ** 2 * nr + (df - d1) ** 2 * nf) / N;
        }
        console.log(`   ${String(band).padStart(4)}  ${((called / n) * 100).toFixed(0).padStart(5)}%   ${f(w.gapShare == null ? null : w.gapShare * 100, 1).padStart(7)}     ${f(w.gapMove).padStart(6)}      ${dr > 0 ? "+" : dr < 0 ? "-" : "0"}/${df > 0 ? "+" : df < 0 ? "-" : "0"}${dr === df ? " same" : " opp "}      ${f(edge, 3).padStart(8)}      ${luck == null ? "—" : luck.toFixed(3)}   ${edge == null || !luck ? "—" : (edge / luck).toFixed(1)}`);
      }
    }
  }
});'
