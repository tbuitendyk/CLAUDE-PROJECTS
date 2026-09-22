#!/usr/bin/env bash
# WHY EACH COIN AND SHAPE OF A STAGE 3 SET COULD NOT BE READ on the Funnel's
# Worth walking? (owner, 2026-09-22: "LOOK THIS TIME at the 24 that could not
# be read"). First the reading the service holds, laid against the floors as
# the screen starts them (30 settings ranked, 40 chunks a part) and no bar; the
# service keeps the reading in memory only, so if a restart has lost it, the
# two floors are worked out off the files on disk instead. Reads only.
set -uo pipefail
ID="${1:-}"; [ -n "$ID" ] || { echo "usage: uts-rankhold-why.sh <stage 3 set id>"; exit 1; }
echo "== the reading the service holds for $ID, floors 30 settings / 40 chunks a part, no bar =="
curl -sS --max-time 30 "http://127.0.0.1:8094/api/funnel/$ID/rankhold?atLeast=&onHowMany=4&fewestRanked=30&fewestChunks=40" > /tmp/uts-rh.json
node -e '
const d = JSON.parse(require("fs").readFileSync("/tmp/uts-rh.json", "utf8"));
if (!d.result) { console.log("  no reading in hand:", JSON.stringify(d).slice(0, 200)); process.exit(3); }
const r = d.result;
console.log(`  ${r.of} coins and shapes: ${r.passing} clear, ${r.failing} do not, ${r.unreadable} could not be read (with no bar, every readable row reads as no bar set)`);
const whys = {};
for (const u of r.units) { if (u.bar.pass == null && u.bar.why !== "no bar has been set") { const w = u.bar.why; (whys[w] = whys[w] || []).push(`${u.name} [settings ${u.usable} of ${u.of}, chunks a part ${u.chunksAPart}]`); } }
for (const [w, list] of Object.entries(whys)) { console.log(`\n  ${list.length} x ${w}`); for (const x of list) console.log("     " + x); }
console.log("\n  readable rows, strongest of the four first (first>second, second>third, first>third, first two>third):");
const ok = r.units.filter((u) => u.bar.pass != null || u.bar.why === "no bar has been set").sort((a, b) => (b.highest ?? -2) - (a.highest ?? -2));
for (const u of ok.slice(0, 15)) console.log(`     ${String(u.name).padEnd(30)} ${u.readings.map((x) => (x.hold == null ? "  -  " : x.hold.toFixed(2).padStart(5))).join("  ")}   settings ${u.usable}, chunks a part ${u.chunksAPart}`);
console.log(`  ... ${ok.length} readable in all`);
'
rc=$?
[ $rc -ne 3 ] && exit 0
echo
echo "== no reading in hand: the two floors worked out off the files on disk =="
cd /opt/ultimate-trading-system || exit 1
node -e '
const fs = require("fs"), path = require("path");
const id = process.argv[1];
const doc = JSON.parse(fs.readFileSync(`data/stagesets/${id}.json`, "utf8"));
const rec = ((doc.windows || {}).units) || {};
const dir = `data/stagesets/${id}.funnelrich`;
const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const out = [];
for (const k of Object.keys(idx.units || {})) {
  const f = path.join(dir, "units", k.replace(/[^A-Za-z0-9._@+-]+/g, "_") + ".json");
  let usable = 0, n = 0;
  try { const u = JSON.parse(fs.readFileSync(f, "utf8")); for (const e of Object.values(u.settings || {})) { n++; const t = e.pnlThirds; if (Array.isArray(t) && t.length >= 3 && t.slice(0, 3).every((v) => Number.isFinite(Number(v)))) usable++; } } catch (e) { out.push({ k, err: String(e.message) }); continue; }
  const w = rec[k]; const chunks = w && w.test && Number(w.test.chunks); const aPart = Number.isFinite(chunks) && chunks > 0 ? Math.floor(chunks / 3) : null;
  out.push({ k, n, usable, aPart });
}
const thin = out.filter((x) => !x.err && x.usable < 30);
const short = out.filter((x) => !x.err && x.usable >= 30 && (x.aPart == null || x.aPart < 40));
console.log(`  ${out.length} coins and shapes in the store; settings ranked below 30: ${thin.length}; chunks a part below 40 or unrecorded: ${short.length}; unreadable files: ${out.filter((x) => x.err).length}`);
for (const x of thin) console.log(`     below 30 settings: ${x.k}   settings with all three parts ${x.usable} of ${x.n}, chunks a part ${x.aPart}`);
for (const x of short) console.log(`     below 40 chunks a part: ${x.k}   chunks a part ${x.aPart}, settings ${x.usable}`);
for (const x of out.filter((y) => y.err)) console.log(`     unreadable file: ${x.k}  ${x.err}`);
const rest = out.filter((x) => !x.err && x.usable >= 30 && x.aPart != null && x.aPart >= 40);
console.log(`  clear of both floors: ${rest.length}. Whether each of those has a comparison that can be read needs the reading itself.`);
' "$ID"
