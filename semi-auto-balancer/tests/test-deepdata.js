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

  // --- deep FIAT cross: a fiat index is otherwise capped at ~2y, but Bitso's
  // own usd_<code> book serves the multi-year span. mxn deep, ars short. ---
  const mkFiat = (fromDaysAgo, toDaysAgo, base) => {
    const m = new Map();
    for (let d = fromDaysAgo; d >= toDaysAgo; d--) m.set(today - d * DAY, base + (fromDaysAgo - d) * 1e-6);
    return m;
  };
  bitso.dailyCloses = async (book) => {
    if (book === 'usd_mxn') return mkFiat(1750, 0, 0.05); // ~4.8y deep
    if (book === 'usd_ars') return mkFiat(700, 0, 0.001); // only ~2y real
    return new Map();
  };
  cgReturn = null;
  cgCalls = [];
  rows = await history.getDailyHistory('fiat:mxn', 1460);
  ok(cgCalls.length === 0, 'deep fiat cross uses the Bitso book, zero CG');
  ok(rows.length >= 1400, `fiat cross returns ~4y of daily bars (${rows.length})`);
  ok(rows.every((r) => !r.synthetic), 'no synthetic needed when the book is deep');
  const mspan = (rows[rows.length - 1].ts - rows[0].ts) / DAY;
  ok(mspan >= 1400, `deep fiat spans ~4 years (${Math.round(mspan)} days)`);

  // --- synthetic backfill: a SHORT real book is padded flat back to the
  // window start so the cross never LIMITS the window ---
  cgReturn = null;
  cgCalls = [];
  rows = await history.getDailyHistory('fiat:ars', 1460);
  const aspan = (rows[rows.length - 1].ts - rows[0].ts) / DAY;
  ok(aspan >= 1400, `short book synthetically extended to the full window (${Math.round(aspan)} days)`);
  ok(rows[0].synthetic === true, 'the oldest days are synthetic (flat backfill)');
  const firstReal = rows.find((r) => !r.synthetic);
  ok(firstReal && rows.filter((r) => !r.synthetic).length >= 650, 'the recent ~2y remain real');
  ok(approx(rows[0].usd_price, firstReal.usd_price), 'synthetic tail holds the earliest real rate flat');
  ok(rows.every((r, i) => i === 0 || r.ts > rows[i - 1].ts), 'series stays strictly increasing in time');

  // --- rebrand splice: POL (listed only at the 2024-09 migration) inherits
  // MATIC's deep history, spliced at the migration date after a continuity
  // check. Flat 0.5 on both sides → seamless boundary. ---
  const constSeries = (fromDaysAgo, toDaysAgo, val) => {
    const m = new Map();
    for (let d = fromDaysAgo; d >= toDaysAgo; d--) m.set(today - d * DAY, val);
    return m;
  };
  const migrationDaysAgo = Math.round((today - Date.UTC(2024, 8, 4)) / DAY); // 2024-09-04
  binance.symbolExists = async (s) => ({ pol: 'POLUSDT', matic: 'MATICUSDT' })[s.toLowerCase()] || null;
  binance.dailyClosesDeep = async (sym) => {
    const s = sym.toLowerCase();
    if (s === 'matic') return constSeries(1460, 0, 0.5); // deep predecessor
    if (s === 'pol') return constSeries(migrationDaysAgo, 0, 0.5); // POL only since migration
    return new Map();
  };
  kucoin.symbolExists = async () => false;
  cgReturn = null;
  cgCalls = [];
  rows = await history.getDailyHistory('polygon-ecosystem-token', 1460, 'pol');
  const rbSpan = (rows[rows.length - 1].ts - rows[0].ts) / DAY;
  ok(rbSpan >= 1400, `POL series spliced back through MATIC to ~4 years (${Math.round(rbSpan)} days)`);
  ok(cgCalls.length === 0, 'rebrand splice used exchange data, zero CG');
  ok(rows.every((r) => Math.abs(r.usd_price - 0.5) < 1e-9), 'spliced series is continuous (no boundary break)');
  ok(rows.every((r, i) => i === 0 || r.ts > rows[i - 1].ts), 'spliced series strictly increasing, no gaps at the migration');

  // --- stablecoin flat backfill (variance-gated): a COIN whose known series
  // is demonstrably flat (a stable tether with no deep source) extends flat to
  // the window; a volatile coin with the same shallow depth NEVER does. ---
  binance.symbolExists = async () => null;
  kucoin.symbolExists = async () => false;
  cgReturn = { prices: Array.from({ length: 400 }, (_, i) => [today - (399 - i) * DAY, 0.999 + 0.004 * ((i % 9) / 9)]) };
  rows = await history.getDailyHistory('stable-tether-coin', 1460, 'stc');
  const sspan = (rows[rows.length - 1].ts - rows[0].ts) / DAY;
  ok(sspan >= 1400, `flat coin series extends to the full window (${Math.round(sspan)}d)`);
  ok(rows[0].synthetic === true && rows.filter((r) => !r.synthetic).length >= 350, 'old span synthetic, recent span real');
  cgReturn = { prices: Array.from({ length: 400 }, (_, i) => [today - (399 - i) * DAY, 100 * (1 + 0.5 * Math.sin(i / 20))]) };
  rows = await history.getDailyHistory('volatile-shallow-coin', 1460, 'vsc');
  ok((rows[rows.length - 1].ts - rows[0].ts) / DAY < 1400, 'a volatile shallow coin is NEVER synthetically extended');
  ok(rows.every((r) => !r.synthetic), 'no synthetic rows for the volatile coin');

  // --- INTERNAL gap fill (the live USDC failure): a stitched stable series
  // with missing candle days inside its span gets those days filled with the
  // previous close, so it can't fall under buildBars' 97% coverage bar and
  // drop the tether. Volatile series keep their gaps untouched. ---
  cgReturn = {
    // USDC-shaped: mostly $1, a real 10-day depeg to ~$0.88 (Mar-2023 style),
    // and ~11% of days knocked out — the exact live failure shape.
    prices: Array.from({ length: 1400 }, (_, i) => [
      today - (1399 - i) * DAY,
      i >= 700 && i < 710 ? 0.88 + 0.01 * (i - 700) : 1.0 + (0.002 * (i % 5)) / 5,
    ]).filter((_, i) => i % 9 !== 3),
  };
  rows = await history.getDailyHistory('gappy-stable-coin', 1460, 'gsc');
  const gapSpanDays = Math.round((rows[rows.length - 1].ts - rows[0].ts) / DAY) + 1;
  ok(rows.length === gapSpanDays, `stable series internal gaps filled despite a depeg episode (${rows.length} rows over ${gapSpanDays} days)`);
  ok(rows.every((r, i) => i === 0 || r.ts - rows[i - 1].ts === DAY), 'filled series has a row every single day');
  const synth = rows.filter((r) => r.synthetic);
  ok(synth.length > 100, `the knocked-out days are synthetic (${synth.length})`);
  ok(rows.some((r) => !r.synthetic && r.usd_price < 0.95), 'the real depeg days survive untouched in the filled series');
  cgReturn = {
    prices: Array.from({ length: 1400 }, (_, i) => [today - (1399 - i) * DAY, 100 * (1 + 0.5 * Math.sin(i / 20))])
      .filter((_, i) => i % 9 !== 3),
  };
  rows = await history.getDailyHistory('gappy-volatile-coin', 1460, 'gvc');
  ok(rows.some((r, i) => i > 0 && r.ts - rows[i - 1].ts > DAY), 'a volatile series keeps its gaps (no fabricated prices)');

  // --- idealize-tether helper: constant $1 only for USD-stable series ---
  const stableRows = Array.from({ length: 200 }, (_, i) => ({ ts: today - (199 - i) * DAY, usd_price: 0.999 + 0.002 * (i % 2) }));
  const ideal = history.idealTetherSeries(stableRows, 1460);
  ok(ideal && ideal.length === 1460 && ideal.every((r) => r.usd_price === 1 && r.synthetic), 'stable tether idealizes to a constant $1 full-window series');
  ok(history.idealTetherSeries(stableRows, 48, Date.now(), 'hourly').length === 48 * 24, 'hourly idealization buckets by hour');
  const mxnish = Array.from({ length: 200 }, (_, i) => ({ ts: today - (199 - i) * DAY, usd_price: 0.055 + 0.001 * (i % 3) }));
  ok(history.idealTetherSeries(mxnish, 1460) === null, 'a non-USD-stable tether (MXN-like) REFUSES idealization');
  const volatile = Array.from({ length: 200 }, (_, i) => ({ ts: today - (199 - i) * DAY, usd_price: 1 + 0.5 * Math.sin(i / 10) }));
  ok(history.idealTetherSeries(volatile, 1460) === null, 'a volatile series refuses idealization too');

  console.log('deep-data layer tests pass');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
