#!/usr/bin/env bash
# uts-extra-train-probe.sh -- READ-ONLY. Runs the stage 1 unit task itself, for
# the FIRST FEW units ticked from a walk set, exactly as a launch runs it -- same
# task shape, same params -- and prints the error each one gives, if any. It
# writes no record set and starts nothing; it is the failing launch, one unit at
# a time, so the reason is read rather than guessed at.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
(async () => {
  const coinsrun = require("./lib/coinsrun");
  const stages = require("./lib/stages");
  const sw = require("./lib/stagework");
  const pairs = coinsrun.passingUnits("walk");
  const units = stages.unitsForPassers(pairs, { singles: true, doubles: false, triples: false }, []);
  const p = { allLoaded: true, windowLayout: "split70", trainOn: "money", weightCap: 7 };
  const howMany = Number(process.env.N || 4);
  console.log(`running the stage 1 unit task on ${howMany} of ${units.length} unit(s), as the launch runs it`);
  console.log("");
  for (const u of units.slice(0, howMany)) {
    const t0 = Date.now();
    const task = {
      combo: { trade: u.trade, ctx1: u.ctx1, ctx2: u.ctx2, size: u.size },
      geometry: u.geometry,
      params: (u.extras || []).length ? { ...p, extras: u.extras } : p,
      seed: "probe", unitKey: `${u.trade}|${u.geometry}`, nullN: 19, fee: 0.00125, pin: null,
    };
    try {
      const res = await sw.s1UnitTask(task);
      const per = res.perMember || [];
      const ex = per[per.length - 1] || {};
      console.log(`${(u.trade + " " + u.geometry).padEnd(24)} OK   ${res.members.length} members  `
        + `extra spoke ${ex.spoke ?? "-"} of ${ex.chunks ?? "-"}  score ${ex.score == null ? "-" : ex.score.toFixed(1)}  ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) {
      console.log(`${(u.trade + " " + u.geometry).padEnd(24)} FAILED after ${Math.round((Date.now() - t0) / 1000)}s`);
      console.log(`    ${String(e && e.message).slice(0, 300)}`);
      if (e && e.stack) console.log("    " + String(e.stack).split("\n").slice(1, 4).join("\n    "));
    }
  }
})().catch((e) => { console.log("probe failed: " + (e && e.message)); if (e && e.stack) console.log(e.stack.slice(0, 600)); });
' 2>&1 | head -70
