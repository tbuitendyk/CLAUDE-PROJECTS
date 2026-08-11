#!/usr/bin/env node
// pilot-refresh.js -- keep the F1 pair's cache CONTINUOUS and CURRENT.
//
// Two jobs, in order, for each of LTCUSDT / XRPUSDT / BCHUSDT:
//   1. FULL history: loadSymbolAll backfills every monthly bundle from the bulk
//      portal (cheap when already cached), so the training span stays complete.
//   2. CURRENT hours: recentKlines tops up from the last cached hour to now via
//      the Mexico tunnel (PILOT_SOCKS) — the VPS is geo-blocked from Binance's
//      REST hosts, so without the tunnel the tail cannot advance. The fresh
//      hours are written as cache day-files (the same shape dailyKlines writes),
//      so produce's allLoaded read sees them.
//
// Idempotent and reboot-safe: it recomputes the gap from what is on disk each
// run, so a missed run or a host bounce simply catches up on the next tick.
// Fetches only public keyless klines. Places no orders.
const fs = require('fs');
const path = require('path');
const b = require('./lib/binance');
const { loadSymbolAll } = require('./lib/pipeline');

const HOUR = b.HOUR_MS;
const SYMS = ['LTCUSDT', 'XRPUSDT', 'BCHUSDT'];
const CACHE = path.join(__dirname, 'data', 'cache');

function writeDayFiles(sym, rows) {
  const byDay = {};
  for (const r of rows) {
    const d = new Date(r.ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      + `-${String(d.getUTCDate()).padStart(2, '0')}`;
    (byDay[key] ||= []).push(r);
  }
  let files = 0;
  for (const [key, dayRows] of Object.entries(byDay)) {
    const file = path.join(CACHE, `${sym}-1h-${key}.json`);
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none */ }
    const map = new Map(existing.map((r) => [r.ts, r]));
    for (const r of dayRows) map.set(r.ts, r);
    const merged = [...map.values()].sort((a, c) => a.ts - c.ts);
    const tmp = `${file}.tmp${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(merged));
    fs.renameSync(tmp, file);
    files++;
  }
  return files;
}

(async () => {
  let ok = true;
  for (const sym of SYMS) {
    try {
      const loaded = await loadSymbolAll(sym, () => {});      // 1. full history
      const rows = loaded.rows || [];
      const last = rows.length ? rows[rows.length - 1].ts : (Date.now() - 400 * 24 * HOUR);
      const gapH = Math.round((Date.now() - last) / HOUR);
      const fresh = await b.recentKlines(sym, last + HOUR);    // 2. current tail (SOCKS)
      const files = writeDayFiles(sym, fresh);
      const newest = fresh.length ? new Date(fresh[fresh.length - 1].ts).toISOString().slice(0, 16)
        : new Date(last).toISOString().slice(0, 16);
      console.log(`${sym}: history rows=${rows.length} (gap ${gapH}h), +${fresh.length} fresh hours, `
        + `${files} day-files, newest ${newest}Z`);
    } catch (err) {
      ok = false;
      console.error(`${sym}: refresh FAILED: ${err.message}`);
    }
  }
  process.exit(ok ? 0 : 1);
})();
