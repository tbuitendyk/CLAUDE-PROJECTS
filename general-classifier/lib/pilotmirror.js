// pilotmirror.js -- the pilot's MIRROR CHECK (review findings 26 + 7).
//
// The pilot's entire premise is that every live fill has a 1:1 paper twin — the
// same frozen-F1 committee call the forward book would make. That claim was
// ADVERTISED (the UI names "mirror-breaks") but never COMPUTED. This module is
// the missing comparison: for each recorded live decision, it takes a fresh
// recompute of the F1 call for that same chunk (computeSignalForChunk, which
// reads CURRENT data) and asks "does it still reproduce what we traded on?"
//
// A break means the instrument is unreliable, not that the idea is wrong (the
// project's gate philosophy): the day-file data the live decision used was later
// revised, or the monthly bundle published different candles (finding 7), or the
// engine/config changed under us. Any of those makes the live book drift from
// its twin — so a break HALTS new entries until it is examined, exactly the
// "fix the instrument and measure again" rule.
//
// Pure and side-effect free except the tiny state helpers; the CLI wrapper
// (pilot-mirror.js) does the recompute and the halt. This split keeps the
// decision logic unit-testable without the engine or the network.
const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, '..', 'data', 'pilot', 'decisions');
const MIRROR_FILE = path.join(__dirname, '..', 'data', 'pilot', 'mirror.json');
// A finalized candle can still be revised by a hair; a decision-price move under
// this is treated as a benign revision, over it as a real divergence. GUESSED,
// deliberately tight — the fidelity metric the pilot measures is in this range.
const PRICE_TOL = 0.005;

// Compare ONE recorded live decision to its fresh recompute. Never throws; a
// recompute that could not run yet (data not caught up) is PENDING, not a break.
function compareDecision(recorded, recomputed) {
  if (!recomputed || recomputed.found === false) {
    // A recorded decision had a COMPLETE feature window at production time
    // (window_complete). If the recompute now cannot find that window, the data
    // it rode has VANISHED/regressed under it — a real divergence, not benign
    // 'pending' (re-review). Only a record without the flag (legacy/unknown)
    // stays pending.
    if (recorded.window_complete) {
      const note = (recomputed && recomputed.note) || 'recompute found no data';
      return { chunk_start: recorded.chunk_start, ok: false, break: true,
        reason: `data vanished under a completed decision — ${note}`,
        recorded: { side: recorded.side, per_member: recorded.per_member, input_hash: recorded.input_hash },
        recomputed: null };
    }
    return { chunk_start: recorded.chunk_start, ok: true, break: false, pending: true,
      reason: (recomputed && recomputed.note) || 'no recompute available' };
  }
  const reasons = [];
  if (recorded.side !== recomputed.side) {
    reasons.push(`side ${recorded.side} -> ${recomputed.side}`);
  }
  const rv = Array.isArray(recorded.per_member) ? recorded.per_member : [];
  const cv = Array.isArray(recomputed.per_member) ? recomputed.per_member : [];
  if (rv.length !== cv.length || rv.some((v, i) => v !== cv[i])) {
    reasons.push(`votes [${rv}] -> [${cv}]`);
  }
  const rp = recorded.decision_price;
  const cp = recomputed.decision_price;
  if (recomputed.price_pending) {
    // The entry candle (+97h) has not closed/cached yet, so the recompute cannot
    // read its open — the live producer records the decision at that open ~1h
    // before the candle caches (2026-08-12). This is benign timing, NOT a
    // divergence: DEFER the price check to a later tick. Side/votes/hash above are
    // fully verified, and once the candle caches (price_pending clears) the normal
    // PRICE_TOL check applies. This does not weaken finding-7: a VANISHED feature
    // window still returns found:false and breaks via the block at the top.
  } else if (rp != null && cp != null && rp !== 0) {
    const dev = Math.abs(cp - rp) / Math.abs(rp);
    if (dev > PRICE_TOL) reasons.push(`decision_price ${rp} -> ${cp} (${(dev * 100).toFixed(2)}%)`);
  } else if ((rp == null) !== (cp == null)) {
    reasons.push(`decision_price ${rp} -> ${cp}`);
  }
  // the input hash covers the DECISION MACHINERY (chunk, votes, quorum, band,
  // side, symbol, train cutoff, config version) but NOT the price. An unexplained
  // hash divergence therefore means a config/engine drift changed a covered field
  // — a REAL break now, not merely informational (re-review). Price is checked
  // separately above with its tolerance, so a benign price revision won't trip it.
  const hashDiff = !!(recorded.input_hash && recomputed.input_hash
    && recorded.input_hash !== recomputed.input_hash);
  if (hashDiff) reasons.push(`input_hash ${recorded.input_hash} -> ${recomputed.input_hash} (config/engine drift)`);
  const isBreak = reasons.length > 0;
  return {
    chunk_start: recorded.chunk_start,
    ok: !isBreak,
    break: isBreak,
    hash_diff: hashDiff,
    reason: isBreak ? reasons.join('; ') : 'match',
    recorded: { side: recorded.side, per_member: rv, decision_price: rp, input_hash: recorded.input_hash },
    recomputed: { side: recomputed.side, per_member: cv, decision_price: cp, input_hash: recomputed.input_hash },
  };
}

function loadDecisions(dir = DECISIONS_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) { /* skip torn */ }
  }
  return out.sort((a, b) => String(a.chunk_start).localeCompare(String(b.chunk_start)));
}

// Persist the live decision at production time. Keyed by chunk_start so a re-ship
// within the same period overwrites rather than duplicates. This is the record
// the recompute is checked against — NOT a fresh read (finding 7).
function writeDecision(record, dir = DECISIONS_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const key = String(record.chunk_start).replace(/[^0-9A-Za-z]/g, '').slice(0, 20) || 'na';
  const file = path.join(dir, `${key}.json`);
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, file);
  return file;
}

function writeMirror(result, file = MIRROR_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(result));
  fs.renameSync(tmp, file);
}

function readMirror(file = MIRROR_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

module.exports = {
  compareDecision, loadDecisions, writeDecision, writeMirror, readMirror,
  DECISIONS_DIR, MIRROR_FILE, PRICE_TOL,
};
