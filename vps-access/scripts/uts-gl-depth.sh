#!/usr/bin/env bash
# uts-gl-depth.sh -- READ-ONLY. For one held or reserve set (an id as the
# argument, or by default the newest whose name holds "HALF LIFE TABLE (cmp)"
# and ends "#3"): the rule's ranges and word lists, the values the survivors
# hold on each ranged dial, how far each sits from the middle of each range
# (the deviance Greenlight shows), and, for the conviction sizing on record,
# how many captured trades each window has, how many are priced, and how many
# a multiplier above zero keeps. Nothing written.
set -uo pipefail
ARG="${1:-}"
cd /opt/ultimate-trading-system
cat > /tmp/uts-gld.js <<'JS'
const fs = require('fs');
const path = require('path');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const S4 = require('/opt/ultimate-trading-system/lib/funnelset.js');
const { multFor } = require('/opt/ultimate-trading-system/lib/convictionsweep.js');
const D = '/opt/ultimate-trading-system/data/stagesets';
const arg = process.argv[2] || '';
const judges = fs.readdirSync(D).filter((f) => /^s4-.*\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (_) { return null; } })
  .filter((d) => d && (d.kind === 'held' || d.kind === 'reserve')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
console.log('newest held/reserve sets:'); for (const d of judges.slice(0, 6)) console.log(`  ${d.id} | ${d.name}`);
const doc = arg ? judges.find((d) => d.id === arg) : judges.find((d) => String(d.name).includes('HALF LIFE TABLE (cmp)') && String(d.name).endsWith('#3'));
if (!doc) { console.log('no such set'); process.exit(0); }
const rule = S.getSet((doc.from || {}).id);
console.log(`\nset ${doc.id} | ${doc.name}\nrule ${rule && rule.id} | ${rule && rule.name} | derived ${!!(rule && rule.derived)}`);
const R = (rule && rule.rule) || {};
console.log('ranges:', JSON.stringify(R.ranges || {}));
console.log('word lists:', JSON.stringify(R.allowed || {}).slice(0, 600));
(async () => {
  const join = await S.funnelVerifyJoin(rule);
  const labels = new Set((doc.survivors || []).map((x) => x.label));
  const rows = (join.rows || []).filter((r) => labels.has(r.label));
  console.log(`survivors ${labels.size}, rows joined ${rows.length}`);
  for (const [dial, range] of Object.entries(R.ranges || {})) {
    const vals = new Map(); const ds = new Map();
    for (const r of rows) {
      const v = String(r[dial]); vals.set(v, (vals.get(v) || 0) + 1);
      const d = S4.depthOf(r, { ranges: { [dial]: range } }).worst.toFixed(2); ds.set(d, (ds.get(d) || 0) + 1);
    }
    console.log(`  ${dial}: range ${range.min}..${range.max}${range.also ? ' also ' + JSON.stringify(range.also) : ''} | values ${[...vals].map(([v, n]) => `${v}x${n}`).join(' ')} | deviance ${[...ds].map(([v, n]) => `${v}x${n}`).join(' ')}`);
  }
  const pairs = new Map();
  for (const r of rows) { const d = S4.depthOf(r, R); const k = `${d.worst.toFixed(2)}/${d.mean.toFixed(2)}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
  console.log('worst/average pairs:', [...pairs].map(([k, n]) => `${k}x${n}`).join(' '));
  // the other dials the rows carry, and how many values each holds among the survivors
  const skip = new Set(['label', 'si']);
  const moving = Object.keys(rows[0] || {}).filter((k) => !skip.has(k) && !(k in (R.ranges || {})) && typeof rows[0][k] !== 'object')
    .map((k) => [k, new Set(rows.map((r) => String(r[k]))).size]).filter(([, n]) => n > 1 && n < rows.length);
  console.log('other fields that differ between survivors:', moving.map(([k, n]) => `${k}=${n}`).join(' ').slice(0, 900));
  // the sizing on record, and what it keeps
  const cap = S.readCapture(rule.id);
  const choices = doc.stopChoices || rule.stopChoices || {};
  const ladders = new Map();
  for (const c of Object.values(choices)) if (c && c.sizing && c.sizing.on) { const k = JSON.stringify(c.sizing.ladder); ladders.set(k, (ladders.get(k) || 0) + 1); }
  console.log('\nsizing ladders on record:', [...ladders].map(([k, n]) => `${k}x${n}`).join(' ') || 'none');
  const pick = (await S.stage4GreenlightDry(doc.id)).depthPick;
  const L = pick && pick.label;
  const sv = cap && (cap.survivors || []).find((x) => x.label === L);
  const c = choices[L] || {};
  console.log(`by depth ${L} | stop ${c.stopPct ?? 'none'} | sizing ${c.sizing && c.sizing.on ? JSON.stringify(c.sizing.ladder) : 'none'} | entry ${sv && sv.entry}`);
  if (sv) for (const [w, k] of [['train', 'train'], ['test', 'test'], ['held', 'hold'], ['reserve', 'reserve']]) {
    const es = sv.entries[k] || [];
    const kept = c.sizing && c.sizing.on ? es.filter((e) => multFor(c.sizing.ladder, e.agree) > 0).length : es.length;
    const agrees = new Map(); for (const e of es) agrees.set(e.agree, (agrees.get(e.agree) || 0) + 1);
    console.log(`  ${w}: entries ${es.length} | kept by the sizing ${kept} | agreement counts ${[...agrees].sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(' ')}`);
  }
  process.exit(0);
})().catch((e) => { console.log('FAILED', e.message); process.exit(0); });
JS
sudo -u uts timeout 240 node /tmp/uts-gld.js "$ARG" 2>&1 | tail -60
rm -f /tmp/uts-gld.js
