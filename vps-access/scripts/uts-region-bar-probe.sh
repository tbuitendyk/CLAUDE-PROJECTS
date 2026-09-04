#!/usr/bin/env bash
# READ ONLY. What the widest region does as the step 5 bar is loosened, on the
# box's own newest stage 3 record set. Prints, per bar: how many settings clear,
# the region size, how the board splits into slices, and the biggest run inside
# each slice -- so a region that cannot grow says WHY it cannot grow.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/regionbar.js <<'JS'
const fs = require('fs');
const path = require('path');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const F = require('/opt/ultimate-trading-system/lib/funnel.js');
const P = require('/opt/ultimate-trading-system/lib/plateau.js');
const dir = '/opt/ultimate-trading-system/data/stagesets';
const ids = fs.readdirSync(dir).filter((f) => /^s3-.*\.json$/.test(f) && !/-agreed/.test(f))
  .map((f) => f.replace(/\.json$/, ''));
console.log('stage 3 sets:', ids.join(', '));
(async () => {
  for (const id of ids.slice(-1)) {
    const st = S.readStageSet ? S.readStageSet(id) : null;
    const rule = { ranges: {}, allowed: {}, floors: {} };
    let units = null;
    try {
      const first = await S.funnelRead(id, { step: 1, rule });
      units = first.units || [];
      console.log(`${id}: ${units.length} unit(s)`, units.map((u) => u.name).join(' | '));
    } catch (e) { console.log(`${id}: step 1 read failed: ${e.message}`); continue; }
    const unit = units.length ? units[0].key : null;
    for (const at of [0, -1, -5, -50]) {
      try {
        const r = await S.funnelRead(id, { step: 5, rule, unit, regionAtLeast: at });
        const g = r.reading || {};
        console.log(`bar ${String(at).padStart(4)}  size ${String(g.size).padStart(6)}  cleared ${String(g.cellsClearing).padStart(6)}  considered ${String(g.cellsConsidered).padStart(6)}  papered ${JSON.stringify(g.papered)}`);
        if (at === -50) {
          console.log('  axes ordered  :', JSON.stringify((g.axes || {}).ordered));
          console.log('  axes categoric:', JSON.stringify((g.axes || {}).categorical));
        }
      } catch (e) { console.log(`bar ${at}: read failed: ${e.message}`); }
    }
    // WHY it cannot grow: how the board splits into slices at the loosest bar
    try {
      const b = await S.funnelBoard(id, 5, (units[0] || {}).key);
      const rows = (b && b.all) || [];
      const ordered = F.ORDERED_DIALS.filter((d) => rows.some((r) => r[d] != null));
      const cat = F.CATEGORICAL_DIALS;
      const slices = new Map();
      for (const r of rows) {
        const k = cat.map((a) => String(r[a])).join('|');
        slices.set(k, (slices.get(k) || 0) + 1);
      }
      const sizes = [...slices.values()].sort((a, b2) => b2 - a);
      console.log(`  ${rows.length} row(s) split into ${slices.size} slice(s); biggest ${sizes.slice(0, 5).join(', ')}`);
      console.log('  ordered dials with more than one value:',
        ordered.filter((d) => new Set(rows.map((r) => r[d])).size > 1).map((d) => `${d}=${new Set(rows.map((r) => r[d])).size}`).join(' ') || 'NONE');
      console.log('  categorical dials with more than one value:',
        cat.filter((d) => new Set(rows.map((r) => r[d])).size > 1).map((d) => `${d}=${new Set(rows.map((r) => r[d])).size}`).join(' ') || 'NONE');
    } catch (e) { console.log('  board read failed:', e.message); }
  }
})().catch((e) => { console.log('FAILED', e.message); });
JS
timeout 600 node /tmp/regionbar.js 2>&1 | tail -60
rm -f /tmp/regionbar.js
