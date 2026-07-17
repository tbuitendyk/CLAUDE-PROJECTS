const config = require('./config');
const db = require('./db');
const kraken = require('./exchanges/kraken');
const bitso = require('./exchanges/bitso');

// Exchange-first market data (Phase 1.5): held assets get priced and their
// daily history topped up from Kraken/Bitso public endpoints, reserving the
// CoinGecko quota for fallback and the scanner (which needs one uniform
// source across its candidate universe and stays CG-only by design).
//
// Every function here is best-effort: any venue failure returns "nothing"
// and the caller falls back to CoinGecko. Nothing throws outward.

function enabled() {
  return config.exchangeMarketData;
}

// coingecko_id -> symbol, from the assets users actually hold. Exchange
// pricing is keyed by ticker symbol; only held assets have a known symbol,
// which is exactly the population we want off the CG quota.
function symbolsForCgIds(ids) {
  const map = new Map();
  const rows = db
    .prepare('SELECT DISTINCT coingecko_id, symbol FROM assets')
    .all();
  for (const r of rows) {
    if (!ids.includes(r.coingecko_id)) continue;
    map.set(r.coingecko_id, r.symbol.toLowerCase());
  }
  // Two different coins sharing one ticker symbol would collide on the
  // venue side — drop both and let CoinGecko (id-keyed) price them.
  const seen = new Map();
  for (const [id, sym] of map) {
    if (seen.has(sym) && seen.get(sym) !== id) {
      map.delete(id);
      map.delete(seen.get(sym));
    } else seen.set(sym, id);
  }
  return map;
}

// USD prices for whatever subset of the requested ids the exchanges can
// serve: coins via one Kraken Ticker batch (unambiguous SYM/USD pairs only),
// fiat codes via Bitso's usd_<code> books. Fiat results are keyed under both
// 'fiat:<code>' and the bare code, like the CG path does.
async function usdPrices(ids, fiatCodes) {
  if (!enabled()) return {};
  const out = {};

  try {
    const symById = symbolsForCgIds(ids);
    const pairById = new Map();
    for (const [id, sym] of symById) {
      const pair = await kraken.pairForSymbol(sym).catch(() => null);
      if (pair) pairById.set(id, pair);
    }
    if (pairById.size > 0) {
      const prices = await kraken.tickerUsd([...new Set(pairById.values())]);
      for (const [id, pair] of pairById) {
        if (prices[pair] > 0) out[id] = prices[pair];
      }
    }
  } catch {
    /* fall back to CoinGecko for everything */
  }

  for (const code of fiatCodes || []) {
    if (code === 'usd') continue;
    try {
      const rate = await bitso.usdFiatRate(code);
      if (rate > 0) {
        out[`fiat:${code}`] = rate;
        out[code] = rate;
      }
    } catch {
      /* this fiat falls back to the CG cross-rate */
    }
  }
  return out;
}

// Daily USD closes for one asset id since a ms timestamp, as a Map(dayTs ->
// price), or null when no exchange source covers it. code = fiat code when
// the id is a fiat (resolved by the caller, which owns fiatCode()).
async function dailyByDay(id, code, sinceMs) {
  if (!enabled()) return null;
  try {
    if (code) {
      if (!bitso.USD_FIAT_BOOKS.has(code)) return null;
      return await bitso.dailyCloses(`usd_${code}`, sinceMs, { invert: true });
    }
    const symById = symbolsForCgIds([id]);
    const sym = symById.get(id);
    if (!sym) return null;
    const pair = await kraken.pairForSymbol(sym);
    if (!pair) return null;
    return await kraken.dailyCloses(pair, sinceMs);
  } catch {
    return null;
  }
}

module.exports = { enabled, usdPrices, dailyByDay, symbolsForCgIds };
