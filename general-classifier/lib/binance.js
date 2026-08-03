const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Binance public bulk-data channel (data.binance.vision): static monthly
// 1h-kline CSVs in single-entry zips, stable URL scheme, no account and no
// key. Same surface the semi-auto balancer uses; here we keep FIVE columns
// per candle (open/high/low/close/quote_volume) instead of close only.
//
// This module is the ONLY place in the app that touches the network.

const DATA = 'https://data.binance.vision';
// Data-only REST mirror (keyless, same public data channel) — used ONLY for
// the current partial month, which the bulk portal's monthly zips can't
// carry yet. Two hosts tried in order; some networks pass one but not the
// other (same pattern as the semi-auto balancer).
const API_HOSTS = ['https://api.binance.vision', 'https://api.binance.com'];
const HOUR_MS = 3_600_000;
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

// Minimal single-entry ZIP reader (the monthly kline zips hold exactly one
// CSV, deflate or stored). Avoids an npm dependency for one format.
function unzipSingleEntry(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip (no EOCD)');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('bad central directory');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compressedSize = buf.readUInt32LE(cdOffset + 20);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad local header');
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip compression method ${method}`);
}

// Kline CSV columns: 0 openTime, 1 open, 2 high, 3 low, 4 close, 5 volume,
// 6 closeTime, 7 quoteVolume, ... openTime switched from milliseconds to
// MICROseconds in 2025+ files; normalize by magnitude. Rows come back
// pruned to time + the five fields the classifier uses.
//
// bucketMs MATTERS. The hourly path floors every timestamp to the hour, which
// is right for 1h files and catastrophic for 1m ones: all sixty minutes of an
// hour would land on the same key and fifty-nine of them would be discarded
// by the Map that consumes them — silently, with no error and a plausible
// result. Minute callers pass 60_000.
function parseKlineCsv(text, bucketMs = HOUR_MS) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const p = line.split(',');
    if (p.length < 8) continue;
    let t = Number(p[0]);
    if (!Number.isFinite(t) || t <= 0) continue; // header or junk
    if (t > 1e14) t = Math.floor(t / 1000); // microseconds -> ms
    const open = Number(p[1]);
    const high = Number(p[2]);
    const low = Number(p[3]);
    const close = Number(p[4]);
    const quoteVolume = Number(p[7]);
    if (!(open > 0 && high > 0 && low > 0 && close > 0)) continue;
    rows.push({
      ts: Math.floor(t / bucketMs) * bucketMs,
      open,
      high,
      low,
      close,
      quoteVolume: Number.isFinite(quoteVolume) && quoteVolume >= 0 ? quoteVolume : 0,
    });
  }
  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}

// Interval is part of the cache key AND the URL. 1m files are ~60x the rows
// of 1h, so they are only ever fetched for a specific confirmation window —
// never as part of a sweep. cacheState()/cachedMonths() match -1h- explicitly,
// so minute files cannot pollute the hourly coverage grid the UI shows.
function cachePath(symbol, year, month, interval = '1h') {
  const mm = String(month).padStart(2, '0');
  return path.join(CACHE_DIR, `${symbol}-${interval}-${year}-${mm}.json`);
}

// One monthly zip -> array of candle rows; null when that month has no file
// (pre-listing / post-delisting months 404 — callers surface them as
// "missing", not fatal). Past months never change, so a parsed month is
// cached on disk and reused forever.
async function monthlyKlines(symbol, year, month, interval = '1h') {
  const file = cachePath(symbol, year, month, interval);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(cached)) return cached;
  } catch {
    /* no cache yet */
  }
  const mm = String(month).padStart(2, '0');
  const url = `${DATA}/data/spot/monthly/klines/${symbol}/${interval}/${symbol}-${interval}-${year}-${mm}.zip`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`binance data ${res.status} for ${symbol} ${interval} ${year}-${mm}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const rows = parseKlineCsv(unzipSingleEntry(buf).toString('utf8'), interval === '1m' ? 60_000 : HOUR_MS);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // ATOMIC: worker threads read these files concurrently with the main
    // thread's refresh timers. A torn read would fall into the catch above,
    // re-fetch, and on a 404 silently drop the month — changing the dataset
    // a model trains on with no error surfaced. rename() is atomic on POSIX.
    const tmp = `${file}.tmp${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(rows));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`cache write failed for ${path.basename(file)}:`, err.message);
  }
  return rows;
}

// One DAILY zip from the bulk portal (published ~1 day behind real time) —
// the fallback for recent data when the REST mirror is unreachable. Cached
// on disk like monthly files; null on 404 (not published yet / no data).
async function dailyKlines(symbol, year, month, day) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const file = path.join(CACHE_DIR, `${symbol}-1h-${year}-${mm}-${dd}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(cached)) return cached;
  } catch {
    /* no cache yet */
  }
  const url = `${DATA}/data/spot/daily/klines/${symbol}/1h/${symbol}-1h-${year}-${mm}-${dd}.zip`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`binance daily ${res.status} for ${symbol} ${year}-${mm}-${dd}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // This function is 1h-only (filename and URL both pin -1h-). The old line
  // read monthlyKlines' `interval` variable, which does not exist in this
  // scope — every cache-miss fetch threw ReferenceError, so the daily-zip
  // tier of the fallback ladder silently never worked (review, 2026-07-31).
  const rows = parseKlineCsv(unzipSingleEntry(buf).toString('utf8'), HOUR_MS);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // ATOMIC: worker threads read these files concurrently with the main
    // thread's refresh timers. A torn read would fall into the catch above,
    // re-fetch, and on a 404 silently drop the month — changing the dataset
    // a model trains on with no error surfaced. rename() is atomic on POSIX.
    const tmp = `${file}.tmp${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(rows));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`cache write failed for ${path.basename(file)}:`, err.message);
  }
  return rows;
}

// Recent candles via the REST mirror, full OHLC+quoteVolume, hour-bucketed.
// Pages by startTime, 1000 candles/call; ~3 pages covers any gap since the
// last published monthly zip.
async function recentKlines(symbol, sinceMs) {
  const rows = [];
  let cursor = Math.max(0, sinceMs || 0);
  for (let page = 0; page < 4; page++) {
    let data = null;
    let lastErr = null;
    for (const host of API_HOSTS) {
      try {
        const res = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&limit=1000`);
        if (res.ok) {
          data = await res.json();
          break;
        }
        lastErr = new Error(`binance REST ${res.status}`);
        if (res.status === 400) return rows; // real answer (unknown symbol), not connectivity
      } catch (err) {
        lastErr = err;
      }
    }
    if (data === null) throw lastErr || new Error('binance REST unreachable');
    if (!Array.isArray(data) || data.length === 0) break;
    for (const r of data) {
      const open = Number(r[1]);
      const high = Number(r[2]);
      const low = Number(r[3]);
      const close = Number(r[4]);
      const quoteVolume = Number(r[7]);
      if (!(open > 0 && high > 0 && low > 0 && close > 0)) continue;
      rows.push({
        ts: Math.floor(Number(r[0]) / HOUR_MS) * HOUR_MS,
        open,
        high,
        low,
        close,
        quoteVolume: Number.isFinite(quoteVolume) && quoteVolume >= 0 ? quoteVolume : 0,
      });
    }
    if (data.length < 1000) break;
    cursor = Number(data[data.length - 1][0]) + HOUR_MS;
  }
  return rows;
}

// Sorted list of cached month strings ('2020-08', ...) for one symbol.
function cachedMonths(symbol) {
  let files = [];
  try {
    files = fs.readdirSync(CACHE_DIR);
  } catch {
    return [];
  }
  const months = [];
  for (const f of files) {
    const m = new RegExp(`^${symbol}-1h-(\\d{4}-\\d{2})\\.json$`).exec(f);
    if (m) months.push(m[1]);
  }
  return months.sort();
}

// Months covered ONLY by day files, and the assembly that turns them into
// month rows. A month whose bundle Binance has not published yet lives as
// SYM-1h-YYYY-MM-DD.json pieces (written by the day-file backfill). The
// coverage table counts them — so the sweep read path must read them too,
// or "to 2026-08-02" on screen coexists with sweeps that end June 30
// (QC 70: caught 2026-08-03, one all-loaded sweep into the mismatch).
function cachedDayMonths(symbol) {
  let files = [];
  try {
    files = fs.readdirSync(CACHE_DIR);
  } catch {
    return [];
  }
  const months = new Set();
  for (const f of files) {
    const m = new RegExp(`^${symbol}-1h-(\\d{4}-\\d{2})-\\d{2}\\.json$`).exec(f);
    if (m) months.add(m[1]);
  }
  return [...months].sort();
}

// All rows a month's day files hold, in day order; null when there are none.
// Callers prefer the monthly bundle when one is cached — day files only ever
// stand in for a month the bulk portal has not published.
function monthFromDayFiles(symbol, year, month) {
  const mm = String(month).padStart(2, '0');
  let files = [];
  try {
    files = fs.readdirSync(CACHE_DIR);
  } catch {
    return null;
  }
  const days = files
    .filter((f) => new RegExp(`^${symbol}-1h-${year}-${mm}-\\d{2}\\.json$`).test(f))
    .sort();
  if (!days.length) return null;
  const rows = [];
  for (const f of days) {
    try {
      const dayRows = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
      if (Array.isArray(dayRows)) for (const r of dayRows) rows.push(r);
    } catch {
      /* torn read: skip the piece rather than fail the month */
    }
  }
  return rows.length ? rows : null;
}

// What's on disk: per symbol, how many months are cached and the span they
// cover. Powers the UI's "available data" area.
function cacheState() {
  let files = [];
  try {
    files = fs.readdirSync(CACHE_DIR);
  } catch {
    return [];
  }
  // Coverage counts BOTH storage forms: whole-month bundles and the daily
  // pieces that hold a month until Binance publishes its bundle (owner,
  // 2026-08-03: the table hid freshly refreshed days). `to` is the latest
  // covered date in either form; `toMonth` stays machine-friendly YYYY-MM
  // for the refresh arithmetic.
  const bySymbol = new Map();
  const entry = (symbol) => {
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, { months: new Set(), latest: '' });
    return bySymbol.get(symbol);
  };
  for (const f of files) {
    let m = /^([A-Z0-9]+)-1h-(\d{4}-\d{2})\.json$/.exec(f);
    if (m) {
      const e = entry(m[1]);
      e.months.add(m[2]);
      if (m[2] > e.latest.slice(0, 7)) e.latest = m[2];
      continue;
    }
    m = /^([A-Z0-9]+)-1h-(\d{4}-\d{2})-(\d{2})\.json$/.exec(f);
    if (m) {
      const e = entry(m[1]);
      e.months.add(m[2]);
      const day = `${m[2]}-${m[3]}`;
      if (day > e.latest) e.latest = day;
    }
  }
  return [...bySymbol.entries()]
    .map(([symbol, e]) => {
      const months = [...e.months].sort();
      return {
        symbol,
        months: months.length,
        from: months[0],
        to: e.latest.length > 7 ? e.latest : months[months.length - 1],
        toMonth: months[months.length - 1],
      };
    })
    .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

module.exports = { monthlyKlines, dailyKlines, recentKlines, unzipSingleEntry, parseKlineCsv, cacheState, cachedMonths, cachedDayMonths, monthFromDayFiles, cachePath, HOUR_MS, MINUTE_MS: 60_000 };
