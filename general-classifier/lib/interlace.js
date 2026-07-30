// WINDOW LAYOUTS — where train / search / holdout live on the calendar.
//
// The owner's design (consult, 2026-07-30), replacing the removed fake
// "interlaced" member regime (QC 49) with real interlacing at the WINDOW
// level:
//
//   * History is cut into groups of 7 blocks: 5 training blocks of 49 days
//     (7 weeks) and 2 evaluation blocks of 63 days (9 weeks) — one search,
//     one holdout per group. Whole weeks keep weekday composition identical
//     in every block; odd week-multiples drift across the calendar so no
//     block ever lines up with month-boundary structure.
//   * Slotting per group, three seeded-random draws (the owner's a/b/c rule):
//     (a) coin flip whether search or holdout comes first, (b) the first
//     eval block goes in position 2 or 3, (c) the second in position 5, 6
//     or 7. Positions 1 and 4 are always training, so evaluation blocks can
//     never touch each other — within a group or across group boundaries.
//   * QUOTA-FIRST sizing: the controlling number is E = G x 63 evaluation
//     days per set (G = whole groups that fit). The 'chronological' layout
//     consumes the SAME quota (last E days = holdout, previous E = search),
//     so for any given time-period shape both layouts contain exactly the
//     same number of potential trade days per window — the owner's
//     comparability invariant, guaranteed by construction and enforced by
//     test, not by tuning.
//   * THE TRAINING SET PAYS ALL PURGE. A training chunk whose candles could
//     overlap any evaluation chunk's candles is dropped; evaluation blocks
//     always keep their full complement. Purge width is geometry-derived:
//     the full reach of one chunk (features or exit horizon, whichever is
//     longer), applied on both sides of every evaluation interval.
//
// Everything here is pure and deterministic: same span + layout + seed ->
// same intervals, forever. The seed is stored with the job.
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TRAIN_BLOCK_DAYS = 49; // 7 weeks
const EVAL_BLOCK_DAYS = 63; // 9 weeks
const GROUP_DAYS = 5 * TRAIN_BLOCK_DAYS + 2 * EVAL_BLOCK_DAYS; // 371 = 53 weeks

// Small, well-known deterministic PRNG. Not for cryptography — for
// reproducible block slotting from a stored integer seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The layout plan in day indices (day 0 = the first chunk's start day).
// Returns { G, evalDays, intervals:[{set,startDay,endDay}], groups }.
function planIntervals(spanDays, layout, seed) {
  const G = Math.floor(spanDays / GROUP_DAYS);
  if (G < 1) {
    throw new Error(`only ${spanDays} days of history — a window layout needs at least ${GROUP_DAYS} (one full group)`);
  }
  const evalDays = G * EVAL_BLOCK_DAYS;
  if (layout === 'chronological') {
    // Same quota, contiguous: train, then search, then holdout at the end.
    return {
      G,
      evalDays,
      groups: null,
      intervals: [
        { set: 'train', startDay: 0, endDay: spanDays - 2 * evalDays },
        { set: 'search', startDay: spanDays - 2 * evalDays, endDay: spanDays - evalDays },
        { set: 'hold', startDay: spanDays - evalDays, endDay: spanDays },
      ],
    };
  }
  if (layout !== 'interlaced') throw new Error(`unknown window layout "${layout}"`);
  const rng = mulberry32(Number(seed) || 0);
  const intervals = [];
  const groups = [];
  let day = 0;
  for (let g = 0; g < G; g++) {
    const searchFirst = rng() < 0.5; // (a)
    const firstPos = rng() < 0.5 ? 2 : 3; // (b)
    const secondPos = 5 + Math.floor(rng() * 3); // (c): 5 | 6 | 7
    const evalAt = {};
    evalAt[firstPos] = searchFirst ? 'search' : 'hold';
    evalAt[secondPos] = searchFirst ? 'hold' : 'search';
    groups.push({ searchFirst, firstPos, secondPos, startDay: day });
    for (let pos = 1; pos <= 7; pos++) {
      const set = evalAt[pos] || 'train';
      const len = evalAt[pos] ? EVAL_BLOCK_DAYS : TRAIN_BLOCK_DAYS;
      intervals.push({ set, startDay: day, endDay: day + len });
      day += len;
    }
  }
  // History rarely divides by 371: the remainder goes to training, so the
  // evaluation quota stays exactly G blocks per set.
  if (day < spanDays) intervals.push({ set: 'train', startDay: day, endDay: spanDays });
  return { G, evalDays, intervals, groups };
}

// Assign chunks to sets and purge the TRAINING side. A training chunk is
// dropped when its candles could intersect any candle an evaluation chunk
// touches — features, label window, or TRADE PATH. Evaluation sets always
// keep every chunk in their intervals.
//
// opts.execEndH: how far past a chunk's start its EXECUTION can reach —
// entry offset + the job's longest timeout + the simulator's 3h gap-scan.
// The first version purged only max(featureHours, exitOffsetH) and the
// audit (2026-07-30, confirmed numerically) showed eval trades at the
// default menu's long timeouts running through candles that surviving
// train chunks used as features — one-sided contamination of the
// interlaced arm, the exact bias the layout comparison exists to measure.
function applyLayout(chunks, geo, layout, seed, opts = {}) {
  if (!chunks.length) throw new Error('no chunks to lay out');
  const t0 = chunks[0].startTs;
  const spanDays = Math.floor((chunks[chunks.length - 1].startTs - t0) / DAY_MS) + 1;
  const plan = planIntervals(spanDays, layout, seed);
  const reachMs = Math.max(geo.featureHours, geo.exitOffsetH, opts.execEndH || 0) * HOUR_MS;
  const evalIvs = plan.intervals
    .filter((iv) => iv.set !== 'train')
    .map((iv) => ({ set: iv.set, a: t0 + iv.startDay * DAY_MS, b: t0 + iv.endDay * DAY_MS }));
  const train = [];
  const search = [];
  const hold = [];
  let purged = 0;
  for (const c of chunks) {
    const home = evalIvs.find((e) => c.startTs >= e.a && c.startTs < e.b);
    if (home) {
      (home.set === 'search' ? search : hold).push(c);
      continue;
    }
    const touchesEval = evalIvs.some((e) => c.startTs > e.a - reachMs && c.startTs < e.b + reachMs);
    if (touchesEval) { purged++; continue; }
    train.push(c);
  }
  return {
    train,
    search,
    hold,
    meta: {
      layout,
      seed: Number(seed) || 0,
      groups: plan.G,
      evalDays: plan.evalDays,
      spanDays,
      purgedTrainChunks: purged,
      trainBlockDays: TRAIN_BLOCK_DAYS,
      evalBlockDays: EVAL_BLOCK_DAYS,
      slots: plan.groups,
    },
  };
}

// Label rotation for null draws under a layout: rotate outcomes WITHIN each
// interval, so noise runs through the identical block structure the real run
// used — every window's class mix survives, the feature-outcome link dies,
// and nothing ever crosses a set boundary. shiftFn is bracketwork's
// windowShift, passed in to keep this module dependency-free.
function rotateWithinIntervals(chunks, layout, seed, shiftFrac, shiftFn) {
  if (!chunks.length) return;
  const t0 = chunks[0].startTs;
  const spanDays = Math.floor((chunks[chunks.length - 1].startTs - t0) / DAY_MS) + 1;
  const plan = planIntervals(spanDays, layout, seed);
  const src = chunks.map((c) => c.diffPct);
  for (const iv of plan.intervals) {
    const a = t0 + iv.startDay * DAY_MS;
    const b = t0 + iv.endDay * DAY_MS;
    const idx = [];
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].startTs >= a && chunks[i].startTs < b) idx.push(i);
    }
    if (idx.length < 2) continue; // one chunk cannot rotate; everything else must
    const rot = shiftFn(idx.length, shiftFrac);
    for (let k = 0; k < idx.length; k++) {
      chunks[idx[k]].diffPct = src[idx[(k + rot) % idx.length]];
    }
  }
}

module.exports = {
  planIntervals,
  applyLayout,
  rotateWithinIntervals,
  mulberry32,
  TRAIN_BLOCK_DAYS,
  EVAL_BLOCK_DAYS,
  GROUP_DAYS,
};
