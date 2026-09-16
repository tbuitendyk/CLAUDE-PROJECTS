#!/usr/bin/env bash
# uts-regime-truth2.sh -- READ-ONLY. The same two questions, with a label that
# balances. The label is the SIGN of the coin's own move over the last K
# periods, counted from periods strictly before the decision, so it is knowable
# at the decision and it splits the history in half by construction. Per part:
# how many decisions fall each way and what buying made on them (selling is the
# same number with the sign turned round). Then: pick the paying side per label
# on TRAIN ONLY and carry it forward unchanged to test, held and reserve. Then:
# could a forecast see the label, given its inputs stop at its own window?
# Reads the record files; writes nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS' 2>&1 | head -120
const fs = require('fs');
const coins = require('./lib/coins.js');
const { GEOMETRIES } = require('./lib/dataset.js');
const DIR = 'data/coins';
const f = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
const recs = fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(fs.readFileSync(`${DIR}/${x}`, 'utf8'))).filter((r) => r.read);
for (const shapeKey of ['daily-1d', 'daily-4d', 'weekly-8d']) {
  const geo = GEOMETRIES[shapeKey];
  const own = Math.max(1, Math.round(geo.featureHours / geo.stepHours)); // periods its own inputs span
  for (const K of [20, 60, 120]) {
    const acc = {}; const coinSign = { down: [], up: [] };
    let seen = 0; let agree = 0;
    for (const rec of recs) {
      const x = rec.shapes[shapeKey];
      if (!x || !x.periods || !x.move || !x.out) continue;
      const n = x.periods;
      const lp = coins.layoutParts(n, 'reserve61');
      if (lp.why || !lp.parts) continue;
      const mv = (i) => { const m = Number(x.move[i]); return Number.isFinite(m) ? m : 0; };
      // trailing sum over periods strictly before i, and the same over just
      // the span its own inputs cover
      const trail = (i, k) => { let s = 0; for (let j = Math.max(0, i - k); j <= i - 1; j++) s += mv(j); return s; };
      const per = { down: { n: 0, s: 0 }, up: { n: 0, s: 0 } };
      for (const p of lp.parts) {
        const a = (acc[p.name] = acc[p.name] || { down: { n: 0, s: 0 }, up: { n: 0, s: 0 } });
        for (let i = Math.max(p.from, K); i <= p.to; i++) {
          const o = Number(x.out[i]); if (!Number.isFinite(o)) continue;
          const t = trail(i, K);
          const key = t < 0 ? 'down' : 'up';
          a[key].n++; a[key].s += o;
          if (p.name === 'train') { per[key].n++; per[key].s += o; }
          const near = trail(i, own);
          seen++; if ((near < 0) === (t < 0)) agree++;
        }
      }
      for (const k of ['down', 'up']) if (per[k].n >= 30) coinSign[k].push(per[k].s / per[k].n);
    }
    const row = (name) => {
      const a = acc[name]; if (!a) return `${name}: —`;
      const d = a.down.n ? a.down.s / a.down.n : null; const u = a.up.n ? a.up.s / a.up.n : null;
      const sh = (a.down.n + a.up.n) ? (100 * a.down.n / (a.down.n + a.up.n)).toFixed(0) : '—';
      return `${name.padEnd(8)} after a fall: ${String(a.down.n).padStart(6)} decisions, buying made ${f(d)}% each | after a rise: ${String(a.up.n).padStart(6)}, buying made ${f(u)}% each | ${sh}% of decisions came after a fall`;
    };
    // the side train says to take, carried forward untouched
    const tr = acc.train || { down: { n: 0, s: 0 }, up: { n: 0, s: 0 } };
    const sideDown = (tr.down.n ? tr.down.s / tr.down.n : 0) >= 0 ? 1 : -1;
    const sideUp = (tr.up.n ? tr.up.s / tr.up.n : 0) >= 0 ? 1 : -1;
    console.log('-'.repeat(114));
    console.log(`${shapeKey} · the label is the sign of the last ${K} periods' move · its own inputs span ${own} period(s)`);
    for (const p of ['train', 'test', 'held', 'reserve']) console.log(`   ${row(p)}`);
    console.log(`   train says: after a fall ${sideDown > 0 ? 'BUY' : 'SELL'}, after a rise ${sideUp > 0 ? 'BUY' : 'SELL'} — carried forward, that rule made, per decision:`);
    for (const p of ['test', 'held', 'reserve']) {
      const a = acc[p]; if (!a) continue;
      const nn = a.down.n + a.up.n;
      const got = nn ? (sideDown * a.down.s + sideUp * a.up.s) / nn : null;
      const plain = nn ? (a.down.s + a.up.s) / nn : null;
      console.log(`      ${p.padEnd(8)} ${f(got)}% against ${f(plain)}% for always buying`);
    }
    const sgn = (arr) => arr.filter((v) => v > 0).length;
    console.log(`   coins whose train figure is positive: after a fall ${sgn(coinSign.down)}/${coinSign.down.length} · after a rise ${sgn(coinSign.up)}/${coinSign.up.length}`);
    console.log(`   could a forecast see the label? its own ${own}-period view agrees with the ${K}-period label on ${seen ? (100 * agree / seen).toFixed(1) : '—'}% of decisions`);
  }
}
JS
