// Phase 2.9 deep-daily layer: getDailyHistory routes >720d requests through
// Binance/KuCoin (data-only), merges KuCoin to keep the tail current, and
// falls back cleanly. Venue modules + CG stubbed — no network.
process.env.EXCHANGE_MARKET_DATA = 'on';
const { freshDb, ok, approx } = require('./helpers');
freshDb('deepdata');

const cg = require('../lib/cg');
let cgCalls = [];
let cgReturn = null; // set to a payload to allow CG; null = should not be hit
cg.getJson = async (p) => {
  cgCalls.push(p);
  if (cgReturn) return cgReturn;
  throw new Error('CG should not be hit for a deep-covered coin');
};

const binance = require('../lib/exchanges/binance');
const kucoin = require('../lib/exchanges/kucoin');
const kraken = require('../lib/exchanges/kraken');
const bitso = require('../lib/exchanges/bitso');

const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY) * DAY;
const mkSeries = (fromDaysAgo, toDaysAgo, base) => {
  const m = new Map();
  for (let d = fromDaysAgo; d >= toDaysAgo; d--) m.set(today - d * DAY, base + (fromDaysAgo - d) * 0.01);
  return m;
};

// Binance: 4y deep but head lags ~15 days (portal zip lag).
binance.symbolExists = async (s) => (s.toLowerCase() === 'sol' ? 'SOLUSDT' : null);
binance.dailyClosesDeep = async () => mkSeries(1460, 15, 100);
// KuCoin: reaches today; also the sole source for a Binance-less coin.
kucoin.symbolExists = async (s) => ['sol', 'kcsonly'].includes(s.toLowerCase());
kucoin.dailyCloses = async (sym, since) => {
  if (sym.toLowerCase() === 'kcsonly') return mkSeries(1460, 0, 5);
  return mkSeries(20, 0, 114); // recent tail top-up
};
// Regular exchange layer (Kraken/Bitso) not needed here.
kraken.pairForSymbol = async () => null;
bitso.availableBooks = async () => [];

const history = require('../lib/history');

(async () => {
  // --- deep coin on Binance, tail healed by KuCoin, zero CG ---
  cgCalls = [];
  let rows = await history.getDailyHistory('solana', 1460, 'sol');
  ok(cgCalls.length === 0, 'deep-covered coin makes zero CoinGecko calls');
  ok(rows.length >= 1400, `~4y of daily bars returned (${rows.length})`);
  const span = (rows[rows.length - 1].ts - rows[0].ts) / DAY;
  ok(span >= 1400, `series spans ~4 years (${Math.round(span)} days)`);
  ok(rows[rows.length - 1].ts >= today - 2 * DAY, 'tail is current (KuCoin healed the Binance zip lag)');

  // --- Binance-less coin served wholly by KuCoin ---
  cgCalls = [];
  rows = await history.getDailyHistory('kcs-only-coin', 1460, 'kcsonly');
  ok(rows.length >= 1400 && cgCalls.length === 0, 'KuCoin-only coin gets full deep history, zero CG');

  // --- a coin neither venue has: deep fetch returns nothing, falls to CG ---
  cgReturn = { prices: [[today - DAY, 2], [today, 2.1]] };
  cgCalls = [];
  rows = await history.getDailyHistory('obscure-coin', 1460, 'obs');
  ok(cgCalls.length >= 1, 'coin with no deep source falls back to CoinGecko');

  console.log('deep-data layer tests pass');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
