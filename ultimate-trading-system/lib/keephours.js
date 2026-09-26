// KEEPING A RUN'S HOURS (3.271.0): the half of lib/hours.js that writes. The
// copies are made here, at Start stage 1 and when an older set is brought
// forward, and deleted here with the last set that names them. The pricing
// workers never reach this module (tests/test-pool.js): they only read copies,
// through lib/hours.js, and a worker that could write one could change the run
// it is pricing.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { cachedMonths, cachedDayMonths, monthFromDayFiles, cachePath } = require('./binance');
const { DATA_DIR, HOURS_DIR, FILE_RE, digestOf, forget, readCoin } = require('./hours');

let tmpSeq = 0;
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ONE MONTH AS THE BOX HOLDS IT, the way every launch has read it: the month's
// bundle when there is one, else its day files in day order. Never the network.
function monthOnDisk(symbol, mm) {
  const [y, m] = mm.split('-').map(Number);
  try {
    const rows = JSON.parse(fs.readFileSync(cachePath(symbol, y, m), 'utf8'));
    // an empty bundle is a month not held (lib/binance.js monthlyKlines)
    if (Array.isArray(rows) && rows.length) return rows;
  } catch (_) { /* no bundle: its day files, if any */ }
  return monthFromDayFiles(symbol, y, m) || [];
}
// EVERY HOUR A LAUNCH READS FOR ONE COIN, off the box as it is at the press:
// every month held, or only the months from `start` to `end` when all loaded data
// is not ticked -- which is what those two boxes on Sweep say they do
function rowsOnDisk(symbol, { allLoaded = true, startMonth = null, endMonth = null } = {}) {
  let months = [...new Set([...cachedMonths(symbol), ...cachedDayMonths(symbol)])].sort();
  if (allLoaded === false) {
    months = months.filter((mm) => (!startMonth || mm >= startMonth) && (!endMonth || mm <= endMonth));
  }
  const rows = [];
  for (const mm of months) for (const r of monthOnDisk(symbol, mm)) rows.push(r);
  return rows;
}

// Keep one coin's hours: the copy is written once, under its fingerprint, and
// what the set records is returned -- the first and last hour, how many, the
// fingerprint and where the copy is.
function keepCoin(symbol, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`the box holds no hours of ${symbol}`);
  const text = JSON.stringify(rows);
  const sha256 = sha(text);
  const file = `hours/${symbol}-${sha256.slice(0, 32)}.json.gz`;
  const full = path.join(DATA_DIR, file);
  // a copy already there is used only once it proves to be these hours
  let whole = false;
  if (fs.existsSync(full)) {
    try { readCoin(symbol, { file, sha256 }); whole = true; } catch (_) { forget(file); }
  }
  if (!whole) {
    fs.mkdirSync(HOURS_DIR, { recursive: true });
    const tmp = `${full}.tmp${process.pid}-${++tmpSeq}`;
    fs.writeFileSync(tmp, zlib.gzipSync(text, { level: 1 }));
    fs.renameSync(tmp, full);
  }
  let fromTs = Infinity;
  let toTs = -Infinity;
  for (const r of rows) {
    if (r && Number.isFinite(r.ts)) { if (r.ts < fromTs) fromTs = r.ts; if (r.ts > toTs) toTs = r.ts; }
  }
  return { fromTs: Number.isFinite(fromTs) ? fromTs : null, toTs: Number.isFinite(toTs) ? toTs : null, count: rows.length, sha256, file };
}
// what a set records, from each coin's entry
function recordOf(coins, at = new Date().toISOString()) {
  const sorted = {};
  for (const sym of Object.keys(coins).sort()) sorted[sym] = coins[sym];
  return { at, digest: digestOf(sorted), coins: sorted };
}
// AT THE PRESS: every coin the run's units read, kept. Refuses -- before anything
// is written about the set -- a coin the box holds no hours of.
function keepHours(symbols, range) {
  const coins = {};
  for (const sym of [...new Set((symbols || []).filter(Boolean))].sort()) coins[sym] = keepCoin(sym, rowsOnDisk(sym, range));
  return recordOf(coins);
}

// the copies a set names, deleted when no set still names them; `inUse` is
// every file any set names
function removeUnused(files, inUse) {
  const keep = new Set(inUse);
  let removed = 0;
  for (const f of new Set(files)) {
    if (keep.has(f) || !FILE_RE.test(f)) continue;
    try { fs.rmSync(path.join(DATA_DIR, f), { force: true }); removed++; forget(f); } catch (_) { /* gone already */ }
  }
  return removed;
}

module.exports = { rowsOnDisk, keepCoin, keepHours, recordOf, removeUnused };
