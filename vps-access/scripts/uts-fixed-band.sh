#!/usr/bin/env bash
# uts-fixed-band.sh -- READ-ONLY. Nothing is searched for. The coin's usual move
# is taken from TRAIN alone. Four fixed bands are tried -- 50, 100, 150, 200 --
# and ALL FOUR are reported, never the best. The only thing learned from train
# is the two signs: after a big rise buy or sell, after a big fall buy or sell.
# Then those locked choices are measured on test, held and reserve, all unseen.
# Gross, before the round trip, which is stated at the end.
# Reads the record files. Writes nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
curl -s -m 180 -o /tmp/uts-fb.json http://127.0.0.1:8094/api/coins/records
node - <<'JS' 2>&1 | head -120
const fs = require('fs');
const coins = require('./lib/coins.js');
const j = JSON.parse(fs.readFileSync('/tmp/uts-fb.json', 'utf8'));
const rows = ((j.passers || {}).rows || []).filter((r) => r.ticked);
const byCoin = {}; for (const r of (j.records || [])) byCoin[r.coin] = r;
const BANDS = [50, 100, 150, 200];
const ROUND_TRIP = 0.25;
const cell = (n, v) => (n ? `${((v > 0 ? '+' : '') + v.toFixed(3)).padStart(7)}%/${String(n).padStart(4)}` : '      —     ');
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
let clears = 0; let tried = 0; let positive = 0;
for (const p of rows) {
  const rec = byCoin[p.coin]; const x = rec && rec.shapes ? rec.shapes[p.geometry] : null;
  if (!x || !x.move || !x.out) continue;
  const lp = coins.layoutParts(x.periods, 'reserve61');
  if (lp.why || !lp.parts) continue;
  const tr = lp.parts.find((q) => q.name === 'train');
  // the coin's usual move, from TRAIN only
  const yard = med(x.move.slice(tr.from, tr.to + 1).map((m) => Math.abs(Number(m))));
  console.log('='.repeat(108));
  console.log(`${p.coin} ${p.shape} · usual move on train ${yard == null ? '—' : yard.toFixed(3)}% · (Coins searched out band ${p.band})`);
  console.log(`  band  a move counts over   signs from train        train              test               held             reserve`);
  for (const b of BANDS) {
    const th = yard * (b / 100);
    let sr = 0; let sf = 0;
    for (let i = tr.from; i <= tr.to; i++) {
      const m = Number(x.move[i]); const o = Number(x.out[i]);
      if (!Number.isFinite(m) || !Number.isFinite(o)) continue;
      if (m > th) sr += o; else if (m < -th) sf += o;
    }
    const dr = sr > 0 ? 1 : (sr < 0 ? -1 : 0);
    const df = sf > 0 ? 1 : (sf < 0 ? -1 : 0);
    const out = [];
    for (const part of lp.parts) {
      let n = 0; let s = 0;
      for (let i = part.from; i <= part.to; i++) {
        const m = Number(x.move[i]); const o = Number(x.out[i]);
        if (!Number.isFinite(m) || !Number.isFinite(o)) continue;
        if (m > th) { if (dr) { n++; s += dr * o; } } else if (m < -th) { if (df) { n++; s += df * o; } }
      }
      out.push({ name: part.name, n, v: n ? s / n : null });
    }
    const res = out.find((q) => q.name === 'reserve');
    if (res && res.n) { tried++; if (res.v > 0) positive++; if (res.v > ROUND_TRIP) clears++; }
    const sg = `${dr > 0 ? 'BUY ' : (dr < 0 ? 'SELL' : '----')}/${df > 0 ? 'BUY ' : (df < 0 ? 'SELL' : '----')}`;
    console.log(`  ${String(b).padStart(4)}  ${th.toFixed(3).padStart(8)}%          ${sg}     ${out.map((q) => cell(q.n, q.v)).join('  ')}`);
  }
}
console.log('='.repeat(108));
console.log(`reserve, over all ${tried} coin-and-band combinations: ${positive} made money gross, ${clears} cleared the ${ROUND_TRIP}% round trip`);
JS
rm -f /tmp/uts-fb.json
