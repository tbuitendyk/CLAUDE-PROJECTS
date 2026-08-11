#!/usr/bin/env node
// pilot-mirror.js -- run the MIRROR CHECK over recorded live decisions and write
// the verdict for the screen (review findings 26 + 7).
//
// For every recent live decision (data/pilot/decisions/*.json), recompute the F1
// call for that chunk against CURRENT data and compare side + per-member votes +
// decision price. A divergence means the data the live trade rode has since been
// revised, or the bundle published different candles, or the engine changed — the
// live book has drifted from its paper twin and the instrument is unreliable.
//
// Output: writes data/pilot/mirror.json (the screen reads it) and exits 2 if any
// break is found, so the tick wrapper can trip the box HALT. Exit 0 = all clear
// (or nothing to check / not yet recomputable). Exit 1 = internal error.
const { computeSignalForChunk } = require('./lib/pilotsignal');
const m = require('./lib/pilotmirror');

const LOOKBACK_DAYS = 12; // recheck the recent window; a 137h hold + settle fits

(async () => {
  try {
    const decisions = m.loadDecisions();
    const now = Date.now();
    const cutoff = now - LOOKBACK_DAYS * 86400000;
    const recent = decisions.filter((d) => {
      const t = Date.parse(d.chunk_start);
      return Number.isFinite(t) && t >= cutoff;
    });
    const results = [];
    for (const d of recent) {
      let recomputed;
      try {
        recomputed = await computeSignalForChunk(Date.parse(d.chunk_start));
      } catch (e) {
        recomputed = { found: false, note: 'recompute error: ' + e.message };
      }
      results.push(m.compareDecision(d, recomputed));
    }
    const breaks = results.filter((r) => r.break);
    const pending = results.filter((r) => r.pending);
    const out = {
      utc: new Date(now).toISOString(),
      checked: results.length,
      breaks: breaks.length,
      pending: pending.length,
      ok: breaks.length === 0,
      results,
    };
    m.writeMirror(out);
    console.log(`mirror: checked ${results.length}, breaks ${breaks.length}, pending ${pending.length}`);
    for (const b of breaks) console.log(`  BREAK ${b.chunk_start}: ${b.reason}`);
    process.exit(breaks.length ? 2 : 0);
  } catch (err) {
    // FAIL LOUD, not silent (re-review): a mirror that cannot run is an
    // unreliable instrument. Stamp an ok:false verdict so the screen and the VPS
    // alert timer can see the drift-detector has stopped verifying (a stale or
    // ok:false mirror.json is an alert condition), instead of the error being
    // swallowed by the tick's `|| true`.
    try {
      m.writeMirror({
        utc: new Date().toISOString(),
        checked: 0, breaks: 0, pending: 0, ok: false,
        error: String(err && err.message || err).slice(0, 300),
        results: [],
      });
    } catch (_) { /* best effort */ }
    process.stderr.write('pilot-mirror FAILED: ' + err.message + '\n');
    process.exit(1);
  }
})();
