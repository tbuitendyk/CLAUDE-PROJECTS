#!/usr/bin/env bash
# uts-found-two.sh -- READ-ONLY. Two things found and not fixed, measured on
# the box: (1) Stage 4 sets whose survivors take the field as their quorum
# (their names start "field"), and how many training trades each capture holds
# for them; (2) files beside the record sets whose set is gone, by kind, with
# their size on disk. Reads set documents and file sizes only.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
D=data/stagesets
echo "== (1) survivors whose quorum is the field"
sudo -u uts timeout 120 node -e '
const fs = require("fs"); const path = require("path"); const zlib = require("zlib");
const D = "data/stagesets";
const docs = fs.readdirSync(D).filter((f) => /^s4-[a-z0-9]+-[0-9]+\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (_) { return null; } }).filter((d) => d && !d.exam);
let sets = 0;
for (const d of docs) {
  const surv = (d.survivors || []).map((s) => String(s.label));
  const field = surv.filter((l) => /^field(\s|$)/.test(l));
  if (!field.length) continue;
  sets++;
  let cap = null;
  try { cap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(D, d.id + "-capture.json.gz"))).toString("utf8")); } catch (_) { cap = null; }
  let trainField = null, testField = null, trainOther = null;
  if (cap && Array.isArray(cap.survivors)) {
    trainField = 0; testField = 0; trainOther = 0;
    for (const s of cap.survivors) {
      const isField = /^field(\s|$)/.test(String(s.label));
      const tr = ((s.entries || {}).train || []).length, te = ((s.entries || {}).test || []).length;
      if (isField) { trainField += tr; testField += te; } else trainOther += tr;
    }
  }
  console.log(`- ${d.id} ${String(d.name || "").slice(0, 60)}: ${field.length} of ${surv.length} survivors quorum by field; capture ${cap ? `v${cap.v}: training trades of those ${trainField}, test ${testField}; training trades of the rest ${trainOther}` : "none"}`);
}
console.log(`Stage 4 sets with such survivors: ${sets} of ${docs.length}`);
' 2>&1 | tail -c 3500
echo
echo "== (2) files whose record set is gone"
sudo -u uts timeout 120 node -e '
const fs = require("fs"); const path = require("path");
const D = "data/stagesets";
const names = fs.readdirSync(D);
const alive = new Set(names.filter((f) => /^s[1-4]-[a-z0-9]+-[0-9]+\.json$/.test(f)).map((f) => f.slice(0, -5)));
const sizeOf = (p) => { const st = fs.statSync(p); if (!st.isDirectory()) return st.size; let n = 0; for (const f of fs.readdirSync(p)) n += sizeOf(path.join(p, f)); return n; };
const kinds = {};
const add = (kind, id, f) => { const k = kinds[kind] || (kinds[kind] = { files: 0, bytes: 0, ids: new Set() }); k.files++; k.bytes += sizeOf(path.join(D, f)); k.ids.add(id); };
for (const f of names) {
  const m = /^(s[1-4]-[a-z0-9]+-[0-9]+)(.*)$/.exec(f);
  if (!m) continue;
  const [, id, rest] = m;
  if (rest === ".json") continue;
  if (alive.has(id)) { if (rest.endsWith(".before-rebuild")) add("kept beside a rebuilt set (its set is alive)", id, f); continue; }
  const kind = rest.startsWith("-capture") ? "capture" : rest.startsWith("-halflife-") ? "half-life run" : rest.startsWith(".funnelrich") ? "test history numbers (folder)"
    : rest.startsWith("-reserve-") ? "reserve board" : rest.startsWith("-agreed") ? "agreed sidecar" : rest.startsWith("-tally") ? "tally" : rest.startsWith("-field") ? "field file"
    : rest.startsWith(".units") ? "unit table" : rest.startsWith("-tunescans") ? "kept scans" : rest.endsWith(".before-rebuild") ? "kept beside a rebuild" : `other (${rest.slice(0, 30)})`;
  add(kind, id, f);
}
const mb = (b) => (b / 1048576).toFixed(1) + " MB";
let total = 0;
for (const [k, v] of Object.entries(kinds)) { total += k.startsWith("kept beside a rebuilt set") ? 0 : v.bytes; console.log(`- ${k}: ${v.files} file(s) of ${v.ids.size} set(s), ${mb(v.bytes)}`); }
console.log(`left behind by sets that are gone: ${mb(total)}`);
const df = require("child_process").execSync("df -h " + D + " | tail -1").toString().trim();
console.log("disk: " + df);
' 2>&1 | tail -c 3000
