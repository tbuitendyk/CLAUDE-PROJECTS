#!/usr/bin/env bash
# READ-ONLY. How long the stage 3 count takes, piece by piece, with the last
# stage 3 launch's block against the newest stage 2 set (S2 #2, every unit),
# in a second process; and what the gateway's own timeout is. Nothing is
# written; the service is not asked.
set -uo pipefail
echo "== gateway timeouts"; grep -rn "proxy_read_timeout\|proxy_connect_timeout\|proxy_send_timeout" /etc/nginx/ 2>/dev/null | head -5 || true
cd /opt/ultimate-trading-system
node - <<'JS'
const fs = require('fs');
const t = (label, fn) => { const t0 = Date.now(); const out = fn(); console.log(label.padEnd(34), ((Date.now() - t0) / 1000).toFixed(2), 's'); return out; };
const stages = require('./lib/stages');
const d3 = JSON.parse(fs.readFileSync('data/stagesets/s3-mte0oajo-1.json', 'utf8'));
const p = d3.params;
const b = { cell: p.cell, cellPermute: p.cellPermute, agreeRule: p.agreeRule, agreePct: p.agreePct, agreeBothModels: p.agreeBothModels, agreePersist: p.agreePersist,
  agreePermuteRule: p.agreePermuteRule, agreePermutePct: p.agreePermutePct, agreePermuteBoth: p.agreePermuteBoth, agreePermutePersist: p.agreePermutePersist,
  agreeBar: p.agreeBar, agreePermuteBar: p.agreePermuteBar, decision: p.decision, band: p.band, weekdaysOnly: p.weekdaysOnly,
  permuteDecision: p.permuteDecision, permuteBand: p.permuteBand, permuteWeekdays: p.permuteWeekdays,
  from: 's2-mtkq55cv-2', carry: 0, pick: 'count', units: 25, coins: 5 };
const parent = stages.getSet('s2-mtkq55cv-2');
console.log('parent', parent && parent.name, 'status', parent && parent.status);
const { records } = t('stage3UnitsFor (all)', () => stages.stage3UnitsFor(parent, 0));
console.log('   units', records.length);
const sizes = [...new Set(records.map((r) => r.size || 1))];
const declared = t('settingsFor', () => stages.settingsFor(b, sizes));
console.log('   declared', declared.length);
const folded = t('foldSameTradeSettings', () => stages.foldSameTradeSettings(declared, records));
console.log('   kept', folded.kept.length, 'folded', folded.folded.length);
const d = t('stage3Declared (whole)', () => stages.stage3Declared(b));
console.log('   ', JSON.stringify(d));
t('tallyBudgetFor', () => stages.tallyBudgetFor({ settings: d.settings, coins: d.coins || 5 }));
t('storeBudgetFor', () => stages.storeBudgetFor({ rows: d.settings * (d.units || 25) }));
JS
