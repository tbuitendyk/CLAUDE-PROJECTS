#!/usr/bin/env bash
# uts-group-one.sh -- READ-ONLY. For the two sets whose only flag is an old
# capture: whether their stage 3 set sizes its trades, what the old capture
# holds against the set's survivors (and by entry), the scans read on it, the
# stop and sizing choices on record, and whether the held and reserve sets read
# from them froze any tuning. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 120 node -e '
const fs = require("fs"); const path = require("path"); const zlib = require("zlib");
const s = require("./lib/stages");
const D = "data/stagesets";
for (const id of ["s4-mtwpnlr8-5", "s4-mu3alkml-12"]) {
  const d = s.getSet(id);
  const parent = s.getSet((d.parent || {}).id) || {};
  const p = parent.params || {};
  console.log(`== ${id} "${d.name}"`);
  console.log(`  stage 3 set ${parent.name}: field ${p.fieldId || "none"}, confirm ${p.confirm || "off"}${p.permuteConfirm ? " (permuted)" : ""}`);
  const surv = d.survivors || [];
  const c = d.capture || {};
  console.log(`  survivors ${surv.length}; capture ${String(c.at || "").slice(0, 16)} release ${c.release}: captured ${c.captured} of ${c.survivors}; entries ${JSON.stringify(c.entries || null)}`);
  let raw = null;
  try { raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(D, id + "-capture.json.gz"))).toString("utf8")); } catch (_) { raw = null; }
  if (raw && Array.isArray(raw.survivors)) {
    const byEntry = {};
    for (const sv of raw.survivors) { const k = sv.entry || "?"; byEntry[k] = (byEntry[k] || 0) + 1; }
    console.log(`  in the capture file, captured survivors by entry: ${JSON.stringify(byEntry)}`);
  }
  // the survivors by entry, off the stage 3 records
  try {
    const rec = require("./lib/rowstore").readAll(parent.id, "records");
    const want = new Set(surv.map((x) => x.label));
    const byEntry = {};
    for (const r of rec) if (want.has(r.label) && r.trade && d.unit && d.unit.startsWith(r.trade + "|")) { const k = r.entry || "?"; byEntry[k] = (byEntry[k] || 0) + 1; }
    console.log(`  the survivors on the stage 3 records, by entry: ${JSON.stringify(byEntry)}`);
  } catch (e) { console.log("  (records not read: " + e.message + ")"); }
  const reads = (c.reads || []);
  console.log(`  scans read on the old capture: ${reads.length} (held-back looks ${reads.filter((r) => r && r.look != null).length})`);
  const scansFile = path.join(D, id + "-tunescans.json");
  console.log(`  kept scan results beside it: ${fs.existsSync(scansFile) ? "yes" : "none"}`);
  const ch = d.stopChoices || {};
  const stops = Object.values(ch).filter((x) => x && x.stopPct != null).length;
  const sizing = Object.values(ch).filter((x) => x && x.sizing && x.sizing.on).length;
  console.log(`  choices on record: ${stops} protective stop(s), ${sizing} survivor(s) with sizing on`);
  for (const j of s.listFunnelSets().filter((x) => (x.kind === "held" || x.kind === "reserve") && (x.from || {}).id === id)) {
    const t = ((j.block || {}).tuned) || null;
    const n = t ? Object.keys(t).length : 0;
    console.log(`  ${j.kind} set ${j.id} #${j.number}: tuning frozen in it: ${n ? n + " survivor(s)" : "none"}`);
  }
}' 2>&1 | tail -c 6000
