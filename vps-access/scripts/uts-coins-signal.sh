#!/usr/bin/env bash
# uts-coins-signal.sh -- READ-ONLY. For one coin, per chunk shape: the sit-out
# band sweep, the plateau and its sweet spot, the one-word traits, how often a
# plateau still appears with the link between window and outcome cut and how
# many of those were at least as strong as the real one (B12), and the closed
# form of chance checked against the spread of the dealt edges (B4)
# (LOOP-2026-09-14-SIGNAL.md, sections A and C).
#
# ONE COPY OF THE ARITHMETIC. The analysis is the product's own lib/, fetched
# from the branch under review into a scratch directory under /tmp -- never a
# second copy typed here. It reads the coin's record file straight off disk.
# The service is not touched, the box's band is not touched, nothing is
# written under /opt. Output is kept under the 8 KB the endpoint hands back.
#   uts-coins-signal.sh LTCUSDT
set -uo pipefail
COIN="${1:-}"
case "$COIN" in ''|*[!A-Za-z0-9]*) echo "usage: uts-coins-signal.sh COIN"; exit 1;; esac
BRANCH=claude/uts-build-out-7f2lmv
SHARED=/root/claude-projects
SCRATCH=/tmp/uts-signal-src
REC="/opt/ultimate-trading-system/data/coins/$COIN.json"
[ -f "$REC" ] || { echo "no record for $COIN on the box"; exit 1; }
git -C "$SHARED" fetch -q origin "$BRANCH" || { echo "could not fetch $BRANCH"; exit 1; }
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
git -C "$SHARED" archive FETCH_HEAD ultimate-trading-system/lib ultimate-trading-system/package.json | tar -x -C "$SCRATCH"
echo "analysis from $(git -C "$SHARED" rev-parse --short FETCH_HEAD) ($BRANCH) · record $(stat -c %y "$REC" | cut -c1-16)"
COIN="$COIN" REC="$REC" LIB="$SCRATCH/ultimate-trading-system/lib" node -e '
const S = require(process.env.LIB + "/coinsignal.js");
const coins = require(process.env.LIB + "/coins.js");
const run = require(process.env.LIB + "/coinsrun.js");
const rec = JSON.parse(require("fs").readFileSync(process.env.REC, "utf8"));
const lays = run.layouts();
const band = run.sitOutBand();
const f = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d));
console.log(`== ${rec.coin} · record shape ${rec.v} · read ${String(rec.provenance.capturedAt).slice(0, 16)} · band on the box ${band}`);
for (const s of coins.shapes()) {
  const x = rec.shapes[s.key];
  if (!x || !x.periods) { console.log(`-- ${s.label}: ${(x && x.why) || "not read"}`); continue; }
  const g = S.signalSummary(x, s.key, lays, band);
  // the link cut, dealt here exactly as the product deals it (within each part
  // of the three-part layout, no overlap) so the per-band dealt ratios are in
  // hand for the B4 check: their spread should be about 1 if the closed form
  // of chance is right
  const TRIALS = 40;
  const parts = coins.layoutParts(x.out.length, S.trainLayoutOf(lays)).parts;
  const dealt = g.sweep.map(() => []);
  let found = 0; const strengths = [];
  for (let t = 0; t < TRIALS; t++) {
    const c = S.signalSummary({ move: x.move, out: S.shuffledWithin(x.out, parts, 20260914 + t) }, s.key, lays, band, { dealt: true });
    c.sweep.forEach((p, i) => { if (p.ratio != null && !p.same) dealt[i].push(p.ratio); });
    if (c.plateau) { found++; strengths.push(S.plateauStrength(c.plateau)); }
  }
  const fa = { trials: TRIALS, found, strengths, meanRatioWhenFound: null };
  const worth = S.linkCutWorth(g.plateau, fa);
  const sdOf = (a) => { if (a.length < 5) return null; const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length); };
  const chk = g.sweep.filter((p) => p.band % 50 === 0).map((p) => { const a = dealt[g.sweep.indexOf(p)]; const sd = sdOf(a); return `${p.band}:${sd == null ? "—" : sd.toFixed(2) + "(" + a.length + ")"}`; }).join(" ");
  const t = g.traits || {};
  const sw = g.sweep.map((p) => `${p.band}:${p.same ? "0" : p.ratio == null ? "—" : p.ratio.toFixed(1)}`).join(" ");
  console.log(`-- ${s.label} · ${x.periods} decisions · k ${g.k.toFixed(2)}`);
  console.log(`   at band ${band}: ${g.atCurrent.same ? "the colour changes no call" : g.atCurrent.ratio == null ? "no ratio" : f(g.atCurrent.ratio, 2) + "x chance"} · called ${(g.atCurrent.called * 100).toFixed(0)}% · lean r/f/blind ${g.atCurrent.lean ? [g.atCurrent.lean.rising, g.atCurrent.lean.falling, g.atCurrent.lean.blind].join("/") : "—"}`);
  console.log(`   plateau: ${g.plateau ? `${g.plateau.fromBand}..${g.plateau.toBand} (${g.plateau.points} pts, mean ${g.plateau.meanRatio.toFixed(2)}x) · sweet spot ${g.sweetSpot.band} at ${f(g.sweetSpot.ratio, 2)}x` : "none — no band beats chance for three steps"}${g.why ? " · " + g.why : ""}`);
  console.log(`   traits: ${t.direction || "—"} / ${t.holding || "—"} / ${t.carrier || "—"} (move: ${t.holdingMove || "—"}) at band ${g.traitsAtBand}`);
  console.log(`   link cut: plateau in ${fa.found} of ${fa.trials}${worth && worth.asStrong != null ? ` · at least as strong (${worth.strength.toFixed(1)}) in ${worth.asStrong} of ${fa.trials}` : ""}`);
  console.log(`   chance check (spread of the dealt ratios, should be near 1; n dealt not 0): ${chk}`);
  console.log(`   sweep: ${sw}`);
}
'
