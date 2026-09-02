#!/usr/bin/env bash
# READ-ONLY. Every unit's stored votes against their own labels on the test
# window: does the pooled forecast call the direction right more often than
# the same votes with the calendar shuffled -- the ten copies the Funnel
# reads, rebuilt from the set's seed -- and does the forecast score that
# stages 1 and 2 rank by say the same thing? Nothing is written.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS'
const fs = require('fs');
const rowstore = require('./lib/rowstore');
const sw = require('./lib/stagework');
const S3 = 's3-mte0oajo-1';
const d3 = JSON.parse(fs.readFileSync(`data/stagesets/${S3}.json`, 'utf8'));
console.log('s3 doc keys:', Object.keys(d3).join(' '));
const parentId = typeof d3.parent === 'string' ? d3.parent : (d3.parent && (d3.parent.id || d3.parent.of)) || 's2-mtdyamtf-1';
console.log('parent:', JSON.stringify(d3.parent), '-> reading', parentId, ' seed:', d3.seed, ' keepN:', d3.params && d3.params.keepN, ' nullN:', d3.params && d3.params.nullN);
const unitKeyOf = (u) => `${u.trade}|${u.ctx1 || ''}|${u.ctx2 || ''}|${u.geometry}`;
const listed = d3.units || d3.carried || (d3.plan && d3.plan.units) || null;
const wanted = listed ? new Set(listed.map(unitKeyOf)) : null;
console.log('units named on the s3 doc:', listed ? listed.length : 'none found (showing every unit of the parent)');
const recs = rowstore.readAll(parentId, 'records');
console.log('parent units:', recs.length);
const CLASSES = [-1, 0, 1];
const argmax = (a) => { let b = 0; for (let k = 1; k < 3; k++) if (a[k] > a[b]) b = k; return CLASSES[b]; };
const f = (x, n = 3) => (x == null || !isFinite(x) ? '-' : Number(x).toFixed(n));
const pad = (s, n) => String(s).padStart(n);
console.log('');
console.log(['unit'.padEnd(34), pad('n', 4), pad('y-/0/+', 12), pad('call-/0/+', 12), pad('dirAcc', 7), pad('copies', 13), pad('beats', 6), pad('upDown', 7), pad('cp', 6), pad('bt', 3), pad('score', 8), pad('copies', 15), pad('bt', 3)].join(' '));
let below = 0, above = 0, total = 0;
for (const rec of recs) {
  const key = unitKeyOf(rec);
  if (wanted && !wanted.has(key)) continue;
  const range = rec.blocks && rec.blocks.votes;
  const idxs = []; for (let b = range[0]; b < range[1]; b++) idxs.push(b);
  const votes = rowstore.readBlocks(parentId, 'votes', idxs).map((x) => x.row).filter((r) => r.u === rec.u && r.w === 0).sort((a, b) => a.i - b.i);
  const n = votes.length; if (!n) { console.log(key, 'no test votes'); continue; }
  const y = votes.map((v) => v.y);
  const M = (rec.specs || []).length;
  const probs = []; for (let mi = 0; mi < M; mi++) probs.push(votes.map((v) => v.m[mi]));
  const pooled = []; for (let i = 0; i < n; i++) pooled.push(sw.pooledAt(probs, i));
  const calls = pooled.map(argmax);
  const upDown = pooled.map((p) => (p[2] === p[0] ? 0 : (p[2] > p[0] ? 1 : -1)));
  const cnt = (arr) => [-1, 0, 1].map((c) => arr.filter((v) => v === c).length).join('/');
  const dirAcc = (callAt) => { let hit = 0, miss = 0; for (let i = 0; i < n; i++) { if (y[i] === 0) continue; const c = callAt(i); if (c === 0) continue; if (c === y[i]) hit++; else miss++; } return hit + miss ? hit / (hit + miss) : null; };
  const real = dirAcc((i) => calls[i]);
  const realUD = dirAcc((i) => upDown[i]);
  const score = sw.forecastScore(probs, y);
  const cAcc = [], cUD = [], cScore = [];
  for (let d = 0; d < 10; d++) {
    const order = sw.dealOrder(d3.seed, key, `s3-test#${d}`, n);
    cAcc.push(dirAcc((i) => calls[order[i]]));
    cUD.push(dirAcc((i) => upDown[order[i]]));
    cScore.push(sw.forecastScore(probs, y, order));
  }
  const beats = (r, cs) => cs.filter((c) => c != null && r != null && r > c).length;
  const rng = (cs) => { const v = cs.filter((c) => c != null); return v.length ? `${f(Math.min(...v))}..${f(Math.max(...v))}` : '-'; };
  const mean = (cs) => { const v = cs.filter((c) => c != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  total++; if (real != null && mean(cAcc) != null) { if (real < mean(cAcc)) below++; else above++; }
  console.log([key.padEnd(34), pad(n, 4), pad(cnt(y), 12), pad(cnt(calls), 12), pad(f(real), 7), pad(rng(cAcc), 13), pad(`${beats(real, cAcc)}/10`, 6), pad(f(realUD), 7), pad(f(mean(cUD)), 6), pad(beats(realUD, cUD), 3), pad(f(score, 1), 8), pad(rng(cScore), 15), pad(beats(score, cScore), 3)].join(' '));
  // per member, briefly: direction accuracy of each member's own argmax on the real calendar
  const per = [];
  for (let mi = 0; mi < M; mi++) { const c = probs[mi].map(argmax); per.push(`${rec.specs[mi].model}/${rec.specs[mi].view}=${f(dirAcc((i) => c[i]), 2)}`); }
  console.log('   members:', per.join('  '));
}
console.log('');
console.log(`units read: ${total}; real direction accuracy below its copies' average: ${below}; at or above: ${above}`);
JS
