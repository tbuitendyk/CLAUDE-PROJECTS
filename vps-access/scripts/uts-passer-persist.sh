#!/usr/bin/env bash
# uts-passer-persist.sh -- READ-ONLY. Does what Coins found actually hold in
# each part of the history? For each TICKED coin and shape it takes the band
# and the two signs EXACTLY as Coins already chose them -- nothing is fitted,
# nothing is searched -- and measures what those calls made inside train,
# inside test, inside held and inside reserve separately. Reads the record
# files off disk. Writes nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
curl -s -m 180 -o /tmp/uts-p.json http://127.0.0.1:8094/api/coins/records
node - <<'JS' 2>&1 | head -110
const fs = require('fs');
const coins = require('./lib/coins.js');
const wm = require('./lib/windowmove.js');
const j = JSON.parse(fs.readFileSync('/tmp/uts-p.json', 'utf8'));
const rows = ((j.passers || {}).rows || []).filter((r) => r.ticked);
const byCoin = {};
for (const r of (j.records || [])) byCoin[r.coin] = r;
const f = (v, d = 3) => (v == null || !Number.isFinite(v) ? '    —  ' : ((v > 0 ? '+' : '') + v.toFixed(d)).padStart(8));
console.log(`ticked rows: ${rows.length}`);
for (const p of rows) {
  const rec = byCoin[p.coin];
  const x = rec && rec.shapes ? rec.shapes[p.geometry] : null;
  if (!x || !x.move || !x.out) { console.log(`${p.coin} ${p.shape}: no record`); continue; }
  const { reading, threshold, yardstick } = wm.readingsUnderBand(x.move, p.band, p.yardstick);
  const dr = p.lean ? Number(p.lean.rising) : 0;
  const df = p.lean ? Number(p.lean.falling) : 0;
  const lp = coins.layoutParts(x.periods, 'reserve61');
  console.log('='.repeat(104));
  console.log(`${p.coin} ${p.shape} · band ${p.band} · yardstick ${Number(yardstick).toFixed(3)} · threshold ${Number(threshold).toFixed(3)}% · after a rise ${dr > 0 ? 'BUY' : 'SELL'}, after a fall ${df > 0 ? 'BUY' : 'SELL'} · ${p.check.asStrong}/${p.check.trials} shuffles`);
  if (lp.why || !lp.parts) { console.log(`   ${lp.why}`); continue; }
  console.log(`   part      acted on   made per acted trade   of which after a rise      after a fall     sat out`);
  let allN = 0; let allS = 0;
  for (const part of lp.parts) {
    let n = 0; let s = 0; let nr = 0; let sr = 0; let nf = 0; let sf = 0; let sat = 0;
    for (let i = part.from; i <= part.to; i++) {
      const o = Number(x.out[i]); if (!Number.isFinite(o)) continue;
      const c = reading[i];
      if (c === 'r') { n++; s += dr * o; nr++; sr += dr * o; }
      else if (c === 'f') { n++; s += df * o; nf++; sf += df * o; }
      else sat++;
    }
    allN += n; allS += s;
    console.log(`   ${part.name.padEnd(9)} ${String(n).padStart(6)}   ${f(n ? s / n : null)}%              ${f(nr ? sr / nr : null)}% /${String(nr).padStart(5)}   ${f(nf ? sf / nf : null)}% /${String(nf).padStart(5)}  ${String(sat).padStart(6)}`);
  }
  console.log(`   whole     ${String(allN).padStart(6)}   ${f(allN ? allS / allN : null)}%`);
}
JS
rm -f /tmp/uts-p.json
