#!/usr/bin/env bash
# READ-ONLY. Why the Funnel says the newest stage 3 set has, or has not, a
# sealed window: the set's window layout, its parent's, and whether the
# parent's records carry the sealed bounds. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const st = require("./lib/stages"); const rs = require("./lib/rowstore");
const s3 = st.listSets().filter((s) => s.stage === 3).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
const doc = st.getSet(s3.id);
console.log("set", doc.name, doc.id, "layout", (doc.params || {}).windowLayout, "engine", doc.engineVersion);
const sw = st.sealedWindowOf(doc);
console.log("sealedWindowOf:", JSON.stringify({ sealed: sw.sealed, layout: sw.layout, missing: sw.missing, why: sw.why, units: (sw.units || []).length }));
const parent = st.getSet(doc.parent.id);
console.log("parent", parent.name, "layout", (parent.params || {}).windowLayout, "engine", parent.engineVersion);
const rows = rs.readAll(parent.id, "records");
console.log("parent records", rows.length, "with reserve:", rows.filter((r) => r.reserve).length, "sample reserve:", JSON.stringify((rows.find((r) => r.reserve) || {}).reserve || null));
const gp = parent.parent ? st.getSet(parent.parent.id) : null;
if (gp) { const g = rs.readAll(gp.id, "records"); console.log("grandparent", gp.name, "layout", (gp.params || {}).windowLayout, "engine", gp.engineVersion, "records", g.length, "with reserve:", g.filter((r) => r.reserve).length); }
'
