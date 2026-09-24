#!/usr/bin/env bash
# uts-rebuild-reasons.sh -- READ-ONLY. Every record set on the box that the
# service would mark REBUILD REQUIRED, with the key and the words of each
# reason. Nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/uts-rr.js <<'JS'
const fs = require('fs');
const path = require('path');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const D = '/opt/ultimate-trading-system/data/stagesets';
let n = 0;
for (const f of fs.readdirSync(D).filter((x) => /^s[34]-.*\.json$/.test(x))) {
  const d = S.getSet(f.replace(/\.json$/, ''));
  const rb = d ? S.rebuildOf(d) : null;
  if (!rb) continue;
  n++;
  console.log(`${d.id} | ${d.name}`);
  for (const r of rb.reasons) console.log(`    ${r.key}: ${r.why}`);
}
console.log(`${n} set(s) flagged`);
process.exit(0);
JS
sudo -u uts timeout 120 node /tmp/uts-rr.js 2>&1 | tail -40
rm -f /tmp/uts-rr.js
