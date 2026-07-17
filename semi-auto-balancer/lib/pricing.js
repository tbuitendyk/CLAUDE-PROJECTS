
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

// USD price for every requested id — coin ids and fiat ids alike. Fiat
// entries are keyed under both their 'fiat:xxx' and bare forms.
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

  // CoinGecko caps URL length; chunk to stay well under it.
  for (let i = 0; i < coinIds.length; i += 100) {
    const chunk = coinIds.slice(i, i + 100);
    const body = await getJson(
      `/simple/price?ids=${encodeURIComponent(chunk.join(','))}&vs_currencies=usd`
    );
    for (const [id, val] of Object.entries(body)) {
      if (val && typeof val.usd === 'number') prices[id] = val.usd;
    }
  }

  // Cross-rate the fiats through bitcoin in one extra request.
  const nonUsd = [...fiats].filter((c) => c !== 'usd');
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

async function searchCoins(query) {
  const body = await getJson(`/search?query=${encodeURIComponent(query)}`);
  return (body.coins || []).slice(0, 15).map((c) => ({
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    rank: c.market_cap_rank,
  }));
}

module.exports = { fetchUsdPrices, searchCoins, supportedFiats, fiatCode };
