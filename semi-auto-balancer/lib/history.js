const db = require('./db');
const { getJson } = require('./cg');
const { fiatCode } = require('./pricing');
const exsource = require('./exsource');
const { rebrandFor } = require('./rebrands');

// Daily price-history cache (Phase 0, exchange layer added in Phase 1.5).
// Everything reads bucketed daily closes from daily_prices; a fetch is only
// made when the cache is stale. Source priority: bulk OHLCVT seeds (via
// scripts/import-ohlcvt.js, already in the cache) → exchange APIs (Kraken
// daily OHLC ≈720d, Bitso fiat books multi-year) → CoinGecko (365-day demo
// limit, and the sole source for scanner candidates).

const DAY_MS = 86_400_000;
const MAX_DAYS = 365; // CoinGecko demo-tier hard limit per fetch
const MAX_EXCHANGE_DAYS = 730; // Kraken serves ~720 daily candles
const MAX_READ_DAYS = 3650; // bulk seeds can go deeper than any live API

// 00:00 UTC bucket for a ms timestamp.
function dayBucket(ts) {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

function latestCachedTs(id) {
  const row = db.prepare('SELECT MAX(ts) AS ts FROM daily_prices WHERE coingecko_id = ?').get(id);
  return row && row.ts != null ? row.ts : null;
}

function oldestCachedTs(id) {
  const row = db.prepare('SELECT MIN(ts) AS ts FROM daily_prices WHERE coingecko_id = ?').get(id);
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
// 'fiat:<code>'), then return the series oldest→newest. Reads may span more
// days than any live source serves (bulk seeds); fetch windows are clamped
// per source (exchange ≈720d, CoinGecko 365d). `symbolHint` lets callers
// (the composition lab's candidates) route through the exchange layer for
// assets not held in any profile.
async function getDailyHistory(id, days = MAX_DAYS, symbolHint = null) {
  days = Math.min(Math.max(1, Math.round(days)), MAX_READ_DAYS);
  const code = fiatCode(id);

  if (code === 'usd' || id === 'usd' || id === 'fiat:usd') {
    // USD is the unit: constant 1, synthesized without any API call.
    const today = dayBucket(Date.now());
    const byDay = new Map();
    for (let i = days - 1; i >= 0; i--) byDay.set(today - i * DAY_MS, 1);
    return [...byDay.entries()].map(([ts, usd_price]) => ({ ts, usd_price }));
  }

  // Deep daily layer (regime study): requests beyond the exchange APIs' live
  // depth (~720d) pull years from Binance/KuCoin's public data portals
  // (data-only, no keys). Coins only — fiats keep the Bitso-book path below.
  let exFetched = false;
  if (exsource.enabled() && days > MAX_EXCHANGE_DAYS && !code && symbolHint) {
    const windowStart = dayBucket(Date.now()) - (days - 1) * DAY_MS;
    const oldest = oldestCachedTs(id);
    const latest = latestCachedTs(id);
    const tailShallow = oldest == null || oldest > windowStart + 2 * DAY_MS;
    const headStale = daysMissing(id, days) > 0;
    if (tailShallow || headStale) {
      const since = tailShallow ? windowStart : Math.max(latest || 0, windowStart);
      const byDay = await exsource.deepDailyByDay(symbolHint, since);
      if (byDay && byDay.size > 0) {
        storeSeries(id, byDay);
        exFetched = true;
      }
    } else {
      exFetched = true;
    }

    // Rebrand splice: a renamed token (e.g. MATIC→POL) whose post-rebrand
    // series starts only at the migration inherits its predecessor's deep
    // history for the older span — spliced at the migration date, and ONLY if
    // the boundary is continuous (a mislabelled entry or a real break is
    // refused). This lets a rebranded holding cover the full window instead of
    // capping it at its (recent) listing date.
    const rb = rebrandFor(id, symbolHint);
    if (rb) {
      const oldestNow = oldestCachedTs(id);
      // Splice when the post-rebrand series doesn't reach the requested window
      // (its history starts at/after the migration, so the older span is missing).
      if (oldestNow == null || oldestNow > windowStart + 2 * DAY_MS) {
        // Predecessor path skips the live-listing gate — a renamed symbol has
        // no recent data but its historical zips are intact.
        const pred = await exsource.deepDailyPredecessor(rb.fromSymbol, windowStart);
        if (pred && pred.size > 0) {
          // The new series' earliest price at/after the migration, for the
          // continuity check against the predecessor at the boundary.
          const firstNew = db
            .prepare('SELECT ts, usd_price FROM daily_prices WHERE coingecko_id = ? AND ts >= ? ORDER BY ts LIMIT 1')
            .get(id, rb.dateMs);
          const preRebrand = new Map();
          let boundaryOld = null;
          for (const [ts, price] of pred) {
            if (ts >= rb.dateMs) {
              boundaryOld = price * rb.ratio; // predecessor value at the swap, in new units
              continue; // don't overwrite real post-rebrand data
            }
            preRebrand.set(ts, price * rb.ratio);
          }
          // Continuity gate: predecessor (×ratio) at the boundary must line up
          // with the new series' first print. Skip the splice on a real break.
          const seamless =
            !firstNew ||
            boundaryOld == null ||
            Math.abs(boundaryOld / firstNew.usd_price - 1) <= 0.15;
          if (seamless && preRebrand.size > 0) {
            storeSeries(id, preRebrand);
            exFetched = true;
          } else if (!seamless) {
            console.error(`rebrand splice skipped for ${id}: boundary break (${boundaryOld} vs ${firstNew.usd_price})`);
          }
        }
      }
    }
  }

  // Deep FIAT layer: a fiat cross (e.g. MXN) is otherwise capped at ~2y by
  // the regular exchange path (MAX_EXCHANGE_DAYS), but Bitso's own usd_<code>
  // book serves ~5y. Pull that deep span so a fiat-tethered profile (Bitso
  // MXN, and any fiat index) isn't the thing that limits the backtest window.
  if (exsource.enabled() && days > MAX_EXCHANGE_DAYS && code && code !== 'usd') {
    const windowStart = dayBucket(Date.now()) - (days - 1) * DAY_MS;
    const oldest = oldestCachedTs(id);
    const tailShallow = oldest == null || oldest > windowStart + 2 * DAY_MS;
    if (tailShallow) {
      const byDay = await exsource.dailyByDay(id, code, windowStart);
      if (byDay && byDay.size > 0) {
        storeSeries(id, byDay);
        exFetched = true;
      }
    } else {
      exFetched = true;
    }
  }

  // Exchange layer: top up from the venue's own market data when it covers
  // this asset (deeper history, zero CG quota). Fetch when the HEAD is stale
  // OR the TAIL is shallower than the requested window — a series first
  // cached via CoinGecko's 365-day cap must deepen, not sit fresh-but-shallow
  // forever. Runs even after a deep fetch, to top up the recent head (the
  // portal zips lag the current partial month). Best-effort; falls to CG.
  if (exsource.enabled()) {
    const cap = Math.min(days, MAX_EXCHANGE_DAYS);
    const windowStart = dayBucket(Date.now()) - (cap - 1) * DAY_MS;
    const latest = latestCachedTs(id);
    const oldest = oldestCachedTs(id);
    const headStale = daysMissing(id, cap) > 0;
    const tailShallow = oldest == null || oldest > windowStart + DAY_MS;
    if (headStale || tailShallow) {
      const since = tailShallow ? windowStart : Math.max(latest || 0, windowStart);
      const byDay = await exsource.dailyByDay(id, code, since, symbolHint);
      if (byDay && byDay.size > 0) {
        storeSeries(id, byDay);
        exFetched = true;
      }
    } else {
      exFetched = true; // cache already covers the window — nothing to fetch
    }
  }

  const missing = exFetched ? 0 : daysMissing(id, Math.min(days, MAX_DAYS));
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
  const rows = db
    .prepare('SELECT ts, usd_price FROM daily_prices WHERE coingecko_id = ? AND ts >= ? ORDER BY ts')
    .all(id, since);

  // Synthetic backfill for a fiat CROSS: if the real series still starts after
  // the requested window (some fiat Bitso trades shallow, or no deep source at
  // all), hold the earliest known cross-rate flat back to the window start so
  // the cross never LIMITS the window — real data where we have it, a constant
  // extrapolation before it. Not persisted (the cache stays real-only); a
  // currency cross is stable enough that a flat pre-history is a fair stand-in,
  // and every mix is denominated here so a short index must not gate the study.
  if (days > MAX_EXCHANGE_DAYS && rows.length) {
    // Which series may be synthetically completed: any fiat cross, or a COIN
    // whose whole known series sits inside a ±3% band of its median (a stable
    // tether like USDC). A volatile coin can never qualify — the band fails.
    const isFiatCross = Boolean(code && code !== 'usd');
    let stableBand = false;
    let med = null;
    if (!code && rows.length >= 30) {
      const vals = rows.map((r) => r.usd_price).sort((a, b) => a - b);
      med = vals[vals.length >> 1];
      stableBand = med > 0 && vals[vals.length - 1] / med < 1.03 && vals[0] / med > 0.97;
    }
    if (isFiatCross || stableBand) {
      const filled = [];
      // Head: constant extrapolation back to the window start (a short cross
      // must never gate the study) — earliest known rate for fiat, median for
      // a stablecoin.
      if (rows[0].ts > since + DAY_MS) {
        const flat = isFiatCross ? rows[0].usd_price : med;
        for (let t = since; t < rows[0].ts; t += DAY_MS) filled.push({ ts: t, usd_price: flat, synthetic: true });
      }
      // INTERNAL gaps: previous close. Stitched deep series can miss candle
      // days (observed live: USDC 1,295 rows over a 1,460d span = 88.7%,
      // under buildBars' 97% coverage bar — the tether got dropped and the
      // whole search failed). For a flat series the previous close is the
      // honest stand-in, and the cache stays real-only.
      for (let i = 0; i < rows.length; i++) {
        filled.push(rows[i]);
        if (i + 1 < rows.length) {
          for (let t = rows[i].ts + DAY_MS; t < rows[i + 1].ts; t += DAY_MS) {
            filled.push({ ts: t, usd_price: rows[i].usd_price, synthetic: true });
          }
        }
      }
      return filled;
    }
  }
  return rows;
}

// Idealized tether series: constant $1.00 across the whole window — the
// "treat the tether as a perfect USD peg" ASSUMPTION, exposed as a user
// toggle in the backtests (default off = real data, wobbles and depegs
// included). Only legitimate for a genuinely USD-stable tether: returns null
// unless the real series' median sits within ±3% of $1 (fiat:usd trivially
// qualifies), so a volatile or non-USD tether can never be "idealized" into
// fiction. `granularity` bucket: 'daily' or 'hourly'.
function idealTetherSeries(realRows, days, nowMs = Date.now(), granularity = 'daily') {
  const vals = (realRows || []).map((r) => r.usd_price).filter((v) => v > 0).sort((a, b) => a - b);
  const med = vals.length ? vals[vals.length >> 1] : null;
  if (med == null || med < 0.97 || med > 1.03) return null;
  const step = granularity === 'hourly' ? 3_600_000 : DAY_MS;
  const count = granularity === 'hourly' ? days * 24 : days;
  const head = Math.floor(nowMs / step) * step;
  const rows = [];
  for (let i = count - 1; i >= 0; i--) rows.push({ ts: head - i * step, usd_price: 1, synthetic: true });
  return rows;
}

// Cache freshness overview for diagnostics.
function cacheStatus() {
  return db
    .prepare(
      'SELECT coingecko_id, COUNT(*) AS days, MIN(ts) AS oldest, MAX(ts) AS newest FROM daily_prices GROUP BY coingecko_id ORDER BY coingecko_id'
    )
    .all();
}

module.exports = { getDailyHistory, idealTetherSeries, cacheStatus, dayBucket, bucketSeries, DAY_MS, MAX_DAYS };
