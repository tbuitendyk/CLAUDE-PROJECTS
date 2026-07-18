const db = require('./db');
const config = require('./config');
const kraken = require('./exchanges/kraken');
const bitso = require('./exchanges/bitso');
const binance = require('./exchanges/binance');
const { getJson } = require('./cg');
const { fiatCode } = require('./pricing');
const { startJob, getJob } = require('./jobs');

// Phase 2.5: hourly price data, acquired fully automatically — years of
// depth on the first request, no manual downloads, no multi-year accrual
// wait. Source ladder per asset (first rung that works is PERSISTED so a
// series never mixes venues across time):
//   1. bitso  — *_usd book (or usd_<fiat> inverted): years in ONE call.
//   2. binance — public data portal monthly zips + REST mirror: years in
//      minutes, USDT-quoted (~USD, fine for backtests).
//   3. kraken-trades — candles rebuilt from raw public trades, back to
//      inception; slow (rate-limited pages), so it runs as a resumable
//      background job while callers see status 'backfilling'.
//   4. coingecko — 90-day hourly stopgap.
// Daily top-ups through the same persisted source keep every series
// current; the trailing partial candle self-corrects via INSERT OR REPLACE.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DEFAULT_DEPTH_DAYS = 730;
const CG_HOURLY_MAX_DAYS = 90;
const KRAKEN_TRADES_THROTTLE_MS = 1200;

const hourBucket = (ts) => Math.floor(ts / HOUR_MS) * HOUR_MS;

function latestTs(id) {
  const row = db.prepare('SELECT MAX(ts) AS ts FROM hourly_prices WHERE coingecko_id = ?').get(id);
  return row && row.ts != null ? row.ts : null;
}

function store(id, byBucket) {
  const ins = db.prepare('INSERT OR REPLACE INTO hourly_prices (coingecko_id, ts, usd_price) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const [ts, p] of byBucket) if (p > 0) ins.run(id, hourBucket(ts), p);
  })();
  return byBucket.size;
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function putSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// ---- kraken trades -> hourly candles ----------------------------------------

// Trades rows: [price, volume, time(sec.float), ...] in ascending order; the
// close of an hour is its last trade.
function aggregateTradesToHours(trades) {
  const byHour = new Map();
  for (const t of trades) {
    const price = Number(t[0]);
    const ts = Number(t[2]) * 1000;
    if (price > 0 && ts > 0) byHour.set(hourBucket(ts), price);
  }
  return byHour;
}

const backfillJobs = new Map(); // id -> jobId (in-flight kraken-trades rebuilds)

function startKrakenTradesBackfill(id, pairKey, depthDays) {
  if (backfillJobs.has(id)) {
    const job = getJob(backfillJobs.get(id));
    if (job && job.status === 'running') return backfillJobs.get(id);
  }
  const jobId = startJob('hourly-backfill', null, async (setProgress) => {
    const cursorKey = `hourlybf_${id}`;
    let cursor = getSetting(cursorKey) || String((Date.now() - depthDays * DAY_MS) * 1e6);
    let pages = 0;
    let stored = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (; pages < 20000; pages++) {
      const { trades, last } = await kraken.tradesPage(pairKey, cursor);
      if (trades.length > 0) stored += store(id, aggregateTradesToHours(trades));
      if (!last || last === cursor || trades.length === 0) break;
      cursor = last;
      if (pages % 25 === 0) {
        putSetting(cursorKey, cursor);
        setProgress(`${id}: page ${pages}, ${stored} candles, cursor ${new Date(Number(cursor) / 1e6).toISOString().slice(0, 10)}`);
      }
      if (Number(cursor) / 1e6 >= Date.now() - HOUR_MS) break; // caught up
      await sleep(KRAKEN_TRADES_THROTTLE_MS);
    }
    putSetting(cursorKey, cursor);
    return { result: { id, pairKey, pages, stored }, params: { id, pairKey, depthDays } };
  });
  backfillJobs.set(id, jobId);
  return jobId;
}

// ---- source resolution ------------------------------------------------------

async function resolveSource(id, symbol) {
  const key = `hourlysrc_${id}`;
  const stored = getSetting(key);
  if (stored) return stored;
  const code = fiatCode(id);
  if (config.exchangeMarketData) {
    try {
      const books = await bitso.availableBooks();
      const book = code ? `usd_${code}` : `${symbol.toLowerCase()}_usd`;
      if (books.includes(book)) {
        putSetting(key, `bitso:${book}`);
        return `bitso:${book}`;
      }
    } catch {}
    if (!code) {
      try {
        const bSym = await binance.symbolExists(symbol);
        if (bSym) {
          putSetting(key, `binance:${bSym}`);
          return `binance:${bSym}`;
        }
      } catch {}
      try {
        const pair = await kraken.pairForSymbol(symbol);
        if (pair) {
          putSetting(key, `kraken-trades:${pair}`);
          return `kraken-trades:${pair}`;
        }
      } catch {}
    }
  }
  if (!code) {
    putSetting(key, 'coingecko');
    return 'coingecko';
  }
  return 'none'; // fiat with no usd_<code> book: daily cache only (not persisted — a book may appear)
}

// Ensure the hourly cache holds ~depthDays for one asset; top up if stale.
// Returns {source, status: 'ok'|'backfilling'|'none', rows, coverageHours}.
async function ensureHourly(id, symbol, { depthDays = DEFAULT_DEPTH_DAYS } = {}) {
  if (id === 'usd' || id === 'fiat:usd') return { source: 'unit', status: 'ok', rows: 0 };
  const source = await resolveSource(id, symbol);
  const latest = latestTs(id);
  const targetStart = Date.now() - depthDays * DAY_MS;
  const since = latest != null ? Math.max(latest, targetStart) : targetStart;
  let rows = 0;
  let status = 'ok';

  try {
    if (source.startsWith('bitso:')) {
      const [, book] = source.split(':');
      rows = store(id, await bitso.hourlyCloses(book, since, { invert: Boolean(fiatCode(id)) }));
    } else if (source.startsWith('binance:')) {
      const [, bSym] = source.split(':');
      // Fresh series or a gap of more than ~40 days needs the monthly zips;
      // otherwise the REST mirror tops up in one or two calls.
      rows =
        latest == null || Date.now() - latest > 40 * DAY_MS
          ? store(id, await binance.backfillCloses(bSym, since))
          : store(id, await binance.recentCloses(bSym, since));
    } else if (source.startsWith('kraken-trades:')) {
      const [, pairKey] = source.split(':');
      // Recent 30 days arrive instantly from OHLC; depth rebuilds from raw
      // trades in the background.
      rows = store(id, await kraken.hourlyCloses(pairKey, since));
      const oldest = db.prepare('SELECT MIN(ts) AS ts FROM hourly_prices WHERE coingecko_id = ?').get(id);
      if (!oldest.ts || oldest.ts > targetStart + 2 * DAY_MS) {
        startKrakenTradesBackfill(id, pairKey, depthDays);
        status = 'backfilling';
      }
    } else if (source === 'coingecko') {
      const behindDays = latest != null ? Math.ceil((Date.now() - latest) / DAY_MS) + 1 : CG_HOURLY_MAX_DAYS;
      const days = Math.min(Math.max(behindDays, 2), CG_HOURLY_MAX_DAYS);
      const body = await getJson(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`);
      const byHour = new Map();
      for (const [ms, p] of body.prices || []) if (p > 0) byHour.set(hourBucket(ms), p);
      rows = store(id, byHour);
    } else {
      status = 'none';
    }
  } catch (err) {
    console.error(`hourly ensure failed for ${id} via ${source}:`, err.message);
    status = latestTs(id) != null ? 'ok' : 'none'; // stale-but-present beats nothing
  }

  const n = db.prepare('SELECT COUNT(*) AS n FROM hourly_prices WHERE coingecko_id = ?').get(id).n;
  return { source, status, rows, coverageHours: n };
}

// Daily collector (scheduler): keep every active asset's hourly series
// current through its persisted source. Self-gates to ~once a day.
function collectDue() {
  const last = Number(getSetting('hourly_collected_at') || 0);
  return Date.now() - last >= 22 * 3600e3;
}

async function collectHourly() {
  const assets = db
    .prepare(
      "SELECT DISTINCT coingecko_id, symbol FROM assets WHERE (target_pct > 0 OR is_index = 1 OR quantity > 0) AND coingecko_id NOT IN ('usd','fiat:usd')"
    )
    .all();
  const results = [];
  for (const a of assets) {
    results.push({ id: a.coingecko_id, ...(await ensureHourly(a.coingecko_id, a.symbol)) });
  }
  putSetting('hourly_collected_at', Date.now());
  return results;
}

// Series reader for the hourly backtests. USD is the unit: constant 1.
function getHourlySeries(id, hours) {
  if (id === 'usd' || id === 'fiat:usd') {
    const now = hourBucket(Date.now());
    const out = [];
    for (let i = hours - 1; i >= 0; i--) out.push({ ts: now - i * HOUR_MS, usd_price: 1 });
    return out;
  }
  const since = hourBucket(Date.now()) - (hours - 1) * HOUR_MS;
  return db
    .prepare('SELECT ts, usd_price FROM hourly_prices WHERE coingecko_id = ? AND ts >= ? ORDER BY ts')
    .all(id, since);
}

function hourlyStatus() {
  return db
    .prepare(
      'SELECT coingecko_id, COUNT(*) AS hours, MIN(ts) AS oldest, MAX(ts) AS newest FROM hourly_prices GROUP BY coingecko_id ORDER BY coingecko_id'
    )
    .all()
    .map((r) => ({ ...r, source: getSetting(`hourlysrc_${r.coingecko_id}`) || 'unknown' }));
}

module.exports = {
  ensureHourly,
  collectHourly,
  collectDue,
  getHourlySeries,
  hourlyStatus,
  aggregateTradesToHours,
  hourBucket,
};
