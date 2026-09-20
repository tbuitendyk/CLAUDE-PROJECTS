#!/usr/bin/env bash
# uts-extra-gate-probe.sh -- READ-ONLY. Why a stage 1 launch from the walk list
# fails, per unit, without running one. It resolves the units exactly as the
# launch does, builds each one's chunks exactly as the stage 1 task does, and
# reports how many training chunks each extra's band actually opens -- which is
# the number the 3.201.0 refusal is about. It trains nothing and writes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
(async () => {
  const coinsrun = require("./lib/coinsrun");
  const stages = require("./lib/stages");
  const sw = require("./lib/stagework");
  const { medianAbsMove } = require("./lib/windowmove");
  const pairs = coinsrun.passingUnits("walk");
  console.log(`${pairs.length} coin-and-shape pair(s) ticked from a walk set`);
  const withEx = pairs.filter((p) => (p.extras || []).length);
  console.log(`${withEx.length} of them carry an extra; ${pairs.length - withEx.length} carry none`);
  const units = stages.unitsForPassers(pairs, { singles: true, doubles: false, triples: false }, []);
  console.log(`${units.length} unit(s) at singles`);
  console.log("");
  console.log("unit                        chunks  train   band   thresh   opens(train)  opens(test)  verdict");
  let bad = 0;
  for (const u of units.slice(0, 30)) {
    const p = { allLoaded: true, windowLayout: "split70", extras: u.extras || [] };
    let out = `${(u.trade + " " + u.geometry).padEnd(26)}`;
    try {
      const { split } = await sw.unitChunks({ trade: u.trade, ctx1: u.ctx1, ctx2: u.ctx2, size: u.size }, u.geometry, p);
      const { trainChunks, testChunks } = split;
      const all = trainChunks.length + testChunks.length + (split.holdChunks || []).length;
      out += `${String(all).padStart(6)}${String(trainChunks.length).padStart(7)}`;
      const ex = (u.extras || [])[0];
      if (!ex) { console.log(out + "     (no extra)"); continue; }
      const onTr = trainChunks.filter((c) => c.extraOn && c.extraOn[0]).length;
      const onTe = testChunks.filter((c) => c.extraOn && c.extraOn[0]).length;
      const yard = medianAbsMove(trainChunks.map((c) => (c.backPct || [])[0]));
      out += `${String(ex.bandPct).padStart(7)}${(yard > 0 ? (yard * ex.bandPct / 100).toFixed(2) : "-").padStart(9)}`;
      out += `${String(onTr).padStart(14)}${String(onTe).padStart(13)}  ${onTr < 12 ? "REFUSED" : "ok"}`;
      if (onTr < 12) bad++;
      console.log(out);
    } catch (e) {
      bad++;
      console.log(out + "   THREW: " + String(e.message).slice(0, 70));
    }
  }
  console.log("");
  console.log(`${bad} unit(s) would fail a stage 1 launch right now`);
})().catch((e) => { console.log("probe failed: " + e.message); });
' 2>&1 | head -60
