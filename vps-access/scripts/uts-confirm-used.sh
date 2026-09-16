#!/usr/bin/env bash
# uts-confirm-used.sh -- READ-ONLY. Has the confirm dial ever been used on this
# box? Per stage 3 set: the recorded confirm selection, whether the set froze
# any coin-and-shape findings onto itself, and whether any ranked row in its
# tally was priced with confirm past off or carries the six numbers. Also the
# saved Coins settings. Reads files; writes nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system
echo "== the saved settings =="
cat data/settings.json 2>&1 | tr -d '\n' | head -c 400; echo
echo "== the coin records on disk =="
ls data/coins/*.json 2>/dev/null | wc -l | sed 's/^/records: /'
echo "== per stage 3 set =="
node - <<'JS' 2>&1 | head -80
const fs = require('fs'); const zlib = require('zlib');
const D = 'data/stagesets';
const sets = fs.readdirSync(D).filter((f) => /^s3-.*\.json$/.test(f)).sort();
for (const f of sets) {
  let d; try { d = JSON.parse(fs.readFileSync(`${D}/${f}`, 'utf8')); } catch (e) { console.log(`${f}: unreadable`); continue; }
  const p = d.params || {};
  const leans = p.confirmLeans || {};
  const keys = Object.keys(leans);
  console.log(`${d.id} "${d.name || ''}" rel ${d.release} · confirm ${JSON.stringify(p.confirm)} permute ${!!p.permuteConfirm} kx ${p.kx ?? '-'} ux ${p.ux ?? '-'} · frozen findings ${keys.length}${keys.length ? ': ' + keys.slice(0, 4).join(', ') : ''}`);
  const t = `${D}/${d.id}-tally.json.gz`;
  if (!fs.existsSync(t)) { console.log('    no tally'); continue; }
  let tal; try { tal = JSON.parse(zlib.gunzipSync(fs.readFileSync(t)).toString('utf8')); } catch (e) { console.log('    tally unreadable'); continue; }
  const rows = tal.ranked || tal.rows || [];
  const byConfirm = {}; let withLean = 0;
  for (const r of rows) { const c = r.confirm || 'off'; byConfirm[c] = (byConfirm[c] || 0) + 1; if (r.lean) withLean++; }
  console.log(`    ${rows.length} ranked rows · confirm ${JSON.stringify(byConfirm)} · rows carrying the six numbers ${withLean}`);
}
JS
