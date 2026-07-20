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

// Commodity-backed tokens are NOT stablecoins: they track a real, diversifying
// price (gold/silver), so they belong in the harvest universe even though
// their names ("PAX Gold", "Tether Gold") trip the substring heuristics above
// (`pax`, `tether`). Exact-symbol allowlist, exempt from NAME_EXCLUDE only —
// the CoinGecko stablecoins/wrapped category filter still removes true pegs.
const COMMODITY_OK = /^(paxg|xaut|kau|kag|xaur|dgx)$/i;

// Cached candidate list: three CG calls per refresh (markets + two category
// filters) ride the SAME throttled queue as polling and any running search,
// so fetching fresh on every request made the pool collapse to held-only
// whenever the queue was busy. Refresh lazily at most every CANDIDATES_TTL;
// serve stale on failure — a half-hour-old top-100 beats a silently empty one.
const CANDIDATES_TTL_MS = 30 * 60_000;
let candidatesCache = { ts: 0, rows: [] };
let candidatesInflight = null;

async function fetchTopCandidatesFresh() {
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
    const sym = (m.symbol || '').toLowerCase();
    if (!COMMODITY_OK.test(sym) && (NAME_EXCLUDE.test(m.name || '') || NAME_EXCLUDE.test(sym))) continue;
    out.push({ id: m.id, symbol: sym, name: m.name, rank: m.market_cap_rank });
  }
  return out;
}

async function topCandidates({ count = 40 } = {}) {
  const fresh = Date.now() - candidatesCache.ts < CANDIDATES_TTL_MS;
  if (!fresh || !candidatesCache.rows.length) {
    if (!candidatesInflight) {
      candidatesInflight = fetchTopCandidatesFresh()
        .then((rows) => {
          if (rows.length) candidatesCache = { ts: Date.now(), rows };
          return rows;
        })
        .finally(() => {
          candidatesInflight = null;
        });
    }
    if (candidatesCache.rows.length) {
      // Serve stale NOW; the refresh lands in the background.
      candidatesInflight.catch(() => {});
    } else {
      // Nothing cached yet — this first call must wait (and may throw; the
      // caller's degrade path handles that).
      await candidatesInflight;
    }
  }
  return candidatesCache.rows.slice(0, count);
}

// Fetch daily history for a candidate list through the cache. Candidates
// carry their ticker symbol so the exchange layer can serve them DEEP
// history (Kraken ≈2y, Bitso multi-year) — without it they'd be stuck at
// CoinGecko's 365-day cap and flunk long evaluation windows. Gentle pacing
// between cold fetches keeps venue rate limiters friendly.
async function candidateSeries(candidates, days, { setProgress = () => {} } = {}) {
  const series = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let i = 0;
  for (const c of candidates) {
    setProgress(`history ${++i}/${candidates.length}: ${c.id}`);
    try {
      const rows = await getDailyHistory(c.id, days, c.symbol || null);
      series.set(c.id, rows);
    } catch (err) {
      console.error(`candidate history failed for ${c.id}:`, err.message);
    }
    if (i < candidates.length) await sleep(250);
  }
  return series;
}

module.exports = { topCandidates, candidateSeries, NAME_EXCLUDE, COMMODITY_OK };
