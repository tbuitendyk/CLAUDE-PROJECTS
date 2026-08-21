// CACHE-WRITE GUARD (owner-ordered, 2026-07-31). A running screen/sweep
// reads the candle cache from its worker threads. A download that writes
// new month files mid-run hands later units a different history than
// earlier ones — one job, two datasets, and nothing in the output says so.
//
// While a batch runs, the guarded write paths refuse:
//   - Load Data and book-draft creation, outright (they exist to fetch);
//
// HONEST SCOPE — what this does NOT cover:
//   - the 6-hourly new-month auto-refresh is gated at its own timer in
//     server.js, not here;
//   - nothing else writes to the cache today. The run-level half of this guard
//     was removed with the single-run screen it protected: there is no longer
//     an endpoint that starts a run which might fetch.
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

function loadRefusal(runningId, action = 'Load Data') {
  if (!runningId) return null;
  return `refused while ${runningId} is running: ${action} writes the candle cache that job's workers are reading. Wait for it to finish.`;
}

module.exports = { monthList, loadRefusal };
