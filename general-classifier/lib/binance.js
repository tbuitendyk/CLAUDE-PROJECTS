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
// pruned to time + the five fields the classifier uses, hour-bucketed.
function parseKlineCsv(text) {
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
      ts: Math.floor(t / HOUR_MS) * HOUR_MS,
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

function cachePath(symbol, year, month) {
  const mm = String(month).padStart(2, '0');
  return path.join(CACHE_DIR, `${symbol}-1h-${year}-${mm}.json`);
}

// One monthly zip -> array of candle rows; null when that month has no file
// (pre-listing / post-delisting months 404 — callers surface them as
// "missing", not fatal). Past months never change, so a parsed month is
// cached on disk and reused forever.
async function monthlyKlines(symbol, year, month) {
  const file = cachePath(symbol, year, month);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(cached)) return cached;
  } catch {
    /* no cache yet */
  }
  const mm = String(month).padStart(2, '0');
  const url = `${DATA}/data/spot/monthly/klines/${symbol}/1h/${symbol}-1h-${year}-${mm}.zip`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`binance data ${res.status} for ${symbol} ${year}-${mm}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const rows = parseKlineCsv(unzipSingleEntry(buf).toString('utf8'));
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rows));
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
  const rows = parseKlineCsv(unzipSingleEntry(buf).toString('utf8'));
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rows));
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

// What's on disk: per symbol, how many months are cached and the span they
// cover. Powers the UI's "available data" area.
function cacheState() {
  let files = [];
  try {
    files = fs.readdirSync(CACHE_DIR);
  } catch {
    return [];
  }
  const bySymbol = new Map();
  for (const f of files) {
    const m = /^([A-Z0-9]+)-1h-(\d{4}-\d{2})\.json$/.exec(f);
    if (!m) continue;
    const [, symbol, month] = m;
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol).push(month);
  }
  return [...bySymbol.entries()]
    .map(([symbol, months]) => {
      months.sort();
      return { symbol, months: months.length, from: months[0], to: months[months.length - 1] };
    })
    .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

module.exports = { monthlyKlines, dailyKlines, recentKlines, unzipSingleEntry, parseKlineCsv, cacheState, HOUR_MS };
