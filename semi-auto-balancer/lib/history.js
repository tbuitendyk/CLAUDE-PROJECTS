const db = require('./db');
const { getJson } = require('./cg');
const { fiatCode } = require('./pricing');

// Daily price-history cache (Phase 0). Sits between the analysis features and
// CoinGecko: everything reads bucketed daily closes from daily_prices; the API
// is only touched when the cache is stale, through the shared rate-limited
// client. The demo tier hard-limits history to the past 365 days; deeper
// multi-year data layers in from the exchange APIs in Phase 1.5.

const DAY_MS = 86_400_000;
const MAX_DAYS = 365;

// 00:00 UTC bucket for a ms timestamp.
function dayBucket(ts) {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

function latestCachedTs(id) {
  const row = db.prepare('SELECT MAX(ts) AS ts FROM daily_prices WHERE coingecko_id = ?').get(id);
  return row && row.ts != null ? row.ts : null;
}

// Bucket a raw market_chart series ([ [ms, price], ... ]) to UTC days.
// CoinGecko's daily points are 00:00 UTC snapshots EXCEPT the final one,
// which is the live price at request time — bucketing it to its day and
// using INSERT OR REPLACE means today's partial value is held until the next
// fetch overwrites it with the real close.
function bucketSeries(prices) {
  const byDay = new Map();
  for (const [ms, price] of prices || []) {
    if (!(price > 0)) continue;
    byDay.set(dayBucket(ms), price); // later points win within a day
  }
  return byDay;
}

function storeSeries(id, byDay) {
  const ins = db.prepare('INSERT OR REPLACE INTO daily_prices (coingecko_id, ts, usd_price) VALUES (?, ?, ?)');
  const tx = db.transaction(() => {
    for (const [ts, price] of byDay) ins.run(id, ts, price);
  });
  tx();
}

async function fetchMarketChart(coinId, vs, days) {
  const body = await getJson(
    `/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=${encodeURIComponent(vs)}&days=${days}`
  );
  return bucketSeries(body.prices);
}

// Refresh policy: refetch only when the cache is missing days. A fetch of
// `days` covers the whole window, so one call per asset per day is the
// steady-state cost. Clamped to the free tier's 365-day limit.
function daysMissing(id, days) {
  const latest = latestCachedTs(id);
  if (latest == null) return days;
  const today = dayBucket(Date.now());
  const behind = Math.ceil((today - latest) / DAY_MS);
  return behind > 0 ? Math.min(days, behind + 1) : 0;
}

// Ensure the cache holds ~`days` of daily USD closes for an asset id (coin or
// 'fiat:<code>'), then return the series oldest→newest.
async function getDailyHistory(id, days = MAX_DAYS) {
  days = Math.min(Math.max(1, Math.round(days)), MAX_DAYS);
  const code = fiatCode(id);

  if (code === 'usd' || id === 'usd' || id === 'fiat:usd') {
    // USD is the unit: constant 1, synthesized without any API call.
    const today = dayBucket(Date.now());
    const byDay = new Map();
    for (let i = days - 1; i >= 0; i--) byDay.set(today - i * DAY_MS, 1);
    return [...byDay.entries()].map(([ts, usd_price]) => ({ ts, usd_price }));
  }

  const missing = daysMissing(id, days);
  if (missing > 0) {
    if (code) {
      // Fiat via the bitcoin cross-rate: usd-per-fiat = btc_usd / btc_fiat,
      // joined on the UTC day bucket (skip days present in only one series).
      const [inUsd, inFiat] = [
        await fetchMarketChart('bitcoin', 'usd', missing),
        await fetchMarketChart('bitcoin', code, missing),
      ];
      const byDay = new Map();
      for (const [ts, btcUsd] of inUsd) {
        const btcFiat = inFiat.get(ts);
        if (btcFiat > 0) byDay.set(ts, btcUsd / btcFiat);
      }
      storeSeries(id, byDay);
    } else {
      storeSeries(id, await fetchMarketChart(id, 'usd', missing));
    }
  }

  const since = dayBucket(Date.now()) - (days - 1) * DAY_MS;
  return db
    .prepare('SELECT ts, usd_price FROM daily_prices WHERE coingecko_id = ? AND ts >= ? ORDER BY ts')
    .all(id, since);
}

// Cache freshness overview for diagnostics.
function cacheStatus() {
  return db
    .prepare(
      'SELECT coingecko_id, COUNT(*) AS days, MIN(ts) AS oldest, MAX(ts) AS newest FROM daily_prices GROUP BY coingecko_id ORDER BY coingecko_id'
    )
    .all();
}

module.exports = { getDailyHistory, cacheStatus, dayBucket, bucketSeries, DAY_MS, MAX_DAYS };
