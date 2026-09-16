#!/usr/bin/env bash
# uts-overlay-ledger.sh -- READ-ONLY. What the confirm dial actually bought on
# this box. Per set that used it: the money at one clip against the money under
# the dial, summed over every ranked row and over the best rows only, on the
# test window; the verdict word counts; and whether the same rows hold up on
# the held-back window. Reads the tally in its line-per-row shape. Writes
# nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS' 2>&1 | head -95
const fs = require('fs'); const zlib = require('zlib');
const C = require('./lib/confirm.js');
const D = 'data/stagesets';
function parse(buf) {
  let at = 0;
  const line = () => { if (at >= buf.length) return null; const e = buf.indexOf(10, at); if (e < 0) { const t = buf.toString('utf8', at); at = buf.length; return t; } const s = buf.toString('utf8', at, e); at = e + 1; return s; };
  const head = JSON.parse(line()); if (typeof head.ranked !== 'number') return null;
  const ranked = [];
  for (let i = 0; i < head.ranked; i++) { const l = line(); if (l === null) break; try { ranked.push(JSON.parse(l)); } catch (_) {} }
  return { head, ranked };
}
const f = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2));
console.log('the dial: ' + JSON.stringify(Object.keys(C)));
for (const file of fs.readdirSync(D).filter((x) => /^s3-.*\.json$/.test(x)).sort()) {
  let d; try { d = JSON.parse(fs.readFileSync(`${D}/${file}`, 'utf8')); } catch (_) { continue; }
  const p = d.params || {};
  if (!Object.keys(p.confirmLeans || {}).length) continue;
  const t = `${D}/${d.id}-tally.json.gz`; if (!fs.existsSync(t)) continue;
  let r; try { r = parse(zlib.gunzipSync(fs.readFileSync(t))); } catch (_) { continue; }
  if (!r) continue;
  const kx = p.kx ?? C.DEFAULT_KX; const ux = p.ux ?? C.DEFAULT_UX;
  console.log('='.repeat(98));
  console.log(`${d.id} "${d.name}" · confirm ${JSON.stringify(p.confirm)} permute ${!!p.permuteConfirm} · kx ${kx} ux ${ux} · ${r.ranked.length} rows`);
  const words = {}; let nLean = 0;
  let plainSum = 0; let dialSum = 0; let better = 0; let worse = 0; let same = 0;
  let sizeSum = 0;
  for (const row of r.ranked) {
    const w = row.verdict || '(none)'; words[w] = (words[w] || 0) + 1;
    const L = row.lean; if (!L || !L.c) continue;
    nLean++;
    const plain = (L.c.pnl || 0) + (L.u.pnl || 0) + (L.z.pnl || 0);
    const dial = (L.c.pnl || 0) * kx + (L.u.pnl || 0) * ux + (L.z.pnl || 0);
    const size = (L.c.n || 0) * kx + (L.u.n || 0) * ux + (L.z.n || 0);
    plainSum += plain; dialSum += dial; sizeSum += size;
    if (dial > plain + 0.01) better++; else if (dial < plain - 0.01) worse++; else same++;
  }
  console.log(`  the word: ${JSON.stringify(words)}`);
  console.log(`  rows carrying the six numbers: ${nLean}`);
  if (nLean) {
    console.log(`  summed over those rows — at one clip ${f(plainSum)} · under the dial ${f(dialSum)} · difference ${f(dialSum - plainSum)}`);
    console.log(`  rows the dial made better ${better} · worse ${worse} · unchanged ${same}`);
    console.log(`  per clip deployed — at one clip ${f(plainSum / Math.max(1, nLean))} a row · under the dial ${f(dialSum / Math.max(1, sizeSum / Math.max(1, nLean)) / Math.max(1, nLean))} a row-clip`);
  }
}
JS
