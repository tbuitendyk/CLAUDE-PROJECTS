#!/usr/bin/env bash
# READ ONLY. What the rebuilt numbers file beside the owner's stage 3 set
# actually holds, and whether the worst losing streak is in it per unit.
set -uo pipefail
cd /opt/ultimate-trading-system
ls -la data/stagesets/*funnelrich* 2>/dev/null || echo "NO funnelrich FILE AT ALL"
cat > /tmp/rich.js <<'JS'
const fs = require('fs');
const dir = '/opt/ultimate-trading-system/data/stagesets';
for (const f of fs.readdirSync(dir).filter((x) => /funnelrich/.test(x))) {
  const x = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const labels = Object.keys(x.settings || {});
  console.log(`${f}: v=${x.v} release=${x.release} savedAt=${x.savedAt} settings=${labels.length}`);
  const one = x.settings[labels[0]];
  console.log('  first label:', labels[0]);
  console.log('  top-level fields:', Object.keys(one || {}).join(', '));
  const units = Object.keys((one || {}).units || {});
  console.log('  units on it:', units.join(' | '));
  if (units.length) console.log('  fields per unit:', JSON.stringify((one.units[units[0]] || {})).slice(0, 300));
  let withDD = 0;
  for (const L of labels) { const e = x.settings[L]; if (e && Number.isFinite(Number(e.maxDrawdown))) withDD++; }
  console.log(`  ${withDD} of ${labels.length} carry a worst losing streak at the top level`);
}
JS
timeout 120 node /tmp/rich.js 2>&1 | tail -30
rm -f /tmp/rich.js
