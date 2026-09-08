#!/usr/bin/env bash
# uts-held-vs-reserve.sh -- READ-ONLY. Each setup's money on the held-back
# window beside its money on the reserve window, and what the two windows did
# as markets. Answers "why did the held-back money look like signal": whether
# the held-back ranking carried any information about the reserve, and whether
# the rule's money simply followed the market's direction. Reads stored blocks
# only. Presses nothing, spends no look.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 2
node - <<'JS'
const fs = require('fs'); const path = require('path');
const SETS = '/opt/ultimate-trading-system/data/stagesets';
const s4 = JSON.parse(fs.readFileSync(path.join(SETS, fs.readdirSync(SETS).find((f) => f.startsWith('s4-'))), 'utf8'));
const v = (s4.verify || []).slice().reverse().find((b) => b.verdict && b.verdict.pass) || (s4.verify || [])[0];
const g = (s4.unread || [])[0];
const m2 = (x) => (x == null || !Number.isFinite(x) ? '-' : (x < 0 ? '-$' + (-x).toFixed(2) : '$' + x.toFixed(2)));
const held = new Map();
for (const r of ((v.survivors || {}).rows || [])) held.set(r.label, r);
const pair = [];
for (const r of (g.rows || [])) { const h = held.get(r.label); if (h && Number.isFinite(h.held) && Number.isFinite(r.money)) pair.push({ label: r.label, h: h.held, u: r.money, ht: h.trades, ut: r.trades, vsL: h.vsLong }); }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const H = pair.map((p) => p.h); const U = pair.map((p) => p.u);
const mh = mean(H); const mu = mean(U);
const sd = (a, m) => Math.sqrt(mean(a.map((x) => (x - m) * (x - m))));
const sh = sd(H, mh); const su = sd(U, mu);
const cov = mean(pair.map((p) => (p.h - mh) * (p.u - mu)));
const corr = sh && su ? cov / (sh * su) : null;
console.log('the verdict read: %s (%s), the grade: %s', v.id, v.verdict.pass ? 'PASS' : 'FAIL', g.id);
console.log('%d setups on both windows', pair.length);
console.log('HELD-BACK  average %s a setup | %d of %d made money | best %s worst %s', m2(mh), H.filter((x) => x > 0).length, H.length, m2(Math.max(...H)), m2(Math.min(...H)));
console.log('RESERVE    average %s a setup | %d of %d made money | best %s worst %s', m2(mu), U.filter((x) => x > 0).length, U.length, m2(Math.max(...U)), m2(Math.min(...U)));
console.log('');
console.log('DOES THE HELD-BACK RANKING PREDICT THE RESERVE?');
console.log('  correlation of the two money columns across the setups: %s', corr == null ? '?' : corr.toFixed(3));
const byH = pair.slice().sort((a, b) => b.h - a.h);
const topN = (n) => { const t = byH.slice(0, n); return '%s on held-back -> %s on reserve'.replace('%s', m2(mean(t.map((p) => p.h)))).replace('%s', m2(mean(t.map((p) => p.u)))); };
console.log('  the best 10 by held-back money: %s', topN(10));
console.log('  the best 50 by held-back money: %s', topN(50));
console.log('  the worst 50 by held-back money: %s', (() => { const t = byH.slice(-50); return m2(mean(t.map((p) => p.h))) + ' on held-back -> ' + m2(mean(t.map((p) => p.u))) + ' on reserve'; })());
console.log('');
console.log('WHAT THE TWO WINDOWS DID AS MARKETS (the four comparisons the engine stored)');
const c = v.heldBack && v.heldBack.comparisons ? v.heldBack.comparisons : {};
const gc = g.controls || {};
const rr = (o) => (o && o.lo != null ? m2(o.lo) + '..' + m2(o.hi) : 'no figure');
console.log('  held-back: long each %s | short each %s | buy+hold %s | short+hold %s', rr(c.alwaysLong), rr(c.alwaysShort), rr(c.buyHold), rr(c.shortHold));
console.log('  reserve:   long each %s | short each %s | buy+hold %s | short+hold %s', rr(gc.alwaysLong), rr(gc.alwaysShort), rr(gc.buyHold), rr(gc.shortHold));
console.log('');
console.log('AGAINST THEIR OWN SCRAMBLED COPIES (timing, with the market taken out)');
const vc = v.copies || {}; const gcp = g.copies || {};
console.log('  held-back: beats %s of %s, bar %s -> %s', vc.beats, vc.copies, vc.bar, vc.pass ? 'PASS' : 'FAIL');
console.log('  reserve:   beats %s of %s, bar %s -> %s', gcp.beats, gcp.copies, gcp.bar, gcp.pass ? 'PASS' : 'FAIL');
const vs = v.survivors || {}; const gs = g.survivors || {};
console.log('  setups clearing their own bar: held-back %s of %s (about %s by chance) | reserve %s of %s (about %s by chance)',
  vs.passing, vs.survivors, vs.byChance == null ? '?' : vs.byChance.toFixed(1), gs.passing, gs.survivors, gs.byChance == null ? '?' : gs.byChance.toFixed(1));
console.log('');
console.log('TRADING RATE  held-back %s trades a setup | reserve %s', (mean(pair.map((p) => p.ht)) || 0).toFixed(0), (mean(pair.map((p) => p.ut)) || 0).toFixed(0));
console.log('distinct money figures: held-back %d, reserve %d, of %d setups', new Set(H.map((x) => x.toFixed(2))).size, new Set(U.map((x) => x.toFixed(2))).size, pair.length);
JS
