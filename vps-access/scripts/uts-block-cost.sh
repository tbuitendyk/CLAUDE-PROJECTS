#!/usr/bin/env bash
# uts-block-cost.sh -- READ-ONLY. What a new measurement block would cost: every
# record set on disk with the block it was built on, the release, how long it
# took to run, and its parent. Everything on an older block is refused as a
# parent, so this is the bill for moving the first digit. Writes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS' 2>&1 | head -60
const fs = require('fs');
const D = 'data/stagesets';
const M = require('./lib/features').MEASUREMENTS_VERSION;
console.log(`this box builds measurement block ${M}`);
const rows = [];
for (const f of fs.readdirSync(D).filter((x) => /^s[1-4]-.*\.json$/.test(x))) {
  let d; try { d = JSON.parse(fs.readFileSync(`${D}/${f}`, 'utf8')); } catch (_) { continue; }
  if (!d.id) continue;
  const t0 = Date.parse(d.startedAt || d.createdAt || 0); const t1 = Date.parse(d.finishedAt || 0);
  const hrs = (t0 && t1 && t1 > t0) ? ((t1 - t0) / 3600000) : null;
  rows.push({ id: d.id, stage: d.stage ?? String(d.id).slice(1, 2), m: d.measurements ?? 0, rel: d.release || '?', st: d.status || '?', hrs, name: (d.name || '').slice(0, 42), on: d.standsOn || d.parent || '' });
}
rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
let total = 0; const byBlock = {};
for (const r of rows) {
  byBlock[r.m] = (byBlock[r.m] || 0) + 1;
  if (r.hrs) total += r.hrs;
  console.log(`  ${String(r.id).padEnd(18)} stage ${r.stage} block ${String(r.m).padEnd(3)} rel ${String(r.rel).padEnd(9)} ${String(r.st).padEnd(7)} ${r.hrs == null ? '     —' : r.hrs.toFixed(2).padStart(6)}h  ${r.name}`);
}
console.log(`sets: ${rows.length} · by block ${JSON.stringify(byBlock)} · recorded run time on disk ${total.toFixed(1)} hours`);
JS
