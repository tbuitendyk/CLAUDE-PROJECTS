#!/usr/bin/env bash
# uts-cs-check.sh -- READ-ONLY. Every Stage 4 set whose name holds "cs tune":
# its kind, what it was read from, the conviction sizing and stops on record
# (each distinct ladder and how many survivors carry it), its capture's pick,
# and for a held set: what its reading froze and worked out, and what
# Greenlight's picture draws for the survivor by depth, step by step.
# Nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/uts-cs.js <<'JS'
const fs = require('fs');
const path = require('path');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const { multFor } = require('/opt/ultimate-trading-system/lib/convictionsweep.js');
const D = '/opt/ultimate-trading-system/data/stagesets';
const docs = fs.readdirSync(D).filter((f) => /^s4-.*\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (_) { return null; } })
  .filter((d) => d && /cs tune/.test(String(d.name))).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
(async () => {
  for (const d of docs) {
    console.log(`\n== ${d.id} | ${d.kind || 'funnel'} | ${d.name} | created ${d.createdAt} | release ${d.release}`);
    if (d.from) console.log(`   read from ${d.from.id} ${d.from.name || ''}`);
    if (d.copiedFrom) console.log(`   saved from ${d.copiedFrom.id} ${d.copiedFrom.name} (stops ${d.copiedFrom.stops}, sizing ${d.copiedFrom.sizing})`);
    const ch = d.stopChoices || {};
    const lad = new Map(); let stops = 0;
    for (const [L, c] of Object.entries(ch)) { if (c && 'stopPct' in c) stops++; if (c && c.sizing && c.sizing.on) { const k = JSON.stringify(c.sizing.ladder); lad.set(k, (lad.get(k) || 0) + 1); } }
    console.log(`   choices on ${Object.keys(ch).length} survivors: stops ${stops}; ladders ${[...lad].map(([k, n]) => `${k} x${n}`).join(' | ') || 'none'}`);
    if (d.capture) console.log(`   capture ${d.capture.id} v${d.capture.v} pick ${d.capture.pick ? d.capture.pick.label + ' (' + (d.capture.pick.measure || 'old') + ')' : 'none'}`);
    if (d.kind === 'held' || d.kind === 'reserve') {
      const t = (d.block || {}).tuned || {};
      console.log(`   reading: survivors ${(((d.block || {}).survivors || {}).rows || []).length}, tuned withATuning ${t.withATuning} priced ${t.priced} why ${t.why || '-'}`);
      const g = await S.stage4GreenlightDry(d.id);
      const L = (g.depthPick || {}).label;
      console.log(`   by depth: ${L} ${JSON.stringify(g.depthPick && g.depthPick.nearby)}`);
      const one = ((g.picture || {}).survivors || []).find((x) => x.label === L);
      const c = ch[L] || {};
      console.log(`   its sizing: ${c.sizing && c.sizing.on ? JSON.stringify(c.sizing.ladder) : 'none'}; stop ${c.stopPct ?? 'none'}`);
      const f = (x) => (x && x.money != null ? `${x.money.toFixed(2)} (${x.trades})` : '-');
      if (one) for (const w of ['train', 'test', 'held']) { const st = (one.steps || {})[w] || {}; console.log(`     ${w}: before History ${f(st.beforeHistory)} | after History ${f(st.afterHistory)} | after stop ${f(st.afterStop)} | after conviction sizing ${f(st.afterSizing)}`); }
      // the held entries of the survivor by depth, by agreement count, and the multiplier each would take
      const rule = S.getSet((d.from || {}).id);
      const cap = rule ? S.readCapture(rule.id) : null;
      const sv = cap ? (cap.survivors || []).find((x) => x.label === L) : null;
      if (sv) {
        const byA = new Map(); for (const e of sv.entries.hold || []) byA.set(e.agree, (byA.get(e.agree) || 0) + 1);
        console.log(`     held entries by agreement: ${[...byA].sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}${c.sizing ? `(x${multFor(c.sizing.ladder, a)})` : ''}`).join(' ')}`);
        console.log(`     capture members ${cap.members}; ladder length ${c.sizing ? c.sizing.ladder.length : '-'}`);
      }
      const hr = ((t.rows || []).find((x) => x.label === L)) || null;
      if (hr) console.log(`     reading's tuned row: trades ${hr.trades} priced ${hr.priced} plain ${hr.plainUsd} tuned ${hr.tunedUsd} clips ${hr.clipsPerTrade}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.log('FAILED', e.stack); process.exit(0); });
JS
sudo -u uts timeout 300 node /tmp/uts-cs.js 2>&1 | tail -60
rm -f /tmp/uts-cs.js
