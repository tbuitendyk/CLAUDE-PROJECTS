#!/usr/bin/env bash
# uts-confirm-rows.sh -- READ-ONLY. For every stage 3 set on this box that
# froze coin-and-shape findings onto itself: how its ranked rows split across
# the confirm dial's values, how many carry the six numbers, and for the rows
# that do, the word and the money with and without. Reads the tally file in
# its own line-per-row shape. Writes nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS' 2>&1 | head -90
const fs = require('fs'); const zlib = require('zlib');
const D = 'data/stagesets';
function parse(buf) {
  let at = 0;
  const line = () => { if (at >= buf.length) return null; const e = buf.indexOf(10, at); if (e < 0) { const t = buf.toString('utf8', at); at = buf.length; return t; } const s = buf.toString('utf8', at, e); at = e + 1; return s; };
  const first = line(); if (!first) return null;
  let head; try { head = JSON.parse(first); } catch (_) { return null; }
  if (typeof head.ranked !== 'number') return null;
  const ranked = [];
  for (let i = 0; i < head.ranked; i++) { const l = line(); if (l === null) break; try { ranked.push(JSON.parse(l)); } catch (_) {} }
  return { head, ranked };
}
const m = (v) => (v == null ? '—' : Number(v).toFixed(2));
for (const f of fs.readdirSync(D).filter((x) => /^s3-.*\.json$/.test(x)).sort()) {
  let d; try { d = JSON.parse(fs.readFileSync(`${D}/${f}`, 'utf8')); } catch (_) { continue; }
  const p = d.params || {}; const keys = Object.keys(p.confirmLeans || {});
  if (!keys.length) continue;
  const t = `${D}/${d.id}-tally.json.gz`;
  console.log('='.repeat(96));
  console.log(`${d.id} "${d.name || ''}" · confirm ${JSON.stringify(p.confirm)} permute ${!!p.permuteConfirm} · findings ${keys.length}: ${keys.join(', ')}`);
  for (const k of keys) { const L = p.confirmLeans[k]; console.log(`    ${k}: band ${L.band} yardstick ${L.yardstick == null ? '—' : Number(L.yardstick).toFixed(3)} rising ${L.rising} falling ${L.falling}`); }
  if (!fs.existsSync(t)) { console.log('  no tally file'); continue; }
  let r; try { r = parse(zlib.gunzipSync(fs.readFileSync(t))); } catch (e) { console.log(`  tally unreadable: ${e.message}`); continue; }
  if (!r) { console.log('  tally in an older shape'); continue; }
  const by = {}; const withLean = [];
  for (const row of r.ranked) { const c = row.confirm || 'off'; by[c] = (by[c] || 0) + 1; if (row.lean) withLean.push(row); }
  console.log(`  tally v${r.head.v} · ${r.ranked.length} ranked rows · by confirm ${JSON.stringify(by)} · carrying the six numbers ${withLean.length}`);
  for (const row of withLean.slice(0, 6)) {
    const L = row.lean || {}; const T = L.test || {};
    console.log(`    ${String(row.label).slice(0, 62)}`);
    console.log(`      verdict ${JSON.stringify(row.verdict)} · size ${L.testSize == null ? '—' : L.testSize} · confirmed ${m((T.cUsd ?? T.confirmedUsd) / 100)}/${T.cN ?? T.confirmedN} · unconfirmed ${m((T.uUsd ?? T.unconfirmedUsd) / 100)}/${T.uN ?? T.unconfirmedN} · no-lean ${m((T.nUsd ?? T.noLeanUsd) / 100)}/${T.nN ?? T.noLeanN}`);
    console.log(`      raw six: ${JSON.stringify(T).slice(0, 220)}`);
  }
}
JS
