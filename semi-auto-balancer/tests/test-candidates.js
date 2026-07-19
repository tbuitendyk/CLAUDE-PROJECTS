// Candidate universe filtering: stablecoins/wrapped derivatives are weeded
// out (by name heuristic AND CoinGecko category), but commodity-backed tokens
// (PAX Gold, Tether Gold) are NOT stablecoins and must survive — their names
// trip the `pax`/`tether` substrings yet they track a real, diversifying price.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok } = require('./helpers');
freshDb('candidates');

// Stub CoinGecko BEFORE requiring candidates (it destructures getJson at load).
const cg = require('../lib/cg');
const MARKETS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2 },
  { id: 'tether', symbol: 'usdt', name: 'Tether', market_cap_rank: 3 },
  { id: 'ripple', symbol: 'xrp', name: 'XRP', market_cap_rank: 4 },
  { id: 'usd-coin', symbol: 'usdc', name: 'USDC', market_cap_rank: 5 },
  { id: 'tether-gold', symbol: 'xaut', name: 'Tether Gold', market_cap_rank: 37 },
  { id: 'pax-gold', symbol: 'paxg', name: 'PAX Gold', market_cap_rank: 43 },
  { id: 'category-only-stable', symbol: 'zzz', name: 'Zzz Reserve', market_cap_rank: 60 },
];
cg.getJson = async (path) => {
  if (path.includes('category=stablecoins')) return [{ id: 'category-only-stable' }];
  if (path.includes('category=wrapped-tokens')) return [];
  return MARKETS;
};

const { topCandidates, COMMODITY_OK } = require('../lib/candidates');

(async () => {
  ok(COMMODITY_OK.test('paxg') && COMMODITY_OK.test('xaut'), 'gold tokens are on the commodity allowlist');
  ok(!COMMODITY_OK.test('usdt') && !COMMODITY_OK.test('pax'), 'the allowlist is exact-symbol, not a substring');

  const out = await topCandidates({ count: 40 });
  const ids = new Set(out.map((c) => c.id));

  ok(ids.has('pax-gold'), 'PAX Gold survives (commodity exemption beats the `pax` heuristic)');
  ok(ids.has('tether-gold'), 'Tether Gold survives (exemption beats the `tether` heuristic)');
  ok(ids.has('bitcoin') && ids.has('ethereum') && ids.has('ripple'), 'ordinary coins pass through');
  ok(!ids.has('tether') && !ids.has('usd-coin'), 'genuine stablecoins are still weeded by the name heuristic');
  ok(!ids.has('category-only-stable'), 'a stablecoin caught only by CG category is still excluded');

  console.log('candidate filtering tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
