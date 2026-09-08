#!/usr/bin/env bash
# uts-reserve-review.sh -- READ-ONLY, INDEPENDENT. Prices the mechanical
# benchmarks on BOTH windows -- the held-back stretch and the reserve stretch --
# with arithmetic written here, from the raw candle files, and compares them to
# what the engine stored for each. Nothing below imports the engine's pricing:
# the only thing taken from it is where each window's chunks start.
#
# Why it exists (owner, 2026-09-08): reading the engine's own grade back proves
# nothing about whether the reserve stretch is treated like the held-back one.
# One pricer over both windows does. If the engine matches this on both, the two
# are being handled the same way; if it matches one and not the other, the gap
# is the difference. Presses nothing, stamps nothing, spends no look.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 2
node - <<'JS'
const fs = require('fs');
const path = require('path');
const ROOT = '/opt/ultimate-trading-system';
const SETS = path.join(ROOT, 'data', 'stagesets');
const CACHE = path.join(ROOT, 'data', 'cache');
const HOUR = 3600000;

// ---- what the engine says, read off disk (documents, not pricing) ----------
const s4 = JSON.parse(fs.readFileSync(path.join(SETS, fs.readdirSync(SETS).find((f) => f.startsWith('s4-'))), 'utf8'));
const s3 = JSON.parse(fs.readFileSync(path.join(SETS, s4.parent.id + '.json'), 'utf8'));
const grade = (s4.unread || [])[0];
if (!grade) { console.log('no reserve grade on the set -- nothing to check against'); process.exit(0); }
const [trade, ctx1, ctx2, geometry] = String(s4.unit).split('|');
const fee = Number((s3.params || {}).fee) || 0;
console.log('unit %s | shape %s | fee %s a leg', s4.unit, geometry, fee);

// ---- the engine's chunk boundaries for each window (the ONE thing borrowed) --
const sw = require(path.join(ROOT, 'lib', 'stagework'));
const combo = { trade, ctx1: ctx1 || null, ctx2: ctx2 || null };
const p = { ...(s3.params || {}) };
const un = require(path.join(ROOT, 'lib', 'stagework'));
(async () => {
  const held = await sw.unitChunks(combo, geometry, p);
  const heldStarts = held.split.holdChunks.map((c) => c.startTs);
  const res = await un.unreadChunksFor(combo, geometry, grade.window.fromTs);
  const resStarts = res.chunks.map((c) => c.startTs);
  const geo = held.geo;
  console.log('held-back  %d chunks, %s to %s', heldStarts.length, day(heldStarts[0]), day(heldStarts[heldStarts.length - 1]));
  console.log('reserve    %d chunks, %s to %s   (the grade recorded %s)', resStarts.length, day(resStarts[0]), day(resStarts[resStarts.length - 1]), grade.window.chunks);
  const overlap = resStarts.filter((t) => heldStarts.includes(t)).length;
  console.log('chunks in both windows: %d  (must be 0)', overlap);

  // ---- MY OWN trade map, straight off the cached candle files ---------------
  const map = new Map();
  let files = 0;
  for (const f of fs.readdirSync(CACHE)) {
    if (!f.startsWith(trade + '-1h-') || !f.endsWith('.json')) continue;
    files++;
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch (_) { continue; }
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (r && Number.isFinite(r.ts) && Number.isFinite(r.open) && r.open > 0) map.set(r.ts, r.open);
    }
  }
  console.log('my candle map: %d hourly opens from %d cached files (no forward fill, no invented prices)', map.size, files);

  // ---- MY OWN money: gross first, then the round trip, exactly as a book ----
  const NOTIONAL = 100;
  const trip = NOTIONAL * 2 * fee;
  const at = (ts) => map.get(ts);
  const exitOf = (entryTs, tHours) => { for (let h = 0; h <= 3; h++) { const b = at(entryTs + (tHours + h) * HOUR); if (b !== undefined) return b; } return undefined; };
  const one = (dir, entry, exit) => (dir === 1 ? NOTIONAL * (exit / entry - 1) : NOTIONAL * (1 - exit / entry)) - trip;
  function everyPeriod(starts, dir, tHours) {
    let pnl = 0; let trades = 0; let unpriced = 0;
    for (const s of starts) {
      const e = at(s + geo.entryOffsetH * HOUR);
      if (e === undefined) { unpriced++; continue; }
      const x = exitOf(s + geo.entryOffsetH * HOUR, tHours);
      if (x === undefined) { unpriced++; continue; }
      pnl += one(dir, e, x); trades++;
    }
    return { pnl, trades, unpriced };
  }
  function onePosition(starts, dir, tHours) {
    if (!starts.length) return null;
    const inTs = starts[0] + geo.entryOffsetH * HOUR;
    const lastTs = starts[starts.length - 1] + geo.entryOffsetH * HOUR;
    const e = at(inTs); const x = exitOf(lastTs, tHours);
    if (e === undefined || x === undefined) return null;
    return one(dir, e, x);
  }

  // ---- the t values the set's setups actually use --------------------------
  const ts = [...new Set((grade.rows || []).map((r) => Number(String(r.label).match(/t(\d+)h/) ? String(r.label).match(/t(\d+)h/)[1] : NaN)).filter(Number.isFinite))].sort((a, b) => a - b);
  console.log('hold lengths in use: %s', ts.join(', '));

  const mine = { held: {}, res: {} };
  for (const t of ts) {
    mine.held[t] = { al: everyPeriod(heldStarts, 1, t), as: everyPeriod(heldStarts, -1, t), bh: onePosition(heldStarts, 1, t), sh: onePosition(heldStarts, -1, t) };
    mine.res[t] = { al: everyPeriod(resStarts, 1, t), as: everyPeriod(resStarts, -1, t), bh: onePosition(resStarts, 1, t), sh: onePosition(resStarts, -1, t) };
  }

  // ---- what the engine stored, for the same things -------------------------
  const eHeld = ((s3.controls || {}).units || {})[s4.unit] || {};
  const g = grade.controls || {};
  const m2 = (v) => (v == null ? '-' : (v < 0 ? '-$' + (-v).toFixed(2) : '$' + v.toFixed(2)));
  console.log('');
  console.log('HELD-BACK: mine, then the engine, per hold length');
  console.log('%5s %12s %12s %8s   %12s %12s %8s', 't', 'mine long', 'engine long', 'diff', 'mine short', 'engine short', 'diff');
  let bad = 0; let seen = 0;
  for (const t of ts) {
    for (const key of ['all|' + t, 'wk|' + t]) {
      const e = eHeld[key]; if (!e) continue;
      seen++;
      const dl = e.alwaysLong == null ? null : mine.held[t].al.pnl - e.alwaysLong;
      const ds = e.alwaysShort == null ? null : mine.held[t].as.pnl - e.alwaysShort;
      if ((dl != null && Math.abs(dl) > 0.005) || (ds != null && Math.abs(ds) > 0.005)) bad++;
      console.log('%5s %12s %12s %8s   %12s %12s %8s', key, m2(mine.held[t].al.pnl), m2(e.alwaysLong), dl == null ? '-' : dl.toFixed(2), m2(mine.held[t].as.pnl), m2(e.alwaysShort), ds == null ? '-' : ds.toFixed(2));
    }
  }
  console.log('held-back rows compared: %d, disagreeing by more than a cent: %d', seen, bad);
  console.log('');
  console.log('RESERVE: the engine stored only the lowest and highest across hold lengths, so mine are ranged the same way');
  const rng = (vals) => ({ lo: Math.min(...vals), hi: Math.max(...vals) });
  const myAL = rng(ts.map((t) => mine.res[t].al.pnl));
  const myAS = rng(ts.map((t) => mine.res[t].as.pnl));
  const myBH = rng(ts.map((t) => mine.res[t].bh).filter((v) => v != null));
  const myS4 = rng(ts.map((t) => mine.res[t].sh).filter((v) => v != null));
  const show = (name, m, e) => console.log('%-12s mine %s to %s | engine %s to %s | %s', name, m2(m.lo), m2(m.hi), m2((e || {}).lo), m2((e || {}).hi),
    (e && Math.abs(m.lo - e.lo) <= 0.005 && Math.abs(m.hi - e.hi) <= 0.005) ? 'MATCH' : 'DIFFERS');
  show('long each', myAL, g.alwaysLong);
  show('short each', myAS, g.alwaysShort);
  show('buy+hold', myBH, g.buyHold);
  show('short+hold', myS4, g.shortHold);
  const noExit = ts.filter((t) => mine.res[t].bh == null);
  if (noExit.length) console.log('no exit price yet on the reserve stretch for hold length(s): %s', noExit.join(', '));
  console.log('unpriced periods, reserve, per hold length: %s', ts.map((t) => t + 'h:' + mine.res[t].al.unpriced).join(' '));
  console.log('unpriced periods, held-back, per hold length: %s', ts.map((t) => t + 'h:' + mine.held[t].al.unpriced).join(' '));
})().catch((e) => { console.log('FAILED:', e && e.message); process.exit(1); });
function day(ts) { return ts == null ? '?' : new Date(Number(ts)).toISOString().slice(0, 10); }
JS
