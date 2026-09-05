#!/usr/bin/env bash
# READ ONLY. Deep read of the three Stage 4 record sets on XRPUSDT weekly-8d.
# The parent board is loaded ONCE and all three are read off it, so this costs
# one board read while a stage 1 sweep is going.
set -uo pipefail
cd /opt/ultimate-trading-system
cat > /tmp/s4deep.js <<'JS'
const fs = require('fs');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const S4 = require('/opt/ultimate-trading-system/lib/funnelset.js');
const F = require('/opt/ultimate-trading-system/lib/funnel.js');
const dir = '/opt/ultimate-trading-system/data/stagesets';
const IDS = ['s4-mtmny75s-1', 's4-mtnk968j-2', 's4-mtnktw7p-3'];
const docs = IDS.map((i) => JSON.parse(fs.readFileSync(`${dir}/${i}.json`, 'utf8')));
const P = docs[0].parent.id;
const UNIT = docs[0].unit;
const mean = (list, f) => { let s = 0; let n = 0; for (const r of list) { const v = f(r); if (v != null && Number.isFinite(v)) { s += v; n++; } } return n ? s / n : null; };
const fx = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d));
const hold = (r) => (r.avgHold == null ? null : Number(r.avgHold));
const holdAt = (d) => (r) => { const a = r.noiseHold; const v = Array.isArray(a) ? a[d] : null; return v == null || !Number.isFinite(Number(v)) ? null : Number(v); };

(async () => {
  const t = S.readTally(P);
  if (!t) { console.log('the parent has no totalled tables'); return; }
  const b = await S.funnelBoard(P, t, UNIT);
  const all = S.withFunnelRich(b.all, S.readFunnelRich(P));
  const K = all.length && Array.isArray(all[0].noiseTest) ? all[0].noiseTest.length : 0;
  const KH = all.length && Array.isArray(all[0].noiseHold) ? all[0].noiseHold.length : 0;
  console.log(`board: ${all.length} settings on ${UNIT}, ${K} scrambled copies of the tuning slice, ${KH} of the held-back slice`);

  const line = (label, rows) => {
    const real = mean(rows, F.money);
    const copies = Array.from({ length: K }, (_, d) => mean(rows, F.moneyAt(d)));
    const beatsN = copies.filter((v) => F.beats(real, v)).length;
    const h = mean(rows, hold);
    const hc = Array.from({ length: KH }, (_, d) => mean(rows, holdAt(d)));
    const hBeats = hc.filter((v) => F.beats(h, v)).length;
    const pos = rows.filter((r) => hold(r) != null && hold(r) > 0).length;
    console.log(`  ${label}`);
    console.log(`    settings ${rows.length.toLocaleString()}`);
    console.log(`    tuning slice $: real ${fx(real)} | copies best ${fx(Math.max(...copies.filter((v) => v != null)))} worst ${fx(Math.min(...copies.filter((v) => v != null)))} avg ${fx(mean(copies.map((v) => ({ v })), (x) => x.v))} | beats ${beatsN} of ${K} | lead ${fx(F.leadOf(real, copies))}`);
    console.log(`    HELD-BACK $ : real ${fx(h)} | copies best ${fx(Math.max(...hc.filter((v) => v != null)))} worst ${fx(Math.min(...hc.filter((v) => v != null)))} avg ${fx(mean(hc.map((v) => ({ v })), (x) => x.v))} | beats ${hBeats} of ${KH} | lead ${fx(F.leadOf(h, hc))}`);
    console.log(`    made money held back: ${pos} of ${rows.length} (${(100 * pos / Math.max(1, rows.length)).toFixed(1)}%)`);
    console.log(`    trades ${fx(mean(rows, (r) => r.avgTrades))} | vs always long $ ${fx(mean(rows, (r) => r.avgVsLong))} | worst losing streak $ ${fx(mean(rows, (r) => r.maxDrawdown))} | beat own copies ${fx(mean(rows, (r) => r.beat), 1)} of ${fx(mean(rows, (r) => r.pairs), 0)} | lead ${fx(mean(rows, (r) => r.avgLead))}`);
  };

  console.log('\n==== THE WHOLE BOARD, nothing narrowed (the thing every rule has to beat) ====');
  line('everything', all);

  for (const d of docs) {
    console.log(`\n==== ${d.id} :: ${d.name}`);
    console.log(`  made ${d.createdAt} under release ${d.release}`);
    console.log(`  rule   : ${d.ruleSentence}`);
    console.log(`  closing: ${JSON.stringify(d.closing)}`);
    console.log(`  target : ${d.target}`);
    console.log(`  check  : ${JSON.stringify(d.check)}`);
    console.log(`  sealed : ${JSON.stringify(d.sealed && { sealed: d.sealed.sealed, of: (d.sealed.units || []).length, why: d.sealed.why })}`);
    console.log(`  steps ${(d.steps || []).length}, back-steps ${(d.backSteps || []).length}`);
    console.log(`  marks  : ${(d.marks || []).map((m) => m.key + (m.detail ? ` (${m.detail})` : '')).join(' | ') || 'none'}`);
    console.log(`  warnings: ${(d.warnings || []).join(' | ') || 'none'}`);
    console.log(`  replay checked: ${JSON.stringify(d.replayChecked && { same: d.replayChecked.same, got: d.replayChecked.got, had: d.replayChecked.had })}`);
    console.log(`  the rule the owner built before step 5: ${d.userRule ? S4.ruleSentence(d.userRule) : 'none recorded'}`);
    console.log(`  rule as held: ${JSON.stringify(d.rule)}`);
    const kept = S4.applyRule(all, d.rule);
    console.log(`  stored count ${(d.counts || {}).survivors} | recomputed today ${kept.length}`);
    line('this rule', kept);
    if (d.userRule) {
      const mine = S4.applyRule(all, { ...S4.EMPTY_RULE, ...d.userRule });
      line("the owner's own rule", mine);
    }
    // every step of the walk, in order
    console.log('  --- the walk, step by step ---');
    for (const st of (d.steps || [])) console.log(`    ${st.n}. ${st.what}: ${st.chose}`);
    if ((d.backSteps || []).length) console.log(`    back-steps: ${JSON.stringify(d.backSteps)}`);
  }
})().catch((e) => console.log('FAILED', e.message, e.stack));
JS
timeout 560 node --max-old-space-size=3000 /tmp/s4deep.js 2>&1 | tail -150
rm -f /tmp/s4deep.js
