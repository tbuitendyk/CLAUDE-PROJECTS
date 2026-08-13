#!/usr/bin/env node
// pilot-backfill-standdowns.js -- one-shot: reconstruct the daily-history rows
// that were never recorded because FLAT (stand-down) calls ship no intent and,
// until 2026-08-13, were written nowhere (owner: the pilot screen's daily
// history showed only trade days).
//
// For each daily chunk_start from FROM (default 2026-08-08) through yesterday
// that has NO record in either store (decisions/ = shipped trades,
// standdowns/ = recorded stand-downs), recompute the committee call with the
// SAME frozen engine + cached candles the mirror check uses
// (computeSignalForChunk — deterministic), and write it to the stand-down
// store marked backfilled:true so the screen labels it honestly as a
// recompute, not a live record.
//
// Read-only with respect to trading: touches only data/pilot/standdowns/,
// which feeds the screen's history and NOTHING else (never the mirror's
// decision store, never an intent). Idempotent — records that exist are
// skipped, so re-running is safe.
//
// A recomputed side of LONG/SHORT for a day with no shipped intent would mean
// the producer was not running (or had no data) that day — recorded verbatim
// with that note, never invented as a fill.
const { computeSignalForChunk } = require('./lib/pilotsignal');
const mirror = require('./lib/pilotmirror');

const DAY_MS = 24 * 3600 * 1000;
const FROM = Date.parse(process.argv[2] || '2026-08-08T00:00:00Z');
const THROUGH = Date.now() - DAY_MS; // through yesterday's chunk; today is the preview's job

(async () => {
  const have = new Set([
    ...mirror.loadDecisions().map((d) => String(d.chunk_start)),
    ...mirror.loadStandDowns().map((d) => String(d.chunk_start)),
  ]);
  let wrote = 0, skipped = 0, incomplete = 0;
  for (let ts = FROM; ts <= THROUGH; ts += DAY_MS) {
    const iso = new Date(ts).toISOString();
    if (have.has(iso)) { skipped++; continue; }
    let r;
    try { r = await computeSignalForChunk(ts); }
    catch (e) { console.log(`  ${iso.slice(0, 10)}  ERROR: ${e.message}`); continue; }
    if (!r.found) { incomplete++; console.log(`  ${iso.slice(0, 10)}  no complete window: ${r.note}`); continue; }
    mirror.writeStandDown({
      chunk_start: r.chunk_start, side: r.side, per_member: r.per_member,
      quorum: r.quorum, band_pct: r.band_pct,
      decision_price: r.decision_price ?? null, input_hash: r.input_hash || null,
      config_version: r.config_version,
      produced_utc: new Date().toISOString(),
      backfilled: true,
      ...(r.side !== 'FLAT' ? { note: 'recompute says a trade was called but no intent shipped that day — producer gap, shown for the record' } : {}),
    });
    wrote++;
    console.log(`  ${iso.slice(0, 10)}  ${r.side}  votes=[${(r.per_member || []).join(',')}]  backfilled`);
  }
  console.log(`backfill done: ${wrote} written, ${skipped} already recorded, ${incomplete} without a complete window`);
})().catch((e) => { console.error('backfill FAILED: ' + e.message); process.exit(1); });
