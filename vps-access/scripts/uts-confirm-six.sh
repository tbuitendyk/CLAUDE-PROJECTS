#!/usr/bin/env bash
# uts-confirm-six.sh -- READ-ONLY. What the confirm dial actually produced on
# this box: for the two sets launched with it set, the count of each verdict
# word over every ranked row, and the six numbers on the best rows. Reads the
# tally in its line-per-row shape; the row's lean IS the parts object.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS' 2>&1 | head -70
const fs = require('fs'); const zlib = require('zlib');
const D = 'data/stagesets';
function parse(buf) {
  let at = 0;
  const line = () => { if (at >= buf.length) return null; const e = buf.indexOf(10, at); if (e < 0) { const t = buf.toString('utf8', at); at = buf.length; return t; } const s = buf.toString('utf8', at, e); at = e + 1; return s; };
  const first = line(); if (!first) return null;
  const head = JSON.parse(first); if (typeof head.ranked !== 'number') return null;
  const ranked = [];
  for (let i = 0; i < head.ranked; i++) { const l = line(); if (l === null) break; try { ranked.push(JSON.parse(l)); } catch (_) {} }
  return { head, ranked };
}
const f = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2));
for (const file of fs.readdirSync(D).filter((x) => /^s3-.*\.json$/.test(x)).sort()) {
  let d; try { d = JSON.parse(fs.readFileSync(`${D}/${file}`, 'utf8')); } catch (_) { continue; }
  const p = d.params || {};
  if (!Object.keys(p.confirmLeans || {}).length) continue;
  const t = `${D}/${d.id}-tally.json.gz`;
  if (!fs.existsSync(t)) continue;
  let r; try { r = parse(zlib.gunzipSync(fs.readFileSync(t))); } catch (_) { continue; }
  if (!r || r.ranked.length < 2) continue;
  const words = {};
  for (const row of r.ranked) { const w = row.verdict || '(none)'; words[w] = (words[w] || 0) + 1; }
  console.log('='.repeat(96));
  console.log(`${d.id} "${d.name}" · confirm ${JSON.stringify(p.confirm)} permute ${!!p.permuteConfirm} · ${r.ranked.length} rows`);
  console.log(`  the word, over every row: ${JSON.stringify(words)}`);
  const sample = r.ranked.filter((x) => x.lean && x.lean.c).slice(0, 3);
  for (const row of sample) {
    const L = row.lean;
    const plain = (L.c.pnl || 0) + (L.u.pnl || 0) + (L.z.pnl || 0);
    console.log(`  ${String(row.label).slice(0, 78)}`);
    console.log(`    ${row.verdict} · agreed-with ${f(L.c.pnl)} over ${L.c.n} · disagreed-with ${f(L.u.pnl)} over ${L.u.n} · inside the band ${f(L.z.pnl)} over ${L.z.n} · all three at one clip ${f(plain)}`);
  }
}
JS
