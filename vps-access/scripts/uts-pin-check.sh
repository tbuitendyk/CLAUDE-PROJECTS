#!/usr/bin/env bash
# uts-pin-check.sh -- READ-ONLY. On the release now serving: is S3 #1c still
# paused and offered, and are the price files it was launched on -- its pin --
# still there with the same bytes? This is exactly what start stage 3 asks.
set -uo pipefail
APP=/opt/ultimate-trading-system
SET=s3-mtqr9ps2-3
echo "== the release now serving =="
grep -m1 '"version"' "$APP/package.json" | tr -d ' '
echo "   service since $(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value), pid $(systemctl show ultimate-trading-system -p MainPID --value)"
cd "$APP" && node -e '
const stages = require("./lib/stages");
const { pinnedIntact, pinnedFilesOf } = require("./lib/manifest");
const doc = stages.getSet("'"$SET"'");
console.log("== the set ==");
console.log("   " + doc.name + " is " + doc.status + " · " + (doc.progress || ""));
const row = stages.listSets().find((x) => x.id === doc.id);
console.log("   list row: status=" + row.status + " checkpoint=" + row.checkpoint + " continued=" + row.continued + " · running: " + (stages.stageRunning() || "nothing"));
console.log("== its pin ==");
const pin = pinnedFilesOf(doc.dataManifest);
const n = pin ? Object.values(pin).reduce((a, l) => a + l.length, 0) : 0;
console.log("   " + (pin ? Object.keys(pin).length + " coins, " + n + " files" : "NO PIN (never stamped)"));
if (pin && pin.LTCUSDT) console.log("   LTCUSDT August 2026 pinned as: " + pin.LTCUSDT.filter((f) => f.includes("2026-08")).length + " file(s), bundle pinned: " + pin.LTCUSDT.includes("LTCUSDT-1h-2026-08.json"));
const t0 = Date.now();
const check = pinnedIntact(doc.dataManifest);
console.log("== are the pinned files intact? (" + (Date.now() - t0) + " ms) ==");
console.log("   intact=" + check.intact + " checked=" + check.checked + " gone=" + check.gone.length + " changed=" + check.changed.length + (check.why ? " why=" + check.why : ""));
if (check.gone.length) console.log("   gone: " + check.gone.slice(0, 8).join(", "));
if (check.changed.length) console.log("   changed: " + check.changed.slice(0, 8).join(", "));
const parent = stages.getSet(doc.parent.id);
const pc = pinnedIntact(parent.dataManifest);
console.log("== and the parent S2 #1, for the next fresh launch ==");
console.log("   intact=" + pc.intact + " checked=" + pc.checked + " gone=" + pc.gone.length + " changed=" + pc.changed.length);
'
