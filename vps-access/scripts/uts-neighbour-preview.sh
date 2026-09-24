#!/usr/bin/env bash
# uts-neighbour-preview.sh -- READ-ONLY. For one held or reserve set (an id as
# the argument, or by default the newest whose name holds "HALF LIFE TABLE
# (cmp)" and ends "#3"): each survivor's neighbouring settings on the board
# its rule was cut from -- one step along one ordered dial, the same
# word-valued dials -- and how many of them are survivors too; the spread of
# that count, and the survivor the most surrounded would pick. Also how many
# Stage 4 captures and stage 4 greenlights on the box carry a pick. Nothing
# written.
set -uo pipefail
ARG="${1:-}"
cd /opt/ultimate-trading-system
cat > /tmp/uts-np.js <<'JS'
const fs = require('fs');
const path = require('path');
const S = require('/opt/ultimate-trading-system/lib/stages.js');
const P = require('/opt/ultimate-trading-system/lib/plateau.js');
const F = require('/opt/ultimate-trading-system/lib/funnel.js');
const D = '/opt/ultimate-trading-system/data/stagesets';
const arg = process.argv[2] || '';
const docs = fs.readdirSync(D).filter((f) => /^s4-.*\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (_) { return null; } }).filter(Boolean);
const judges = docs.filter((d) => d.kind === 'held' || d.kind === 'reserve').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const caps = docs.filter((d) => d.capture && d.capture.pick);
console.log(`captures carrying a pick: ${caps.length}`); for (const d of caps) console.log(`  ${d.id} | ${d.name} | v${d.capture.v} | pick ${d.capture.pick.label}`);
let gl = 0; try { const GD = '/opt/ultimate-trading-system/data/greenlights'; gl = fs.readdirSync(GD).filter((f) => { try { return JSON.parse(fs.readFileSync(path.join(GD, f), 'utf8')).target === 'stage4'; } catch (_) { return false; } }).length; } catch (_) { gl = 'no folder'; }
console.log(`stage 4 greenlights: ${gl}`);
const doc = arg ? judges.find((d) => d.id === arg) : judges.find((d) => String(d.name).includes('HALF LIFE TABLE (cmp)') && String(d.name).endsWith('#3'));
if (!doc) { console.log('no such set'); process.exit(0); }
const rule = S.getSet((doc.from || {}).id);
(async () => {
  const t0 = Date.now();
  const join = await S.funnelVerifyJoin(rule);
  console.log(`\n${doc.name}: board ${join.mine.length} rows (all ${join.all.length}), survivors ${join.rows.length}, read in ${Date.now() - t0} ms`);
  const board = join.mine;
  const ordered = F.ORDERED_DIALS.filter((d) => board.some((r) => r[d] != null));
  const cat = F.CATEGORICAL_DIALS;
  const idx = P.axisIndex(board, ordered);
  console.log('ordered dials swept on the board:', ordered.map((a) => `${a}=${idx[a].size}[${[...idx[a].keys()].join(',')}]`).join(' '));
  const wordVals = cat.map((a) => [a, new Set(board.map((r) => String(r[a]))).size]).filter(([, n]) => n > 1);
  console.log('word-valued dials that differ on the board:', wordVals.map(([a, n]) => `${a}=${n}`).join(' '));
  const key = (c) => `${c.slice}#${c.pos.join(',')}`;
  const onBoard = new Set(board.map((r) => key(P.coordsOf(r, idx, ordered, cat))));
  const alive = new Set(join.rows.map((r) => key(P.coordsOf(r, idx, ordered, cat))));
  const len = ordered.map((a) => idx[a].size);
  const out = join.rows.map((r) => {
    const c = P.coordsOf(r, idx, ordered, cat);
    let slots = 0; let live = 0; let absent = 0; let offMenu = 0; const perAxis = {};
    for (let ax = 0; ax < ordered.length; ax++) {
      if (len[ax] <= 1 || c.pos[ax] < 0) continue;
      for (const step of [-1, 1]) {
        slots++;
        const q = c.pos[ax] + step;
        if (q < 0 || q >= len[ax]) { offMenu++; continue; }
        const probe = c.pos.slice(); probe[ax] = q;
        const k = `${c.slice}#${probe.join(',')}`;
        if (alive.has(k)) { live++; perAxis[ordered[ax]] = (perAxis[ordered[ax]] || 0) + 1; } else if (!onBoard.has(k)) absent++;
      }
    }
    return { label: r.label, slots, live, absent, offMenu, share: slots ? (slots - live) / slots : null, perAxis };
  });
  const spread = new Map(); for (const x of out) { const k = `${x.live}/${x.slots}`; spread.set(k, (spread.get(k) || 0) + 1); }
  console.log('surviving neighbours / neighbour slots:', [...spread].sort().map(([k, n]) => `${k}x${n}`).join(' '));
  const offs = new Map(); for (const x of out) { const k = `off-menu ${x.offMenu} absent ${x.absent}`; offs.set(k, (offs.get(k) || 0) + 1); }
  console.log('dead slots that are off the menu / not on the board:', [...offs].map(([k, n]) => `${k}: ${n}`).join(' | '));
  const best = out.slice().sort((a, b) => (a.share - b.share) || (b.slots - a.slots))[0];
  console.log('most surrounded:', best.label, `${best.live} of ${best.slots}`, JSON.stringify(best.perAxis));
  const worst = out.slice().sort((a, b) => (b.share - a.share))[0];
  console.log('least surrounded:', worst.label, `${worst.live} of ${worst.slots}`);
  process.exit(0);
})().catch((e) => { console.log('FAILED', e.message); process.exit(0); });
JS
sudo -u uts timeout 240 node /tmp/uts-np.js "$ARG" 2>&1 | tail -40
rm -f /tmp/uts-np.js
