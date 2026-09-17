#!/usr/bin/env bash
# uts-passer-clean.sh -- READ-ONLY. The same five ticked findings, but with
# EVERYTHING chosen inside train and nothing else. The two signs come from the
# first 70% of train; the band is picked by the same plateau rule but scored on
# the last 30% of train; then those choices are measured, untouched, on test,
# held and reserve. So test, held and reserve are all genuinely unseen.
# Reads the record files. Writes nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
curl -s -m 180 -o /tmp/uts-pc.json http://127.0.0.1:8094/api/coins/records
node - <<'JS' 2>&1 | head -120
const fs = require('fs');
const coins = require('./lib/coins.js');
const S = require('./lib/coinsignal.js');
const wm = require('./lib/windowmove.js');
const j = JSON.parse(fs.readFileSync('/tmp/uts-pc.json', 'utf8'));
const rows = ((j.passers || {}).rows || []).filter((r) => r.ticked);
const byCoin = {}; for (const r of (j.records || [])) byCoin[r.coin] = r;
const f = (v) => (v == null || !Number.isFinite(v) ? '    —  ' : ((v > 0 ? '+' : '') + v.toFixed(3)).padStart(8));
const grid = S.bandGrid ? S.bandGrid() : S.BAND_GRID;
for (const p of rows) {
  const rec = byCoin[p.coin]; const x = rec && rec.shapes ? rec.shapes[p.geometry] : null;
  if (!x || !x.move || !x.out) continue;
  const lp = coins.layoutParts(x.periods, 'reserve61');
  if (lp.why || !lp.parts) continue;
  const tr = lp.parts.find((q) => q.name === 'train');
  const cut = tr.from + Math.floor((tr.to - tr.from + 1) * 0.7);
  const k = S.overlapFactor ? S.overlapFactor(p.geometry) : 1;
  // pick the band with everything inside train: signs on train's first 70%,
  // scored on train's last 30%
  const ratios = []; const per = []; const kept = [];
  for (const b of grid) {
    const { reading } = wm.readingsUnderBand(x.move, b, null);
    const leans = S.leansOn(reading, x.out, tr.from, cut - 1);
    const e = S.edgeOn(reading, x.out, cut, tr.to, leans, k);
    kept.push({ b, leans, e });
    ratios.push(e.ratio); per.push(e.edge == null ? null : e.edge * (e.n / Math.max(1, tr.to - cut + 1)));
  }
  const pl = S.findPlateau(grid, ratios, per);
  console.log('='.repeat(104));
  if (!pl.plateau || !pl.sweetSpot) {
    console.log(`${p.coin} ${p.shape}: with everything chosen inside train, NO plateau is found at all (Coins chose band ${p.band} looking wider)`);
    continue;
  }
  const b = pl.sweetSpot.band;
  const pick = kept.find((q) => q.b === b);
  const dr = pick.leans.dr; const df = pick.leans.df;
  const { reading } = wm.readingsUnderBand(x.move, b, null);
  console.log(`${p.coin} ${p.shape} · train-only band ${b} (Coins chose ${p.band}) · after a rise ${dr > 0 ? 'BUY' : (dr < 0 ? 'SELL' : 'nothing')}, after a fall ${df > 0 ? 'BUY' : (df < 0 ? 'SELL' : 'nothing')} (Coins: ${p.lean.rising > 0 ? 'BUY' : 'SELL'}/${p.lean.falling > 0 ? 'BUY' : 'SELL'})`);
  console.log(`   part      acted on   made per acted trade`);
  for (const part of lp.parts) {
    let n = 0; let s = 0;
    for (let i = part.from; i <= part.to; i++) {
      const o = Number(x.out[i]); if (!Number.isFinite(o)) continue;
      const c = reading[i];
      if (c === 'r') { n++; s += dr * o; } else if (c === 'f') { n++; s += df * o; }
    }
    const tag = part.name === 'train' ? ' (chosen here)' : ' UNSEEN';
    console.log(`   ${part.name.padEnd(9)} ${String(n).padStart(6)}   ${f(n ? s / n : null)}%${tag}`);
  }
}
JS
rm -f /tmp/uts-pc.json
