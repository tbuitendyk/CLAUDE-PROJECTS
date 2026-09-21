// THE HOURS SINCE THE LAST FINISHED DAY (owner order, 2026-09-21: "fix the
// Global Refresh and Refresh to latest buttons on the Data tab to be able to
// download the most recent hourly candles available").
//
// The bulk portal publishes a day's file about a day after the day ends, so
// day files alone left the box a day or more behind, and `to` on Data read a
// date the newest decision could not reach. A refresh now does three things
// per coin, in this order: the month bundles it always fetched (lib/pipeline
// loadSymbol); the day files of every month without a bundle, asking the
// portal again for a day whose file is on disk but not whole; then every
// CLOSED hourly candle since the last whole day, from the REST mirror, written
// into day files by day -- today's file is partial and grows with every press.
//
// A candle still forming -- its hour has not ended -- is never written: its
// high, low and close are not known yet, and a file that held one would say
// the data reaches an hour it does not.
//
// Nothing here reaches the network itself: the fetchers are lib/binance.js's
// own, handed in so a test can stand in for them.
const binance = require('./binance');

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const dayStartOf = (ts) => { const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10);
const ym = (ts) => new Date(ts).toISOString().slice(0, 7);

// DAY FILES FOR ONE MONTH WITHOUT A BUNDLE: every finished day of it, fetched
// from the portal when it is not on disk or its file is not whole. Today is
// never a finished day file, and a day already whole is not asked for again.
async function backfillDayFiles(symbol, monthStr, { now = Date.now(), daily = binance.dailyKlines, setProgress = () => {} } = {}) {
  const [y, m] = String(monthStr).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = dayStartOf(now);
  let fetched = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = Date.UTC(y, m - 1, d);
    if (dayStart >= today) break;
    const have = binance.readDayFile(symbol, dayStart);
    if (binance.dayFileWhole(have, dayStart)) continue;
    setProgress(`${symbol} ${ymd(dayStart)} (day file${have ? ', completing it' : ''})`);
    const rows = await daily(symbol, y, m, d, { refetch: !!have });
    if (rows && rows.length) fetched++;
  }
  return fetched;
}

// WHERE THE REST PASS STARTS: the day after the last whole day file, or the
// day after the last bundled month, looking back from yesterday and never
// further than `maxDays`. Today's hours are always asked for.
function recentSince(symbol, now = Date.now(), maxDays = 45) {
  const today = dayStartOf(now);
  const bundled = new Set(binance.cachedMonths(symbol));
  let since = today;
  for (let back = 1; back <= maxDays; back++) {
    const day = today - back * DAY_MS;
    if (bundled.has(ym(day))) break;
    if (binance.dayFileWhole(binance.readDayFile(symbol, day), day)) break;
    since = day;
  }
  return since;
}

// THE CLOSED HOURS SINCE, written into day files by day. A candle already on
// disk is kept as it is; a candle whose hour has not ended is dropped.
async function fillRecent(symbol, { now = Date.now(), recent = binance.recentKlines, setProgress = () => {}, maxDays = 45 } = {}) {
  const since = recentSince(symbol, now, maxDays);
  setProgress(`${symbol} hours since ${ymd(since)} (recent candles)`);
  const rows = await recent(symbol, since);
  const closed = (Array.isArray(rows) ? rows : []).filter((r) => r && r.ts >= since && r.ts + HOUR_MS <= now && r.open > 0);
  const byDay = new Map();
  for (const r of closed) {
    const day = dayStartOf(r.ts);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  const days = [];
  let candles = 0;
  for (const [day, fresh] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const have = binance.readDayFile(symbol, day) || [];
    const merged = new Map(have.map((r) => [r.ts, r]));
    let added = 0;
    for (const r of fresh) if (!merged.has(r.ts)) { merged.set(r.ts, r); added++; }
    if (!added) continue;
    binance.writeDayFile(symbol, day, [...merged.values()].sort((a, b) => a.ts - b.ts));
    candles += added;
    days.push(ymd(day));
  }
  const newest = binance.newestCandleTs(symbol);
  return { since: ymd(since), candles, days, newest, to: newest == null ? null : binance.candleHourText(newest) };
}

module.exports = { backfillDayFiles, recentSince, fillRecent, dayStartOf, HOUR_MS, DAY_MS };
