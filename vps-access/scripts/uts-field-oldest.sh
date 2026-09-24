#!/usr/bin/env bash
# uts-field-oldest.sh -- READ-ONLY. The decision field on Coins: with a window,
# half-life and weight floor as typed, the three oldest days its window holds
# on the latest decision day, per coin and daily chunk shape -- their dates and
# the weight the field gives each -- worked out with the build's own code
# (lib/fieldrun.js inputFor with keepUnclosed as the build calls it, the window
# rule of rollPoints in lib/field.js, and field.weightAt), and whether the build
# would take that window at all (fieldrun.dialsFrom against the box's own most).
# Changes nothing.
#   usage: uts-field-oldest.sh [windowDays] [halfLifeDays] [floor] [coins, comma separated]
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
W="${1:-1095}"; H="${2:-500}"; FL="${3:-0.1}"; COINS="${4:-BTCUSDT,SOLUSDT}"
sudo -u uts timeout 300 nice -n 10 node -e '
(async () => {
  const [W, H, FL, COINS] = process.argv.slice(1);
  const DAY = 86400000;
  const F = require("./lib/field");
  const fieldrun = require("./lib/fieldrun");
  const coinsrun = require("./lib/coinsrun");
  const pipeline = require("./lib/pipeline");
  const { toHourlyMap, forwardFill, GEOMETRIES } = require("./lib/dataset");
  const vocab = require("./lib/vocabulary").vocabulary();
  const shapeName = Object.fromEntries((vocab.geometry || []).map((g) => [g.value, g.label]));
  const cap = fieldrun.capOf(coinsrun.scanRecords().records);
  let verdict;
  try {
    fieldrun.dialsFrom({ windowDays: Number(W), halfLifeDays: Number(H), floor: Number(FL), bands: "10", lookbackDays: "1", evidenceCap: 0, leastEvidence: 0, copies: 0 }, cap);
    verdict = "the build takes it";
  } catch (e) { verdict = "the build REFUSES it: " + e.message; }
  console.log(`window, days ${W} · half-life, days ${H} · weight floor ${FL}`);
  console.log(`most this box allows: ${cap.system ? cap.system.days + " days (" + cap.system.coin + ")" : "not known"} -> ${verdict}`);
  const iso = (ts) => new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  for (const coin of COINS.split(",")) {
    const loaded = await pipeline.loadSymbolAll(coin, () => {});
    if (!loaded.rows.length) { console.log(coin + ": no cached prices on this box"); continue; }
    const map = forwardFill(toHourlyMap(loaded.rows)).map;
    for (const geo of Object.keys(GEOMETRIES)) {
      if (GEOMETRIES[geo].stepHours !== 24) continue;
      const input = fieldrun.inputFor(map, geo, [], { keepUnclosed: true });
      const n = input.decisionTs.length;
      if (!n) { console.log(`${coin} · ${shapeName[geo] || geo}: no decision days`); continue; }
      const d = n - 1; const tsNow = input.decisionTs[d]; const Wms = Number(W) * DAY;
      // in the points on that day: closed by then, with an outcome, and not older than the window
      const inWin = [];
      for (let i = 0; i < d; i++) {
        if (input.closeTs[i] <= tsNow && input.out[i] != null && tsNow - input.decisionTs[i] <= Wms) inWin.push(i);
      }
      console.log(`${coin} · ${shapeName[geo] || geo} · latest decision day ${iso(tsNow)} · ${inWin.length} decisions in the window`);
      inWin.slice(0, 3).forEach((i, k) => {
        const age = (tsNow - input.decisionTs[i]) / DAY;
        console.log(`   position ${k + 1}: ${iso(input.decisionTs[i])} · ${age} days old · weight ${F.weightAt(age, Number(H), Number(FL))}`);
      });
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
' "$W" "$H" "$FL" "$COINS"
