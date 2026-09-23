#!/usr/bin/env bash
# uts-field-full.sh -- READ-ONLY. For a stage 3 set priced with a field: each
# coin and shape's train, test and held stretch against the first day its
# field pair's window was full ("full since" on Coins). Before that day the
# field reads from part of a window. Reads the set's document and the field it
# was priced with, frozen beside it. Changes nothing.
#   usage: uts-field-full.sh [stage 3 set id]
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
S3="${1:-s3-muc74wb6-25}"
sudo -u uts timeout 120 node -e '
const fs = require("fs"); const path = require("path"); const zlib = require("zlib");
const id = process.argv[1];
const D = "data/stagesets";
const doc = JSON.parse(fs.readFileSync(path.join(D, id + ".json"), "utf8"));
const p = doc.params || {};
let side = null;
try { side = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(D, id + "-field.json.gz"))).toString("utf8")); } catch (e) { console.log("no field beside the set:", e.message); process.exit(0); }
console.log(`set ${id} "${doc.name}"; field ${side.field} "${side.name}"; window ${ (side.dials || {}).windowDays } days; half-life ${(side.dials || {}).halfLifeDays} days`);
const day = (ts) => (ts == null ? "never" : new Date(ts).toISOString().slice(0, 10));
const units = ((doc.windows || {}).units) || {};
const pairs = p.fieldPairs || {};
let n = 0, testEarly = 0, holdEarly = 0, trainDays = 0, trainBefore = 0, noPair = 0;
const lines = [];
for (const [u, w] of Object.entries(units)) {
  if (!w) continue;
  n++;
  const key = pairs[u];
  const pr = key && side.pairs ? side.pairs[key] : null;
  if (!pr) { noPair++; continue; }
  const full = pr.fullAt ?? null;
  const tr = w.train || {}, te = w.test || {}, ho = w.hold || {};
  const spanD = (a, b) => (a != null && b != null ? (b - a) / 86400000 : 0);
  const trD = spanD(tr.fromTs, tr.toTs);
  const before = full == null ? trD : Math.max(0, Math.min(trD, spanD(tr.fromTs, full)));
  trainDays += trD; trainBefore += before;
  if (full == null || (te.fromTs != null && te.fromTs < full)) testEarly++;
  if (full == null || (ho.fromTs != null && ho.fromTs < full)) holdEarly++;
  lines.push(`${u}: train ${day(tr.fromTs)}..${day(tr.toTs)} (${Math.round(trD)} d, ${Math.round(before)} d before full) | test from ${day(te.fromTs)} | held from ${day(ho.fromTs)} | field full since ${day(full)}`);
}
console.log(`coins and shapes: ${n}; with no field pair: ${noPair}`);
console.log(`train days before the field is full: ${Math.round(trainBefore)} of ${Math.round(trainDays)} (${trainDays ? (100 * trainBefore / trainDays).toFixed(1) : 0}%)`);
console.log(`coins and shapes whose TEST starts before the field is full: ${testEarly}; whose HELD starts before: ${holdEarly}`);
for (const l of lines.slice(0, 12)) console.log("  " + l);
if (lines.length > 12) console.log(`  ... and ${lines.length - 12} more`);
' "$S3" 2>&1 | tail -c 6000
