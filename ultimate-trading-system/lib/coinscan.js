'use strict';
// WALKING A COIN'S OWN READING FORWARD, KNOWING NOTHING IT COULD NOT HAVE KNOWN
// (owner, 2026-09-17).
//
// The Coins reading as it stands answers ONE question: is there structure in
// this coin's history at all? It answers it over the whole span, and that is
// correct for that question -- cutting the span down only weakens it.
//
// It cannot answer two others, and those are the ones a trade needs:
//
//   - could the band have been FOUND without seeing the answer? Measured
//     2026-09-17: with everything chosen inside train, four of the five ticked
//     coin-and-shape pairs found no plateau at all, and the fifth decayed to
//     +0.015% by reserve, before the round trip. The searching was doing the
//     work.
//   - is the finding a PROPERTY of the coin, or one episode? Four stretches
//     cannot tell those apart. LTC at Daily 3-day is weak across the first
//     three quarters of its life and strong in the last quarter, which is one
//     episode wearing two stretches' clothing.
//
// This walks the whole history one window at a time. At the start of every
// window the coin's usual move and the two signs are worked out from
// everything BEFORE it and then held still while the window is priced. So
// every number on the far side of this is a number the run could have had at
// the time, and the shape of them across the years says whether a finding
// holds or comes and goes.
//
// Nothing here trades and nothing here chooses. It reports.

const { medianAbsMove } = require('./windowmove');

// THE BANDS ARE THE OWNER'S, NOT A LIST IN HERE (RULE FIVE). This is what the
// box offers when the screen sends nothing, and the screen can send anything.
const BANDS_WHEN_UNSAID = [50, 100, 150, 200];
const SCRAMBLES_WHEN_UNSAID = 10;

// A DETERMINISTIC SHUFFLE, so a scrambled reading is the same one tomorrow.
// The seed rides on the coin, the shape, the band and the copy's number, so no
// two scrambles anywhere on a run share an order by accident.
function seededOrder(n, seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
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

// THE WINDOWS, IN TIME ORDER. Nothing is priced before `warmUp` periods have
// gone by, because the first window has to have something behind it to learn
// the signs from. A tail shorter than a whole window is dropped rather than
// reported as a short one -- a half-length window's figure is not comparable
// with the ones above it, and putting it in the same column says it is.
function windowsOf(n, warmUp, span) {
  const out = [];
  if (!(n > 0) || !(span > 0)) return out;
  for (let from = Math.max(0, warmUp); from + span - 1 < n; from += span) {
    out.push({ from, to: from + span - 1 });
  }
  return out;
}

// THE COIN'S USUAL MOVE AT THE START OF ONE WINDOW. 'trailing' is what the run
// would have had in hand; 'whole' is what the Coins reading uses today, kept
// so the two can be put side by side and the difference seen rather than
// argued about.
function usualMoveAt(move, upTo, mode) {
  if (mode === 'whole') return medianAbsMove(move);
  return medianAbsMove(move.slice(0, Math.max(0, upTo)));
}

// WHICH WAY IT LEANED, from the periods before a point, read at one threshold.
// Zero means the periods before it said nothing either way, and a window whose
// sign is zero places no trades on that side rather than guessing one.
// A NULL MOVE IS A DECISION THIS LOOK-BACK CANNOT READ, not a move of zero
// (3.159.0). Number(null) is 0 and 0 is finite, so the old guard let it
// through as "the coin did not move", which is a claim and not a silence.
const noMove = (m) => (m == null || !Number.isFinite(Number(m)));
function signsBefore(move, out, upTo, threshold) {
  let sr = 0; let sf = 0; let nr = 0; let nf = 0;
  for (let i = 0; i < upTo; i++) {
    if (noMove(move[i])) continue;
    const m = Number(move[i]); const o = Number(out[i]);
    if (!Number.isFinite(o)) continue;
    if (m > threshold) { sr += o; nr++; } else if (m < -threshold) { sf += o; nf++; }
  }
  return { r: sr > 0 ? 1 : (sr < 0 ? -1 : 0), f: sf > 0 ? 1 : (sf < 0 ? -1 : 0), nr, nf };
}

// ONE WINDOW PRICED, at a threshold and a pair of signs already fixed.
function priceWindow(move, out, from, to, threshold, signs) {
  let n = 0; let sum = 0; let nr = 0; let nf = 0;
  for (let i = from; i <= to; i++) {
    if (noMove(move[i])) continue;
    const m = Number(move[i]); const o = Number(out[i]);
    if (!Number.isFinite(o)) continue;
    if (m > threshold) { if (signs.r) { n++; sum += signs.r * o; nr++; } } else if (m < -threshold) { if (signs.f) { n++; sum += signs.f * o; nf++; } }
  }
  return { n, sum, nr, nf, perTrade: n ? sum / n : null };
}

// THE WALK ITSELF, one coin and shape at one band.
//
// `signsMode` is 'rolled' -- learned afresh before every window from
// everything behind it -- or 'fixed', learned once from the first `fixedUpTo`
// periods and then never touched again. Rolled says what the run would have
// made; fixed says whether the relationship itself holds still. They answer
// different questions and the screen offers both.
function walk(move, out, opts) {
  const {
    band, span, warmUp, usual = 'trailing', signsMode = 'rolled', fixedUpTo = 0, floor = 0,
  } = opts;
  const n = Math.min(move.length, out.length);
  const wins = windowsOf(n, warmUp, span);
  const rows = [];
  let fixedSigns = null;
  let fixedThreshold = null;
  if (signsMode === 'fixed') {
    const yard = usualMoveAt(move, fixedUpTo || warmUp, usual === 'whole' ? 'whole' : 'trailing');
    fixedThreshold = yard == null ? null : yard * (band / 100);
    fixedSigns = fixedThreshold == null ? { r: 0, f: 0, nr: 0, nf: 0 } : signsBefore(move, out, fixedUpTo || warmUp, fixedThreshold);
  }
  let total = 0; let totalN = 0; let up = 0; let down = 0; let counted = 0;
  for (const w of wins) {
    const yard = fixedThreshold != null ? null : usualMoveAt(move, w.from, usual);
    const threshold = fixedThreshold != null ? fixedThreshold : (yard == null ? null : yard * (band / 100));
    if (threshold == null) { rows.push({ from: w.from, to: w.to, n: 0, perTrade: null, thin: true }); continue; }
    const signs = fixedSigns || signsBefore(move, out, w.from, threshold);
    const p = priceWindow(move, out, w.from, w.to, threshold, signs);
    const thin = p.n < floor;
    rows.push({
      from: w.from, to: w.to, n: p.n, perTrade: p.perTrade, thin,
      threshold, up: signs.r, downSign: signs.f, tookUp: p.nr, tookDown: p.nf,
    });
    if (thin || !p.n) continue;
    total += p.sum; totalN += p.n; counted++;
    if (p.perTrade > 0) up++; else if (p.perTrade < 0) down++;
  }
  return {
    rows, trades: totalN, perTrade: totalN ? total / totalN : null,
    windows: counted, windowsUp: up, windowsDown: down,
    best: rows.reduce((a, r) => (!r.thin && r.n && (a == null || r.perTrade > a) ? r.perTrade : a), null),
    worst: rows.reduce((a, r) => (!r.thin && r.n && (a == null || r.perTrade < a) ? r.perTrade : a), null),
  };
}

// THE SAME WALK ON SCRAMBLED COPIES OF THE SAME COIN. The outcomes are dealt
// into a new order and the moves are left where they are, so the shape of the
// history and every threshold survives and only the link between what was seen
// and what followed is cut. How many copies did AT LEAST AS WELL is the number
// that matters: with ninety coin-and-shape pairs and several bands each, a few
// hundred looks are being taken and a handful will shine for nothing. A row
// that beats its own scrambles is saying something; a row that is merely
// positive is not.
// AND THE SAME WALK ON SLIDING COPIES, BESIDE THEM (owner, 2026-09-17:
// "explain first of all what the whole point of this sliding copy is").
//
// Dealing the outcomes into a new order cuts TWO things where only one was
// meant to go: the link to the reading, which is the whole point, and the
// outcomes' OWN ORDER IN TIME, which was not. A SLIDING copy moves every
// outcome along by the same offset and wraps the tail round to the front, so
// each outcome keeps the outcomes it actually happened next to and the only
// thing cut is which reading it sat under.
//
// WHAT I SAID THIS WOULD SHOW, AND WHAT IT ACTUALLY SHOWED. I told the owner
// the dealt copies were probably flattering the real rows -- big moves arrive
// in bunches, dealing spreads them evenly, so the copies would be a calmer
// coin than the real one ever was -- and that this was the likely cause of 883
// of 4,628 rows on the box beating all fifty copies against a chance figure of
// 90.7. Three probes were run before any of this shipped and NONE of them
// supports that (RULE SIX, hunt your own instrument):
//
//   * bunched MAGNITUDES, reading disconnected from outcome: dealt and slid
//     are the same to within noise (22.7 and 22.9 of 50 as good, fair is 25).
//     Size clustering on its own is not the problem.
//   * PERSISTENT DIRECTION, reading disconnected from outcome -- a coin that
//     simply drifts one way for a stretch, then the other: dealt copies come
//     out at 41 to 45 of 50 as good where 25 is fair, and slid copies at 24 to
//     29. So the dealt null IS badly unfair on a drifting coin -- but it is
//     unfair AGAINST the real row, not for it, which is the wrong direction to
//     explain an excess.
//   * ONE PRICE PATH, the realistic shape, where the reading is the change
//     into the decision and the outcome the change after it: dealt and slid
//     are indistinguishable (24.8/24.8, 22.4/22.7, 22.5/22.5).
//
// So sliding is kept because it was never worse in any probe and is clearly
// fairer in one, not because it is expected to collapse the count on the box.
// The 883 most likely comes from somewhere else -- 4,628 rows are 13
// look-backs by 4 bands by ninety coin-and-shape pairs, and the look-backs and
// bands of one pair read almost the same thing, so "chance is 90.7" counts
// draws that are not independent. That is reported to the owner, not acted on.
//
// BOTH COUNTS ARE KEPT, side by side, and neither replaces the other: the
// difference between them is the measurement, and a measurement that is shown
// can be argued with, where one that is asserted cannot.
//
// The offsets are a seeded order of 1..n-1, so no two copies of the same walk
// share one until there are more copies than there are places to slide to.
function slidOffsets(n, copies, seed) {
  if (!(n > 2) || !(copies > 0)) return [];
  const order = seededOrder(n - 1, seed);
  const offsets = [];
  for (let c = 0; c < copies; c++) offsets.push(order[c % order.length] + 1);
  return offsets;
}
function scrambled(move, out, opts, copies, seedText) {
  const real = walk(move, out, opts);
  if (!copies || real.perTrade == null) return { real, copies: copies || 0, asGood: null, asGoodSlid: null };
  const n = Math.min(move.length, out.length);
  const beatsIt = (w) => w.perTrade != null && w.perTrade >= real.perTrade - 1e-12;
  let asGood = 0;
  for (let c = 0; c < copies; c++) {
    const order = seededOrder(n, hashOf(`${seedText}|${c}`));
    const dealt = new Array(n);
    for (let i = 0; i < n; i++) dealt[i] = out[order[i]];
    if (beatsIt(walk(move, dealt, opts))) asGood++;
  }
  const offsets = slidOffsets(n, copies, hashOf(`${seedText}|slide`));
  let asGoodSlid = offsets.length ? 0 : null;
  for (const k of offsets) {
    const slid = new Array(n);
    for (let i = 0; i < n; i++) slid[i] = out[(i + k) % n];
    if (beatsIt(walk(move, slid, opts))) asGoodSlid++;
  }
  return { real, copies, asGood, asGoodSlid };
}


// EVERY COIN AND SHAPE ON THE BOX, AT EVERY BAND THE SCREEN ASKS FOR.
//
// Nothing is filtered here. The passing test on Coins answers a different
// question and it is not consulted: a coin that passes and a coin that does
// not are both walked, both reported, and the owner reads the difference
// rather than being handed one of them (RULE FIVE).
//
// A window is asked for in months because "is this a phase?" is a question
// about time, and the shapes step at different rates -- so the same number of
// months is a different number of decisions on a Daily 1-day unit and on a
// Weekly 8-day one, and each is converted on its own.
const HOURS_A_MONTH = 730;

function periodsForMonths(months, stepHours) {
  const p = Math.round((Number(months) * HOURS_A_MONTH) / Number(stepHours));
  return Number.isFinite(p) && p > 0 ? p : 0;
}

// ONE TASK, RUNNABLE ON A WORKER THREAD (3.158.0). The walk was a single
// thread's job and the box has four; on ninety coin-and-shape pairs at five
// bands that is four hundred and fifty independent walks that share nothing,
// which is exactly the shape the pool was built for. The payload carries its
// own moves and outcomes so the worker needs no files and no state.
function walkTask({ move, out, opts, copies, seedText }) {
  const got = scrambled(move, out, opts, copies, seedText);
  return {
    trades: got.real.trades, perTrade: got.real.perTrade,
    windows: got.real.windows, windowsUp: got.real.windowsUp, windowsDown: got.real.windowsDown,
    best: got.real.best, worst: got.real.worst, copies: got.copies, asGood: got.asGood, asGoodSlid: got.asGoodSlid,
    scan: got.real.rows.map((r) => ({ from: r.from, to: r.to, n: r.n, perTrade: r.perTrade, thin: !!r.thin })),
  };
}

// EVERY WALK THIS RUN WILL DO, listed before any of it starts, so the screen
// can say "N of M" from the first second rather than counting as it goes.
function walkTasksFor(records, geometries, opts) {
  const {
    windowMonths = 6, warmUpMonths = 12, bands = BANDS_WHEN_UNSAID, sweetSpots = null,
    usual = 'trailing', signsMode = 'rolled', scrambles = SCRAMBLES_WHEN_UNSAID,
    floor = 5, only = null, fixedUpTo = null, lookbacks = null,
  } = opts || {};
  const want = only && only.length ? new Set(only.map((c) => String(c).toUpperCase())) : null;
  const tasks = [];
  for (const rec of records || []) {
    if (!rec || !rec.read) continue;
    if (want && !want.has(String(rec.coin).toUpperCase())) continue;
    for (const [key, geo] of Object.entries(geometries || {})) {
      const sr = rec.shapes && rec.shapes[key];
      if (!sr || !Array.isArray(sr.move) || !Array.isArray(sr.out) || !sr.move.length) continue;
      const span = periodsForMonths(windowMonths, geo.stepHours);
      const warmUp = periodsForMonths(warmUpMonths, geo.stepHours);
      const spot = sweetSpots ? sweetSpots[`${rec.coin}|${key}`] : null;
      const list = bands.slice();
      if (spot != null && !list.includes(spot)) list.push(spot);
      // THE SHAPE DECIDES THE TRADE; THE LOOK-BACK DECIDES WHAT IS LOOKED AT
      // (owner, 2026-09-17). 'own' is the shape's own span, which is what
      // every reading used before this; a number of hours measures from that
      // far before the decision instead. A look-back the record does not carry
      // is left out rather than guessed -- it is only there if the coins were
      // read with it.
      const backs = [{ key: 'own', arr: sr.move }];
      for (const h of (lookbacks || [])) {
        const arr = sr.moves && sr.moves[String(h)];
        if (Array.isArray(arr) && arr.length === sr.move.length) backs.push({ key: String(h), arr });
      }
      for (const back of backs) for (const band of list) {
        tasks.push({
          coin: rec.coin, geometry: key, band, lookback: back.key,
          searched: spot != null && band === spot, span, warmUp,
          ts: Array.isArray(sr.ts) ? sr.ts : null,
          payload: {
            move: back.arr, out: sr.out, copies: scrambles,
            seedText: `${rec.coin}|${key}|${band}|${back.key}|${usual}|${signsMode}|${span}`,
            opts: {
              band, span, warmUp, usual, signsMode, floor,
              fixedUpTo: fixedUpTo && fixedUpTo[`${rec.coin}|${key}`] != null ? fixedUpTo[`${rec.coin}|${key}`] : warmUp,
            },
          },
        });
      }
    }
  }
  return tasks;
}

// THE ROW A FINISHED TASK BECOMES. Kept here so the worker path and the
// inline path build the same row and neither can drift.
function rowOf(task, got) {
  return {
    coin: task.coin, geometry: task.geometry, band: task.band, lookback: task.lookback || 'own', searched: task.searched,
    span: task.span, warmUp: task.warmUp,
    trades: got.trades, perTrade: got.perTrade,
    windows: got.windows, windowsUp: got.windowsUp, windowsDown: got.windowsDown,
    best: got.best, worst: got.worst, copies: got.copies, asGood: got.asGood, asGoodSlid: got.asGoodSlid,
    scan: (got.scan || []).map((w) => ({ ...w, ts: task.ts ? task.ts[w.from] : null })),
  };
}

module.exports = {
  BANDS_WHEN_UNSAID, SCRAMBLES_WHEN_UNSAID,
  windowsOf, usualMoveAt, signsBefore, priceWindow, walk, scrambled, seededOrder, slidOffsets, periodsForMonths, HOURS_A_MONTH,
  walkTask, walkTasksFor, rowOf,
};
