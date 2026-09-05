#!/usr/bin/env bash
# READ ONLY. Every Stage 4 record set on the box, one line each.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/s4list.js <<'JS'
const fs = require('fs');
const dir = '/opt/ultimate-trading-system/data/stagesets';
const files = fs.readdirSync(dir).filter((f) => /^s4-.*\.json$/.test(f)).sort();
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  console.log([
    d.id, '|', d.name, '|', 'unit=' + (d.unit || 'all'), '|', 'made=' + (d.createdAt || '?'),
    '|', 'release=' + (d.release || (d.params || {}).engineVersion || '?'),
    '|', 'kept=' + ((d.counts || {}).survivors) + ' of ' + ((d.counts || {}).of || '?'),
    '|', 'parent=' + ((d.parent || {}).id || '?'),
  ].join(' '));
}
console.log('---- keys on one of them ----');
if (files.length) console.log(Object.keys(JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf8'))).join(', '));
JS
timeout 120 node /tmp/s4list.js 2>&1 | tail -40
rm -f /tmp/s4list.js
