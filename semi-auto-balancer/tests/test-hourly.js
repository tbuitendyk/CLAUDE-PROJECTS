// Phase 2.5 hourly auto-fill: the zip reader against a zip built in-test,
// Binance CSV parsing (ms AND the 2025+ microsecond format), trades->candle
// aggregation, the source ladder with persistence (bitso -> binance ->
// kraken-trades -> coingecko), and the USD unit synthesis. All venue
// surfaces stubbed — no network.
const zlib = require('zlib');
const { freshDb, ok, approx } = require('./helpers');
freshDb('hourly');

const cg = require('../lib/cg');
let cgCalls = [];
let cgResponses = [];
cg.getJson = async (path) => {
  cgCalls.push(path);
  if (cgResponses.length === 0) throw new Error(`unexpected CG call: ${path}`);
  return cgResponses.shift();
};

const bitso = require('../lib/exchanges/bitso');
const binance = require('../lib/exchanges/binance');
const kraken = require('../lib/exchanges/kraken');

const HOUR = 3_600_000;
const now = Math.floor(Date.now() / HOUR) * HOUR;

// ---- zip reader against a hand-built single-entry zip ----
function buildZip(name, content) {
  const data = zlib.deflateRawSync(Buffer.from(content));
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // local header offset
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}
const csv = `${now - 2 * HOUR},100,101,99,100.5,10,${now - HOUR - 1},1,1,1,1,0\n${now - HOUR},100.5,102,100,101.5,12,${now - 1},1,1,1,1,0\n`;
const unzipped = binance.unzipSingleEntry(buildZip('X-1h-2026-06.csv', csv)).toString('utf8');
ok(unzipped === csv, 'zip reader round-trips a deflate single-entry zip');

// ---- kline CSV parsing: ms and microsecond timestamps ----
const parsedMs = binance.parseKlineCsv(csv);
ok(parsedMs.size === 2 && approx(parsedMs.get(now - HOUR), 101.5), 'kline CSV (ms) parsed to hour closes');
const microCsv = `${(now - HOUR) * 1000},1,2,0.5,1.25,10,0,1,1,1,1,0\n`;
const parsedUs = binance.parseKlineCsv(microCsv);
ok(approx(parsedUs.get(now - HOUR), 1.25), '2025+ microsecond timestamps normalized');

// ---- kraken trades -> hourly candles ----
const hourlyMod = require('../lib/hourly');
const agg = hourlyMod.aggregateTradesToHours([
  ['100.0', '0.1', (now - 2 * HOUR) / 1000 + 10],
  ['101.0', '0.1', (now - 2 * HOUR) / 1000 + 3000],
  ['102.0', '0.1', (now - HOUR) / 1000 + 100],
]);
ok(approx(agg.get(now - 2 * HOUR), 101) && approx(agg.get(now - HOUR), 102), 'hour close = last trade in the hour');

// ---- source ladder with stubs ----
const db = require('../lib/db');
db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 5, 15, 0)").run();
db.prepare(
  "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index) VALUES (1, 'bitcoin', 'btc', 1, 40, 0), (1, 'filecoin', 'fil', 1, 30, 0), (1, 'weirdcoin', 'wrd', 1, 30, 0), (1, 'tether', 'usdt', 100, 0, 1)"
).run();

const mkSeries = (n, base) => new Map(Array.from({ length: n }, (_, i) => [now - (n - i) * HOUR, base + i * 0.01]));
let probes = { books: 0, binance: 0, krakenPair: 0 };
bitso.availableBooks = async () => {
  probes.books++;
  return ['btc_usd', 'usd_mxn'];
};
bitso.hourlyCloses = async () => mkSeries(72, 60000);
binance.symbolExists = async (sym) => {
  probes.binance++;
  return sym === 'fil' ? 'FILUSDT' : null;
};
binance.backfillCloses = async () => mkSeries(72, 4);
binance.recentCloses = async () => mkSeries(4, 4.5);
kraken.pairForSymbol = async (sym) => {
  probes.krakenPair++;
  return null; // weirdcoin not on kraken either
};

(async () => {
  // btc -> bitso (first rung)
  const btc = await hourlyMod.ensureHourly('bitcoin', 'btc');
  ok(btc.source === 'bitso:btc_usd' && btc.status === 'ok' && btc.coverageHours === 72, 'btc fills deep from bitso in one call');

  // fil -> binance (bitso lacks the book)
  const fil = await hourlyMod.ensureHourly('filecoin', 'fil');
  ok(fil.source === 'binance:FILUSDT' && fil.coverageHours === 72, 'fil backfills from the binance data portal');

  // weirdcoin -> coingecko stopgap
  cgResponses = [{ prices: Array.from({ length: 48 }, (_, i) => [now - (48 - i) * HOUR, 2 + i * 0.001]) }];
  const wrd = await hourlyMod.ensureHourly('weirdcoin', 'wrd');
  ok(wrd.source === 'coingecko' && wrd.coverageHours === 48, 'unlisted coin falls back to CG hourly');

  // Sources persist: repeat calls must not re-probe the ladder.
  const probesBefore = { ...probes };
  await hourlyMod.ensureHourly('bitcoin', 'btc');
  await hourlyMod.ensureHourly('filecoin', 'fil');
  ok(
    probes.books === probesBefore.books && probes.binance === probesBefore.binance,
    'persisted source skips ladder probing on later top-ups'
  );

  // Reader: series ordered, USD synthesized as the unit.
  const rows = hourlyMod.getHourlySeries('bitcoin', 100);
  ok(rows.length === 72 && rows[0].ts < rows[71].ts, 'reader returns oldest->newest');
  const usd = hourlyMod.getHourlySeries('usd', 5);
  ok(usd.length === 5 && usd.every((r) => r.usd_price === 1), 'USD synthesizes as constant 1');

  // Status view carries the source label.
  const status = hourlyMod.hourlyStatus();
  ok(status.find((s) => s.coingecko_id === 'filecoin').source === 'binance:FILUSDT', 'diagnostics expose per-asset source');

  console.log('hourly auto-fill tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
