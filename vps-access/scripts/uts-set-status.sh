#!/usr/bin/env bash
# uts-set-status.sh -- READ-ONLY. Every record set on the box, oldest first:
# its stage, release, name, whether the running release flags it REBUILD
# REQUIRED and why, whether it was rebuilt in place, and the state of its
# capture. Stage 1 and 2 sets are counted only (nothing sized reaches them).
# Reads set documents through the service's own code. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 120 node -e '
const s = require("./lib/stages");
console.log("release " + require("./package.json").version);
const all = s.listSets().filter((x) => !x.exam).map((x) => s.getSet(x.id)).filter(Boolean);
const early = all.filter((d) => d.stage < 3);
console.log(`stage 1 and 2 sets: ${early.length} (nothing sized reaches them)`);
const rows = all.filter((d) => d.stage >= 3).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
for (const d of rows) {
  const f = s.rebuildOf(d);
  const flag = f ? "REBUILD REQUIRED: " + f.reasons.map((r) => r.key).join("+") : "ok";
  const rb = d.rebuilt ? ` · rebuilt ${String(d.rebuilt.at).slice(0, 10)} (${d.rebuilt.survivorsBefore} -> ${d.rebuilt.survivorsNow} survivors)` : "";
  const cap = d.stage === 4 ? (d.capture ? ` · capture v${d.capture.v}${d.capture.fieldFill ? ` at ${d.capture.fieldFill.pct}%` : ""} ${String(d.capture.at || "").slice(0, 10)}` : " · no capture") : "";
  const kind = d.stage === 3 ? "S3" : (d.kind === "held" || d.kind === "reserve" ? d.kind : (d.derived ? "half-life" : "rule"));
  console.log(`${String(d.createdAt || "").slice(0, 10)} ${kind.padEnd(9)} ${String(d.release || "?").padEnd(8)} ${d.id} "${String(d.name || "").slice(0, 62)}" :: ${flag}${rb}${cap}`);
}
' 2>&1 | tail -c 7800
