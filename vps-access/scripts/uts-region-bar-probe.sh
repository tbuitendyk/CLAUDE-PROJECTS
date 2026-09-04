#!/usr/bin/env bash
# READ ONLY. What the widest region does as the step 5 bar is loosened, on the
# owner's own board and their own two rules. Prints, per bar: how many settings
# clear and the region size -- and, when it will not grow, WHY: how the rows
# split into slices a region may never cross, and which dials still move.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/regionbar.js <<'JS'
const fs = require('fs');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const F = require('/opt/ultimate-trading-system/lib/funnel.js');
const S4 = require('/opt/ultimate-trading-system/lib/funnelset.js');
const P = require('/opt/ultimate-trading-system/lib/plateau.js');
const dir = '/opt/ultimate-trading-system/data/stagesets';
const S3 = 's3-mtl42g1m-3';
const S4ID = 's4-mtmny75s-1';
const doc = JSON.parse(fs.readFileSync(`${dir}/${S4ID}.json`, 'utf8'));
console.log('stage 4 set:', doc.name, '| unit', doc.unit || doc.unitKey || JSON.stringify(doc.units || null));
const unit = doc.unit || doc.unitKey || (doc.board && doc.board.key) || null;
(async () => {
  const board = await S.funnelBoard(S3, 5, unit);
  const rich = S.readFunnelRich ? S.readFunnelRich(S3) : null;
  const all = S.withFunnelRich ? S.withFunnelRich(board.all, rich) : board.all;
  console.log(`board: ${all.length} row(s) for unit ${unit}`);
  const cat = F.CATEGORICAL_DIALS;
  const report = (label, rows) => {
    const ordered = F.ORDERED_DIALS.filter((d) => rows.some((r) => r[d] != null));
    console.log(`\n== ${label}: ${rows.length} row(s)`);
    const slices = new Map();
    for (const r of rows) { const k = cat.map((a) => String(r[a])).join('|'); slices.set(k, (slices.get(k) || 0) + 1); }
    const sizes = [...slices.values()].sort((a, b) => b - a);
    console.log(`   slices ${slices.size}; biggest ${sizes.slice(0, 6).join(', ')}`);
    console.log('   ordered dials still moving:', ordered.filter((d) => new Set(rows.map((r) => r[d])).size > 1).map((d) => `${d}=${new Set(rows.map((r) => r[d])).size}`).join(' ') || 'NONE');
    console.log('   word dials still moving  :', cat.filter((d) => new Set(rows.map((r) => r[d])).size > 1).map((d) => `${d}=${new Set(rows.map((r) => r[d])).size}`).join(' ') || 'NONE');
    if (rows.length > 6000) { console.log('   too many rows to walk here'); return; }
    const mapped = rows.map((r) => ({ ...r, pnl: F.money(r), trades: r.avgTrades == null ? 1 : r.avgTrades }));
    const nulls = mapped.filter((r) => !Number.isFinite(r.pnl)).length;
    console.log(`   rows with no money figure at all: ${nulls}`);
    for (const at of [0, -1, -5, -50, -1000]) {
      const g = P.widestRegion(mapped, { minTrades: 0, atLeast: at, orderedAxes: ordered, categoricalAxes: cat });
      console.log(`   bar ${String(at).padStart(6)}  size ${String(g.size).padStart(6)}  cleared ${String(g.cellsClearing).padStart(6)}  of ${g.cellsConsidered}  papered ${JSON.stringify(g.papered)}`);
    }
  };
  const rule = doc.rule || doc.finalRule || null;
  const userRule = doc.userRule || null;
  if (userRule) report("the owner's own rule", S4.applyRule(all, { ...S4.EMPTY_RULE, ...userRule }));
  if (rule) report('the final rule', S4.applyRule(all, rule));
  report('the whole board, nothing narrowed', all);
})().catch((e) => { console.log('FAILED', e.message, e.stack); });
JS
timeout 540 node --max-old-space-size=3000 /tmp/regionbar.js 2>&1 | tail -60
rm -f /tmp/regionbar.js
