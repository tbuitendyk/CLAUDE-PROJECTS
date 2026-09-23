#!/usr/bin/env bash
# uts-lineage.sh -- READ-ONLY. Every stage 3 set with the stage 2 and stage 1
# sets it came from, by name, and the Stage 4 sets cut from it. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 60 node -e '
const s = require("./lib/stages");
const all = s.listSets().filter((x) => !x.exam);
const byId = new Map(all.map((x) => [x.id, s.getSet(x.id)]).filter(([, d]) => !!d));
const nm = (id) => { const d = byId.get(id); return d ? d.name : `(gone: ${id})`; };
for (const d of [...byId.values()].filter((x) => x.stage === 3).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
  const s2 = byId.get((d.parent || {}).id);
  const s1id = s2 ? (s2.parent || {}).id : null;
  const kids = [...byId.values()].filter((x) => x.stage === 4 && (x.parent || {}).id === d.id).length;
  console.log(`${d.name}  <-  stage 2: ${s2 ? s2.name : "(none)"}  <-  stage 1: ${s1id ? nm(s1id) : "(none)"}${kids ? `  | Stage 4 sets cut from it: ${kids}` : ""}`);
}' 2>&1 | tail -c 6000
