const { monthlyKlines, cachedMonths, cachedDayMonths, monthFromDayFiles, HOUR_MS } = require('./binance');
const { pnlAt, directionalCall } = require('./paper');

// Loading market history, and two small things everything downstream agrees on.
//
// This module used to run a whole analysis end to end — download, chunk, score,
// train, report. That run belonged to the single-pair screen, which was retired
// (THIS-RELEASE point 14), and roughly 470 lines went with it. What is left is
// the part every surviving path still needs:
//
//   monthList / loadSymbol / loadSymbolAll   getting candle history onto disk
//   MIN_CHUNKS                               the floor below which no run is honest
//   deriveShift                              placing a null rotation in the cycle
//   tuneTau                                  picking the directional threshold
//                                            from a fixed, pre-registered menu
//
// The name is now wider than the contents. It is kept because five modules
// import from it and renaming buys nothing the header does not already say.

const MIN_CHUNKS = 12;

// The pre-registered threshold menu tuneTau picks from. A FIXED grid, never a
// continuous scan: a scan would let the tuner shop, which is the freedom the
// null tests exist to price.
const TAU_GRID = [0, 0.34, 0.4, 0.45, 0.5, 0.55, 0.6];

// Threshold menu for the directional decision rule — a FIXED, pre-registered
// grid (never a continuous scan). tau=0 is "always in, direction only".
// Chosen on the chronological validation tail by paper P&L; ties go to the
// higher tau (fewer, more confident trades).
function tuneTau(valChunks, valProbs, tradeMap, geo) {
  const ladder = TAU_GRID.map((tau) => {
    let pnl = 0;
    let trades = 0;
    valChunks.forEach((c, i) => {
      const call = directionalCall(valProbs[i], tau);
      if (call === 0) return;
      const entryC = tradeMap.get(c.startTs + geo.entryOffsetH * HOUR_MS);
      const exitC = tradeMap.get(c.startTs + geo.exitOffsetH * HOUR_MS);
      if (!entryC || !exitC) return;
      pnl += pnlAt(call, entryC.open, exitC.open);
      trades++;
    });
    return { tau, pnl, trades };
  });
  let best = ladder[0];
  for (const row of ladder) {
    if (row.pnl > best.pnl || (row.pnl === best.pnl && row.tau > best.tau)) best = row;
  }
  return { tau: best.tau, tauLadder: ladder };
}

function monthList(startMonth, endMonth) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s || ''));
    if (!m) throw new Error(`bad month "${s}" (expected YYYY-MM)`);
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error(`bad month "${s}"`);
    return { year, month };
  };
  const a = parse(startMonth);
  const b = parse(endMonth);
  const out = [];
  let { year, month } = a;
  while (year < b.year || (year === b.year && month <= b.month)) {
    out.push({ year, month });
    if (out.length > 120) throw new Error('range too large (max 120 months)');
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  if (out.length === 0) throw new Error('end month is before start month');
  return out;
}

async function loadSymbol(symbol, months, onProgress) {
  const { currentAbortEpoch, throwIfAbortedSince } = require('./throttle');
  const epoch = currentAbortEpoch();
  const rows = [];
  const missing = [];
  for (const { year, month } of months) {
    throwIfAbortedSince(epoch);
    const mm = `${year}-${String(month).padStart(2, '0')}`;
    onProgress(`downloading ${symbol} ${mm}`);
    const monthRows = await monthlyKlines(symbol, year, month);
    if (monthRows === null) {
      // No published bundle. The month still counts as "missing" (that is
      // what tells the refresh flow to backfill day files), but any day
      // files already on disk are READ — the read side must see what the
      // coverage table counts (QC 70).
      missing.push(mm);
      const dayRows = monthFromDayFiles(symbol, year, month);
      if (dayRows) for (const r of dayRows) rows.push(r);
    } else for (const r of monthRows) rows.push(r); // no spread-push: keeps arg counts off the call stack
  }
  return { rows, missing };
}

// "All loaded data" mode: read exactly the months already cached on disk
// for this symbol — never touches the network. Both storage forms count:
// whole-month bundles AND day-file months (QC 70 — day files used to be
// invisible here, so sweeps ended months before the coverage table's "to"
// date). monthlyKlines is only called for months whose bundle file exists
// on disk, so it always cache-hits and the no-network guarantee holds.
async function loadSymbolAll(symbol, onProgress) {
  const { currentAbortEpoch, throwIfAbortedSince } = require('./throttle');
  const epoch = currentAbortEpoch();
  const rows = [];
  const monthly = new Set(cachedMonths(symbol));
  const list = [...new Set([...monthly, ...cachedDayMonths(symbol)])].sort();
  for (const mm of list) {
    throwIfAbortedSince(epoch);
    onProgress(`reading cached ${symbol} ${mm}`);
    const [year, month] = mm.split('-').map(Number);
    const monthRows = monthly.has(mm)
      ? await monthlyKlines(symbol, year, month)
      : monthFromDayFiles(symbol, year, month);
    if (monthRows) for (const r of monthRows) rows.push(r);
  }
  return { rows, missing: [], cachedMonthCount: list.length };
}

// Map a fractional null-shift request (0..1) onto a pair's own cycle of n
// weeks, keeping an 8-week buffer away from both ends. Distinct fractions
// can collapse to the same integer once n < requested shifts — callers
// group null samples by the DERIVED shift so duplicates never double-count.
function deriveShift(n, frac) {
  const usable = n - 16;
  if (usable < 4) throw new Error(`too few chunks (${n}) for null-shift calibration`);
  return Math.min(n - 1, Math.max(1, 8 + Math.round(frac * usable)));
}

module.exports = { monthList, deriveShift, loadSymbol, loadSymbolAll, MIN_CHUNKS, tuneTau };
