#!/usr/bin/env bash
# uts-rebuild-family.sh -- READ-ONLY. For every Stage 4 set the running release
# flags REBUILD REQUIRED: what its rebuild would stand on -- its coin and shape
# (or the blend), what the filter kept when it was cut, whether today's filter
# on Table 3.C keeps its coin and shape for the test history numbers pass and
# for the cut, what it was read or built from, and at what. Reads files only.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 180 node -e '
const s = require("./lib/stages");
console.log("release " + require("./package.json").version);
const sets = s.listSets().filter((x) => x.stage === 4 && !x.exam).map((x) => s.getSet(x.id)).filter(Boolean);
const flagged = sets.filter((d) => { const f = s.rebuildOf(d); return f && f.reasons.some((r) => r.key === "stage4"); });
const parents = new Map();
for (const d of flagged) {
  const pid = String((d.parent || {}).id);
  if (!parents.has(pid)) {
    const t = s.readTally(pid);
    let pass = null, cut = null;
    try { pass = t && s.passKeptOf ? s.passKeptOf(pid, t) : null; } catch (e) { pass = { err: e.message }; }
    try { cut = t && s.keptUnitKeys ? s.keptUnitKeys(pid, t) : null; } catch (e) { cut = { err: e.message }; }
    const rich = s.readFunnelRich(pid);
    parents.set(pid, { t, pass, cut, rich });
    const p = s.getSet(pid) || {};
    console.log(`parent ${pid} ${String(p.name || "").slice(0, 60)}`);
    console.log(`  units ${t ? s.unitsOfSet(t, pid).length : "no tables"}; pass keeps ${pass && pass.kept ? pass.kept.size : (pass && pass.pending ? "pending" : "all")}; cut keeps ${cut && cut.kept ? cut.kept.size : (cut && cut.pending ? "pending" : "all")}; numbers in todays shape: ${rich ? `yes, ${rich.unitsDone} of ${rich.unitsTotal} coins and shapes` : "none"}`);
  }
  const P = parents.get(pid);
  const u = d.unit == null ? null : String(d.unit);
  const inPass = u == null ? "-" : (!P.pass || !P.pass.kept ? "yes" : (P.pass.kept.has(u) ? "yes" : "NO"));
  const inCut = u == null ? "-" : (!P.cut || !P.cut.kept ? "yes" : (P.cut.kept.has(u) ? "yes" : "NO"));
  const r = (d.block || {}).rules || {};
  console.log(`- ${d.id} ${d.kind || "funnel"} #${d.number ?? ""} "${String(d.name || "").slice(0, 70)}" release ${d.release}`);
  console.log(`    unit ${u == null ? "(the blend)" : JSON.stringify(u)} ${d.unitName || ""}; keptUnits ${Array.isArray(d.keptUnits) ? d.keptUnits.length : "null"}; pass keeps it ${inPass}; cut keeps it ${inCut}; survivors ${(d.survivors || []).length}`);
  if (d.derived) console.log(`    built from ${d.derived.from} (${d.derived.kind}) months ${JSON.stringify(d.derived.months || null)} run ${d.derived.run}`);
  if (d.from) console.log(`    read from ${d.from.id}; share ${r.barChanged ? r.barPct : "(standard)"} sanity ${r.sanityPct ?? "-"}; standsOn ${(d.standsOn || {}).id || "-"}`);
  if (d.capture) console.log(`    capture v ${d.capture.v}`);
  console.log(`    name edited ${d.nameEditedAt ? "yes" : "no"}; closing ${JSON.stringify((d.closing || {}).key || null)}; stop ${d.stopChoice ? "yes" : "no"}; sizing ${d.sizing ? "yes" : "no"}`);
}
console.log(`flagged Stage 4 sets: ${flagged.length}`);
' 2>&1 | tail -c 7800
