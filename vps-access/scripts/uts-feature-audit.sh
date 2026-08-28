#!/usr/bin/env bash
# READ-ONLY: build real chunks at every chunk shape for a coin on its own, a
# coin read alongside one other, and alongside two, and measure the block of
# numbers itself — frozen, duplicated, or near-duplicated. Writes nothing.
set -euo pipefail
cd /opt/ultimate-trading-system
node - <<'JS'
const fs = require('fs');
const path = require('path');
const { toHourlyMap, forwardFill, GEOMETRIES } = require('./lib/dataset');
const bracket = require('./lib/bracket');
const { featureNamesFor, viewIndices, std, pearson } = require('./lib/features');

function loadCoin(sym) {
  const dir = path.join('data', 'cache');
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(sym + '-1h-')).sort();
  const rows = [];
  for (const f of files) rows.push(...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  rows.sort((a, b) => a.ts - b.ts);
  return forwardFill(toHourlyMap(rows)).map;
}
const SYMS = ['ADAUSDT', 'ATOMUSDT', 'BCHUSDT'];
const maps = {};
for (const s of SYMS) maps[s] = loadCoin(s);
console.log('coins: ' + SYMS.map((s) => s + ' (' + maps[s].size + 'h)').join(', '));

const combos = [
  { label: 'coin on its own', maps: { trade: maps[SYMS[0]] }, size: 1 },
  { label: 'read alongside one', maps: { trade: maps[SYMS[0]], ctx1: maps[SYMS[1]] }, size: 2 },
  { label: 'read alongside two', maps: { trade: maps[SYMS[0]], ctx1: maps[SYMS[1]], ctx2: maps[SYMS[2]] }, size: 3 },
];

for (const combo of combos) {
  console.log('\n' + '='.repeat(70) + '\n' + combo.label.toUpperCase() + '\n' + '='.repeat(70));
  for (const geo of ['daily-1d', 'daily-4d', 'weekly-8d']) {
    const nDays = GEOMETRIES[geo].featureHours / 24;
    const P = nDays + 12;
    const built = bracket.buildComboChunks(combo.maps, geo, false);
    const chunks = built.chunks;
    if (!chunks.length) { console.log('\n-- ' + geo + ': no chunks'); continue; }
    const per = featureNamesFor(nDays);
    let names;
    if (combo.size === 1) names = per.slice(0, P);
    else if (combo.size === 2) names = per.slice();
    else names = [].concat(per, per.slice(P, 2 * P).map((n) => n.replace('comp_', 'comp2_')), per.slice(2 * P).map((n) => n + '#2'));
    const X = chunks.map((c) => c.x);
    const N = X.length;
    const M = X[0].length;
    const cols = [];
    for (let j = 0; j < M; j++) cols.push(X.map((r) => r[j]));
    const sds = cols.map((c) => std(c));
    const frozen = [];
    for (let j = 0; j < M; j++) if (sds[j] < 1e-12) frozen.push((names[j] || ('#' + j)) + '=' + cols[j][0]);
    const dupes = [];
    for (let a = 0; a < M; a++) {
      for (let b = a + 1; b < M; b++) {
        if (sds[a] < 1e-12 || sds[b] < 1e-12) continue;
        let same = true;
        for (let i = 0; i < N; i++) if (cols[a][i] !== cols[b][i]) { same = false; break; }
        if (same) dupes.push(names[a] + ' == ' + names[b]);
      }
    }
    const vcount = (v) => {
      const two = viewIndices(v, nDays);
      if (combo.size === 1) return two.filter((i) => i < P).length;
      if (combo.size === 2) return two.length;
      return two.length + two.filter((i) => i >= P).length;
    };
    // how many of the volume-reading numbers are actually alive
    const volIdx = [];
    for (let j = 0; j < M; j++) if (/dayvol|rel_vol_log/.test(names[j] || '')) volIdx.push(j);
    const volLive = volIdx.filter((j) => sds[j] > 1e-12).length;
    console.log('\n-- ' + geo + ' (' + GEOMETRIES[geo].featureHours + 'h, ' + N + ' chunks, ' + M + ' numbers)');
    console.log('   readings: everything ' + M + ' · prices ' + vcount('prices') + ' · volume ' + vcount('volume') + (combo.size > 1 ? ' · cross ' + vcount('cross') : ''));
    console.log('   volume reading: ' + volIdx.length + ' numbers, ' + volLive + ' of them alive');
    console.log('   frozen: ' + (frozen.length ? frozen.join(', ') : 'none'));
    console.log('   exact duplicates: ' + (dupes.length ? dupes.join(' | ') : 'none'));
  }
}
JS
