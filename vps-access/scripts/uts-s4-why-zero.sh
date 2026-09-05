#!/usr/bin/env bash
# READ ONLY. Why the oldest Stage 4 set's rule now keeps none of the settings
# it wrote down: which clause of it fails, and whether the rebuilt numbers its
# two limits read are still on the box for those settings.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/why0.js <<'JS'
const fs = require('fs');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const S4 = require('/opt/ultimate-trading-system/lib/funnelset.js');
const dir = '/opt/ultimate-trading-system/data/stagesets';
const d = JSON.parse(fs.readFileSync(`${dir}/s4-mtmny75s-1.json`, 'utf8'));
(async () => {
  const t = S.readTally(d.parent.id);
  const b = await S.funnelBoard(d.parent.id, t, d.unit);
  const rich = S.readFunnelRich(d.parent.id);
  const all = S.withFunnelRich(b.all, rich);
  console.log(`board ${all.length} settings; rebuilt-numbers file holds ${rich ? Object.keys(rich.settings || {}).length : 0} settings, saved ${rich ? rich.savedAt : '-'}`);
  const R = d.rule;
  // one clause at a time, cumulative
  const parts = [];
  for (const [k, v] of Object.entries(R.ranges || {})) parts.push([`range ${k}`, { ranges: { [k]: v }, allowed: {}, floors: {} }]);
  for (const [k, v] of Object.entries(R.allowed || {})) parts.push([`values ${k}`, { ranges: {}, allowed: { [k]: v }, floors: {} }]);
  for (const [k, v] of Object.entries(R.floors || {})) parts.push([`limit ${k}`, { ranges: {}, allowed: {}, floors: { [k]: v } }]);
  console.log('\n-- each clause on its own, over the whole board --');
  for (const [name, one] of parts) console.log(`   ${String(name).padEnd(22)} keeps ${S4.applyRule(all, one).length.toLocaleString()}`);
  console.log('\n-- the rule with its two limits taken off --');
  const noFloors = { ranges: R.ranges, allowed: R.allowed, floors: {} };
  const keptNoFloors = S4.applyRule(all, noFloors);
  console.log(`   keeps ${keptNoFloors.length.toLocaleString()} (the set wrote down ${(d.counts || {}).survivors})`);
  // do the settings it wrote down still carry the two numbers the limits read?
  const stored = new Set((d.survivors || []).map((s) => s.label));
  const mine = all.filter((r) => stored.has(r.label));
  const withDD = mine.filter((r) => r.maxDrawdown != null && Number.isFinite(Number(r.maxDrawdown))).length;
  const withTr = mine.filter((r) => r.avgTrades != null && Number.isFinite(Number(r.avgTrades))).length;
  console.log(`\n-- the ${stored.size} settings this set wrote down --`);
  console.log(`   found on the board today : ${mine.length}`);
  console.log(`   still carry a worst losing streak : ${withDD}`);
  console.log(`   still carry a trade count        : ${withTr}`);
  const anyDD = all.filter((r) => r.maxDrawdown != null).length;
  console.log(`   settings anywhere on the board carrying a worst losing streak today: ${anyDD.toLocaleString()} of ${all.length.toLocaleString()}`);
  // and the other two sets, for comparison
  for (const id of ['s4-mtnk968j-2']) {
    const o = JSON.parse(fs.readFileSync(`${dir}/${id}.json`, 'utf8'));
    const st = new Set((o.survivors || []).map((s) => s.label));
    const rows = all.filter((r) => st.has(r.label));
    console.log(`   ${id}: ${st.size} written down, ${rows.filter((r) => r.maxDrawdown != null).length} still carry a worst losing streak`);
  }
})().catch((e) => console.log('FAILED', e.message, e.stack));
JS
timeout 540 node --max-old-space-size=3000 /tmp/why0.js 2>&1 | tail -50
rm -f /tmp/why0.js
