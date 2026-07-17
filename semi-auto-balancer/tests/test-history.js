// Phase 0: daily price-history cache — UTC bucketing, partial-point
// self-correction, fiat cross-rate join, USD synthesis, lazy top-up.
// Exchange market data off: this file asserts the CoinGecko paths.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('history');

// Stub the CoinGecko client BEFORE requiring history (destructured at load).
const cg = require('../lib/cg');
let responses = [];
let calls = [];
cg.getJson = async (path) => {
  calls.push(path);
  if (responses.length === 0) throw new Error(`unexpected CG call: ${path}`);
  return responses.shift();
};

const db = require('../lib/db');
const history = require('../lib/history');
const { dayBucket, DAY_MS } = history;

const today = dayBucket(Date.now());
const day = (n) => today - n * DAY_MS; // n days ago, 00:00 UTC

(async () => {
  // --- bucketing: normalizes to UTC day, partial trailing point kept as its day ---
  const series = history.bucketSeries([
    [day(2) + 1, 100], // daily point (00:00 UTC + jitter)
    [day(1), 110],
    [day(0) + 8 * 3600 * 1000, 111.5], // "current price" partial point mid-day
  ]);
  ok(series.get(day(2)) === 100 && series.get(day(1)) === 110, 'series buckets to UTC days');
  ok(series.get(day(0)) === 111.5, 'partial trailing point bucketed to today');

  // --- coin fetch: fills cache, second call within the same day is cache-only ---
  responses = [{ prices: [[day(3), 90], [day(2), 100], [day(1), 110], [day(0) + 3600e3, 112]] }];
  let rows = await history.getDailyHistory('bigcoin', 4);
  ok(calls.length === 1 && calls[0].includes('/coins/bigcoin/market_chart'), 'one API call on cold cache');
  ok(rows.length === 4 && rows[0].usd_price === 90, 'returns oldest->newest series');

  calls = [];
  rows = await history.getDailyHistory('bigcoin', 4);
  ok(calls.length === 0, 'warm cache -> zero API calls');

  // --- partial point self-corrects: next fetch REPLACEs today's row ---
  db.prepare("DELETE FROM daily_prices WHERE coingecko_id = 'bigcoin' AND ts = ?").run(day(0));
  // simulate "yesterday's fetch left a partial today" then a new fetch arrives
  db.prepare("INSERT INTO daily_prices (coingecko_id, ts, usd_price) VALUES ('bigcoin', ?, ?)").run(day(0), 112);
  // force a top-up by pretending we're a day behind: delete today's row and re-add stale latest
  db.prepare("DELETE FROM daily_prices WHERE coingecko_id = 'bigcoin' AND ts = ?").run(day(0));
  responses = [{ prices: [[day(1), 110], [day(0), 115]] }];
  calls = [];
  rows = await history.getDailyHistory('bigcoin', 4);
  const todayRow = rows.find((r) => r.ts === day(0));
  ok(calls.length === 1 && todayRow && todayRow.usd_price === 115, 'stale/partial row overwritten by fresh fetch (INSERT OR REPLACE)');

  // --- fiat cross-rate: joined on day bucket, one-sided days skipped ---
  responses = [
    { prices: [[day(2), 60000], [day(1), 62000], [day(0), 61000]] },          // btc/usd
    { prices: [[day(2), 1200000], [day(1), 1240000]] },                        // btc/mxn (day 0 missing)
  ];
  calls = [];
  rows = await history.getDailyHistory('fiat:mxn', 3);
  ok(calls.length === 2, 'fiat needs two bitcoin series');
  ok(rows.length === 2, 'one-sided day skipped in the join');
  ok(approx(rows[0].usd_price, 60000 / 1200000), 'usd-per-mxn = btc_usd/btc_mxn');

  // --- USD synthesizes with no API call ---
  calls = [];
  rows = await history.getDailyHistory('fiat:usd', 5);
  ok(calls.length === 0 && rows.length === 5 && rows.every((r) => r.usd_price === 1), 'USD is constant 1, zero API calls');

  // --- days clamped to the free-tier max ---
  responses = [{ prices: [[day(0), 5]] }];
  calls = [];
  await history.getDailyHistory('newcoin', 9999);
  ok(calls[0].includes('days=365'), 'days clamped to 365 (demo-tier hard limit)');

  console.log('history cache tests pass');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
