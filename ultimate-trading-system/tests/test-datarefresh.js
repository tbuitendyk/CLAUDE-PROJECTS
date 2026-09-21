// THE HOURS SINCE THE LAST FINISHED DAY (owner order, 2026-09-21, 3.214.0):
// Global Refresh and Refresh to latest bring every coin to the most recent
// closed hourly candle, and `to` on Data names that candle to the hour.
//
// Everything runs on a reserved fake coin in the real cache folder, with the
// two fetchers stood in for, so nothing here touches the network; the
// cleanup removes exactly that coin's files.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');
const binance = require('../lib/binance');
const dr = require('../lib/datarefresh');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const SYM = 'ZZZDRUSDT';
const HOUR = 3_600_000;

const candle = (ts) => ({ ts, open: 100 + (ts / HOUR) % 7, high: 108, low: 99, close: 101, quoteVolume: 1000 });
const hours = (dayStart, from, to) => { const out = []; for (let h = from; h <= to; h++) out.push(candle(dayStart + h * HOUR)); return out; };
const D19 = Date.UTC(2026, 8, 19);
const D20 = Date.UTC(2026, 8, 20);
const D21 = Date.UTC(2026, 8, 21);
const NOW = Date.UTC(2026, 8, 21, 6, 35);      // 06:35 UTC on the 21st: the 05:00 candle is the newest closed one

function cleanup() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const f of fs.readdirSync(CACHE)) if (f.startsWith(`${SYM}-1h-`)) fs.rmSync(path.join(CACHE, f), { force: true });
}
const readDay = (dayStart) => binance.readDayFile(SYM, dayStart);
const state = () => binance.cacheState().find((s) => s.symbol === SYM);

module.exports.aDayFileIsWholeOnlyWhenItsLastCandleOpenedAt2300 = function () {
  assert.strictEqual(binance.dayFileWhole(hours(D20, 0, 23), D20), true);
  assert.strictEqual(binance.dayFileWhole(hours(D20, 0, 22), D20), false, 'one hour short is not whole');
  assert.strictEqual(binance.dayFileWhole(hours(D20, 3, 23), D20), true, 'a hole inside the day is the exchange\'s, not a reason to ask again');
  assert.strictEqual(binance.dayFileWhole(null, D20), false);
  assert.strictEqual(binance.dayFileWhole([], D20), false);
  assert.strictEqual(binance.candleHourText(Date.UTC(2026, 8, 21, 5)), '2026-09-21-05:00:00');
  assert.strictEqual(binance.candleHourText(Date.UTC(2026, 0, 1, 0)), '2026-01-01-00:00:00');
};

module.exports.theCacheStateNamesTheNewestCandleToTheHour = function () {
  cleanup();
  // a bundle for August, whole day files for the 19th and 20th, today's partial
  fs.writeFileSync(path.join(CACHE, `${SYM}-1h-2026-08.json`), JSON.stringify(hours(Date.UTC(2026, 7, 31), 0, 23)));
  binance.writeDayFile(SYM, D19, hours(D19, 0, 23));
  binance.writeDayFile(SYM, D20, hours(D20, 0, 23));
  binance.writeDayFile(SYM, D21, hours(D21, 0, 5));
  const s = state();
  assert.strictEqual(s.to, '2026-09-21-05:00:00', 'the newest candle on file, to the hour');
  assert.strictEqual(s.toTs, Date.UTC(2026, 8, 21, 5));
  assert.strictEqual(s.toMonth, '2026-09', 'the month the trim prompt pre-fills stays a month');
  assert.strictEqual(s.from, '2026-08');
  assert.strictEqual(s.months, 2);
  assert.strictEqual(binance.newestCandleTs(SYM), Date.UTC(2026, 8, 21, 5));
  // a bundle alone: its last candle
  cleanup();
  fs.writeFileSync(path.join(CACHE, `${SYM}-1h-2026-08.json`), JSON.stringify(hours(Date.UTC(2026, 7, 31), 0, 23)));
  assert.strictEqual(state().to, '2026-08-31-23:00:00');
  // a bundle newer than the day files (the bundle came, the pieces stayed): the bundle's last candle
  binance.writeDayFile(SYM, Date.UTC(2026, 7, 2), hours(Date.UTC(2026, 7, 2), 0, 23));
  assert.strictEqual(state().to, '2026-08-31-23:00:00');
  cleanup();
};

module.exports.theDayFilesAreAskedForOnlyWhenNotWholeAndTodayNever = async function () {
  cleanup();
  binance.writeDayFile(SYM, D19, hours(D19, 0, 23));     // whole: not asked for
  binance.writeDayFile(SYM, D20, hours(D20, 0, 22));     // not whole: asked for again
  const asked = [];
  const daily = async (symbol, y, m, d, opts) => {
    asked.push({ day: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, refetch: !!(opts && opts.refetch) });
    if (d === 20) return null;                            // the portal has not published it yet
    return hours(Date.UTC(y, m - 1, d), 0, 23);
  };
  const fetched = await dr.backfillDayFiles(SYM, '2026-09', { now: NOW, daily });
  assert.deepStrictEqual(asked.filter((a) => a.day >= '2026-09-18'), [
    { day: '2026-09-18', refetch: false },
    { day: '2026-09-20', refetch: true },
  ], 'a missing day is asked for, a whole day is not, a day not whole is asked for again, and today never');
  assert.ok(!asked.some((a) => a.day === '2026-09-21'), 'today is never a finished day file');
  assert.strictEqual(fetched, asked.length - 1, 'the day the portal had not published is not counted');
  assert.strictEqual(readDay(D20).length, 23, 'a 404 leaves the file on disk as it was');
  cleanup();
};

module.exports.theRefreshFillsTheHoursSinceTheLastWholeDayAndNeverAFormingCandle = async function () {
  cleanup();
  binance.writeDayFile(SYM, D19, hours(D19, 0, 23));     // whole
  binance.writeDayFile(SYM, D20, hours(D20, 0, 22));     // one hour short
  assert.strictEqual(dr.recentSince(SYM, NOW), D20, 'the REST pass starts at the day after the last whole day');
  let askedSince = null;
  const recent = async (symbol, since) => {
    askedSince = since;
    // what the mirror answers: everything from the 20th through the forming 06:00 candle
    return [...hours(D20, 0, 23), ...hours(D21, 0, 6)];
  };
  const got = await dr.fillRecent(SYM, { now: NOW, recent });
  assert.strictEqual(askedSince, D20);
  assert.deepStrictEqual({ since: got.since, candles: got.candles, days: got.days, to: got.to },
    { since: '2026-09-20', candles: 7, days: ['2026-09-20', '2026-09-21'], to: '2026-09-21-05:00:00' },
    'the 23:00 of the 20th and 00:00 to 05:00 of the 21st are written; the forming 06:00 is not');
  const d20 = readDay(D20);
  assert.strictEqual(d20.length, 24);
  assert.ok(binance.dayFileWhole(d20, D20), 'the 20th is whole now');
  assert.deepStrictEqual(d20.map((r) => r.ts), hours(D20, 0, 23).map((r) => r.ts), 'in hour order, no candle twice');
  const d21 = readDay(D21);
  assert.deepStrictEqual(d21.map((r) => r.ts), hours(D21, 0, 5).map((r) => r.ts), 'today\'s file holds the closed hours only');
  assert.strictEqual(state().to, '2026-09-21-05:00:00');
  // an hour later: only the 06:00 candle is new, and the pass starts at today
  const later = NOW + HOUR;
  assert.strictEqual(dr.recentSince(SYM, later), D21);
  const again = await dr.fillRecent(SYM, { now: later, recent: async () => [...hours(D21, 0, 7)] });
  assert.deepStrictEqual({ candles: again.candles, days: again.days, to: again.to }, { candles: 1, days: ['2026-09-21'], to: '2026-09-21-06:00:00' });
  assert.strictEqual(readDay(D21).length, 7);
  // nothing new: nothing written
  const none = await dr.fillRecent(SYM, { now: later, recent: async () => [...hours(D21, 0, 7)] });
  assert.deepStrictEqual({ candles: none.candles, days: none.days }, { candles: 0, days: [] });
  // a bundled month bounds the walk back
  cleanup();
  fs.writeFileSync(path.join(CACHE, `${SYM}-1h-2026-08.json`), JSON.stringify(hours(Date.UTC(2026, 7, 31), 0, 23)));
  assert.strictEqual(dr.recentSince(SYM, Date.UTC(2026, 8, 3, 12)), Date.UTC(2026, 8, 1), 'after a bundled August the pass starts on the first of September');
  assert.strictEqual(dr.recentSince(SYM, Date.UTC(2026, 11, 1, 12), 45), Date.UTC(2026, 11, 1) - 45 * dr.DAY_MS, 'and never further back than the cap');
  cleanup();
};

module.exports.theRefreshRouteFillsTheRecentHoursAndTheScreenSaysSo = function () {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
  assert.ok(server.includes("      try { recent = await require('./lib/datarefresh').fillRecent(t.symbol, { setProgress }); }"), 'the refresh route runs the recent pass after the day files');
  assert.ok(server.includes("      catch (err) { recent = { candles: 0, since: null, to: null, error: err.message }; }"), 'a mirror out of reach keeps the day files and is reported');
  assert.ok(ui.includes("${r.recentError ? ` — the hours since the last whole day were not fetched: ${r.recentError}` : ''}"), 'and the finished message says so, never a quiet done');
  assert.ok(server.includes("const backfillDailies = (symbol, monthStr, setProgress) => require('./lib/datarefresh').backfillDayFiles(symbol, monthStr, { setProgress });"), 'download and refresh share the one day-file backfill');
  assert.ok(server.includes('recentCandles: recent.candles, recentSince: recent.since, to: recent.to, recentError: recent.error || null'), 'the job\'s result names the newest candle');
  assert.ok(ui.includes("  to: 'the newest hourly candle on file, YYYY-MM-DD-HH:00:00 UTC, by the hour it opened. Refresh brings it to the most recent closed hour.',"), 'the column key says what `to` is now');
  assert.ok(ui.includes('then the hours since the last whole day, to the most recent closed hourly candle. Trim keeps only a range'), 'the note on Data says what Refresh does');
  assert.ok(ui.includes('title="Every cached coin: fetch from its newest cached month through the current month, then the hours since the last whole day, to the most recent closed hourly candle">Global Refresh</button>'), 'and so does the button');
  assert.ok(ui.includes("${r.to ? ` to ${r.to}` : ''}"), 'the finished message names the newest candle');
  const help = fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8');
  assert.ok(help.includes('and then hour by hour to the most recent closed hourly candle'), 'the help entry says so too');
};

module.exports.zzz_cleanupTheFakeCoin = function () {
  cleanup();
  assert.strictEqual(fs.readdirSync(CACHE).filter((f) => f.startsWith(`${SYM}-1h-`)).length, 0);
};
