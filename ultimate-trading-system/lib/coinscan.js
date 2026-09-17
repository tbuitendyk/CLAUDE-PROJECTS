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
function signsBefore(move, out, upTo, threshold) {
  let sr = 0; let sf = 0; let nr = 0; let nf = 0;
  for (let i = 0; i < upTo; i++) {
    const m = Number(move[i]); const o = Number(out[i]);
    if (!Number.isFinite(m) || !Number.isFinite(o)) continue;
    if (m > threshold) { sr += o; nr++; } else if (m < -threshold) { sf += o; nf++; }
  }
  return { r: sr > 0 ? 1 : (sr < 0 ? -1 : 0), f: sf > 0 ? 1 : (sf < 0 ? -1 : 0), nr, nf };
}

// ONE WINDOW PRICED, at a threshold and a pair of signs already fixed.
function priceWindow(move, out, from, to, threshold, signs) {
  let n = 0; let sum = 0; let nr = 0; let nf = 0;
  for (let i = from; i <= to; i++) {
    const m = Number(move[i]); const o = Number(out[i]);
    if (!Number.isFinite(m) || !Number.isFinite(o)) continue;
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
function scrambled(move, out, opts, copies, seedText) {
  const real = walk(move, out, opts);
  if (!copies || real.perTrade == null) return { real, copies: copies || 0, asGood: null };
  const n = Math.min(move.length, out.length);
  let asGood = 0;
  for (let c = 0; c < copies; c++) {
    const order = seededOrder(n, hashOf(`${seedText}|${c}`));
    const dealt = new Array(n);
    for (let i = 0; i < n; i++) dealt[i] = out[order[i]];
    const w = walk(move, dealt, opts);
    if (w.perTrade != null && w.perTrade >= real.perTrade - 1e-12) asGood++;
  }
  return { real, copies, asGood };
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
    best: got.real.best, worst: got.real.worst, copies: got.copies, asGood: got.asGood,
    scan: got.real.rows.map((r) => ({ from: r.from, to: r.to, n: r.n, perTrade: r.perTrade, thin: !!r.thin })),
  };
}

// EVERY WALK THIS RUN WILL DO, listed before any of it starts, so the screen
// can say "N of M" from the first second rather than counting as it goes.
function walkTasksFor(records, geometries, opts) {
  const {
    windowMonths = 6, warmUpMonths = 12, bands = BANDS_WHEN_UNSAID, sweetSpots = null,
    usual = 'trailing', signsMode = 'rolled', scrambles = SCRAMBLES_WHEN_UNSAID,
    floor = 5, only = null, fixedUpTo = null,
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
      for (const band of list) {
        tasks.push({
          coin: rec.coin, geometry: key, band, searched: spot != null && band === spot, span, warmUp,
          ts: Array.isArray(sr.ts) ? sr.ts : null,
          payload: {
            move: sr.move, out: sr.out, copies: scrambles,
            seedText: `${rec.coin}|${key}|${band}|${usual}|${signsMode}|${span}`,
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
    coin: task.coin, geometry: task.geometry, band: task.band, searched: task.searched,
    span: task.span, warmUp: task.warmUp,
    trades: got.trades, perTrade: got.perTrade,
    windows: got.windows, windowsUp: got.windowsUp, windowsDown: got.windowsDown,
    best: got.best, worst: got.worst, copies: got.copies, asGood: got.asGood,
    scan: (got.scan || []).map((w) => ({ ...w, ts: task.ts ? task.ts[w.from] : null })),
  };
}

async function walkEverything(records, geometries, opts, yieldNow) {
  const {
    windowMonths = 6, warmUpMonths = 12, bands = BANDS_WHEN_UNSAID, sweetSpots = null,
    usual = 'trailing', signsMode = 'rolled', scrambles = SCRAMBLES_WHEN_UNSAID,
    floor = 5, only = null, fixedUpTo = null,
  } = opts || {};
  const want = only && only.length ? new Set(only.map((c) => String(c).toUpperCase())) : null;
  const rows = [];
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
      if (sweetSpots && spot != null && !list.includes(spot)) list.push(spot);
      for (const band of list) {
        const o = {
          band, span, warmUp, usual, signsMode, floor,
          fixedUpTo: fixedUpTo && fixedUpTo[`${rec.coin}|${key}`] != null ? fixedUpTo[`${rec.coin}|${key}`] : warmUp,
        };
        const got = scrambled(sr.move, sr.out, o, scrambles, `${rec.coin}|${key}|${band}|${usual}|${signsMode}|${span}`);
        rows.push({
          coin: rec.coin, geometry: key, band, searched: spot != null && band === spot,
          span, warmUp,
          trades: got.real.trades, perTrade: got.real.perTrade,
          windows: got.real.windows, windowsUp: got.real.windowsUp, windowsDown: got.real.windowsDown,
          best: got.real.best, worst: got.real.worst,
          copies: got.copies, asGood: got.asGood,
          scan: got.real.rows.map((r) => ({
            from: r.from, to: r.to, n: r.n, perTrade: r.perTrade, thin: !!r.thin,
            ts: Array.isArray(sr.ts) ? sr.ts[r.from] : null,
          })),
        });
      }
      if (yieldNow) await yieldNow();
    }
  }
  return rows;
}

module.exports = {
  BANDS_WHEN_UNSAID, SCRAMBLES_WHEN_UNSAID,
  windowsOf, usualMoveAt, signsBefore, priceWindow, walk, scrambled, seededOrder, periodsForMonths, walkEverything, HOURS_A_MONTH,
  walkTask, walkTasksFor, rowOf,
};
