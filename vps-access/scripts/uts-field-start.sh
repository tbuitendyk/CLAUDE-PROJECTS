#!/usr/bin/env bash
# uts-field-start.sh -- READ-ONLY. Where the decision field starts for each coin
# and daily chunk shape, with the build's own code: the coin's first decision
# day (the start of its history on this box), the first day the window is full
# (rollPoints' own rule: the first day at least `window` days after the first
# decision), and on that day the three oldest days the window holds with the
# weight field.weightAt gives each. Beside it, the coin's train stretch under
# 61/13/13/13 (coins.layoutParts, as the box's most is worked out) and how much
# of it has a full field. Then what every field built on the box recorded for
# those coins: its window and each pair's first day and "full since".
# Changes nothing.
#   usage: uts-field-start.sh [coins, comma separated]   (window 1095, half-life 500, floor 0.1)
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
COINS="${1:-BTCUSDT,SOLUSDT}"
sudo -u uts timeout 300 nice -n 10 node -e '
(async () => {
  const COINS = process.argv[1].split(",");
  const W = 1095, H = 500, FL = 0.1, DAY = 86400000;
  const F = require("./lib/field");
  const fieldrun = require("./lib/fieldrun");
  const fset = require("./lib/fieldset");
  const coins = require("./lib/coins");
  const pipeline = require("./lib/pipeline");
  const { toHourlyMap, forwardFill, GEOMETRIES } = require("./lib/dataset");
  const vocab = require("./lib/vocabulary").vocabulary();
  const shapeName = Object.fromEntries((vocab.geometry || []).map((g) => [g.value, g.label]));
  const day = (ts) => (ts == null ? "never" : new Date(ts).toISOString().slice(0, 10));
  console.log(`window, days ${W} · half-life, days ${H} · weight floor ${FL}`);
  for (const coin of COINS) {
    const loaded = await pipeline.loadSymbolAll(coin, () => {});
    if (!loaded.rows.length) { console.log(coin + ": no cached prices on this box"); continue; }
    const map = forwardFill(toHourlyMap(loaded.rows)).map;
    for (const geo of Object.keys(GEOMETRIES)) {
      if (GEOMETRIES[geo].stepHours !== 24) continue;
      const input = fieldrun.inputFor(map, geo, [], { keepUnclosed: true });
      const ts = input.decisionTs; const n = ts.length;
      if (!n) continue;
      const full = ts.findIndex((t) => t - ts[0] >= W * DAY);
      const lp = coins.layoutParts(n, "reserve61");
      const tr = lp && lp.parts ? lp.parts.find((q) => q.name === "train") : null;
      const trainEnd = tr ? ts[Math.min(n - 1, tr.to)] : null;
      const trainDays = tr ? tr.to - tr.from + 1 : 0;
      const trainFull = tr && full >= 0 ? Math.max(0, tr.to - Math.max(tr.from, full) + 1) : 0;
      console.log(`${coin} · ${shapeName[geo] || geo}: history from ${day(ts[0])} · window first full ${full >= 0 ? day(ts[full]) : "never"} · train ${day(ts[0])} to ${day(trainEnd)}, ${trainDays} days, ${trainFull} of them with a full field`);
      if (full >= 0) {
        const tsNow = ts[full];
        const inWin = [];
        for (let i = 0; i < full; i++) if (input.closeTs[i] <= tsNow && input.out[i] != null && tsNow - ts[i] <= W * DAY) inWin.push(i);
        inWin.slice(0, 3).forEach((i, k) => {
          const age = (tsNow - ts[i]) / DAY;
          console.log(`   on ${day(tsNow)}, position ${k + 1}: ${day(ts[i])} · ${age} days old · weight ${F.weightAt(age, H, FL)}`);
        });
      }
    }
  }
  console.log("");
  console.log("what the fields built on this box recorded:");
  for (const f of fset.listFields()) {
    const doc = fset.readField(f.id);
    if (!doc) continue;
    const dl = doc.dials || {};
    const mine = (doc.pairs || []).filter((p) => COINS.includes(p.coin));
    console.log(`${f.id} "${doc.name || ""}": window ${dl.windowDays} days, half-life ${dl.halfLifeDays}, floor ${dl.floor}${dl.windowEachOwn ? " (each coin its own)" : ""} · ${mine.length} pairs of these coins`);
    for (const p of mine) console.log(`   ${p.coin} · ${shapeName[p.geometry] || p.geometry}: first day ${day(p.firstTs)} · full since ${day(p.fullAt)} · last day ${day(p.lastTs)} · window ${p.windowDays || dl.windowDays} days`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
' "$COINS"
