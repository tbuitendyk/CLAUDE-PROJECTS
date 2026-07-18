// Phase 1.5 exchange-first market data: held assets price from Kraken/Bitso
// public endpoints with zero CoinGecko calls; anything the exchanges can't
// serve falls back to CG; daily history tops up from the exchange layer.
// Venue modules are stubbed — no network.
const { freshDb, ok, approx } = require('./helpers');
freshDb('exsource');

// Trap every CoinGecko call so fallback behavior is provable.
const cg = require('../lib/cg');
let cgCalls = [];
let cgResponses = [];
cg.getJson = async (path) => {
  cgCalls.push(path);
  if (cgResponses.length === 0) throw new Error(`unexpected CG call: ${path}`);
  return cgResponses.shift();
};

const kraken = require('../lib/exchanges/kraken');
const bitso = require('../lib/exchanges/bitso');
const DAY_MS = 86_400_000;
const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;

// Stub the venue market-data surface exsource consumes.
kraken.pairForSymbol = async (sym) => (sym === 'btc' ? 'XXBTZUSD' : null);
kraken.tickerUsd = async (pairs) => (pairs.includes('XXBTZUSD') ? { XXBTZUSD: 61234 } : {});
kraken.dailyCloses = async () => new Map([ [today - DAY_MS, 60000], [today, 61000] ]);
bitso.usdFiatRate = async (code) => (code === 'mxn' ? 0.055 : null);
bitso.dailyCloses = async (book, since, opts) =>
  book === 'usd_mxn' ? new Map([ [today - DAY_MS, opts && opts.invert ? 1 / 18.2 : 18.2], [today, opts && opts.invert ? 1 / 18.0 : 18.0] ]) : new Map();

const db = require('../lib/db');
const pricing = require('../lib/pricing');
const history = require('../lib/history');

(async () => {
  // Held assets are the population exchange pricing covers (symbol lookup).
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 5, 15, 0)").run();
  db.prepare(
    "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct) VALUES (1, 'bitcoin', 'btc', 1, 50), (1, 'fiat:mxn', 'mxn', 0, 50)"
  ).run();

  // --- live pricing: exchange serves everything -> zero CG calls ---
  cgCalls = [];
  let prices = await pricing.fetchUsdPrices(['bitcoin', 'fiat:mxn']);
  ok(cgCalls.length === 0, 'exchange-covered poll makes zero CoinGecko calls');
  ok(approx(prices.bitcoin, 61234), 'coin priced from the Kraken ticker');
  ok(approx(prices['fiat:mxn'], 0.055) && approx(prices.mxn, 0.055), 'fiat priced from the Bitso usd_mxn book (both key forms)');

  // --- fallback: an unheld/unlisted coin falls through to CG ---
  cgCalls = [];
  cgResponses = [{ weirdcoin: { usd: 5 } }];
  prices = await pricing.fetchUsdPrices(['bitcoin', 'weirdcoin']);
  ok(approx(prices.bitcoin, 61234) && approx(prices.weirdcoin, 5), 'exchange + CG prices merge');
  ok(cgCalls.length === 1 && cgCalls[0].includes('weirdcoin') && !cgCalls[0].includes('bitcoin'), 'only the uncovered coin hits CoinGecko');

  // --- daily history tops up from the exchange layer, zero CG calls ---
  cgCalls = [];
  let rows = await history.getDailyHistory('bitcoin', 5);
  ok(cgCalls.length === 0, 'coin history topped up from Kraken OHLC, zero CG calls');
  ok(rows.length === 2 && approx(rows[1].usd_price, 61000), 'kraken daily closes land in the cache');

  cgCalls = [];
  rows = await history.getDailyHistory('fiat:mxn', 5);
  ok(cgCalls.length === 0, 'fiat history topped up from the Bitso usd_mxn book, zero CG calls');
  ok(approx(rows[1].usd_price, 1 / 18.0), 'fiat series stored as USD-per-MXN (inverted book rate)');

  // --- an id with no exchange source falls back to the CG history path ---
  cgCalls = [];
  cgResponses = [{ prices: [[today - DAY_MS, 2.5], [today, 2.6]] }];
  rows = await history.getDailyHistory('unlisted-coin', 5);
  ok(cgCalls.length === 1 && cgCalls[0].includes('unlisted-coin'), 'uncovered coin history falls back to CoinGecko');
  ok(rows.length === 2 && approx(rows[1].usd_price, 2.6), 'CG fallback series cached and returned');

  // --- fresh-but-shallow series DEEPEN via the exchange (the 365d-cap trap):
  // bitcoin sits cached at 2 days; asking for 6 must refetch the window, not
  // conclude "head is fresh, nothing to do" ---
  kraken.dailyCloses = async (pair, since) =>
    new Map(Array.from({ length: 6 }, (_, i) => [today - (5 - i) * DAY_MS, 50000 + i]));
  cgCalls = [];
  rows = await history.getDailyHistory('bitcoin', 6);
  ok(rows.length === 6 && cgCalls.length === 0, 'shallow tail triggers an exchange deepen, zero CG calls');

  // --- unheld candidates route through the exchange via the symbol hint ---
  kraken.pairForSymbol = async (sym) => (sym === 'newby' ? 'NEWBYUSD' : null);
  kraken.dailyCloses = async () => new Map([[today - DAY_MS, 7], [today, 7.5]]);
  cgCalls = [];
  rows = await history.getDailyHistory('brand-new-coin', 5, 'newby');
  ok(rows.length === 2 && cgCalls.length === 0 && approx(rows[1].usd_price, 7.5), 'symbol hint serves unheld candidates from the venue');

  console.log('exsource tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
