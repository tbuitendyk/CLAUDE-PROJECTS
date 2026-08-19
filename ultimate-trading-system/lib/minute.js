// Minute candles, loaded for ONE asset over ONE window.
//
// WHY THIS IS NOT JUST "the hourly loader with a different interval".
// A month of 1m candles is ~43,200 rows against 720; a typical test window is
// ~1.4 years, so one asset is roughly 735,000 candles. That is fine held once
// on the main thread and dropped afterwards, and it is NOT fine held by four
// worker threads next to their hourly maps. Confirmation therefore runs on
// the main thread, one asset at a time, and this module deliberately offers
// no cache: the map is built, used, and released.
//
// It also refuses to forward-fill. The hourly path fills gaps because a
// missing hour would break chunk geometry; here a missing minute is
// information — it means the exchange published nothing — and inventing a
// candle would be inventing the very intra-bar path this exists to measure.
const { monthlyKlines, MINUTE_MS } = require('./binance');

function monthsBetween(fromMs, toMs) {
  const out = [];
  const d = new Date(fromMs);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= toMs) {
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// Returns { map, months, missingMonths, candles, fromMs, toMs }.
// map: Map<minuteTs, {open, high, low, close}> — only real candles.
async function loadMinuteWindow(symbol, fromMs, toMs, onProgress = () => {}) {
  const months = monthsBetween(fromMs, toMs);
  const map = new Map();
  const missingMonths = [];
  for (let i = 0; i < months.length; i++) {
    const { year, month } = months[i];
    onProgress(`minute data ${symbol} ${year}-${String(month).padStart(2, '0')} (${i + 1}/${months.length})`);
    let rows = null;
    try {
      rows = await monthlyKlines(symbol, year, month, '1m');
    } catch (err) {
      throw new Error(`minute fetch failed for ${symbol} ${year}-${month}: ${err.message}`);
    }
    if (!rows || !rows.length) {
      missingMonths.push(`${year}-${String(month).padStart(2, '0')}`);
      continue;
    }
    for (const r of rows) {
      // Keep only the requested window; the edge months are mostly waste
      // otherwise, and this is the difference between ~700k and ~2M entries.
      if (r.ts < fromMs || r.ts > toMs) continue;
      map.set(r.ts, { open: r.open, high: r.high, low: r.low, close: r.close });
    }
  }
  return {
    map,
    months: months.length,
    missingMonths,
    candles: map.size,
    fromMs,
    toMs,
    // What perfect coverage would look like, so a caller can say how complete
    // the confirmation actually was rather than assuming it was total.
    expected: Math.floor((toMs - fromMs) / MINUTE_MS) + 1,
  };
}

module.exports = { loadMinuteWindow, monthsBetween };
