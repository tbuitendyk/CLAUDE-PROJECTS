#!/usr/bin/env bash
# uts-why-it-looked.sh -- READ-ONLY. What the held-back reading actually gated
# on, how many setups beat simply being long on each window, how many times the
# held-back window was looked at before it was stamped, and what the selection
# itself was priced at. Stored blocks only; presses nothing, spends no look.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 2
node - <<'JS'
const fs = require('fs'); const path = require('path');
const SETS = '/opt/ultimate-trading-system/data/stagesets';
const s4 = JSON.parse(fs.readFileSync(path.join(SETS, fs.readdirSync(SETS).find((f) => f.startsWith('s4-'))), 'utf8'));
const v = (s4.verify || []).slice().reverse().find((b) => b.verdict && b.verdict.pass) || (s4.verify || [])[0];
const g = (s4.unread || [])[0];
const m2 = (x) => (x == null || !Number.isFinite(x) ? '-' : (x < 0 ? '-$' + (-x).toFixed(2) : '$' + x.toFixed(2)));
const vs = v.survivors || {}; const hb = v.heldBack || {};
console.log('HELD-BACK, what the reading gated on');
console.log('  the setups made %s a setup; the gate was buy-and-hold and short-and-hold', m2(hb.real));
console.log('  beat buy-and-hold: %s | beat short-and-hold: %s  -> the money gate %s', hb.comparisons && hb.comparisons.beatsBuyHold, hb.comparisons && hb.comparisons.beatsShortHold, hb.pass ? 'PASSED' : 'failed');
console.log('  setups beating simply being long, held-back: %s of %s   (printed, never a gate)', vs.beatsAlwaysLong, vs.survivors);
console.log('  their money against being long, per setup: average %s', m2(hb.vsLong));
const gr = (g.rows || []).map((r) => r.vsLong).filter((x) => Number.isFinite(x));
console.log('RESERVE');
console.log('  setups beating simply being long, reserve: %s of %s', gr.filter((x) => x > 0).length, (g.rows || []).length);
console.log('  their money against being long, per setup: average %s', m2(gr.length ? gr.reduce((a, b) => a + b, 0) / gr.length : null));
console.log('');
console.log('HOW MUCH THE HELD-BACK WINDOW WAS LOOKED AT BEFORE IT WAS STAMPED');
const lk = v.looks || {};
console.log('  counted looks before the verdict: %s', lk.unstamped);
for (const w of (lk.what || [])) console.log('    - %s', String(w).slice(0, 150));
console.log('');
console.log('WHAT THE SELECTION ITSELF WAS PRICED AT');
const a = v.lineA || {}; const b = v.lineB || {};
console.log('  line A: %s', JSON.stringify(a).slice(0, 400));
console.log('  line B: %s', JSON.stringify(b).slice(0, 400));
console.log('');
console.log('THE RULE: %s', String(s4.ruleSentence || '').slice(0, 400));
console.log('survivors kept: %s of the block; the set records %s', (s4.counts || {}).survivors, JSON.stringify(s4.counts || {}).slice(0, 200));
JS
