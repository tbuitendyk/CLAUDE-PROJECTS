#!/usr/bin/env bash
# uts-regime-truth.sh -- READ-ONLY. Two questions asked of the real coin
# records. (1) Is there a falling stretch where selling pays? A strictly
# backward-looking fall-from-peak label is built per coin from the window moves
# scaled for overlap, using only periods BEFORE each decision, and the
# decision's own outcome is averaged inside and outside it, per part.
# (2) Could a forecast see it? The same label against the sign of the one
# window move the forecast's own inputs end at. Reads the record files; writes
# nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS' 2>&1 | head -120
const fs = require('fs');
const coins = require('./lib/coins.js');
const { GEOMETRIES } = require('./lib/dataset.js');
const DIR = 'data/coins';
const f = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
const recs = fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(fs.readFileSync(`${DIR}/${x}`, 'utf8'))).filter((r) => r.read);
console.log(`records read: ${recs.length}`);
for (const shapeKey of ['daily-1d', 'daily-4d', 'weekly-8d']) {
  const geo = GEOMETRIES[shapeKey];
  const overlap = geo.stepHours / geo.featureHours; // a 96h move counted every 24h overcounts 4x
  for (const DD of [5, 10, 20]) {
    // pooled over every coin, per part of the sealed layout
    const acc = {};
    let seenA = 0; let agree = 0; let downSeen = 0; let downNegMove = 0;
    for (const rec of recs) {
      const x = rec.shapes[shapeKey];
      if (!x || !x.periods || !x.move || !x.out) continue;
      const n = x.periods;
      const lp = coins.layoutParts(n, 'reserve61');
      if (lp.why || !lp.parts) continue;
      const parts = lp.parts;
      // the strictly backward price path and its running peak
      const px = new Array(n).fill(0);
      let run = 0;
      for (let i = 0; i < n; i++) { const m = Number(x.move[i]); run += (Number.isFinite(m) ? m : 0) * overlap; px[i] = run; }
      for (const p of parts) {
        const a = (acc[p.name] = acc[p.name] || { dN: 0, dSum: 0, uN: 0, uSum: 0 });
        for (let i = p.from; i <= p.to; i++) {
          if (i < 30) continue; // no trailing history yet
          let peak = -1e9;
          for (let j = Math.max(0, i - 400); j <= i - 1; j++) if (px[j] > peak) peak = px[j];
          const fall = peak - px[i - 1]; // points off the trailing peak, known before the decision
          const o = Number(x.out[i]);
          if (!Number.isFinite(o)) continue;
          const down = fall >= DD;
          if (down) { a.dN++; a.dSum += o; } else { a.uN++; a.uSum += o; }
          const mv = Number(x.move[i]);
          if (Number.isFinite(mv)) { seenA++; if ((mv < 0) === down) agree++; if (down) { downSeen++; if (mv < 0) downNegMove++; } }
        }
      }
    }
    const line = (name) => {
      const a = acc[name]; if (!a) return `${name}: —`;
      const dm = a.dN ? a.dSum / a.dN : null; const um = a.uN ? a.uSum / a.uN : null;
      return `${name} falling ${a.dN} decisions buy ${f(dm)}% sell ${f(dm == null ? null : -dm)}% | rising ${a.uN} buy ${f(um)}% sell ${f(um == null ? null : -um)}%`;
    };
    console.log('-'.repeat(110));
    console.log(`${shapeKey} · a fall of ${DD} points off the trailing peak`);
    for (const p of ['train', 'test', 'held', 'reserve']) console.log(`   ${line(p)}`);
    console.log(`   could a forecast see it? its own window move agrees with the label on ${seenA ? (100 * agree / seenA).toFixed(1) : '—'}% of decisions; inside a falling stretch the window move is negative on ${downSeen ? (100 * downNegMove / downSeen).toFixed(1) : '—'}% (${downSeen} decisions)`);
  }
}
JS
