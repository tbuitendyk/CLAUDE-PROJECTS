#!/usr/bin/env bash
# uts-capture-verify.sh -- READ-ONLY. After the capture, before the deploy:
# will the paused run actually be startable again?
#
# It checks the things a start-again refuses on that depend on the world
# outside the code: the stage 2 parent still being on the box with every unit
# the run priced, and the price files being the same ones the run was priced
# on. It does NOT rebuild the block (every function that builds it is
# byte-identical between the deployed release and 3.82.0, checked in the
# repo) and does NOT scan 2.18M rows for duplicates (a set that has never
# been started again cannot hold one).
#
# Nothing is written. It loads the deployed modules only to read with them.
set -uo pipefail
APP=/opt/ultimate-trading-system
SET=s3-mtqr9ps2-3
cd "$APP" || exit 1
node -e '
const fs = require("fs"), path = require("path");
const APP = "'"$APP"'", SET = "'"$SET"'";
const D = path.join(APP, "data", "stagesets");
const doc = JSON.parse(fs.readFileSync(path.join(D, SET + ".json"), "utf8"));
const cp = JSON.parse(fs.readFileSync(path.join(D, "checkpoints", SET + ".json"), "utf8"));
const say = (ok, m) => console.log("   " + (ok ? "OK  " : "NO  ") + m);

console.log("== the paused set ==");
say(doc.status === "paused", doc.name + " is " + doc.status);
say(cp.v === 1 && cp.id === SET, "its checkpoint is v" + cp.v + " for " + cp.id);
say(Array.isArray(cp.units) && cp.units.length === 300, cp.units.length + " units listed, in the order the run had them");

console.log("== the stage 2 parent it was priced from ==");
const pid = (doc.parent || {}).id || (doc.params || {}).from;
let parent = null;
try { parent = JSON.parse(fs.readFileSync(path.join(D, pid + ".json"), "utf8")); } catch (e) { /* reported below */ }
say(!!parent, "the parent " + pid + (parent ? " (" + parent.name + ", " + parent.status + ")" : " IS NOT ON THE BOX"));
if (!parent) process.exit(1);
say(parent.stage === 2, "it is a stage " + parent.stage + " record set");

console.log("== every unit the run priced is still on it ==");
const rowstore = require(path.join(APP, "lib", "rowstore.js"));
const recs = rowstore.readAll(pid, "records");
const have = new Set(recs.map((r) => r.u));
const missing = cp.units.filter((u) => !have.has(u));
say(missing.length === 0, recs.length + " records on the parent; " + (missing.length ? missing.length + " OF THE RUN’S UNITS ARE GONE: " + missing.slice(0, 8).join(",") : "all 300 of the run’s units are there"));

console.log("== the price files are the ones it was priced on ==");
const man = require(path.join(APP, "lib", "manifest.js"));
const stamped = (doc.dataManifest || {}).symbols || null;
if (!stamped) { say(false, "the run recorded no price-file fingerprint, so this cannot be checked"); }
else {
  const names = Object.keys(stamped);
  let changed = [];
  for (const s of names) {
    let now = null;
    try { now = man.symbolManifest(s); } catch (e) { changed.push(s + " (unreadable)"); continue; }
    if (now.digest !== stamped[s].digest) changed.push(s);
  }
  say(changed.length === 0, names.length + " coins fingerprinted at the launch; "
    + (changed.length ? changed.length + " HAVE CHANGED SINCE: " + changed.slice(0, 8).join(", ") : "none has changed since"));
}

console.log("== the records store ==");
const file = rowstore.storeFile(SET, "records");
const meta = JSON.parse(fs.readFileSync(file + ".meta.json", "utf8"));
const last = meta.blocks[meta.blocks.length - 1];
const indexed = last ? Number(last.at) + Number(last.bytes) : 0;
const size = fs.statSync(file).size;
console.log("   " + meta.rows.toLocaleString() + " rows indexed in " + meta.blocks.length.toLocaleString() + " blocks");
console.log("   file " + size.toLocaleString() + " bytes, indexed up to " + indexed.toLocaleString()
  + " -> " + (size > indexed ? (size - indexed).toLocaleString() + " bytes past the index, which the start-again cuts off first" : "the file ends exactly where the index says"));
say(true, "the checkpoint counted " + cp.storeRows.toLocaleString() + " rows pushed; " + meta.rows.toLocaleString() + " reached the index"
  + (cp.storeRows > meta.rows ? " (" + (cp.storeRows - meta.rows).toLocaleString() + " were still in flight and are priced again)" : ""));

console.log("== what is left to price ==");
const done = meta.rows, total = (doc.plan || {}).settings * cp.units.length;
console.log("   " + done.toLocaleString() + " of about " + total.toLocaleString() + " rows are on disk ("
  + (100 * done / total).toFixed(1) + "%), so a start-again prices about " + (total - done).toLocaleString() + " settings");
'
