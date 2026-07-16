const config = require('./config');

// Pricing provider: CoinGecko. Returns USD prices for a list of coin ids.
// The "index asset" of a profile is either 'usd' or another coin id;
// relative prices are computed as usd(asset) / usd(index).

function headers() {
  const h = { accept: 'application/json' };
  if (config.coingeckoApiKey) h['x-cg-demo-api-key'] = config.coingeckoApiKey;
  return h;
}

async function fetchUsdPrices(coinIds) {
  const ids = [...new Set(coinIds.filter((id) => id && id !== 'usd'))];
  if (ids.length === 0) return {};
  const prices = {};
  // CoinGecko caps URL length; chunk to stay well under it.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = `${config.coingeckoBase}/simple/price?ids=${encodeURIComponent(chunk.join(','))}&vs_currencies=usd`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      throw new Error(`CoinGecko ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const body = await res.json();
    for (const [id, val] of Object.entries(body)) {
      if (val && typeof val.usd === 'number') prices[id] = val.usd;
    }
  }
  return prices;
}

async function searchCoins(query) {
  const url = `${config.coingeckoBase}/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`CoinGecko search ${res.status}`);
  const body = await res.json();
  return (body.coins || []).slice(0, 15).map((c) => ({
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    rank: c.market_cap_rank,
  }));
}

module.exports = { fetchUsdPrices, searchCoins };
