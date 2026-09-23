#!/usr/bin/env bash
# uts-field-fill.sh -- READ-ONLY. For a stage 3 set priced with a field: how
# much of train each fill threshold would keep, measured over every coin and
# shape -- the fill being the share of the field's window already behind a
# day ("full since" is 100%) -- and how much of a full window's evidence the
# field holds at that fill under its own half-life and weight floor. Reads the
# set's document and the field frozen beside it. Changes nothing.
#   usage: uts-field-fill.sh [stage 3 set id]
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
S3="${1:-s3-muc74wb6-25}"
sudo -u uts timeout 120 node -e '
const fs = require("fs"); const path = require("path"); const zlib = require("zlib");
const id = process.argv[1];
const D = "data/stagesets";
const DAY = 86400000;
const doc = JSON.parse(fs.readFileSync(path.join(D, id + ".json"), "utf8"));
const side = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(D, id + "-field.json.gz"))).toString("utf8"));
const dl = side.dials || {};
const Wd = Number(dl.windowDays), H = Number(dl.halfLifeDays), f = Number(dl.floor);
console.log(`field "${side.name}": window ${Wd} days, half-life ${H} days, weight floor ${f}, least evidence ${dl.leastEvidence}, evidence cap ${dl.evidenceCap}`);
// the weight a window of T days holds, one decision a day, under max(floor, 0.5^(age/H))
const Af = f > 0 && f < 1 ? H * Math.log2(1 / f) : (f >= 1 ? 0 : Infinity);
const weightOf = (T) => { const a = Math.min(T, Af); return (H / Math.LN2) * (1 - Math.pow(0.5, a / H)) + (f > 0 ? f * Math.max(0, T - Af) : 0); };
const full = weightOf(Wd);
const units = ((doc.windows || {}).units) || {};
const pairs = (doc.params || {}).fieldPairs || {};
const cuts = [0, 10, 20, 25, 33, 40, 50, 67, 75, 100];
const kept = Object.fromEntries(cuts.map((c) => [c, 0]));
let trainDays = 0, noReading = 0;
for (const [u, w] of Object.entries(units)) {
  if (!w || !w.train) continue;
  const parts = u.split("|");
  const pr = side.pairs[pairs[parts[0] + "|" + parts[3]]];
  if (!pr || !pr.days || !Array.isArray(pr.days.ts) || !pr.days.ts.length) continue;
  const first = pr.days.ts[0];
  const a = w.train.fromTs, b = w.train.toTs;
  const len = (b - a) / DAY;
  trainDays += len;
  noReading += Math.max(0, Math.min(len, (first - a) / DAY));
  for (const c of cuts) {
    const from = first + (c / 100) * Wd * DAY;       // the first day at this fill
    kept[c] += Math.max(0, Math.min(len, (b - Math.max(a, from)) / DAY));
  }
}
console.log(`train days over all coins and shapes: ${Math.round(trainDays)}; with no field reading at all (before the field starts): ${(100 * noReading / trainDays).toFixed(1)}%`);
console.log("fill of the window | days behind the day | evidence held vs a full window | share of train kept");
for (const c of cuts) {
  const T = (c / 100) * Wd;
  console.log(`${String(c).padStart(3)}% | ${String(Math.round(T)).padStart(4)} d | ${(100 * weightOf(T) / full).toFixed(0).padStart(3)}% | ${(100 * kept[c] / trainDays).toFixed(1)}%`);
}
' "$S3" 2>&1 | tail -c 4000
