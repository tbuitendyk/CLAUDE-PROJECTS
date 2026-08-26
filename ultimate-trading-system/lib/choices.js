// NAMING THE CHOICES ON ROWS RECORDED BEFORE THEY CARRIED THEM
// (owner order, 2026-08-26: "you need to record that information for each
// row. i'm sure it can be recovered").
//
// A replication row recorded before 2026-08-26 does not say which decision,
// band or 24/5 choice made it — those were in hand at the write site and
// never written. The owner was right that they are recoverable, and the key
// is WRITE ORDER: the same pass of the same loop appended one census row for
// a unit and then that unit's replication rows, into two append-only files.
// Both files therefore hold the same units in the same order. Walking them
// in lockstep hands every replication row its unit's census record — which
// carries the decision, the band choice and the 24/5 choice — and the order
// disambiguates even the units that agree on every recorded field: two
// units on the same coin at the same fixed band, differing only in choices
// the rows never carried, CANNOT be told apart by matching fields, and CAN
// by position. (For the record: a first answer to the owner said this was
// unrecoverable. That answer had checked only field matching and stated the
// dead end as an impossibility — the exact unverified-claim fault the house
// rules exist to stop.)
//
// WHAT THIS NEVER DOES: touch the rows. The recovered names live in a small
// sidecar of unit spans beside the store, rebuilt on demand like the totals
// — the rows are the record and stay byte-identical (QC 74).
//
// HONESTY RULES, in order of application:
//   * a span of rows is named only by a census record that MATCHES it on
//     every field both files carry (coin, contexts, chunk shape, band %,
//     copy tag);
//   * a census record with no span claims nothing and is skipped (a unit
//     can record zero replication rows) — but only within a bounded
//     look-ahead, because an unbounded search could leap an interrupt
//     boundary and derail every name after it;
//   * after matching, the named choices within one coin-and-copy group must
//     all DIFFER — the run scored each combination once, so a duplicate
//     proves a misalignment, and every claimant loses its name rather than
//     one keeping a guess;
//   * every count (named, unnamed, skipped, cleared) is saved with the
//     result and shown, never swallowed.
const fs = require('fs');
const path = require('path');
const rowstore = require('./rowstore');

const UNITS_V = 1;
// How far past the pointer a span's census record may sit and still be
// claimed. The records passed over are units that recorded no rows; a gap
// longer than this reads as divergence and the span goes unnamed instead.
const LOOKAHEAD = 64;

function unitsFile(runId) {
  return path.join(rowstore.storeDir(runId), 'replication.units.json');
}

// One parsed sidecar in hand, stamp-and-size guarded — same shape and same
// reasons as the totals slot in lib/replication.js.
let unitsInHand = null;   // { runId, mtimeMs, size, units }

function readUnits(runId) {
  let st;
  try { st = fs.statSync(unitsFile(runId)); } catch (_) {
    if (unitsInHand && unitsInHand.runId === runId) unitsInHand = null;
    return null;
  }
  if (unitsInHand && unitsInHand.runId === runId
    && unitsInHand.mtimeMs === st.mtimeMs && unitsInHand.size === st.size) {
    return unitsInHand.units;
  }
  try {
    const units = JSON.parse(fs.readFileSync(unitsFile(runId), 'utf8'));
    unitsInHand = { runId, mtimeMs: st.mtimeMs, size: st.size, units };
    return units;
  } catch (_) { return null; }
}

function writeUnits(runId, units) {
  const f = unitsFile(runId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(units));
  fs.renameSync(tmp, f);
  try {
    const st = fs.statSync(f);
    unitsInHand = { runId, mtimeMs: st.mtimeMs, size: st.size, units };
  } catch (_) { unitsInHand = null; }
}

// The fields BOTH files carry for a unit, as one comparable string.
const sigOf = (r) => `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}|${r.bandPct}|${r.nullDealSeed ?? ''}`;
// The coin-and-copy group a unit belongs to: everything but the band %.
const groupKeyOf = (r) => `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}|${r.nullDealSeed ?? ''}`;

// The full pass. Streams the replication rows once (run it off the answering
// thread for a big store — lib/choices-worker.js), reads the census whole
// (one row per unit, small by construction). Returns null when either file
// is missing — there is nothing to match against, and saying so beats a
// sidecar full of nulls.
function buildAndSaveUnits(runId, onProgress) {
  if (!rowstore.exists(runId, 'replication') || !rowstore.exists(runId, 'census')) return null;
  const census = [];
  rowstore.each(runId, 'census', (r) => {
    census.push({
      sig: sigOf(r),
      d: r.decision ?? null,
      b: r.bandMode ?? null,
      w: r.weekdaysOnly ?? null,
      k: r.key ?? null,
    });
  });

  const spans = [];
  const groupKeys = [];      // span index -> coin-and-copy group, walk-local
  let cur = null;            // { at, n, sig, group, labels:Set }
  let p = 0;                 // census pointer
  let named = 0; let unnamed = 0; let skipped = 0;
  let rowsSeen = 0;

  const close = () => {
    if (!cur) return;
    // Claim the next census record with this span's signature, within the
    // bounded look-ahead. Records passed over recorded no rows of their own.
    let hit = -1;
    for (let j = p; j < census.length && j < p + LOOKAHEAD; j++) {
      if (census[j].sig === cur.sig) { hit = j; break; }
    }
    if (hit >= 0) {
      const u = census[hit];
      skipped += hit - p;
      p = hit + 1;
      spans.push({ at: cur.at, n: cur.n, d: u.d, b: u.b, w: u.w, k: u.k });
      named++;
    } else {
      spans.push({ at: cur.at, n: cur.n, d: null, b: null, w: null, k: null });
      unnamed++;
    }
    groupKeys.push(cur.group);
    cur = null;
  };

  rowstore.each(runId, 'replication', (r, at) => {
    rowsSeen++;
    if (onProgress && rowsSeen % 1000000 === 0) onProgress(rowsSeen);
    const sig = sigOf(r);
    const label = r.declaredLabel ?? '';
    // A new unit begins when the shared fields change — or when a label
    // repeats, because one unit scores each configuration once, so a repeat
    // is the next unit even when every shared field agrees (two units on
    // the same coin at the same fixed band).
    if (!cur || sig !== cur.sig || cur.labels.has(label)) {
      close();
      cur = { at, n: 0, sig, group: groupKeyOf(r), labels: new Set() };
    }
    cur.labels.add(label);
    cur.n++;
    return true;
  });
  close();

  // A coin-and-copy group scored each combination of choices once. Two spans
  // in one group claiming the SAME choices prove a misalignment somewhere
  // between them — strip every claimant rather than let one wear a guess.
  let cleared = 0;
  const claims = new Map();   // group -> Map(choices -> [span indexes])
  spans.forEach((s, i) => {
    if (s.d == null && s.b == null && s.w == null) return;
    let g = claims.get(groupKeys[i]);
    if (!g) { g = new Map(); claims.set(groupKeys[i], g); }
    const ck = `${s.d}|${s.b}|${s.w}`;
    let list = g.get(ck);
    if (!list) { list = []; g.set(ck, list); }
    list.push(i);
  });
  for (const g of claims.values()) {
    for (const list of g.values()) {
      if (list.length <= 1) continue;
      for (const i of list) {
        spans[i] = { at: spans[i].at, n: spans[i].n, d: null, b: null, w: null, k: null };
        cleared++;
        named--;
        unnamed++;
      }
    }
  }

  const out = {
    v: UNITS_V,
    builtAt: new Date().toISOString(),
    source: 'matched against the run\'s census records in the order both were written',
    rowsSeen,
    named,
    unnamed,
    censusSkipped: skipped,
    cleared,
    spans,
  };
  writeUnits(runId, out);
  return out;
}

// ---- the background recovery, one per run, kindest priority -----------------
const builds = new Map();   // runId -> { scanned, startedAt, error }

function startUnits(runId) {
  const going = builds.get(runId);
  if (going && !going.error) return going;
  const state = { scanned: 0, startedAt: Date.now(), error: null };
  builds.set(runId, state);
  try {
    const { Worker } = require('worker_threads');
    const w = new Worker(path.join(__dirname, 'choices-worker.js'), { workerData: { runId } });
    w.on('message', (m) => {
      if (m.scanned != null) state.scanned = m.scanned;
      if (m.error) { state.error = m.error; }
      if (m.done) builds.delete(runId);
    });
    w.on('error', (e) => { state.error = e.message; });
    w.on('exit', (code) => { if (code === 0) builds.delete(runId); else if (!state.error) state.error = `the recovery stopped with code ${code}`; });
    w.unref();
  } catch (err) {
    state.error = err.message;
  }
  return state;
}

function buildState(runId) {
  return builds.get(runId) || null;
}

// The span covering row position `at`, or null. Spans are saved in order.
function namesAt(units, at) {
  const spans = units && Array.isArray(units.spans) ? units.spans : null;
  if (!spans || !spans.length) return null;
  let lo = 0; let hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (spans[mid].at <= at) lo = mid; else hi = mid - 1;
  }
  const s = spans[lo];
  return s.at <= at && at < s.at + s.n ? s : null;
}

module.exports = { unitsFile, readUnits, writeUnits, buildAndSaveUnits, startUnits, buildState, namesAt, sigOf, groupKeyOf, UNITS_V, LOOKAHEAD };
