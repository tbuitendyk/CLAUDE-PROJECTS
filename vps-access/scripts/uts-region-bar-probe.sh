#!/usr/bin/env bash
# READ ONLY, small output. Why the widest region will not grow on the owner's
# own board: how many rows the final rule keeps, how they split into slices a
# region may never cross, and which dials still move.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/rb.js <<'JS'
const fs = require('fs');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const S4 = require('/opt/ultimate-trading-system/lib/funnelset.js');
const F = require('/opt/ultimate-trading-system/lib/funnel.js');
const P = require('/opt/ultimate-trading-system/lib/plateau.js');
const doc = JSON.parse(fs.readFileSync('/opt/ultimate-trading-system/data/stagesets/s4-mtmny75s-1.json', 'utf8'));
const unit = doc.unit || doc.unitKey || null;
(async () => {
  const r = await S.funnelSetRows(doc.id || 's4-mtmny75s-1', {});
  const rows = (r && r.rows) || [];
  console.log('rows', rows.length, 'keys', Object.keys(rows[0] || {}).slice(0, 40).join(','));
  const cat = F.CATEGORICAL_DIALS; const ord = F.ORDERED_DIALS;
  const slices = new Map();
  for (const x of rows) { const k = cat.map((a) => String(x[a])).join('|'); slices.set(k, (slices.get(k) || 0) + 1); }
  console.log('slices', slices.size, 'biggest', [...slices.values()].sort((a, b) => b - a).slice(0, 6).join(','));
  console.log('ordered moving:', ord.filter((d) => new Set(rows.map((x) => x[d])).size > 1).map((d) => `${d}=${new Set(rows.map((x) => x[d])).size}`).join(' ') || 'NONE');
  console.log('word moving   :', cat.filter((d) => new Set(rows.map((x) => x[d])).size > 1).map((d) => `${d}=${new Set(rows.map((x) => x[d])).size}`).join(' ') || 'NONE');
  const mapped = rows.map((x) => ({ ...x, pnl: F.money(x), trades: x.avgTrades == null ? 1 : x.avgTrades }));
  const ordered = ord.filter((d) => rows.some((x) => x[d] != null));
  for (const at of [0, -1000]) {
    const g = P.widestRegion(mapped, { minTrades: 0, atLeast: at, orderedAxes: ordered, categoricalAxes: cat });
    console.log(`bar ${at}: size ${g.size} cleared ${g.cellsClearing} of ${g.cellsConsidered}`);
  }
})().catch((e) => console.log('FAILED', e.message));
JS
timeout 240 node /tmp/rb.js 2>&1 | tail -20
rm -f /tmp/rb.js
