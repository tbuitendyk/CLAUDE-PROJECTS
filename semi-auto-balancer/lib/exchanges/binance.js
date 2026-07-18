const zlib = require('zlib');

// Binance public market data (Phase 2.5 hourly depth). Two keyless surfaces:
//   * data.binance.vision — static monthly kline CSVs (zip), stable URL
//     scheme, years of 1h candles in a handful of ~300KB downloads;
//   * api.binance.vision — the data-only REST mirror, used for the current
//     partial month (1000 candles/call) and for symbol existence probes.
// Used as the depth source for assets Bitso can't serve; USDT-quoted, which
// is fine for backtesting purposes (~USD). No account, no key, no ToS
// click-through — this is Binance's published bulk-data channel.

const DATA = 'https://data.binance.vision';
// REST mirrors tried in order — some networks pass one but not the other.
const API_HOSTS = ['https://api.binance.vision', 'https://api.binance.com'];
const HOUR_MS = 3_600_000;

async function apiFetch(pathAndQuery) {
  let lastErr = null;
  for (const host of API_HOSTS) {
    try {
      const res = await fetch(`${host}${pathAndQuery}`);
      if (res.ok) return res.json();
      lastErr = new Error(`binance ${res.status}`);
      if (res.status === 400) return null; // real answer (e.g. unknown symbol), not connectivity
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('binance REST unreachable');
}

// Minimal single-entry ZIP reader (the monthly kline zips hold exactly one
// CSV, deflate or stored). Avoids adding an npm dependency for one format.
function unzipSingleEntry(buf) {
  // End Of Central Directory: scan backwards for its signature.
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

// Kline CSV rows: openTime,open,high,low,close,... — openTime switched from
// milliseconds to MICROseconds in 2025+ files; normalize by magnitude.
function parseKlineCsv(text) {
  const byHour = new Map();
  for (const line of String(text).split('\n')) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    let t = Number(parts[0]);
    if (!Number.isFinite(t) || t <= 0) continue; // header or junk
    if (t > 1e14) t = Math.floor(t / 1000); // microseconds -> ms
    const close = Number(parts[4]);
    if (!(close > 0)) continue;
    byHour.set(Math.floor(t / HOUR_MS) * HOUR_MS, close);
  }
  return byHour;
}

// Does Binance trade SYMUSDT? Try the REST mirrors; when both are
// unreachable (some egress proxies), fall back to probing the data portal
// for LAST month's zip — its existence proves the listing.
async function symbolExists(symbol) {
  const s = `${symbol.toUpperCase()}USDT`;
  try {
    const rows = await apiFetch(`/api/v3/klines?symbol=${s}&interval=1h&limit=1`);
    return Array.isArray(rows) && rows.length > 0 ? s : null;
  } catch {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 1);
    const month = await monthlyCloses(s, d.getUTCFullYear(), d.getUTCMonth() + 1).catch(() => null);
    return month && month.size > 0 ? s : null;
  }
}

// One monthly zip -> Map(hourTs -> close); null when that month has no file
// (pre-listing or post-delisting months 404 — callers just skip them).
async function monthlyCloses(binanceSymbol, year, month) {
  const mm = String(month).padStart(2, '0');
  const url = `${DATA}/data/spot/monthly/klines/${binanceSymbol}/1h/${binanceSymbol}-1h-${year}-${mm}.zip`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`binance data ${res.status} for ${binanceSymbol} ${year}-${mm}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return parseKlineCsv(unzipSingleEntry(buf).toString('utf8'));
}

// Recent candles via the REST mirrors (current month / top-ups). Pages by
// startTime; 1000 candles per call ≈ 41 days per page.
async function recentCloses(binanceSymbol, sinceMs) {
  const byHour = new Map();
  let cursor = Math.max(0, sinceMs || 0);
  for (let page = 0; page < 20; page++) {
    const rows = await apiFetch(
      `/api/v3/klines?symbol=${binanceSymbol}&interval=1h&startTime=${cursor}&limit=1000`
    );
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const close = Number(r[4]);
      if (close > 0) byHour.set(Math.floor(Number(r[0]) / HOUR_MS) * HOUR_MS, close);
    }
    const lastOpen = Number(rows[rows.length - 1][0]);
    if (rows.length < 1000) break;
    cursor = lastOpen + HOUR_MS;
  }
  return byHour;
}

// Full backfill: monthly zips from `sinceMs` through last month, then the
// REST mirror for the current partial month. Months without files (before
// listing / after delisting) are skipped, not fatal.
async function backfillCloses(binanceSymbol, sinceMs, { onProgress = () => {} } = {}) {
  const out = new Map();
  const start = new Date(Math.max(0, sinceMs));
  const now = new Date();
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;
  while (y < curY || (y === curY && m < curM)) {
    onProgress(`binance ${binanceSymbol} ${y}-${String(m).padStart(2, '0')}`);
    try {
      const month = await monthlyCloses(binanceSymbol, y, m);
      if (month) for (const [ts, p] of month) out.set(ts, p);
    } catch (err) {
      console.error(`binance monthly failed ${binanceSymbol} ${y}-${m}:`, err.message);
    }
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  // Current partial month via REST; when both mirrors are unreachable the
  // monthly depth still stands and the gap closes on a later top-up.
  try {
    const monthStartMs = Date.UTC(curY, curM - 1, 1);
    const recent = await recentCloses(binanceSymbol, Math.max(sinceMs, monthStartMs));
    for (const [ts, p] of recent) out.set(ts, p);
  } catch (err) {
    console.error(`binance recent top-up unavailable for ${binanceSymbol}:`, err.message);
  }
  return out;
}

module.exports = { symbolExists, monthlyCloses, recentCloses, backfillCloses, unzipSingleEntry, parseKlineCsv };
