// KuCoin public market data (Phase 2.9 deep-history layer). Data-only — no
// account, no key: KuCoin's spot candles endpoint serves daily closes back
// to a coin's listing, the fallback depth source when Binance lacks a symbol.
// USDT-quoted (≈ USD, fine for backtests).

const API = 'https://api.kucoin.com';
const DAY_MS = 86_400_000;
const DAY_S = 86_400;

async function getJson(pathAndQuery) {
  const res = await fetch(`${API}${pathAndQuery}`, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`KuCoin ${res.status}`);
  const body = await res.json();
  if (body.code && body.code !== '200000') throw new Error(`KuCoin ${body.code}: ${body.msg || ''}`);
  return body.data;
}

// Symbols cache: KuCoin's tradable spot pairs, so the collector can tell
// which coins it can serve at all before paging candles.
let symbolsCache = null;
async function usdtSymbols() {
  if (symbolsCache && Date.now() - symbolsCache.at < 24 * 3600e3) return symbolsCache.set;
  const list = await getJson('/api/v1/symbols');
  const set = new Set(
    (list || []).filter((s) => s.quoteCurrency === 'USDT' && s.enableTrading).map((s) => s.baseCurrency.toUpperCase())
  );
  symbolsCache = { at: Date.now(), set };
  return set;
}

async function symbolExists(symbol) {
  try {
    return (await usdtSymbols()).has(symbol.toUpperCase());
  } catch {
    return false;
  }
}

// Daily closes for SYM-USDT since a ms timestamp, as Map(dayTs -> close).
// KuCoin caps a candles call at 1500 rows, so page backward from now in
// ~1000-day windows. Row shape: [time(s), open, close, high, low, volume,
// turnover]; close is index 2, newest-first within a page.
async function dailyCloses(symbol, sinceMs) {
  const pair = `${symbol.toUpperCase()}-USDT`;
  const start = Math.max(0, Math.floor((sinceMs || 0) / 1000));
  const byDay = new Map();
  let endAt = Math.floor(Date.now() / 1000);
  for (let page = 0; page < 8; page++) {
    const startAt = Math.max(start, endAt - 1000 * DAY_S);
    let rows;
    try {
      rows = await getJson(`/api/v1/market/candles?type=1day&symbol=${pair}&startAt=${startAt}&endAt=${endAt}`);
    } catch {
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const ts = Number(r[0]) * 1000;
      const close = Number(r[2]);
      if (close > 0) byDay.set(Math.floor(ts / DAY_MS) * DAY_MS, close);
    }
    const oldest = Number(rows[rows.length - 1][0]);
    if (oldest <= start || rows.length < 1000) break;
    endAt = oldest - DAY_S;
  }
  return byDay;
}

module.exports = { dailyCloses, symbolExists, usdtSymbols };
