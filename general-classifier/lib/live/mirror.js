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
const { compareDecision } = require('../decisioncompare');
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
  // R17: a flat newest-10 window can miss decisions whose positions are still
  // OPEN. Cover at least the whole hold window (ceil(tHours/24) concurrent
  // positions) plus a 10-decision margin, so every unclosed position's decision
  // is re-verified, never just the newest 10. Floor at 10; caller may override.
  const holdChunks = Math.ceil((setup.configSnapshot && setup.configSnapshot.cell
    && setup.configSnapshot.cell.tHours ? setup.configSnapshot.cell.tHours : 24) / 24);
  const n = opts.recent || Math.max(10, holdChunks + 10);
  const recompute = opts.recompute || ((chunkMs) => signal.computeSignalForChunk(setup, chunkMs));
  const all = loadDecisions(setup.id, opts.dir).slice(-n);

  // A DECISION FROM A DIFFERENT ENGINE CANNOT BE RE-VERIFIED BY THIS ONE, and
  // reporting that as a BREAK is wrong. A break means the record and the engine
  // disagree about the SAME computation — that is drift, and it halts trading.
  // A record whose config_version is not this profile's was produced by other
  // arithmetic: its fingerprint pins that version, so recomputing it here always
  // differs, every time, for a reason that is not drift and that no amount of
  // investigation will resolve.
  //
  // This is not hypothetical tidiness. Carrying a book onto a profile brought
  // decisions stamped 'f1-v1-2026-08-11' into a profile computing under its own
  // version; all eight were reported as breaks and the profile was halted for
  // drift that did not exist. Counted and named separately now, so the operator
  // can see the history is there and see that it is not being vouched for.
  const mine = String((setup.configSnapshot || {}).configVersion || '');
  const foreign = mine ? all.filter((r) => r.config_version && r.config_version !== mine) : [];
  const records = mine ? all.filter((r) => !r.config_version || r.config_version === mine) : all;

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
    // carried in from another engine: shown, never vouched for, never a break
    foreign: foreign.length,
    foreignVersions: [...new Set(foreign.map((r) => r.config_version))],
    utc: opts.utc || new Date(opts.nowMs || 0).toISOString(),
    details: breaks.map((b) => ({ chunk_start: b.chunk_start, reason: b.reason })),
  };
}

module.exports = { checkSetup, loadDecisions, decisionsDir };
