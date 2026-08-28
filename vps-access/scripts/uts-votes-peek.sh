#!/usr/bin/env bash
# READ-ONLY: one unit's kept votes out of the stage 2 store — are the six
# members six voices, or three voices counted twice? Explains why the /6
# rungs of the stage 3 tables pair up (q1=q2, q3=q4, q5=q6). Writes nothing.
set -euo pipefail
cd /opt/ultimate-trading-system
node - <<'JS'
const rowstore = require('./lib/rowstore');
const id = 's2-mtb4g9is-1';
const recs = rowstore.readAll(id, 'records');
const rec = recs[0];
console.log('unit:', rec.trade, rec.geometry, 'size', rec.size);
console.log('members:', rec.specs.map((s, i) => `${i}:${s.model}/${s.view}`).join('  '));
const range = rec.blocks.votes;
const idxs = [];
for (let b = range[0]; b < range[1]; b++) idxs.push(b);
const votes = rowstore.readBlocks(id, 'votes', idxs).map((x) => x.row).filter((r) => r.u === rec.u);
console.log('vote rows:', votes.length);
const M = rec.specs.length;
const streams = [];
for (let mi = 0; mi < M; mi++) streams.push(votes.map((v) => v.m[mi]));
// raw probability streams identical between members?
for (let a = 0; a < M; a++) {
  for (let b = a + 1; b < M; b++) {
    if (JSON.stringify(streams[a]) === JSON.stringify(streams[b])) {
      console.log('IDENTICAL RAW VOTES: member', a, `${rec.specs[a].model}/${rec.specs[a].view}`, '== member', b, `${rec.specs[b].model}/${rec.specs[b].view}`);
    }
  }
}
// argmax calls per member, pairwise agreement
const argmax = (p) => {
  const a = Array.isArray(p) ? p : [p.d, p.n, p.u];
  let best = 0;
  for (let k = 1; k < 3; k++) if (a[k] > a[best]) best = k;
  return best - 1;
};
const calls = streams.map((s) => s.map(argmax));
console.log('pairwise call agreement (argmax):');
for (let a = 0; a < M; a++) {
  for (let b = a + 1; b < M; b++) {
    let same = 0;
    for (let i = 0; i < calls[a].length; i++) if (calls[a][i] === calls[b][i]) same++;
    console.log(`  ${a}(${rec.specs[a].model}/${rec.specs[a].view}) vs ${b}(${rec.specs[b].model}/${rec.specs[b].view}): ${same}/${calls[a].length}`);
  }
}
// majority sizes over the moments, all six members voting
const hist = {};
for (let i = 0; i < calls[0].length; i++) {
  let up = 0;
  let down = 0;
  for (let mi = 0; mi < M; mi++) {
    const c = calls[mi][i];
    if (c > 0) up++;
    else if (c < 0) down++;
  }
  const key = up === down ? 'tie' : String(Math.max(up, down));
  hist[key] = (hist[key] || 0) + 1;
}
console.log('majority-size histogram over the moments (argmax):', JSON.stringify(hist));
JS
