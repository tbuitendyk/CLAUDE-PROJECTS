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
// THE FEE IS NOW REQUIRED, AND THAT IS THE WHOLE FIX (2026-08-21).
//
// This priced its ladder of candidate thresholds by calling pnlAt with no fee
// argument, so the paper default of $0.125 a leg took over — always, silently,
// and with no way for a caller to say otherwise. The live signal path declares
// a fee of 0. So the threshold that decides whether a directional trade happens
// at all was chosen against one trading cost and then traded against another.
//
// Proved by hand: on periods whose edge sits near the fee, the two assumptions
// pick different thresholds (0.55 against 0.50) and trade a different number of
// periods (38 against 45). On a strong edge they agree — so this bites exactly
// where the edge is thin, which is where it matters.
//
// WHICH fee is correct is not decided here. That is a question about how the
// system is meant to trade and it belongs to the owner. What is fixed is that
// the tuner can no longer disagree with the caller BY ACCIDENT: every caller
// passes the same fee it prices its own simulation at, and forgetting throws
// rather than quietly reverting to a number nobody chose.
function tuneTau(valChunks, valProbs, tradeMap, geo, feePerLeg) {
  if (!Number.isFinite(feePerLeg) || feePerLeg < 0) {
    throw new TypeError(`tuneTau: feePerLeg is required and must be a real cost per leg — got ${JSON.stringify(feePerLeg)}. `
      + 'It used to default to the paper fee while the live path charged something else.');
  }
  const ladder = TAU_GRID.map((tau) => {
    let pnl = 0;
    let trades = 0;
    valChunks.forEach((c, i) => {
      const call = directionalCall(valProbs[i], tau);
      if (call === 0) return;
      const entryC = tradeMap.get(c.startTs + geo.entryOffsetH * HOUR_MS);
      const exitC = tradeMap.get(c.startTs + geo.exitOffsetH * HOUR_MS);
      if (!entryC || !exitC) return;
      // Same rule as the labeller: an invented candle is not a price anything
      // traded at, so it cannot price a candidate threshold either.
      if (entryC.filled || exitC.filled) return;
      pnl += pnlAt(call, entryC.open, exitC.open, feePerLeg);
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

// WHAT CONDITION IS THIS SERIES IN (added 2026-08-21).
//
// Every number the system reports is worked out from these candles, and a
// month that is short, holed, duplicated, out of order or carrying impossible
// prices used to be loaded WITHOUT A WORD. A rule tested against it is scored
// on data that is not what it appears to be, and the score comes back looking
// perfectly ordinary — which is the only failure shape that reaches a trading
// decision unnoticed.
//
// This does not refuse anything. Refusing is a decision about what the owner
// may run, and that is theirs. It makes the condition SAYABLE, so a screen can
// say it.
// `monthCounts` maps 'YYYY-MM' to how many candles that month contributed. It
// is needed because a month TRUNCATED AT THE END has no internal gap — first to
// last is unbroken — so nothing in the rows themselves can reveal it. Only
// knowing which month it was supposed to be can.
// One month's contribution: how many candles, and the first and last hour they
// cover. The two timestamps are what make "short at which end" answerable.
function tally(rows) {
  if (!rows || !rows.length) return { count: 0, first: null, last: null };
  let first = Infinity; let last = -Infinity;
  for (const r of rows) { if (r && Number.isFinite(r.ts)) { if (r.ts < first) first = r.ts; if (r.ts > last) last = r.ts; } }
  return { count: rows.length, first: Number.isFinite(first) ? first : null, last: Number.isFinite(last) ? last : null };
}

function describeSeries(rows, monthCounts = null) {
  const out = {
    candles: rows.length,
    distinctHours: 0,
    duplicateHours: 0,
    outOfOrder: 0,
    gaps: 0,
    missingHours: 0,
    badPrices: 0,
    nonPositivePrices: 0,
    lowAboveHigh: 0,
    invented: 0,
    shortMonths: [],
  };
  if (monthCounts) {
    // WHICH END IS IT SHORT AT. That question answers it, where counting alone
    // cannot. A month missing hours at the START is a pair that had not started
    // trading yet — ordinary, for the first month held. A month missing hours
    // at the END is truncated, and that is a fault unless the month is not over.
    //
    // The first version of this simply skipped the first and last month, which
    // is crude and, on a single-month cache, skips the only month there is —
    // so a month cut off a third of the way through reported nothing at all.
    const keys = Object.keys(monthCounts).sort();
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    keys.forEach((mm, i) => {
      const c = monthCounts[mm];
      if (!c || !c.count) return;
      const [y, m] = mm.split('-').map(Number);
      const from = Date.UTC(y, m - 1, 1);
      const to = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
      const expect = (to - from) / HOUR_MS;
      if (c.count >= expect) return;
      const startsLate = c.first > from;
      const endsEarly = c.last < to - HOUR_MS;
      const firstHeld = i === 0;
      // ONLY THE CURRENT MONTH IS EXCUSED FOR ENDING EARLY. "It is the newest
      // month held" is not a reason — the data source publishes past months
      // complete, so a past month that stops early is truncated whether or not
      // anything newer sits beside it. Excusing the newest held month meant a
      // cache holding ONE month could never report that month as short at all,
      // which is precisely the case the attack tests.
      const excusedStart = startsLate && firstHeld;
      const excusedEnd = endsEarly && mm === thisMonth;
      // Short at an end that has a reason, and short nowhere else: not a fault.
      const unexplained = (startsLate && !excusedStart) || (endsEarly && !excusedEnd)
        || (!startsLate && !endsEarly); // short in the middle, i.e. holes
      if (!unexplained) return;
      out.shortMonths.push({
        month: mm, have: c.count, expect,
        where: startsLate && endsEarly ? 'both ends' : (startsLate ? 'the start' : (endsEarly ? 'the end' : 'the middle')),
      });
    });
  }
  if (!rows.length) return out;
  const seen = new Set();
  let prev = null;
  for (const r of rows) {
    if (!r) { out.badPrices += 1; continue; }
    if (seen.has(r.ts)) out.duplicateHours += 1; else seen.add(r.ts);
    if (prev !== null) {
      if (r.ts <= prev) out.outOfOrder += 1;
      else {
        const missing = Math.round((r.ts - prev) / HOUR_MS) - 1;
        if (missing > 0) { out.gaps += 1; out.missingHours += missing; }
      }
    }
    prev = r.ts;
    if (r.filled) out.invented += 1;
    const vals = [r.open, r.high, r.low, r.close];
    if (vals.some((v) => !Number.isFinite(Number(v)))) out.badPrices += 1;
    else {
      if (vals.some((v) => Number(v) <= 0)) out.nonPositivePrices += 1;
      if (Number(r.low) > Number(r.high)) out.lowAboveHigh += 1;
    }
  }
  out.distinctHours = seen.size;
  return out;
}

// True when there is anything worth telling the owner about.
function seriesIsClean(q) {
  return !(q.duplicateHours || q.outOfOrder || q.gaps || q.badPrices
    || q.nonPositivePrices || q.lowAboveHigh || (q.shortMonths && q.shortMonths.length));
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
  const monthCounts = {};
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
      monthCounts[mm] = tally(dayRows);
    } else {
      for (const r of monthRows) rows.push(r); // no spread-push: keeps arg counts off the call stack
      monthCounts[mm] = tally(monthRows);
    }
  }
  return { rows, missing, quality: describeSeries(rows, monthCounts) };
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
  const monthCounts = {};
  for (const mm of list) {
    throwIfAbortedSince(epoch);
    onProgress(`reading cached ${symbol} ${mm}`);
    const [year, month] = mm.split('-').map(Number);
    const monthRows = monthly.has(mm)
      ? await monthlyKlines(symbol, year, month)
      : monthFromDayFiles(symbol, year, month);
    if (monthRows) for (const r of monthRows) rows.push(r);
    monthCounts[mm] = tally(monthRows);
  }
  return { rows, missing: [], cachedMonthCount: list.length, quality: describeSeries(rows, monthCounts) };
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

module.exports = { monthList, deriveShift, loadSymbol, loadSymbolAll, MIN_CHUNKS, tuneTau, describeSeries, seriesIsClean };
