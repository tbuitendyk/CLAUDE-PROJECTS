#!/usr/bin/env bash
# uts-orphans-delete.sh -- ONE-OFF, owner order 2026-09-23 ("one off delete of
# stuff left behind"). Deletes, in data/stagesets only, the files and folders
# named after a record set whose document is gone -- left behind by deletions
# before 3.237.0, which now deletes everything a set owns. A name counts only
# when it is a set id (s1- to s4-, then letters and digits, a dash, digits)
# followed by "-" or "."; a set whose document is there is never touched.
# Lists each item with its size, then deletes it. Taken off the branch after
# its one run.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 120 node -e '
const fs = require("fs"); const path = require("path");
const D = "data/stagesets";
const names = fs.readdirSync(D);
const alive = new Set(names.filter((f) => /^s[1-4]-[a-z0-9]+-[0-9]+\.json$/.test(f)).map((f) => f.slice(0, -5)));
const sizeOf = (p) => { const st = fs.statSync(p); if (!st.isDirectory()) return st.size; let n = 0; for (const f of fs.readdirSync(p)) n += sizeOf(path.join(p, f)); return n; };
const gone = [];
for (const f of names) {
  const m = /^(s[1-4]-[a-z0-9]+-[0-9]+)([-.].*)$/.exec(f);
  if (!m) continue;
  const [, id, rest] = m;
  if (rest === ".json" || alive.has(id)) continue;
  gone.push({ f, id, bytes: sizeOf(path.join(D, f)) });
}
let total = 0;
for (const g of gone) {
  fs.rmSync(path.join(D, g.f), { recursive: true, force: true });
  total += g.bytes;
  console.log(`deleted ${g.f} (${(g.bytes / 1048576).toFixed(2)} MB) -- its set ${g.id} is gone`);
}
console.log(`${gone.length} item(s) deleted, ${(total / 1048576).toFixed(1)} MB`);
' 2>&1 | tail -c 6000
