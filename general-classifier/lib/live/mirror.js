// Per-setup mirror (IMPLEMENTATION-PLAN 6.1; NEXT-RELEASE point 16). The
// generalized twin of lib/pilotmirror.js: for each active setup, recompute its
// recorded live decisions against fresh data and flag any that no longer
// reproduce (the paper twin has drifted from the live book) — the same drift
// detector that guards F1, per setup.
//
// REUSES pilotmirror.compareDecision unchanged (one comparison rule for both
// rails; the QC-110 price_pending + finding-7 vanished-window semantics come
// with it). Decisions are the records live-produce.js wrote to
// data/live/decisions/<setupId>.jsonl; the recompute is
// lib/live/signal.computeSignalForChunk. Read-only: a break here is surfaced
// (and, once the control plane wires it, disarms THAT setup) — this module
// only DETECTS.
const fs = require('fs');
const path = require('path');
const { compareDecision } = require('../pilotmirror');
const signal = require('./signal');

function decisionsDir() {
  return process.env.GC_LIVE_DECISIONS
    || path.join(__dirname, '..', '..', 'data', 'live', 'decisions');
}

// Load a setup's decision records (newline-delimited JSON, append-only; keep
// the LAST record per chunk_start so a re-ship within a period is one entry).
function loadDecisions(setupId, dir = decisionsDir()) {
  const f = path.join(dir, `${setupId}.jsonl`);
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (_) { return []; }
  const byChunk = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); byChunk.set(r.chunk_start, r); } catch (_) { /* torn line */ }
  }
  return [...byChunk.values()].sort((a, b) => String(a.chunk_start).localeCompare(String(b.chunk_start)));
}

// Check one setup: recompute its most recent N decisions and compare. Never
// throws — a recompute that cannot run yet is PENDING, a real divergence is a
// BREAK (compareDecision decides which). `recompute` is injectable for tests.
async function checkSetup(setup, opts = {}) {
  const n = opts.recent || 10;
  const recompute = opts.recompute || ((chunkMs) => signal.computeSignalForChunk(setup, chunkMs));
  const records = loadDecisions(setup.id, opts.dir).slice(-n);
  const results = [];
  for (const rec of records) {
    let re = null;
    try { re = await recompute(Date.parse(rec.chunk_start)); }
    catch (e) { re = { found: false, note: 'recompute error: ' + (e && e.message) }; }
    results.push(compareDecision(rec, re));
  }
  const breaks = results.filter((r) => r.break);
  const pending = results.filter((r) => r.pending);
  return {
    setup_id: setup.id,
    ok: breaks.length === 0,
    checked: results.length,
    breaks: breaks.length,
    pending: pending.length,
    utc: opts.utc || new Date(opts.nowMs || 0).toISOString(),
    details: breaks.map((b) => ({ chunk_start: b.chunk_start, reason: b.reason })),
  };
}

module.exports = { checkSetup, loadDecisions, decisionsDir };
