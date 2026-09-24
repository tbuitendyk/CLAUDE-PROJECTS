#!/usr/bin/env bash
# uts-survivor-shape.sh -- READ-ONLY. For one held or reserve set (an id as the
# argument, or by default the newest whose name holds "HALF LIFE TABLE (cmp)"
# and ends "#3"): which dials differ between its survivors and how many values
# each takes, how the survivors fall into groups on the dials outside the
# rule's ranges, and how many of the ranged grid's cells each group fills.
# Nothing written.
set -uo pipefail
ARG="${1:-}"
cd /opt/ultimate-trading-system
cat > /tmp/uts-ss.js <<'JS'
const fs = require('fs');
const path = require('path');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const F = require('/opt/ultimate-trading-system/lib/funnel.js');
const D = '/opt/ultimate-trading-system/data/stagesets';
const arg = process.argv[2] || '';
const judges = fs.readdirSync(D).filter((f) => /^s4-.*\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (_) { return null; } })
  .filter((d) => d && (d.kind === 'held' || d.kind === 'reserve')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const doc = arg ? judges.find((d) => d.id === arg) : judges.find((d) => String(d.name).includes('HALF LIFE TABLE (cmp)') && String(d.name).endsWith('#3'));
if (!doc) { console.log('no such set'); process.exit(0); }
const rule = S.getSet((doc.from || {}).id);
(async () => {
  const join = await S.funnelVerifyJoin(rule);
  const rows = join.rows;
  const R = rule.rule || {};
  const dials = F.ALL_DIALS.filter((d) => rows.some((r) => r[d] != null));
  const moving = dials.filter((d) => new Set(rows.map((r) => String(r[d]))).size > 1);
  console.log(`${rows.length} survivors; dials that differ between them:`);
  for (const d of moving) {
    const c = new Map(); for (const r of rows) c.set(String(r[d]), (c.get(String(r[d])) || 0) + 1);
    console.log(`  ${d} (${F.ORDERED_DIALS.includes(d) ? 'ordered' : 'words'}${d in (R.ranges || {}) ? ', ranged in the rule' : ''}): ${[...c].map(([v, n]) => `${v} x${n}`).join(', ')}`);
  }
  const ranged = moving.filter((d) => d in (R.ranges || {}));
  const outside = moving.filter((d) => !(d in (R.ranges || {})));
  const groups = new Map();
  for (const r of rows) {
    const g = outside.map((d) => `${d}=${r[d]}`).join(' ');
    const cell = ranged.map((d) => `${d}=${r[d]}`).join(' ');
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g).add(cell);
  }
  console.log(`\ngroups on the dials outside the rule's ranges (${outside.join(', ')}): ${groups.size}`);
  const fill = new Map(); for (const [, cells] of groups) fill.set(cells.size, (fill.get(cells.size) || 0) + 1);
  console.log(`cells of the ranged grid (${ranged.join(' x ')}) each group fills: ${[...fill].map(([k, n]) => `${k} cells x${n} groups`).join(', ')}`);
  const cellsSeen = new Map(); for (const [, cells] of groups) for (const c of cells) cellsSeen.set(c, (cellsSeen.get(c) || 0) + 1);
  console.log('groups per ranged cell:', [...cellsSeen].map(([c, n]) => `${c}: ${n}`).join(' | '));
  // which combinations of the outside dials are missing from the full product
  const vals = outside.map((d) => [...new Set(rows.map((r) => String(r[d])))]);
  const full = vals.reduce((a, v) => a * v.length, 1);
  console.log(`full product of the outside dials: ${full}; present: ${groups.size}`);
  // pairs of outside dials that are tied to each other
  for (let i = 0; i < outside.length; i++) for (let j = i + 1; j < outside.length; j++) {
    const pairs = new Set(rows.map((r) => `${r[outside[i]]}|${r[outside[j]]}`));
    const need = new Set(rows.map((r) => String(r[outside[i]]))).size * new Set(rows.map((r) => String(r[outside[j]]))).size;
    if (pairs.size < need) console.log(`  ${outside[i]} with ${outside[j]}: only ${[...pairs].join(', ')}`);
  }
  process.exit(0);
})().catch((e) => { console.log('FAILED', e.message); process.exit(0); });
JS
sudo -u uts timeout 240 node /tmp/uts-ss.js "$ARG" 2>&1 | tail -40
rm -f /tmp/uts-ss.js
