// Exchange adapter seam (IMPLEMENTATION-PLAN 8.2; NEXT-RELEASE 7 prep).
//
// Everything the LIVE rail needs from a venue, behind one interface, so a
// future exchange (the US/Canada expansion) is a second adapter — never a
// rewrite of the engine. Binance is adapter #1 and simply delegates to
// lib/binance.js; the research side keeps importing lib/binance directly
// (its bulk/history workflows are out of this seam's scope on purpose).
//
// Interface (all deterministic pass-throughs, no AI, public data only):
//   name                       adapter identity for provenance/debug
//   recentKlines(sym, since)   live closed+forming candles (entry-open reads)
//   serverTime(socks)          exchange-synced clock through the tunnel
//   monthlyKlines(sym, y, m)   bulk month bundle (catalog repair)
//   coveredMonths(sym)         local cache coverage for the catalog
//   newestCandleTs(sym)        freshness probe for the screen
const binance = require('../binance');

const binanceAdapter = {
  name: 'binance',
  recentKlines: (symbol, sinceMs) => binance.recentKlines(symbol, sinceMs),
  serverTime: (socks) => binance.socksServerTime(socks),
  monthlyKlines: (symbol, year, month) => binance.monthlyKlines(symbol, year, month),
  coveredMonths: (symbol) => binance.coveredMonths(symbol),
  newestCandleTs: (symbol) => binance.newestCandleTs(symbol),
};

const ADAPTERS = { binance: binanceAdapter };

// One venue this release; the setup schema gains an `exchange` field when a
// second adapter exists (defaulting to 'binance' for every current record).
function getExchange(name = 'binance') {
  const a = ADAPTERS[name];
  if (!a) {
    const e = new Error(`unknown exchange adapter '${name}'`);
    e.code = 'NO_ADAPTER';
    throw e;
  }
  return a;
}

module.exports = { getExchange, ADAPTERS };
