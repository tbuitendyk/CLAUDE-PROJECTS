#!/usr/bin/env node
// Seed daily_prices from Kraken's bulk OHLCVT CSV files (Phase 1.5).
//
// Kraken distributes full candlestick history as quarterly-updated CSV zips
// (Google Drive links on their support article — see EXCHANGES.md). Download
// the 1440-interval files for the USD pairs you hold, then run:
//
//   node scripts/import-ohlcvt.js <coingecko_id> <path/to/XBTUSD_1440.csv>
//
// CSV rows: timestamp(s),open,high,low,close,volume,trades — no header.
// Rows land in the same daily_prices cache the exchange/CG top-ups use
// (INSERT OR REPLACE, 00:00 UTC buckets), so live top-ups layer over the
// seed seamlessly and backtests just see a deeper series.

const fs = require('fs');
const readline = require('readline');

const [, , cgId, file] = process.argv;
if (!cgId || !file) {
  console.error('usage: node scripts/import-ohlcvt.js <coingecko_id> <ohlcvt_1440.csv>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`no such file: ${file}`);
  process.exit(1);
}

const db = require('../lib/db');
const DAY_MS = 86_400_000;

(async () => {
  const ins = db.prepare('INSERT OR REPLACE INTO daily_prices (coingecko_id, ts, usd_price) VALUES (?, ?, ?)');
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const ts = Number(parts[0]) * 1000;
    const close = Number(parts[4]);
    if (!(ts > 0) || !(close > 0)) continue;
    rows.push([Math.floor(ts / DAY_MS) * DAY_MS, close]);
  }
  if (rows.length === 0) {
    console.error('no usable rows found — is this a Kraken OHLCVT 1440 CSV?');
    process.exit(1);
  }
  db.transaction(() => {
    for (const [ts, close] of rows) ins.run(cgId, ts, close);
  })();
  const span = (rows[rows.length - 1][0] - rows[0][0]) / DAY_MS;
  console.log(
    `imported ${rows.length} daily closes for ${cgId} ` +
      `(${new Date(rows[0][0]).toISOString().slice(0, 10)} → ${new Date(rows[rows.length - 1][0]).toISOString().slice(0, 10)}, ~${Math.round(span / 365)}y)`
  );
})();
