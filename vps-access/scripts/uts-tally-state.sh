#!/usr/bin/env bash
# uts-tally-state.sh -- READ-ONLY. For every stage 3 set: whether its totalled
# tables are on disk, their size and date, the shape they were written in
# against the shape the running release reads, and how many records the set
# holds. Parses a tally only when it is under 200 MB. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 240 node -e '
const fs = require("fs"); const path = require("path"); const zlib = require("zlib");
const s = require("./lib/stages");
const D = "data/stagesets";
const src = fs.readFileSync("lib/stages.js", "utf8");
const want = Number((/const TALLY_V = (\d+);/.exec(src) || [])[1]);
console.log(`the running release reads tables of shape ${want}`);
for (const x of s.listSets().filter((y) => y.stage === 3 && !y.exam)) {
  const f = path.join(D, `${x.id}-tally.json.gz`);
  let line = `${x.id} "${String(x.name).slice(0, 45)}": `;
  let st = null; try { st = fs.statSync(f); } catch (_) { st = null; }
  if (!st) { console.log(line + "NO TABLES ON DISK"); continue; }
  line += `${(st.size / 1048576).toFixed(1)} MB gz, written ${st.mtime.toISOString().slice(0, 16)}`;
  if (st.size < 200 * 1048576) {
    try {
      const raw = zlib.gunzipSync(fs.readFileSync(f)).toString("utf8");
      const m = /"v"\s*:\s*(\d+)/.exec(raw.slice(0, 2000));
      line += `; shape ${m ? m[1] : "?"}${m && Number(m[1]) !== want ? " (OLDER: reads as absent)" : ""}`;
    } catch (e) { line += `; unreadable: ${e.message}`; }
  }
  console.log(line);
}' 2>&1 | tail -c 6000
