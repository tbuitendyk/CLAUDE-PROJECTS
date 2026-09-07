#!/usr/bin/env bash
# uts-windows-check.sh -- READ-ONLY. After the 3.85.0 fill: for every finished
# set, does the unread window the fill worked out today start where the run's
# own sealed window started, chunk for chunk? (Equal on every record proves the
# fill and the pinned files at once.) Then: are each set's pinned files intact,
# and how many sets still lack their date ranges (RULE TEN count).
set -uo pipefail
APP=/opt/ultimate-trading-system
RUN=""
if [ "$(id -u)" = 0 ] && command -v runuser >/dev/null 2>&1; then RUN="runuser -u uts --"; fi
cd "$APP" || exit 1
$RUN timeout 400 node -e '
  const stages = require("'"$APP"'/lib/stages");
  const rowstore = require("'"$APP"'/lib/rowstore");
  const manifest = require("'"$APP"'/lib/manifest");
  const key = (u) => u.trade + "|" + (u.ctx1 || "") + "|" + (u.ctx2 || "") + "|" + u.geometry;
  for (const row of stages.listSets()) {
    if (![1, 2, 3].includes(row.stage)) continue;
    const doc = stages.getSet(row.id);
    const w = stages.windowsOfSet(doc);
    let same = 0, diff = 0, noReserve = 0, noWindow = 0, examples = [];
    if (doc.stage === 3) {
      const parent = stages.getSet((doc.parent || {}).id || "");
      const recs = parent ? rowstore.readAll(parent.id, "records") : [];
      const units = ((doc.windows || {}).units) || {};
      for (const k of Object.keys(units)) {
        const rec = recs.find((r) => key(r) === k);
        const u = units[k].unread, r = rec && rec.reserve;
        if (!u) { noWindow++; continue; }
        if (!r) { noReserve++; continue; }
        if (u.fromTs === r.fromTs && u.chunks === r.chunks) same++; else { diff++; if (examples.length < 3) examples.push(k + ": fill " + new Date(u.fromTs).toISOString().slice(0,10) + "/" + u.chunks + " vs run " + new Date(r.fromTs).toISOString().slice(0,10) + "/" + r.chunks); }
      }
    } else {
      for (const rec of rowstore.readAll(doc.id, "records")) {
        const u = rec.windows && rec.windows.unread, r = rec.reserve;
        if (!u) { noWindow++; continue; }
        if (!r) { noReserve++; continue; }
        if (u.fromTs === r.fromTs && u.chunks === r.chunks) same++; else { diff++; if (examples.length < 3) examples.push(key(rec) + ": fill " + new Date(u.fromTs).toISOString().slice(0,10) + "/" + u.chunks + " vs run " + new Date(r.fromTs).toISOString().slice(0,10) + "/" + r.chunks); }
      }
    }
    let pin = "no pin";
    try { const pc = manifest.pinnedIntact(doc.dataManifest); pin = pc.pinned ? (pc.intact ? "intact (" + pc.checked + " files)" : "NOT INTACT: gone " + pc.gone.length + ", changed " + pc.changed.length) : "not pinned"; } catch (e) { pin = "pin check failed: " + e.message; }
    console.log(row.name + " (stage " + doc.stage + ", " + doc.status + "): " + w.known + " of " + w.units + " units have date ranges · unread window same as the run sealed: " + same + ", different: " + diff + ", no sealed window on the record: " + noReserve + ", no date ranges: " + noWindow + " · pinned files " + pin + (doc.windowsFilledAt ? " · filled " + doc.windowsFilledAt : "") + (((doc.windows||{}).filledIn) ? " · filled in" : ""));
    for (const e of examples) console.log("      " + e);
  }
  const m = stages.windowsMissing();
  console.log("RULE TEN: sets still without their date ranges: " + m.sets + " (" + m.units + " units)");
  process.exit(0);
'
