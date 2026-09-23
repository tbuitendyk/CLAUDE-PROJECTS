#!/usr/bin/env bash
# uts-field-pair.sh -- READ-ONLY. One field pair frozen beside a stage 3 set,
# day by day at its edges: its first day, the first day it speaks, the first
# day its window is marked full, the recorded "full since", and how many days
# it holds. Changes nothing.   usage: uts-field-pair.sh [stage 3 set id]
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
S3="${1:-s3-muc74wb6-25}"
sudo -u uts timeout 120 node -e '
const fs = require("fs"); const path = require("path"); const zlib = require("zlib");
const id = process.argv[1];
const side = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join("data/stagesets", id + "-field.json.gz"))).toString("utf8"));
const day = (ts) => (ts == null ? "none" : new Date(ts).toISOString().slice(0, 10));
const keys = Object.keys(side.pairs).slice(0, 4);
for (const k of keys) {
  const p = side.pairs[k]; const c = p.days || {};
  const n = (c.ts || []).length;
  const firstSpeak = (c.speaking || []).findIndex((x) => x > 0);
  const firstFull = (c.full || []).findIndex((x) => !!x);
  console.log(`${k}: ${n} days, ${day(c.ts[0])} .. ${day(c.ts[n - 1])}; first speaking ${firstSpeak < 0 ? "never" : day(c.ts[firstSpeak])}; first marked full ${firstFull < 0 ? "never" : day(c.ts[firstFull])}; recorded full since ${day(p.fullAt)}; window ${p.windowDays ?? "(not stored)"}; columns ${Object.keys(c).join(",")}`);
}
console.log("dials:", JSON.stringify(side.dials));
' "$S3" 2>&1 | tail -c 3000
