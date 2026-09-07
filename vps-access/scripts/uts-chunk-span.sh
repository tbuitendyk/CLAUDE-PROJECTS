#!/usr/bin/env bash
# uts-chunk-span.sh -- READ-ONLY. Builds the chunk list for the Funnel set's
# unit exactly as the three-stage engine builds it (same function, same
# arguments) and prints where the chunks start and end, how they step, and
# which of them the reserve61 layout seals. Reads candle files; writes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
node - <<'JS'
(async () => {
  const fs = require('fs'), path = require('path');
  const D = '/opt/ultimate-trading-system/data';
  const sets = path.join(D, 'stagesets');
  const read = (id) => JSON.parse(fs.readFileSync(path.join(sets, id + '.json'), 'utf8'));
  const s4s = fs.readdirSync(sets).filter((f) => /^s4-.*\.json$/.test(f)).map((f) => read(f.replace(/\.json$/, '')))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const s4 = s4s[0];
  const s3 = read(s4.parent.id);
  const p = s3.params || {};
  const [trade, ctx1, ctx2, geometry] = String(s4.unit).split('|');
  const combo = { trade, ctx1: ctx1 || null, ctx2: ctx2 || null, size: 1 + (ctx1 ? 1 : 0) + (ctx2 ? 1 : 0) };
  const branch = { geometry, decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const { buildCombo } = require('/opt/ultimate-trading-system/lib/bracketwork');
  const t0 = Date.now();
  const { geo, chunks } = await buildCombo(combo, branch, { allLoaded: !!p.allLoaded, startMonth: p.startMonth, endMonth: p.endMonth });
  const day = (ts) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  const N = chunks.length;
  const nReserve = Math.max(2, Math.round(N * 0.13));
  const sealed = chunks.slice(N - nReserve);
  const work = chunks.slice(0, N - nReserve);
  const nHold = Math.max(2, Math.round(work.length * 0.15));
  const nTest = Math.max(2, Math.round(work.length * 0.15));
  const hold = work.slice(work.length - nHold);
  const test = work.slice(work.length - nHold - nTest, work.length - nHold);
  const train = work.slice(0, work.length - nHold - nTest);
  const steps = {};
  for (let i = 1; i < N; i++) { const h = Math.round((chunks[i].startTs - chunks[i - 1].startTs) / 3600000); steps[h] = (steps[h] || 0) + 1; }
  console.log('unit ' + s4.unit + '   built in ' + (Date.now() - t0) + ' ms   (allLoaded ' + p.allLoaded + ', months ' + p.startMonth + '..' + p.endMonth + ')');
  console.log('chunk shape ' + geometry + ': features ' + geo.featureHours + 'h, entry at +' + geo.entryOffsetH + 'h, exit at +' + geo.exitOffsetH + 'h, step ' + geo.stepHours + 'h');
  console.log('chunks built: ' + N + '   first start ' + day(chunks[0].startTs) + '   last start ' + day(chunks[N - 1].startTs) + '   last exit ' + day(chunks[N - 1].startTs + geo.exitOffsetH * 3600000));
  console.log('hours between consecutive starts, and how often: ' + JSON.stringify(steps));
  const span = (list, name) => console.log('   ' + name.padEnd(10) + String(list.length).padStart(5) + ' chunks   ' + day(list[0].startTs) + ' .. ' + day(list[list.length - 1].startTs) + '   (last exit ' + day(list[list.length - 1].startTs + geo.exitOffsetH * 3600000) + ')');
  span(train, 'training'); span(test, 'test'); span(hold, 'held-back'); span(sealed, 'SEALED');
  console.log('sealed = ' + nReserve + ' of ' + N + ' chunks = ' + (100 * nReserve / N).toFixed(1) + '%   first sealed start ' + day(sealed[0].startTs));
  // the record on the stage 2 parent, for the same unit, says:
  const rec = (s3.plan || {}).unitList || [];
  console.log('the stage 3 plan lists ' + rec.length + ' units; the reserve the record carries is read by the service (see uts-sealed-proof.sh)');
})().catch((e) => { console.log('FAILED: ' + (e && e.stack || e)); process.exit(1); });
JS
