#!/usr/bin/env bash
# READ-ONLY. For the carried ten units: the pooled forecast's calls priced on
# the label's own basis (entry-hour open to exit-hour open, the move the label
# was scored on), real calendar against the set's ten shuffles; the engine's
# own market pricing on the same calls at 17h (the label window) and 41h; and
# how the calls do on the biggest moves. Chunks are rebuilt the way stage 3
# rebuilds them. Nothing is written.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS'
const fs = require('fs');
const rowstore = require('./lib/rowstore');
const sw = require('./lib/stagework');
const bracketLib = require('./lib/bracket');
const S3 = 's3-mte0oajo-1';
const d3 = JSON.parse(fs.readFileSync(`data/stagesets/${S3}.json`, 'utf8'));
const P = d3.parent.id;
const fee = Number(d3.params.feePerLeg ?? d3.params.fee ?? 0.125);
console.log('params:', Object.keys(d3.params).join(' '), '| fee', fee, '| layout', d3.params.windowLayout, '| months', d3.params.startMonth, d3.params.endMonth);
const recs = rowstore.readAll(P, 'records');
const ordered = recs.slice().sort((a, b) => ((b.beat || 0) - (a.beat || 0)) || ((b.lead || 0) - (a.lead || 0)));
const carried = ordered.slice(0, Number(d3.parent.carry) || 10);
const unitKeyOf = (u) => `${u.trade}|${u.ctx1 || ''}|${u.ctx2 || ''}|${u.geometry}`;
const CLASSES = [-1, 0, 1];
const argmax = (a) => { let b = 0; for (let k = 1; k < 3; k++) if (a[k] > a[b]) b = k; return CLASSES[b]; };
const f = (x, n = 1) => (x == null || !isFinite(x) ? '-' : Number(x).toFixed(n));
const rng = (v) => `${f(Math.min(...v))}..${f(Math.max(...v))}`;
const beats = (r, cs) => cs.filter((c) => r > c).length;
(async () => {
  for (const rec of carried) {
    const key = unitKeyOf(rec);
    const t0 = Date.now();
    let built;
    try { built = await sw.unitChunks({ trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size }, rec.geometry, d3.params); }
    catch (e) { console.log('==', key, 'cannot rebuild:', e.message); continue; }
    const { geo, maps, split } = built;
    const test = split.testChunks;
    const idxs = []; for (let b = rec.blocks.votes[0]; b < rec.blocks.votes[1]; b++) idxs.push(b);
    const votes = rowstore.readBlocks(P, 'votes', idxs).map((x) => x.row).filter((r) => r.u === rec.u && r.w === 0).sort((a, b) => a.i - b.i);
    const n = votes.length;
    if (test.length !== n || test.some((c, i) => c.startTs !== votes[i].ts)) { console.log('==', key, 'MISALIGNED: rebuilt', test.length, 'stored', n); continue; }
    const y = votes.map((v) => v.y);
    const diff = test.map((c) => c.diffPct);
    const labelMismatch = test.filter((c, i) => c.label !== y[i]).length;
    const M = rec.specs.length;
    const probs = []; for (let mi = 0; mi < M; mi++) probs.push(votes.map((v) => v.m[mi]));
    const pooledCalls = Array.from({ length: n }, (_, i) => argmax(sw.pooledAt(probs, i)));
    const memberCalls = probs.map((p) => p.map(argmax));
    const majority = Array.from({ length: n }, (_, i) => { let up = 0, dn = 0; for (let mi = 0; mi < M; mi++) { const c = memberCalls[mi][i]; if (c === 1) up++; else if (c === -1) dn++; } return up >= 5 ? 1 : dn >= 5 ? -1 : 0; });
    const orders = []; for (let d = 0; d < 10; d++) orders.push(sw.dealOrder(d3.seed, key, `s3-test#${d}`, n));
    const shuffle = (calls, order) => order.map((k) => calls[k]);
    const labelMoney = (calls) => { let s = 0, t = 0; for (let i = 0; i < n; i++) if (calls[i]) { s += calls[i] * diff[i]; t++; } return { net: s - t * 2 * fee, t }; };
    const sim = (calls, tH) => bracketLib.simMarket(test, calls, maps.trade, geo, { tHours: tH, feePerLeg: fee }).pnl;
    const abs = diff.map(Math.abs).slice().sort((a, b) => a - b); const thr = abs[Math.floor(abs.length * 0.75)];
    const bigAcc = (calls) => { let h = 0, m = 0; for (let i = 0; i < n; i++) { if (Math.abs(diff[i]) < thr || !calls[i]) continue; if (Math.sign(diff[i]) === calls[i]) h++; else m++; } return h + m ? h / (h + m) : null; };
    const bigMoney = (calls) => { let s = 0; for (let i = 0; i < n; i++) if (calls[i] && Math.abs(diff[i]) >= thr) s += calls[i] * diff[i]; return s; };
    console.log(`== ${key}  n ${n}  label mismatches vs rebuilt ${labelMismatch}  |move| top quarter >= ${f(thr, 2)}%  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const [name, calls] of [['pooled argmax', pooledCalls], ['5 of 8 agree', majority]]) {
      const real = labelMoney(calls); const r17 = sim(calls, 17); const r41 = sim(calls, 41);
      const cl = [], c17 = [], c41 = [], cb = [], cbm = [];
      for (const o of orders) { const s = shuffle(calls, o); cl.push(labelMoney(s).net); c17.push(sim(s, 17)); c41.push(sim(s, 41)); cb.push(bigAcc(s)); cbm.push(bigMoney(s)); }
      const cbAvg = cb.reduce((a, b) => a + b, 0) / cb.length;
      console.log(`   ${name.padEnd(14)} trades ${String(real.t).padStart(3)} | label-basis $ real ${f(real.net).padStart(7)} copies ${rng(cl)} beats ${beats(real.net, cl)} | engine 17h $ real ${f(r17).padStart(7)} copies ${rng(c17)} beats ${beats(r17, c17)} | 41h $ real ${f(r41).padStart(7)} copies ${rng(c41)} beats ${beats(r41, c41)}`);
      console.log(`   ${''.padEnd(14)} big moves: right ${f(bigAcc(calls), 2)} vs copies ${f(cbAvg, 2)} | big-move $ real ${f(bigMoney(calls))} copies ${rng(cbm)} beats ${beats(bigMoney(calls), cbm)}`);
    }
  }
})().catch((e) => console.log('FAILED', e.stack));
JS
