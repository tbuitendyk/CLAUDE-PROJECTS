// CACHE-WRITE GUARD (owner-ordered, 2026-07-31). A running screen/sweep
// reads the candle cache from its worker threads. A download that writes
// new month files mid-run hands later units a different history than
// earlier ones — one job, two datasets, and nothing in the output says so.
//
// While a batch runs:
//   - Load Data is refused outright (its whole purpose is to write months);
//   - a single classifier run is refused ONLY if it would have to fetch.
//     "All loaded data" mode and fully-cached ranges read the cache without
//     ever touching the network (lib/pipeline.js loadSymbolAll) — those
//     stay allowed.
// Pure decision functions, exported for the tests; server.js wires them.

// 'YYYY-MM' walk, inclusive. Malformed input yields [] — the endpoint has
// already validated format, so this is belt-and-braces, not a fallback.
function monthList(startMonth, endMonth) {
  const m = /^(\d{4})-(\d{2})$/;
  const a = m.exec(startMonth || '');
  const b = m.exec(endMonth || '');
  if (!a || !b) return [];
  const out = [];
  let y = Number(a[1]);
  let mo = Number(a[2]);
  const yEnd = Number(b[1]);
  const moEnd = Number(b[2]);
  while (y < yEnd || (y === yEnd && mo <= moEnd)) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
    mo++;
    if (mo > 12) { mo = 1; y++; }
    if (out.length > 1200) return []; // a century of months means garbage input
  }
  return out;
}

function loadRefusal(runningId) {
  if (!runningId) return null;
  return `refused while ${runningId} is running: Load Data writes the candle cache that job's workers are reading. Wait for it to finish.`;
}

function runRefusal(runningId, { allLoaded, tradeSymbol, compareSymbol, startMonth, endMonth }, cachedMonthsFn) {
  if (!runningId) return null;
  if (allLoaded) return null; // reads only what is already on disk; fetches nothing
  const missing = [];
  for (const sym of [tradeSymbol, compareSymbol]) {
    const have = new Set(cachedMonthsFn(sym));
    for (const mm of monthList(startMonth, endMonth)) {
      if (!have.has(mm)) missing.push(`${sym} ${mm}`);
    }
  }
  if (!missing.length) return null; // fully cached: a read-only run is no hazard
  const shown = missing.slice(0, 3).join(', ') + (missing.length > 3 ? ', …' : '');
  return `refused while ${runningId} is running: this run would download ${missing.length} uncached month(s) (${shown}) into the candle cache that job's workers are reading. Tick "all loaded data", or wait for it to finish.`;
}

module.exports = { monthList, loadRefusal, runRefusal };
