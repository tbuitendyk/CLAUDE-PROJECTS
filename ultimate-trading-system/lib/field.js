// field.js -- THE DECISION FIELD (FIELD-DESIGN.md; owner LOOP NOW! 2026-09-21).
//
// For one coin and one chunk shape: a grid of points, one per pair of sit-out
// band and look-back, filled one decision at a time over a sliding window and
// read on every decision day. Each point keeps the weighted total and the
// weighted count of the chunk's own outcome after a RISING reading at that
// band and look-back, and the same pair after a FALLING one; a reading that
// sat out records nothing. On a decision day every point whose reading today
// is not sit-out says how the coin tended to go after readings like today's
// -- its average outcome, weighed by the evidence behind it -- and the points
// are summed into the FIELD: a sign, a size (the pull), and an agreement
// (how much of the pull points one way, 0 to 100).
//
// NO LEAK, BY ARITHMETIC: a decision enters the points only once its chunk
// has CLOSED -- its close instant at or before the instant of the day being
// read. A day's field therefore holds nothing from that day or after it,
// whatever stretch of history the day belongs to. There is no train, test,
// held or reserve in here (owner, point 5).
//
// THE WEIGHT of a decision is its half-life weight, max(floor, 0.5^(age/H)),
// age in days from the decision to the day being read. It is kept in EPOCH
// FORM: the decayed part of every point holds sum(v * 2^((ts_i - epoch)/H))
// and is read as that times 2^(-(ts_d - epoch)/H), so nothing is multiplied
// day by day and nothing drifts; the part of the window older than the floor
// age H*log2(1/floor) sits in a second accumulator at the floor weight. A
// decision leaves the window from whichever part it is in.
//
// THE YARDSTICK a band is a share of is worked out per look-back, as the
// weighted median of |move| over the window's decisions before the day
// being read, under the same weights (owner, answer 1). A day's readings are
// fixed on that day and stored, so adding a decision later and dropping it
// later still use what was read then. The readings depend on the moves and
// never on the outcomes, so they are taken ONCE and every copy reads them.
//
// CERTAINTY is the real field's size ranked against SLID copies of the
// coin -- the outcomes moved along by a seeded offset and wrapped, so every
// outcome keeps its neighbours in time and only which reading it sits under
// is cut (owner decision, slides only, 2026-09-21). The scrambles count is
// taken ONCE, on the day the window first fills, and kept beside the slides
// count; nothing reads it but the screen.
//
// Pure arithmetic: no I/O and no imports but the seeded generator, so a
// worker thread loads it and the live path computes the same numbers.
// NO AI anywhere in this path (RULE SEVEN).
const { mulberry32 } = require('./rng');

const DAY_MS = 86400000;
const REBASE_EXPONENT = 500;

// THE DIALS, checked once and returned in one shape. Every one of them comes
// off the screen (RULE FIVE); nothing here is a constant a run reads without
// the owner having typed it. Defaults are the launcher's, not the engine's.
function checkDials(d) {
  const num = (v, what, lo, hi) => {
    const x = Number(v);
    if (v === '' || v == null || !Number.isFinite(x)) throw new Error(`${what} must be a number, not ${JSON.stringify(v)}`);
    if (lo != null && x < lo) throw new Error(`${what} must be at least ${lo}, not ${x}`);
    if (hi != null && x > hi) throw new Error(`${what} must be at most ${hi}, not ${x}`);
    return x;
  };
  const list = (v, what) => {
    const raw = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\s,]+/);
    const arr = raw.map((x) => (x === '' || x == null ? null : Number(x))).filter((x) => x != null);
    if (!arr.length) throw new Error(`${what} is empty`);
    for (const x of arr) if (!Number.isFinite(x) || !(x > 0)) throw new Error(`${what} holds a value that is not a number above zero: ${JSON.stringify(x)}`);
    const uniq = [...new Set(arr)].sort((a, b) => a - b);
    if (uniq.length !== arr.length) throw new Error(`${what} repeats a value`);
    return uniq;
  };
  const windowDays = num(d.windowDays, 'window, days', 1);
  const halfLifeDays = num(d.halfLifeDays, 'half-life, days', 0.01);
  const floor = num(d.floor, 'weight floor', 0, 1);
  const bands = list(d.bands, 'sit-out bands');
  const lookbackHours = list(d.lookbackHours, 'look-backs');
  const evidenceCap = num(d.evidenceCap, 'evidence cap', 0);
  const leastEvidence = num(d.leastEvidence, 'least evidence', 0);
  const copies = Math.floor(num(d.copies == null ? 0 : d.copies, 'slid copies', 0));
  if (evidenceCap > 0 && leastEvidence > evidenceCap) throw new Error(`least evidence (${leastEvidence}) is above the evidence cap (${evidenceCap})`);
  return { windowDays, halfLifeDays, floor, bands, lookbackHours, evidenceCap, leastEvidence, copies, seedText: String(d.seedText || '') };
}

// the half-life weight of a decision `ageDays` old
function weightAt(ageDays, halfLifeDays, floor) {
  const w = Math.pow(0.5, ageDays / halfLifeDays);
  return w < floor ? floor : w;
}

// A DETERMINISTIC ORDER of 0..n-1 from a seed, for the copies.
function seededOrder(n, seed) {
  const next = mulberry32(seed);
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}
function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// the offsets the slid copies use: a seeded order of 1..n-1, so no two copies
// share one until there are more copies than places to slide to
function slidOffsets(n, copies, seed) {
  if (!(n > 2) || !(copies > 0)) return [];
  const order = seededOrder(n - 1, seed);
  const out = [];
  for (let c = 0; c < copies; c++) out.push(order[c % order.length] + 1);
  return out;
}

// THE WEIGHTED MEDIAN of values already sorted ascending, weights alongside:
// the value at which the running weight first reaches half the total.
function weightedMedianSorted(vals, weights, count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += weights[i];
  if (!(total > 0)) return null;
  let run = 0;
  for (let i = 0; i < count; i++) {
    run += weights[i];
    if (run >= total / 2) return vals[i];
  }
  return vals[count - 1];
}

// the inputs, checked once
function checkInput(input, dials) {
  const { decisionTs, closeTs, out } = input;
  const n = decisionTs.length;
  if (closeTs.length !== n || out.length !== n) throw new Error('the field needs one close instant and one outcome per decision (null where the chunk has not closed)');
  for (let i = 1; i < n; i++) if (!(decisionTs[i] > decisionTs[i - 1])) throw new Error('the decisions must be in time order with no two at the same instant');
  const moves = dials.lookbackHours.map((h) => {
    const m = input.moves[String(h)];
    if (!m || m.length !== n) throw new Error(`no move series for a look-back of ${h} hours`);
    return m;
  });
  return { n, moves };
}

// ---- PASS ONE: THE READINGS, from the moves alone -------------------------
//
// For every decision day: the yardstick per look-back (weighted median of
// |move| over the window's decisions before it), and from it the day's
// reading per look-back -- its sign and how many of the bands, ascending,
// its move cleared. Stored as two Int8 arrays, decision major.
function readingsFor(input, dials) {
  const { n, moves } = checkInput(input, dials);
  const { decisionTs } = input;
  const H = dials.lookbackHours.length;
  const B = dials.bands.length;
  const W = dials.windowDays * DAY_MS;
  const readSign = new Int8Array(n * H);
  const readB = new Int8Array(n * H);
  const yardVals = []; const yardIdx = [];
  for (let h = 0; h < H; h++) { yardVals.push([]); yardIdx.push([]); }
  const wByIdx = new Float64Array(n);
  const wScratch = new Float64Array(n + 1);
  const yardNow = new Float64Array(H);
  let yardDrop = 0;
  for (let d = 0; d < n; d++) {
    const tsNow = decisionTs[d];
    if (d > 0) {
      const i = d - 1;
      for (let h = 0; h < H; h++) {
        const m = moves[h][i];
        if (m == null || !Number.isFinite(Number(m))) continue;
        const v = Math.abs(Number(m));
        const vals = yardVals[h]; const idx = yardIdx[h];
        let lo = 0; let hi = vals.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < v) lo = mid + 1; else hi = mid; }
        vals.splice(lo, 0, v); idx.splice(lo, 0, i);
      }
    }
    while (yardDrop < d && tsNow - decisionTs[yardDrop] > W) {
      for (let h = 0; h < H; h++) {
        const idx = yardIdx[h];
        const at = idx.indexOf(yardDrop);
        if (at >= 0) { idx.splice(at, 1); yardVals[h].splice(at, 1); }
      }
      yardDrop++;
    }
    for (let j = yardDrop; j < d; j++) wByIdx[j] = weightAt((tsNow - decisionTs[j]) / DAY_MS, dials.halfLifeDays, dials.floor);
    for (let h = 0; h < H; h++) {
      const vals = yardVals[h]; const idx = yardIdx[h];
      const count = vals.length;
      for (let j = 0; j < count; j++) wScratch[j] = wByIdx[idx[j]];
      const med = count ? weightedMedianSorted(vals, wScratch, count) : null;
      yardNow[h] = med != null && med > 0 ? med : NaN;
    }
    const base = d * H;
    for (let h = 0; h < H; h++) {
      const m = moves[h][d];
      const yard = yardNow[h];
      if (m == null || !Number.isFinite(Number(m)) || !(yard > 0)) { readSign[base + h] = 0; readB[base + h] = 0; continue; }
      const x = Number(m);
      const s = x > 0 ? 1 : (x < 0 ? -1 : 0);
      const ax = Math.abs(x);
      let nb = 0;
      while (nb < B && ax > yard * (dials.bands[nb] / 100)) nb++;
      readSign[base + h] = nb > 0 ? s : 0;
      readB[base + h] = nb;
    }
  }
  return { n, H, B, readSign, readB, yardsticks: Array.from(yardNow).map((y) => (Number.isFinite(y) ? y : null)) };
}

// ONE SET OF POINTS: the two accumulators and the operations on them, laid
// out as H*B*4 numbers per point: [risingTotal, risingWeight, fallingTotal,
// fallingWeight], look-back major.
class Points {
  constructor(H, B) {
    this.H = H; this.B = B;
    this.dec = new Float64Array(H * B * 4);
    this.flo = new Float64Array(H * B * 4);
  }
  // add (e > 0) or remove (e < 0) one decision's contribution: its stored
  // readings, its outcome and its weight factor -- epoch form for the decayed
  // part, the floor for the floor part
  apply(target, R, i, v, e) {
    const { H, B } = this;
    const base = i * H;
    for (let h = 0; h < H; h++) {
      const s = R.readSign[base + h];
      if (s === 0) continue;
      const nb = R.readB[base + h];
      const side = s > 0 ? 0 : 2;
      for (let b = 0; b < nb; b++) {
        const at = ((h * B) + b) * 4 + side;
        target[at] += v * e;
        target[at + 1] += e;
      }
    }
  }
  scaleDecayed(f) { const a = this.dec; for (let i = 0; i < a.length; i++) a[i] *= f; }
  // THE FIELD on a day: today's readings, the scale that turns the decayed
  // part into today's weights, and the two evidence dials.
  //
  // EACH POINT WEIGHS IN WITH ITS AVERAGE OUTCOME, NOT ONLY ITS SIGN (loop
  // decision, 2026-09-21, recorded in LOOP-FIELD.md). The first cut summed
  // sign(average) x evidence, and a fabricated coin whose outcome followed
  // its one-day move perfectly could not be told from noise by it: the bands
  // at one look-back nest, so their points agree with each other whether or
  // not they know anything, and a copy with no signal is exactly as
  // unanimous as the real coin. The signal lives in HOW FAR the average sits
  // from zero, so that is what a point brings: average x min(evidence, cap).
  // `agreement` is then how much of that pull points one way, 0 to 100, and
  // `size` is the pull itself, which certainty ranks against the copies.
  read(R, d, scale, cap, least) {
    const { H, B, dec, flo } = this;
    const base = d * H;
    let F = 0; let Fabs = 0; let speaking = 0; let evidence = 0;
    for (let h = 0; h < H; h++) {
      const s = R.readSign[base + h];
      if (s === 0) continue;
      const nb = R.readB[base + h];
      const side = s > 0 ? 0 : 2;
      for (let b = 0; b < nb; b++) {
        const at = ((h * B) + b) * 4 + side;
        const wt = dec[at + 1] * scale + flo[at + 1];
        if (!(wt > 0) || wt < least) continue;
        const avg = (dec[at] * scale + flo[at]) / wt;
        if (avg === 0) continue;
        const w = cap > 0 && wt > cap ? cap : wt;
        F += avg * w; Fabs += Math.abs(avg) * w; speaking++; evidence += w;
      }
    }
    return {
      sign: F > 0 ? 1 : (F < 0 ? -1 : 0),
      agreement: Fabs > 0 ? Math.abs(F) / Fabs * 100 : 0,
      size: Math.abs(F), speaking, evidence,
    };
  }
  // the grid as the screen shows it: per point, the average outcome after
  // rising and after falling, each with the evidence behind it
  grid(scale) {
    const { H, B, dec, flo } = this;
    const out = [];
    for (let h = 0; h < H; h++) {
      const row = [];
      for (let b = 0; b < B; b++) {
        const at = ((h * B) + b) * 4;
        const rW = dec[at + 1] * scale + flo[at + 1];
        const fW = dec[at + 3] * scale + flo[at + 3];
        row.push({
          rising: rW > 0 ? { avg: (dec[at] * scale + flo[at]) / rW, evidence: rW } : null,
          falling: fW > 0 ? { avg: (dec[at + 2] * scale + flo[at + 2]) / fW, evidence: fW } : null,
        });
      }
      out.push(row);
    }
    return out;
  }
  // how many points carry at least the least evidence, per side
  withEvidence(scale, least) {
    const { H, B, dec, flo } = this;
    const bar = Math.max(least, 1e-12);
    let rising = 0; let falling = 0;
    for (let p = 0; p < H * B; p++) {
      const at = p * 4;
      if (dec[at + 1] * scale + flo[at + 1] >= bar) rising++;
      if (dec[at + 3] * scale + flo[at + 3] >= bar) falling++;
    }
    return { rising, falling, of: H * B };
  }
}

// ---- PASS TWO: THE POINTS, ROLLED FORWARD under one set of outcomes -------
//
// `outcomeOf(k, i)` gives copy k's outcome for decision i (k = 0 is the real
// coin). Every copy shares the readings and differs only there. Returns the
// per-day series for the real coin, the certainty against the copies, and
// the real points at the last day.
function rollPoints(input, dials, R, outcomeOf, K, throughDay) {
  const { decisionTs, closeTs } = input;
  const { n, H, B } = R;
  const W = dials.windowDays * DAY_MS;
  const Hl = dials.halfLifeDays;
  const floorAgeDays = dials.floor > 0 && dials.floor < 1 ? Hl * Math.log2(1 / dials.floor) : (dials.floor >= 1 ? 0 : Infinity);
  const copies = [];
  for (let k = 0; k <= K; k++) copies.push(new Points(H, B));
  let epoch = decisionTs[0] || 0;
  const eOf = (i) => Math.pow(2, (decisionTs[i] - epoch) / (Hl * DAY_MS));
  let addPtr = 0; let floorPtr = 0; let dropPtr = 0;
  const series = [];
  let fullAt = null;
  const lastDay = throughDay == null ? n - 1 : Math.min(n - 1, throughDay);
  for (let d = 0; d <= lastDay; d++) {
    const tsNow = decisionTs[d];
    // decisions whose chunk has closed by now enter the points; one with no
    // outcome on record (the live path's unclosed tail) enters nothing
    while (addPtr < d && closeTs[addPtr] <= tsNow) {
      const i = addPtr; const e = eOf(i);
      for (let k = 0; k <= K; k++) {
        const v = outcomeOf(k, i);
        if (v == null || !Number.isFinite(Number(v))) continue;
        copies[k].apply(copies[k].dec, R, i, Number(v), e);
      }
      addPtr++;
    }
    // the part older than the floor age moves to the floor accumulator
    while (floorPtr < addPtr && (tsNow - decisionTs[floorPtr]) / DAY_MS > floorAgeDays) {
      const i = floorPtr; const e = eOf(i);
      for (let k = 0; k <= K; k++) {
        const v = outcomeOf(k, i);
        if (v == null || !Number.isFinite(Number(v))) continue;
        copies[k].apply(copies[k].dec, R, i, Number(v), -e);
        copies[k].apply(copies[k].flo, R, i, Number(v), dials.floor);
      }
      floorPtr++;
    }
    // what has left the window leaves the points, from whichever part
    while (dropPtr < addPtr && tsNow - decisionTs[dropPtr] > W) {
      const i = dropPtr;
      for (let k = 0; k <= K; k++) {
        const v = outcomeOf(k, i);
        if (v == null || !Number.isFinite(Number(v))) continue;
        if (i < floorPtr) copies[k].apply(copies[k].flo, R, i, Number(v), -dials.floor);
        else copies[k].apply(copies[k].dec, R, i, Number(v), -eOf(i));
      }
      if (i >= floorPtr) floorPtr = i + 1;
      dropPtr++;
    }
    // re-base the epoch before the exponent grows large
    if ((tsNow - epoch) / (Hl * DAY_MS) > REBASE_EXPONENT) {
      const f = Math.pow(2, -(tsNow - epoch) / (Hl * DAY_MS));
      for (let k = 0; k <= K; k++) copies[k].scaleDecayed(f);
      epoch = tsNow;
    }
    // the field today, real and copies
    const scale = Math.pow(2, -(tsNow - epoch) / (Hl * DAY_MS));
    const real = copies[0].read(R, d, scale, dials.evidenceCap, dials.leastEvidence);
    let below = 0;
    for (let k = 1; k <= K; k++) {
      if (copies[k].read(R, d, scale, dials.evidenceCap, dials.leastEvidence).size < real.size) below++;
    }
    const full = tsNow - decisionTs[0] >= W;
    if (full && fullAt == null) fullAt = d;
    series.push({
      ts: tsNow, sign: real.sign, agreement: real.agreement, size: real.size,
      certainty: K > 0 ? below / K * 100 : null,
      speaking: real.speaking, evidence: real.evidence, full,
    });
  }
  const tsLast = decisionTs[lastDay];
  return {
    days: series, fullAt, points: copies[0],
    scale: Math.pow(2, -(tsLast - epoch) / (Hl * DAY_MS)),
    inWindow: addPtr - dropPtr,
  };
}

// THE BUILD, one coin and shape, every decision day in order.
//
//   decisionTs[i]  the instant decision i is taken (the first candle of its
//                  fill window, as windowmove.decisionAt gives it)
//   closeTs[i]     the instant its chunk closes (startTs + exitOffsetH)
//   out[i]         the chunk's own outcome, entry to exit, in percent
//   moves[h][i]    the move over look-back h (hours) into decision i, in
//                  percent, or null where the coin has no candle that far back
function buildField(input, dialsIn) {
  const dials = checkDials(dialsIn);
  const R = readingsFor(input, dials);
  const { n } = R;
  const { decisionTs, out } = input;
  // THE COPIES SLIDE OVER THE CLOSED OUTCOMES ONLY. A decision whose chunk has
  // not closed (the live path's own day, and the one or two before it on a
  // long hold) has no outcome to lend a copy; it never enters a point either
  // way, so the copies are exactly the lab's when every outcome is closed.
  const closed = [];
  const posOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (out[i] != null && Number.isFinite(Number(out[i]))) { posOf[i] = closed.length; closed.push(i); }
  const m = closed.length;
  const K = Math.min(dials.copies, Math.max(0, m - 2));
  const offsets = slidOffsets(m, K, hashOf(`${dials.seedText}|slide`));
  const outcomeOf = (k, i) => (k === 0 ? out[i] : (posOf[i] < 0 ? null : out[closed[(posOf[i] + offsets[k - 1]) % m]]));
  const rolled = rollPoints(input, dials, R, outcomeOf, K, null);
  const { days, fullAt, points, scale } = rolled;
  // THE SCRAMBLES, ONCE, ON THE FILL DAY: the same readings, the outcomes
  // dealt into a seeded order, each copy rolled from the start to that day
  let scramblesAsGood = null;
  if (fullAt != null && K > 0) {
    const realThen = days[fullAt].size;
    scramblesAsGood = 0;
    for (let c = 0; c < K; c++) {
      const order = seededOrder(m, hashOf(`${dials.seedText}|scramble|${c}`));
      const dealt = new Array(n).fill(null);
      for (let j = 0; j < m; j++) dealt[closed[j]] = out[closed[order[j]]];
      const got = rollPoints(input, dials, R, (k, i) => dealt[i], 0, fullAt);
      const day = got.days[got.days.length - 1];
      if (day && day.size >= realThen - 1e-12) scramblesAsGood++;
    }
  }
  const last = days[days.length - 1];
  const tsLast = decisionTs[n - 1];
  return {
    dials,
    decisions: n,
    days,
    fullAt: fullAt == null ? null : decisionTs[fullAt],
    fullAtDay: fullAt,
    fill: fullAt == null || K === 0 ? null : {
      copies: K,
      slidesAsGood: Math.round((100 - days[fullAt].certainty) / 100 * K),
      scramblesAsGood,
    },
    state: last ? {
      ts: last.ts, sign: last.sign, agreement: last.agreement, size: last.size, certainty: last.certainty,
      speaking: last.speaking, evidence: last.evidence, full: last.full,
      daysInWindow: Math.min(dials.windowDays, Math.round((tsLast - decisionTs[0]) / DAY_MS)),
      decisionsInWindow: rolled.inWindow,
      yardsticks: R.yardsticks,
      pointsWithEvidence: points.withEvidence(scale, dials.leastEvidence),
    } : null,
    grid: points.grid(scale),
    readingToday: last ? readingsOf(R, n - 1) : null,
  };
}
function readingsOf(R, d) {
  const out = [];
  for (let h = 0; h < R.H; h++) out.push({ sign: R.readSign[d * R.H + h], bandsCleared: R.readB[d * R.H + h] });
  return out;
}

// THE READING ON A DAY, looked up by the decision instant: the day whose
// decision instant is the latest at or before `ts`, or null before the first.
// A run reads a unit's chunks at their own instants, so the match is exact
// on the shape the field was built for.
function readAt(days, ts) {
  let lo = 0; let hi = days.length - 1; let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].ts <= ts) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? null : days[found];
}

// THE RANGE OF AGREEMENT over the days in the window, for the state on the
// screen: lowest, the quarters, highest, and how many days there were.
function agreementRange(days, windowDays) {
  if (!days || !days.length) return null;
  const last = days[days.length - 1].ts;
  const within = days.filter((x) => last - x.ts <= windowDays * DAY_MS);
  const inWindow = within.filter((x) => x.speaking > 0);
  if (!inWindow.length) return { days: 0, silentDays: within.length };
  const quarters = (arr) => {
    const a = arr.slice().sort((p, q) => p - q);
    const at = (q) => a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))];
    return { lowest: a[0], quarter: at(0.25), median: at(0.5), threeQuarters: at(0.75), highest: a[a.length - 1] };
  };
  const c = inWindow.map((x) => x.certainty).filter((x) => x != null);
  return {
    days: inWindow.length, silentDays: within.length - inWindow.length,
    agreement: quarters(inWindow.map((x) => x.agreement)),
    certainty: c.length ? quarters(c) : null,
  };
}

// THE ONE TASK, RUNNABLE ON A WORKER THREAD: the build, with the series
// packed into columns so a pair of two thousand days is a few kilobytes of
// numbers on disk and not two thousand objects. The range is read here too,
// once, so the screen never recomputes it on every draw.
function fieldTask({ input, dials }) {
  const got = buildField(input, dials);
  const cols = { ts: [], sign: [], agreement: [], size: [], certainty: [], speaking: [], evidence: [], full: [] };
  for (const d of got.days) {
    cols.ts.push(d.ts); cols.sign.push(d.sign); cols.agreement.push(Number(d.agreement.toFixed(3)));
    cols.size.push(Number(d.size.toFixed(6))); cols.certainty.push(d.certainty == null ? null : Number(d.certainty.toFixed(2)));
    cols.speaking.push(d.speaking); cols.evidence.push(Number(d.evidence.toFixed(3))); cols.full.push(d.full ? 1 : 0);
  }
  return {
    dials: got.dials, fullAt: got.fullAt, fullAtDay: got.fullAtDay, fill: got.fill, state: got.state,
    grid: got.grid, readingToday: got.readingToday, range: agreementRange(got.days, got.dials.windowDays),
    days: cols,
  };
}

module.exports = {
  DAY_MS, checkDials, weightAt, seededOrder, hashOf, slidOffsets, weightedMedianSorted, Points,
  readingsFor, rollPoints, buildField, readAt, agreementRange, fieldTask,
};
