
// Pricing provider: CoinGecko, for coins AND fiat currencies from the same
// source. Coins are quoted directly in USD. Fiat holdings are stored with a
// 'fiat:' prefix (e.g. 'fiat:cad') and priced via a cross-rate: bitcoin is
// fetched in USD plus each needed fiat, and USD-per-CAD = btc_usd / btc_cad.
// Bare fiat codes (e.g. an index_asset of 'cad') are also recognized.

// Snapshot of CoinGecko's supported vs_currencies (fiat + metals); the live
// list is fetched (and cached) for validation when adding fiat assets.
const FIAT_CODES = new Set([
  'usd', 'aed', 'ars', 'aud', 'bdt', 'bhd', 'bmd', 'brl', 'cad', 'chf', 'clp',
  'cny', 'czk', 'dkk', 'eur', 'gbp', 'gel', 'hkd', 'huf', 'idr', 'ils', 'inr',
  'jpy', 'krw', 'kwd', 'lkr', 'mmk', 'mxn', 'myr', 'ngn', 'nok', 'nzd', 'php',
  'pkr', 'pln', 'rub', 'sar', 'sek', 'sgd', 'thb', 'try', 'twd', 'uah', 'vef',
  'vnd', 'zar', 'xdr', 'xag', 'xau',
]);

// Returns the fiat currency code for an asset/index id, or null if it's a
// coin. 'fiat:xxx' is always fiat; bare codes are fiat when on the list.
function fiatCode(id) {
  if (!id) return null;
  if (id.startsWith('fiat:')) return id.slice(5).toLowerCase();
  if (FIAT_CODES.has(id.toLowerCase())) return id.toLowerCase();
  return null;
}

// All CoinGecko traffic goes through the shared rate-limited, quota-ledgered
// client so bursts from any feature can't starve the others.
const { getJson } = require('./cg');
const exsource = require('./exsource');

// USD price for every requested id — coin ids and fiat ids alike. Fiat
// entries are keyed under both their 'fiat:xxx' and bare forms.
// Phase 1.5: held assets are priced from exchange public tickers first
// (Kraken SYM/USD, Bitso usd_<fiat>); only what the exchanges can't serve
// falls through to CoinGecko, cutting steady-state quota use.
async function fetchUsdPrices(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const coinIds = [];
  const fiats = new Set();
  for (const id of unique) {
    const code = fiatCode(id);
    if (code) fiats.add(code);
    else coinIds.push(id);
  }

  const prices = { usd: 1, 'fiat:usd': 1 };

  let exPrices = {};
  try {
    exPrices = await exsource.usdPrices(coinIds, [...fiats]);
  } catch {
    /* exchange pricing is best-effort; CoinGecko covers everything below */
  }
  Object.assign(prices, exPrices);
  const cgCoinIds = coinIds.filter((id) => !(prices[id] > 0));

  // CoinGecko caps URL length; chunk to stay well under it.
  for (let i = 0; i < cgCoinIds.length; i += 100) {
    const chunk = cgCoinIds.slice(i, i + 100);
    const body = await getJson(
      `/simple/price?ids=${encodeURIComponent(chunk.join(','))}&vs_currencies=usd`
    );
    for (const [id, val] of Object.entries(body)) {
      if (val && typeof val.usd === 'number') prices[id] = val.usd;
    }
  }

  // Cross-rate the remaining fiats through bitcoin in one extra request.
  const nonUsd = [...fiats].filter((c) => c !== 'usd' && !(prices[`fiat:${c}`] > 0));
  if (nonUsd.length > 0) {
    const body = await getJson(
      `/simple/price?ids=bitcoin&vs_currencies=${encodeURIComponent(['usd', ...nonUsd].join(','))}`
    );
    const btc = body.bitcoin || {};
    for (const code of nonUsd) {
      if (typeof btc.usd === 'number' && typeof btc[code] === 'number' && btc[code] > 0) {
        const rate = btc.usd / btc[code]; // USD per 1 unit of fiat
        prices[`fiat:${code}`] = rate;
        prices[code] = rate;
      }
    }
  }
  return prices;
}

// Fiat codes available for adding as assets: CoinGecko's live vs-currency
// list (cached 1h) intersected with the fiat/metals snapshot -- the live
// list also contains crypto vs-currencies (btc, eth, ...) which belong in
// the coin search, not here.
let vsCache = { at: 0, list: null };
async function supportedFiats() {
  if (vsCache.list && Date.now() - vsCache.at < 60 * 60 * 1000) return vsCache.list;
  try {
    const body = await getJson(`/simple/supported_vs_currencies`);
    if (Array.isArray(body) && body.length > 0) {
      const live = new Set(body.map((c) => String(c).toLowerCase()));
      vsCache = { at: Date.now(), list: [...FIAT_CODES].filter((c) => live.has(c)).sort() };
      return vsCache.list;
    }
  } catch {
    /* fall through to snapshot */
  }
  return [...FIAT_CODES].sort();
}

// Coin search, LOCAL-FIRST: the CG /search endpoint rides the same throttled
// queue as polling and history backfills, so live searches were flaky —
// waiting behind the bucket or dying in a 429 backoff with nothing shown.
// Instead, keep a top-250 markets snapshot (refreshed lazily, ~1 quota call
// per half hour) and answer from it instantly; only fall through to the live
// CG /search when the local snapshot has too few matches (obscure coins), and
// serve stale-but-usable data sooner than nothing.
const MARKETS_TTL_MS = 30 * 60_000;
let marketsCache = { ts: 0, rows: [] };
let marketsInflight = null;

async function topMarketsSnapshot() {
  const fresh = Date.now() - marketsCache.ts < MARKETS_TTL_MS;
  if (fresh && marketsCache.rows.length) return marketsCache.rows;
  if (!marketsInflight) {
    marketsInflight = getJson('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1')
      .then((rows) => {
        if (Array.isArray(rows) && rows.length) marketsCache = { ts: Date.now(), rows };
        return marketsCache.rows;
      })
      .catch(() => marketsCache.rows) // keep stale on failure — stale beats silence
      .finally(() => {
        marketsInflight = null;
      });
  }
  // If we have anything cached, return it NOW and let the refresh land in the
  // background; only await when the cache is empty (first ever search).
  return marketsCache.rows.length ? marketsCache.rows : marketsInflight;
}

function localMatches(rows, q) {
  const needle = q.toLowerCase();
  const scored = [];
  for (const m of rows) {
    const sym = (m.symbol || '').toLowerCase();
    const name = (m.name || '').toLowerCase();
    let score = null;
    if (sym === needle) score = 0;
    else if (sym.startsWith(needle)) score = 1;
    else if (name.startsWith(needle)) score = 2;
    else if (name.includes(needle)) score = 3;
    if (score != null) scored.push({ score, rank: m.market_cap_rank || 9999, m });
  }
  scored.sort((a, b) => a.score - b.score || a.rank - b.rank);
  return scored.map(({ m }) => ({ id: m.id, symbol: m.symbol, name: m.name, rank: m.market_cap_rank }));
}

async function searchCoins(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const rows = await topMarketsSnapshot();
  const local = localMatches(rows, q).slice(0, 15);
  // Top-250 answers the overwhelming majority (USDC, majors) instantly and
  // reliably: an exact symbol hit or a healthy match count is a confident
  // answer. Only chase the throttled live search for thin/obscure queries.
  const needle = q.toLowerCase();
  const exact =
    local.length > 0 &&
    ((local[0].symbol || '').toLowerCase() === needle || (local[0].name || '').toLowerCase() === needle);
  if (exact || local.length >= 3) return local;
  try {
    const body = await getJson(`/search?query=${encodeURIComponent(q)}`);
    const live = (body.coins || []).slice(0, 15).map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      rank: c.market_cap_rank,
    }));
    // Merge: local (authoritative for majors) first, live fills the rest.
    const seen = new Set(local.map((c) => c.id));
    return [...local, ...live.filter((c) => !seen.has(c.id))].slice(0, 15);
  } catch {
    return local; // live search flaked — local results still beat nothing
  }
}

module.exports = { fetchUsdPrices, searchCoins, supportedFiats, fiatCode };
