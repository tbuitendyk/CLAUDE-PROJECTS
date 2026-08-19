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
const CACHE = path.join(__dirname, 'data', 'cache');

// WHICH PAIRS TO KEEP CURRENT — derived from the profiles that are actually
// trading, not a hardcoded triple. The list used to be three symbols because one
// hardcoded config traded them; a profile on any other pair would have run its
// committee on a cache nothing was topping up, and produced a call from stale
// candles rather than failing loudly. Every pair a live or paper profile needs
// (its traded pair and both context pairs) is refreshed.
//
// Falls back to the original triple only if the registry cannot be read at all,
// so a broken registry degrades to "keep refreshing what we were" rather than to
// "refresh nothing".
function symbolsToRefresh() {
  try {
    const reg = require('./lib/live/setups');
    const want = new Set();
    for (const s of reg.listSetups()) {
      if (!['paper', 'live', 'stopped'].includes(s.state)) continue;
      const combo = (s.configSnapshot || {}).combo || {};
      for (const k of ['trade', 'ctx1', 'ctx2']) if (combo[k]) want.add(combo[k]);
      if (s.tradedPair) want.add(s.tradedPair);
    }
    if (want.size) return [...want].sort();
  } catch (_) { /* fall through */ }
  return ['LTCUSDT', 'XRPUSDT', 'BCHUSDT'];
}
const SYMS = symbolsToRefresh();

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
  // A candle is CLOSED (safe to cache) only once its whole hour is past. The
  // decision must use finalized OHLC exactly as training did; a still-forming
  // hour is a 5-minute stub and out-of-distribution (review finding 6, FATAL).
  const closedCutoff = () => Math.floor(Date.now() / HOUR) * HOUR; // start of the current (forming) hour
  for (const sym of SYMS) {
    try {
      const loaded = await loadSymbolAll(sym, () => {});      // 1. full history
      const rows = loaded.rows || [];
      const last = rows.length ? rows[rows.length - 1].ts : (Date.now() - 400 * 24 * HOUR);
      const gapH = Math.round((Date.now() - last) / HOUR);
      // Re-fetch the last 24h (not just from last+HOUR): earlier runs each left
      // ONE forming-hour stub at their boundary, so overwrite the whole recent
      // window with finalized values (writeDayFiles dedups by ts). Then drop the
      // current forming hour so a stub is never cached going forward.
      const cutoff = closedCutoff();
      const since = Math.min(last, Date.now() - 24 * HOUR);
      const raw = await b.recentKlines(sym, since);          // 2. current tail (SOCKS)
      const fresh = raw.filter((r) => r.ts < cutoff);        // closed hours only
      const dropped = raw.length - fresh.length;
      const files = writeDayFiles(sym, fresh);
      const newest = fresh.length ? new Date(fresh[fresh.length - 1].ts).toISOString().slice(0, 16)
        : new Date(last).toISOString().slice(0, 16);
      console.log(`${sym}: history rows=${rows.length} (gap ${gapH}h), +${fresh.length} closed hours `
        + `(${dropped} forming dropped), ${files} day-files, newest ${newest}Z`);
    } catch (err) {
      ok = false;
      console.error(`${sym}: refresh FAILED: ${err.message}`);
    }
  }
  process.exit(ok ? 0 : 1);
})();
