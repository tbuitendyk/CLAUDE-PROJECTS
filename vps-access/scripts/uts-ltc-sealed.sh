#!/usr/bin/env bash
# uts-ltc-sealed.sh -- READ-ONLY. For every unit of S3 #1c that reads LTCUSDT
# (as the traded coin or alongside), where does its sealed window begin? If
# every one begins before 2026-08-20, the 17 candles the refresh added on that
# day are candles no unit ever reads.
set -uo pipefail
APP=/opt/ultimate-trading-system
node -e '
const path = require("path");
const stages = require("'"$APP"'/lib/stages");
const rowstore = require("'"$APP"'/lib/rowstore");
const doc = stages.getSet("s3-mtqr9ps2-3");
const parent = stages.getSet((doc.parent || {}).id);
console.log("parent " + parent.name + " (" + parent.id + "), " + rowstore.count(parent.id, "records") + " records");
const recs = rowstore.readAll(parent.id, "records");
const one = recs[0];
console.log("a record\x27s window fields: " + JSON.stringify(Object.fromEntries(Object.entries(one).filter(([k]) => /reserve|sealed|window|span|from|to|first|last|chunks/i.test(k)))).slice(0, 600));
const units = new Set((doc.plan && doc.plan.unitSettings ? doc.plan.unitSettings.map((x) => x.u) : []));
const mine = recs.filter((r) => (units.size ? units.has(r.u) : true) && [r.trade, r.ctx1, r.ctx2].includes("LTCUSDT"));
console.log("units of this run reading LTCUSDT: " + mine.length + " of " + (units.size || recs.length));
const starts = mine.map((r) => (r.reserve && (r.reserve.fromTs || r.reserve.from || r.reserve.start || r.reserve.at)) || (r.sealed && (r.sealed.fromTs || r.sealed.from)) || null);
const known = starts.filter((x) => x != null);
console.log("sealed-window starts known for " + known.length + " of " + mine.length);
if (known.length) {
  const asMs = (v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
  const ms = known.map(asMs).filter(Number.isFinite);
  const latest = Math.max(...ms), earliest = Math.min(...ms);
  console.log("earliest sealed start " + new Date(earliest).toISOString() + " · latest " + new Date(latest).toISOString());
  console.log("2026-08-20 07:00Z is " + (latest <= Date.parse("2026-08-20T07:00:00Z") ? "AFTER every sealed start: unread by every unit" : "BEFORE at least one sealed start: READ by some unit"));
} else {
  console.log("raw reserve of the first LTCUSDT unit: " + JSON.stringify(mine[0] && mine[0].reserve).slice(0, 400));
  try { const sw = stages.sealedFromUnits(mine); console.log("sealedFromUnits: " + JSON.stringify(sw).slice(0, 400)); } catch (e) { console.log("sealedFromUnits threw: " + e.message); }
}
'
