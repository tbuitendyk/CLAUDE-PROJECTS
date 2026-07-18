const { getJson } = require('./cg');
const { getDailyHistory } = require('./history');

// Candidate universe for the composition search (and later the Phase 5
// scanner): CoinGecko top-100 by market cap, minus stablecoins and wrapped/
// staked derivatives. CG is deliberately the sole pricing source for
// candidates — a scored universe needs one uniform source (PLAN). History
// flows through the shared daily cache, so a full refresh costs at most one
// CG call per candidate per day and nothing at all once warm.

// Name/symbol heuristics on top of the category filters: pegged and
// derivative assets have no harvestable identity of their own.
const NAME_EXCLUDE = /usd|usde?|dai|tether|wrapped|staked|restaked|bridged|peg|frax|eur[tcs]?\b|gyen|pax|cbeth|wbtc|weth|steth|reth/i;

async function topCandidates({ count = 40 } = {}) {
  const markets = await getJson(
    '/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1'
  );
  // The markets payload has no per-coin category field — exclusion works via
  // two category-filtered calls (PLAN Phase 5 design), plus the heuristics.
  const excluded = new Set();
  for (const cat of ['stablecoins', 'wrapped-tokens']) {
    try {
      const rows = await getJson(
        `/coins/markets?vs_currency=usd&category=${cat}&order=market_cap_desc&per_page=250&page=1`
      );
      for (const r of rows) excluded.add(r.id);
    } catch {
      /* category call failing just means heuristics carry the load */
    }
  }
  const out = [];
  for (const m of markets || []) {
    if (excluded.has(m.id)) continue;
    if (NAME_EXCLUDE.test(m.name || '') || NAME_EXCLUDE.test(m.symbol || '')) continue;
    out.push({ id: m.id, symbol: (m.symbol || '').toLowerCase(), name: m.name, rank: m.market_cap_rank });
    if (out.length >= count) break;
  }
  return out;
}

// Fetch daily history for a candidate list through the cache, keeping only
// those with (near-)complete coverage of the evaluation window — "real
// history" means the whole window, so every mix is judged on the same bars.
// Small gaps (illiquid days) are tolerated up to missTolerance.
async function candidateSeries(ids, days, { missTolerance = 0.03, setProgress = () => {} } = {}) {
  const series = new Map();
  let i = 0;
  for (const id of ids) {
    setProgress(`history ${++i}/${ids.length}: ${id}`);
    try {
      const rows = await getDailyHistory(id, days);
      series.set(id, rows);
    } catch (err) {
      console.error(`candidate history failed for ${id}:`, err.message);
    }
  }
  return series;
}

module.exports = { topCandidates, candidateSeries, NAME_EXCLUDE };
