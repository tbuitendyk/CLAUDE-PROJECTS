#!/usr/bin/env bash
# DID THE FIELD'S BARS EVER CLEAR IN EACH THIRD OF A COIN AND SHAPE'S TEST
# WINDOW (owner, 2026-09-22: "tell me if the data is accurate or corrupt")?
# For every coin and shape whose four comparisons on Worth walking? came back
# unreadable, and for the strongest readable one beside them: per third of the
# recorded test window, the field pair's speaking days, how many carry a
# certainty of 70 or more, an agreement of 40 or more, both, and the highest
# certainty seen. Reads only.
set -uo pipefail
ID="${1:-}"; [ -n "$ID" ] || { echo "usage: uts-rankhold-gate.sh <stage 3 set id>"; exit 1; }
cd /opt/ultimate-trading-system || exit 1
curl -sS --max-time 30 "http://127.0.0.1:8094/api/funnel/$ID/rankhold?atLeast=&onHowMany=4&fewestRanked=30&fewestChunks=40" > /tmp/uts-rh4.json
node --max-old-space-size=1500 -e '
const fs = require("fs");
const stages = require("./lib/stages"); const FG = require("./lib/fieldgate");
const id = process.argv[1];
const d = JSON.parse(fs.readFileSync("/tmp/uts-rh4.json", "utf8"));
if (!d.result) { console.log("no reading in hand"); process.exit(0); }
const zero = d.result.units.filter((u) => u.bar.why === "no boundary on this coin and shape could be read");
const readable = d.result.units.filter((u) => u.bar.why === "no bar has been set").sort((a, b) => (b.highest ?? -2) - (a.highest ?? -2)).slice(0, 2);
const doc = stages.getSet(id);
const shape = stages.relaunchShapeOf(doc);
const keyOf = (r) => `${r.trade}|${r.ctx1 || ""}|${r.ctx2 || ""}|${r.geometry}`;
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
for (const u of [...zero, ...readable]) {
  const rec = shape.records.find((r) => keyOf(r) === u.unit);
  const w = (((doc.windows || {}).units || {})[u.unit] || {}).test;
  console.log(`\n== ${u.name}  (${zero.includes(u) ? "unreadable" : "readable, strongest " + (u.highest == null ? "-" : u.highest.toFixed(2))})`);
  if (!rec || !w || !w.fromTs) { console.log("   no record or window"); continue; }
  let fp = null; try { fp = stages.fieldPayloadFor(doc, rec); } catch (e) { console.log("   field: " + e.message); continue; }
  if (!fp) { console.log("   no field pair"); continue; }
  const days = FG.daysFromColumns(fp.days).filter((x) => x && x.ts >= w.fromTs && x.ts <= w.toTs).sort((a, b) => a.ts - b.ts);
  const n = days.length, c1 = Math.floor(n / 3), c2 = Math.floor((2 * n) / 3);
  console.log(`   window ${day(w.fromTs)} to ${day(w.toTs)}, field pair ${fp.key}, ${n} field days inside it`);
  const part = (name, s) => {
    const sp = s.filter((x) => x.speaking && x.sign);
    const c70 = sp.filter((x) => Number(x.certainty) >= 70).length, a40 = sp.filter((x) => Number(x.agreement) >= 40).length;
    const both = sp.filter((x) => Number(x.certainty) >= 70 && Number(x.agreement) >= 40).length;
    const maxC = sp.length ? Math.max(...sp.map((x) => Number(x.certainty) || 0)) : null, maxA = sp.length ? Math.max(...sp.map((x) => Number(x.agreement) || 0)) : null;
    console.log(`   ${name}: ${s.length} days ${s.length ? day(s[0].ts) + " to " + day(s[s.length - 1].ts) : ""}; speaking ${sp.length}; certainty>=70 on ${c70}, agreement>=40 on ${a40}, both on ${both}; highest certainty ${maxC == null ? "-" : maxC.toFixed(1)}, highest agreement ${maxA == null ? "-" : maxA.toFixed(1)}`);
  };
  part("first third ", days.slice(0, c1)); part("second third", days.slice(c1, c2)); part("last third  ", days.slice(c2));
}
' "$ID"
