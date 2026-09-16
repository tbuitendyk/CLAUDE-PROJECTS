#!/usr/bin/env bash
# uts-state-readings.sh -- READ-ONLY. Is DIRECTION special, or is it just one
# reading among several? Four backward-looking readings of a coin's recent
# history, each computed only from periods finished before the decision, each
# cut into three by thresholds taken from the TRAIN part alone and then applied
# unchanged everywhere. Per reading: what buying made in each third, whether the
# order train found survives, how many coins keep it, and whether a forecast's
# own window could tell the thirds apart. Reads the record files; writes
# nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS' 2>&1 | head -130
const fs = require('fs');
const coins = require('./lib/coins.js');
const { GEOMETRIES } = require('./lib/dataset.js');
const DIR = 'data/coins';
const K = 60;
const f = (v, d = 3) => (v == null || !Number.isFinite(v) ? '   —  ' : ((v > 0 ? '+' : '') + v.toFixed(d)).padStart(7));
const recs = fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(fs.readFileSync(`${DIR}/${x}`, 'utf8'))).filter((r) => r.read);
const READINGS = ['which way it has gone', 'how much it has been moving', 'where it sits in its range', 'how far off its high', 'how the plain trade has done'];
// every reading of one coin+shape, index by index, using only j <= i-1
function readingsOf(x, geo) {
  const n = x.periods;
  const overlap = geo.stepHours / geo.featureHours;
  const mv = (i) => { const m = Number(x.move[i]); return Number.isFinite(m) ? m : 0; };
  const px = new Array(n); let run = 0;
  for (let i = 0; i < n; i++) { run += mv(i) * overlap; px[i] = run; }
  const hold = Math.max(1, Math.ceil((geo.exitOffsetH - geo.entryOffsetH) / geo.stepHours));
  const out = READINGS.map(() => new Array(n).fill(null));
  for (let i = K + hold + 1; i < n; i++) {
    const a = i - K; const b = i - 1;
    let lo = Infinity; let hi = -Infinity; let av = 0;
    for (let j = a; j <= b; j++) { if (px[j] < lo) lo = px[j]; if (px[j] > hi) hi = px[j]; av += Math.abs(mv(j)); }
    av /= K;
    out[0][i] = px[b] - px[a];
    out[1][i] = av;
    out[2][i] = hi > lo ? (px[b] - lo) / (hi - lo) : null;
    out[3][i] = av > 0 ? (hi - px[b]) / av : null;
    let s = 0; let c = 0;
    for (let j = Math.max(0, i - K - hold); j <= i - hold - 1; j++) { const o = Number(x.out[j]); if (Number.isFinite(o)) { s += o; c++; } }
    out[4][i] = c ? s / c : null;
  }
  return out;
}
const cuts = (vals) => { const v = vals.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (v.length < 60) return null; return [v[Math.floor(v.length / 3)], v[Math.floor(2 * v.length / 3)]]; };
const band = (v, c) => (v == null || !Number.isFinite(v) ? null : (v <= c[0] ? 0 : (v <= c[1] ? 1 : 2)));
for (const shapeKey of ['daily-2d', 'daily-4d']) {
  const geo = GEOMETRIES[shapeKey];
  const own = Math.max(1, Math.round(geo.featureHours / geo.stepHours));
  console.log('='.repeat(112));
  console.log(`${shapeKey} · thirds cut on train only · looking back ${K} periods · a forecast's own inputs span ${own}`);
  for (let R = 0; R < READINGS.length; R++) {
    const pooled = {}; let keepHeld = 0; let keepRes = 0; let coinsSeen = 0; let seen = 0; let agree = 0;
    for (const rec of recs) {
      const x = rec.shapes[shapeKey];
      if (!x || !x.periods || !x.move || !x.out) continue;
      const lp = coins.layoutParts(x.periods, 'reserve61');
      if (lp.why || !lp.parts) continue;
      const all = readingsOf(x, geo);
      const vals = all[R];
      const tr = lp.parts.find((p) => p.name === 'train');
      const c = cuts(vals.slice(tr.from, tr.to + 1));
      if (!c) continue;
      // the same reading as a forecast's own window would see it
      const near = readingsOf(Object.assign({}, x, { periods: x.periods }), Object.assign({}, geo, {}));
      const per = {};
      for (const p of lp.parts) {
        const a = (pooled[p.name] = pooled[p.name] || [0, 0, 0].map(() => ({ n: 0, s: 0 })));
        const q = (per[p.name] = per[p.name] || [0, 0, 0].map(() => ({ n: 0, s: 0 })));
        for (let i = p.from; i <= p.to; i++) {
          const b = band(vals[i], c); if (b == null) continue;
          const o = Number(x.out[i]); if (!Number.isFinite(o)) continue;
          a[b].n++; a[b].s += o; q[b].n++; q[b].s += o;
          if (R === 0) { const nb = band(near[0][i], c); if (nb != null) { seen++; if (nb === b) agree++; } }
        }
      }
      const m = (o, b) => (o[b] && o[b].n ? o[b].s / o[b].n : null);
      const t = per.train; if (!t) continue;
      const means = [0, 1, 2].map((b) => m(t, b));
      if (means.some((v) => v == null)) continue;
      const hi = means.indexOf(Math.max(...means)); const lo = means.indexOf(Math.min(...means));
      coinsSeen++;
      const H = per.held; const V = per.reserve;
      if (H && m(H, hi) != null && m(H, lo) != null && m(H, hi) > m(H, lo)) keepHeld++;
      if (V && m(V, hi) != null && m(V, lo) != null && m(V, hi) > m(V, lo)) keepRes++;
    }
    const row = (name) => {
      const a = pooled[name]; if (!a) return '—';
      return [0, 1, 2].map((b) => `${f(a[b].n ? a[b].s / a[b].n : null)}% /${String(a[b].n).padStart(6)}`).join(' | ');
    };
    console.log(`  ${READINGS[R]}`);
    for (const p of ['train', 'test', 'held', 'reserve']) console.log(`     ${p.padEnd(8)} low ${row(p).split(' | ')[0]}  mid ${row(p).split(' | ')[1]}  high ${row(p).split(' | ')[2]}`);
    console.log(`     the order train found still holds on held for ${keepHeld}/${coinsSeen} coins, on reserve for ${keepRes}/${coinsSeen}`);
    if (R === 0) console.log(`     a forecast's own ${own}-period window lands in the same third on ${seen ? (100 * agree / seen).toFixed(1) : '—'}% of decisions`);
  }
}
JS
