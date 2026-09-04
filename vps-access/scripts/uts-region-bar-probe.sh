#!/usr/bin/env bash
# READ ONLY. What the widest region does as the step 5 bar is loosened, on the
# owner's own board and their own two rules -- run through the same reading the
# screen uses, so what it prints is what the screen would print.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/regionbar.js <<'JS'
const fs = require('fs');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const S4 = require('/opt/ultimate-trading-system/lib/funnelset.js');
const dir = '/opt/ultimate-trading-system/data/stagesets';
const S3 = 's3-mtl42g1m-3';
const doc = JSON.parse(fs.readFileSync(`${dir}/s4-mtmny75s-1.json`, 'utf8'));
const unit = doc.unit || doc.unitKey || null;
console.log('stage 4 set:', doc.name, '| unit', unit);
console.log('keys on the set:', Object.keys(doc).join(', '));
const rules = [];
if (doc.userRule) rules.push(["the owner's own rule", { ...S4.EMPTY_RULE, ...doc.userRule }]);
if (doc.rule) rules.push(['the final rule', doc.rule]);
rules.push(['nothing narrowed', S4.EMPTY_RULE]);
(async () => {
  for (const [label, rule] of rules) {
    console.log(`\n== ${label}: ${S4.ruleSentence ? S4.ruleSentence(rule) : ''}`);
    for (const at of [0, -1, -5, -50, -1000]) {
      const t0 = Date.now();
      try {
        const r = await S.funnelRead(S3, { step: 5, rule, unit, regionAtLeast: at });
        const g = r.reading || {};
        console.log(`   bar ${String(at).padStart(6)}  size ${String(g.size).padStart(6)}  cleared ${String(g.cellsClearing).padStart(6)}  of ${String(g.cellsConsidered).padStart(6)}  papered ${JSON.stringify(g.papered)}  copies ${JSON.stringify((g.noise || {}).sizes || []).slice(0, 60)}  ${Date.now() - t0}ms`);
        if (at === 0) console.log('      axes:', JSON.stringify(g.axes));
      } catch (e) { console.log(`   bar ${at}: FAILED ${e.message}`); break; }
    }
  }
})().catch((e) => { console.log('FAILED', e.message, e.stack); });
JS
timeout 540 node --max-old-space-size=3000 /tmp/regionbar.js 2>&1 | tail -60
rm -f /tmp/regionbar.js
