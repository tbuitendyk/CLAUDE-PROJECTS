#!/usr/bin/env bash
# uts-coins-strong.sh -- READ-ONLY. Every coin and shape on the box whose signal
# reading names a plateau: the sweet spot, what it calls and keeps, the leans
# learned on train, the link-cut worth, the traits, and the gap per part at
# that band. From the branch's own lib (one copy of the arithmetic), reading
# the record files straight off disk. Nothing is written, nothing restarted.
set -uo pipefail
BRANCH=claude/uts-build-out-7f2lmv
SHARED=/root/claude-projects
SCRATCH=/tmp/uts-signal-src
git -C "$SHARED" fetch -q origin "$BRANCH" || { echo "could not fetch $BRANCH"; exit 1; }
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
git -C "$SHARED" archive FETCH_HEAD ultimate-trading-system/lib ultimate-trading-system/package.json | tar -x -C "$SCRATCH"
echo "analysis from $(git -C "$SHARED" rev-parse --short FETCH_HEAD)"
LIB="$SCRATCH/ultimate-trading-system/lib" node -e '
const fs = require("fs");
const S = require(process.env.LIB + "/coinsignal.js");
const coins = require(process.env.LIB + "/coins.js");
const run = require(process.env.LIB + "/coinsrun.js");
const { GEOMETRIES } = require(process.env.LIB + "/dataset.js");
const lays = run.layouts();
const dir = "/opt/ultimate-trading-system/data/coins";
const f = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d));
for (const file of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const rec = JSON.parse(fs.readFileSync(dir + "/" + file, "utf8"));
  if (!rec.read) continue;
  for (const s of coins.shapes()) {
    const x = rec.shapes[s.key];
    if (!x || !x.periods) continue;
    const g = S.signalSummary(x, s.key, lays, run.sitOutBand());
    if (!g.plateau) continue;
    const w = S.linkCutWorth(g.plateau, x.linkCut);
    const b = g.sweetSpot.band;
    const at = g.sweep.find((p) => p.band === b);
    const tl = S.trainLayoutOf(lays);
    const rb = S.readBand({ move: x.move, out: x.out }, b, g.k, lays, tl);
    const parts = (rb.gaps[tl] || []).map((p) => `${p.name}: gap ${p.gapShare == null ? "—" : (p.gapShare * 100).toFixed(1) + " pts"} / ${p.gapMove == null ? "—" : f(p.gapMove) + "%"}`).join(" · ");
    console.log(`${rec.coin} ${s.label} · ${x.periods} decisions · plateau ${g.plateau.fromBand}-${g.plateau.toBand} (${g.plateau.points} bands, mean ${g.plateau.meanRatio.toFixed(2)}x) · check ${w ? w.asStrong + "/" + w.trials : "—"}`);
    console.log(`   sweet spot ${b}: ${f(at.ratio)}x chance · called ${(at.called * 100).toFixed(0)}% · edge per called trade ${f(at.edge, 3)}% · per decision ${f(at.perDecision, 3)}% · leans after rising/falling/blind ${rb.lean.rising}/${rb.lean.falling}/${rb.lean.blind} · judged on ${at.judged}`);
    console.log(`   traits ${[g.traits.direction, g.traits.holding, g.traits.carrier].filter(Boolean).join(" ")} · ${parts}`);
  }
}
'
