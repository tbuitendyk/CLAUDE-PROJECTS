#!/usr/bin/env bash
# uts-reserve-review.sh -- READ-ONLY, INDEPENDENT. Prices the mechanical
# benchmarks on BOTH windows -- the held-back stretch and the reserve stretch --
# with arithmetic written here, from the raw cached candles, and compares each
# against what the engine stored for that window. Nothing here imports the
# engine's pricing; the only thing borrowed is where each window's chunks start,
# and the held-back split is rebuilt on the SAME pinned price files the run was
# launched on, or the split itself would differ.
#
# Why (owner, 2026-09-08): reading the engine's own grade back proves nothing
# about whether the reserve stretch is treated like the held-back one. One
# pricer over both windows does. Presses nothing, spends no look.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 2
node - <<'JS'
const fs = require('fs'); const path = require('path');
const ROOT = '/opt/ultimate-trading-system';
const SETS = path.join(ROOT, 'data', 'stagesets'); const CACHE = path.join(ROOT, 'data', 'cache');
const HOUR = 3600000;
const day = (t) => (t == null ? '?' : new Date(Number(t)).toISOString().slice(0, 10));
const m2 = (v) => (v == null || !Number.isFinite(v) ? '-' : (v < 0 ? '-$' + (-v).toFixed(2) : '$' + v.toFixed(2)));
const pad = (s, n) => String(s).padStart(n);

const s4 = JSON.parse(fs.readFileSync(path.join(SETS, fs.readdirSync(SETS).find((f) => f.startsWith('s4-'))), 'utf8'));
const s3 = JSON.parse(fs.readFileSync(path.join(SETS, s4.parent.id + '.json'), 'utf8'));
const grade = (s4.unread || [])[0];
if (!grade) { console.log('no reserve grade on the set'); process.exit(0); }
const [trade, ctx1, ctx2, geometry] = String(s4.unit).split('|');
const fee = Number((s3.params || {}).fee) || 0;
const sw = require(path.join(ROOT, 'lib', 'stagework'));
const pin = ((s3.dataManifest || {}).detailFile) || null;
const pinned = pin ? require(path.join(ROOT, 'lib', 'pin')).pinnedFilesOf({ detailFile: pin }) : null;
console.log('unit %s | fee %s a leg | pinned to the launch files: %s', s4.unit, fee, pinned ? 'yes' : 'NO -- the split may not match');

(async () => {
  const held = await sw.unitChunks({ trade, ctx1: ctx1 || null, ctx2: ctx2 || null }, geometry, { ...(s3.params || {}), pinnedFiles: pinned });
  const res = await sw.unreadChunksFor({ trade, ctx1: ctx1 || null, ctx2: ctx2 || null }, geometry, grade.window.fromTs);
  const geo = held.geo;
  const H = held.split.holdChunks.map((c) => c.startTs);
  const R = res.chunks.map((c) => c.startTs);
  const storedHold = ((s3.windows || {}).units || {})[s4.unit] || (s3.windows || {});
  console.log('held-back  %d chunks, %s to %s   (the run recorded %s chunks)', H.length, day(H[0]), day(H[H.length - 1]), ((storedHold.hold) || {}).chunks);
  console.log('reserve    %d chunks, %s to %s   (the grade recorded %s chunks)', R.length, day(R[0]), day(R[R.length - 1]), grade.window.chunks);
  const both = R.filter((t) => H.includes(t)).length;
  console.log('chunks in BOTH windows: %d   (must be 0)', both);

  const map = new Map(); let files = 0;
  for (const f of fs.readdirSync(CACHE)) {
    if (!f.startsWith(trade + '-1h-') || !f.endsWith('.json')) continue;
    files++;
    let rows; try { rows = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch (_) { continue; }
    for (const r of (Array.isArray(rows) ? rows : [])) if (r && Number.isFinite(r.ts) && r.open > 0) map.set(r.ts, r.open);
  }
  console.log('my own candle map: %d hourly opens from %d files, raw, nothing filled in', map.size, files);

  const N = 100; const trip = N * 2 * fee;
  const at = (t) => map.get(t);
  const exitAt = (e, t) => { for (let h = 0; h <= 3; h++) { const b = at(e + (t + h) * HOUR); if (b !== undefined) return b; } return undefined; };
  const one = (d, e, x) => (d === 1 ? N * (x / e - 1) : N * (1 - x / e)) - trip;
  const MON = { 'daily-1d': [1, 2, 3, 4], 'daily-2d': [1, 2, 3], 'daily-3d': [1], 'daily-4d': [1] }[geometry] || null;
  const wkOnly = (starts) => (MON ? starts.filter((s) => MON.includes(new Date(s).getUTCDay())) : starts);
  function each(starts, dir, t) {
    let pnl = 0; let n = 0; let miss = 0;
    for (const s of starts) {
      const e = at(s + geo.entryOffsetH * HOUR); const x = e === undefined ? undefined : exitAt(s + geo.entryOffsetH * HOUR, t);
      if (e === undefined || x === undefined) { miss++; continue; }
      pnl += one(dir, e, x); n++;
    }
    return { pnl, n, miss };
  }
  function hold1(starts, dir, t) {
    if (!starts.length) return null;
    const e = at(starts[0] + geo.entryOffsetH * HOUR);
    const x = exitAt(starts[starts.length - 1] + geo.entryOffsetH * HOUR, t);
    return (e === undefined || x === undefined) ? null : one(dir, e, x);
  }
  const ts = [...new Set((grade.rows || []).map((r) => { const m = String(r.label).match(/t(\d+)h/); return m ? Number(m[1]) : NaN; }).filter(Number.isFinite))].sort((a, b) => a - b);

  const eHeld = ((s3.controls || {}).units || {})[s4.unit] || {};
  console.log('');
  console.log('HELD-BACK -- mine against the engine, per hold length and 24/7 or 24/5');
  console.log('%s %11s %11s %9s %11s %11s %9s', pad('key', 8), 'mine long', 'engine', 'diff', 'mine short', 'engine', 'diff');
  let rows = 0; let off = 0;
  for (const t of ts) for (const wk of [false, true]) {
    const key = (wk ? 'wk|' : 'all|') + t; const e = eHeld[key]; if (!e) continue;
    const starts = wk ? wkOnly(H) : H;
    const al = each(starts, 1, t).pnl; const as = each(starts, -1, t).pnl;
    const dl = e.alwaysLong == null ? null : al - e.alwaysLong; const ds = e.alwaysShort == null ? null : as - e.alwaysShort;
    rows++; if ((dl != null && Math.abs(dl) > 0.005) || (ds != null && Math.abs(ds) > 0.005)) off++;
    console.log('%s %11s %11s %9s %11s %11s %9s', pad(key, 8), pad(m2(al), 11), pad(m2(e.alwaysLong), 11), pad(dl == null ? '-' : dl.toFixed(2), 9), pad(m2(as), 11), pad(m2(e.alwaysShort), 11), pad(ds == null ? '-' : ds.toFixed(2), 9));
  }
  console.log('held-back: %d rows compared, %d differ by more than a cent', rows, off);

  console.log('');
  console.log('RESERVE -- the grade stored only the lowest and highest across hold lengths, so mine are ranged the same way');
  const g = grade.controls || {};
  const rng = (v) => { const k = v.filter((x) => x != null && Number.isFinite(x)); return k.length ? { lo: Math.min(...k), hi: Math.max(...k) } : null; };
  const cmp = (name, mine, e) => {
    const ok = mine && e && e.lo != null && Math.abs(mine.lo - e.lo) <= 0.005 && Math.abs(mine.hi - e.hi) <= 0.005;
    const none = !mine && (!e || e.lo == null);
    console.log('%s mine %s..%s | engine %s..%s | %s', pad(name, 11),
      mine ? m2(mine.lo) : 'no figure', mine ? m2(mine.hi) : '', e && e.lo != null ? m2(e.lo) : 'no figure', e && e.lo != null ? m2(e.hi) : '',
      ok ? 'MATCH' : none ? 'both say no figure' : 'DIFFERS');
  };
  cmp('long each', rng(ts.map((t) => each(R, 1, t).pnl)), g.alwaysLong);
  cmp('short each', rng(ts.map((t) => each(R, -1, t).pnl)), g.alwaysShort);
  cmp('buy+hold', rng(ts.map((t) => hold1(R, 1, t))), g.buyHold);
  cmp('short+hold', rng(ts.map((t) => hold1(R, -1, t))), g.shortHold);
  console.log('periods with no exit price -- reserve %s', ts.map((t) => t + 'h:' + each(R, 1, t).miss).join(' '));
  console.log('periods with no exit price -- held-back %s', ts.map((t) => t + 'h:' + each(H, 1, t).miss).join(' '));
  console.log('buy-and-hold on the reserve stretch: %s', ts.every((t) => hold1(R, 1, t) == null) ? 'NO EXIT PRICE at any hold length' : 'priced');
})().catch((e) => { console.log('FAILED:', e && e.message); process.exit(1); });
JS
