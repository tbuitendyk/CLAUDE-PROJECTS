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
// WHAT IT COSTS TO GET IN AND OUT ONCE, in the same units as every figure the
// walk prints: percent of the position. It is DERIVED from the one fee the
// system trades at rather than typed here, because a second copy of a number
// is a second number the day one of them moves.
const ROUND_TRIP = require('./paper').FEE_ROUND_TRIP * 100;

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
// THE ROW'S OWN LEAN, KEPT (3.171.0, owner order 2026-09-18: "how can the
// signals be encoded onto those records and read by the stage three sweep").
//
// The walk has computed this all along and thrown it away: signsBefore returns
// +1, -1 or 0 for a rising window and the same for a falling one, which is
// exactly the shape of the lean a passer already hands stage 3. walkTask used
// to map the strip down to five fields and the two signs went with the rest.
//
// IT IS THE WHOLE HISTORY'S, at this row's own look-back and band. The owner
// settled that: "we're trying to analyze the entire field of data available on
// each coin to see what kind of signal can be extracted that we're just going
// to use". A rolled lean is a different answer every window and cannot ride on
// a record as one pair of numbers; this one can.
//
// ZERO IS A REAL ANSWER and it means take no trade after that colour -- which
// is a third state the passers' lean has never had.
function leanOver(move, out, band) {
  const yard = medianAbsMove(move);
  if (yard == null || !(yard > 0)) return null;
  const threshold = yard * (band / 100);
  const n = Math.min(move.length, out.length);
  const s = signsBefore(move, out, n, threshold);
  return {
    rising: s.r, falling: s.f, yardstick: yard, threshold,
    afterRising: s.nr, afterFalling: s.nf,
  };
}
function walkTask({ move, out, opts, copies, seedText }) {
  const got = scrambled(move, out, opts, copies, seedText);
  return {
    lean: leanOver(move, out, opts.band),
    trades: got.real.trades, perTrade: got.real.perTrade,
    windows: got.real.windows, windowsUp: got.real.windowsUp, windowsDown: got.real.windowsDown,
    best: got.real.best, worst: got.real.worst, copies: got.copies, asGood: got.asGood, asGoodSlid: got.asGoodSlid,
    scan: got.real.rows.map((r) => ({ from: r.from, to: r.to, n: r.n, perTrade: r.perTrade, thin: !!r.thin })),
  };
}

// ONCE THE LOOK-BACK IS IN HOURS, A CHUNK SHAPE IS ONLY ITS FORWARD TIME
// (owner order, 2026-09-17: "we're not going to have five chunk shapes when we
// are doing fixed lookbacks. We're gonna have only the three chunk shapes").
//
// A shape used to decide two things at once: how far back the reading looked,
// and when the trade opened and closed. A look-back in hours takes the first
// job away from it, and what is left coincides in pairs. Read straight off
// GEOMETRIES in lib/dataset.js:
//
//   daily-1d  opens 25h into its chunk, closes at 42h   -> holds 17h
//   daily-2d  opens 49h,                 closes at 66h  -> holds 17h
//   daily-3d  opens 73h,                 closes at 114h -> holds 41h
//   daily-4d  opens 97h,                 closes at 138h -> holds 41h
//   weekly-8d opens 195h,                closes at 255h -> holds 60h
//
// Every daily shape is built on the SAME grid of chunk starts (dailyStarts()
// takes the minimum and maximum timestamp and nothing else, so the geometry
// never enters it), and a chunk's entry and exit candles are looked up at
// start + entryOffsetH and start + exitOffsetH. So daily-2d's chunk at S buys
// and sells at S+49h and S+66h -- which is exactly where daily-1d's chunk at
// S+24h buys and sells, because S+24h is on the same grid. Its look-back reads
// back from the same instant too. THE TWO ARE ONE TRADE SERIES INDEXED A DAY
// APART, and so are daily-3d and daily-4d.
//
// Measured on the box before this was built: of 36 coin-and-hold units where
// both twins were readable, 12 agreed to within 0.02% a trade. They differ at
// all only because featureHours gates whether a chunk survives -- daily-2d
// demands 48 unbroken hours from its start where daily-1d demands 24 -- so a
// price gap can drop a chunk from one and not the other.
//
// SO ONE SHAPE PER FORWARD TIME IS WALKED at a fixed look-back, and it is the
// one that demands the fewest unbroken hours, because that one keeps the most
// chunks. 'own' still walks EVERY shape: there the reading spans the shape's
// own distance to its entry -- 25h, 49h, 73h, 97h -- and those are all
// different, so no two shapes are the same trade at 'own'.
//
// A geometry with no entry or exit offset to compare is left in a group of its
// own and never stood down. Guessing is worse than walking it twice.
function forwardHoursOf(geo) {
  const f = Number(geo && geo.exitOffsetH) - Number(geo && geo.entryOffsetH);
  return Number.isFinite(f) ? f : null;
}
function oneShapePerForwardTime(geometries) {
  const groups = new Map();
  for (const [key, geo] of Object.entries(geometries || {})) {
    const fwd = forwardHoursOf(geo);
    const g = fwd == null ? `alone:${key}` : `fwd:${fwd}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(key);
  }
  const out = [];
  for (const [g, keys] of groups) {
    const sorted = keys.slice().sort((a, b) => {
      const fa = Number(geometries[a].featureHours); const fb = Number(geometries[b].featureHours);
      if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fa - fb;
      return a < b ? -1 : 1;
    });
    out.push({
      forwardHours: g.startsWith('fwd:') ? Number(g.slice(4)) : null,
      walks: sorted[0],
      standsFor: sorted.slice(1),
    });
  }
  out.sort((a, b) => (a.forwardHours == null ? 1e9 : a.forwardHours) - (b.forwardHours == null ? 1e9 : b.forwardHours));
  return out;
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
  // one shape per forward time at a fixed look-back; every shape at 'own'
  const walksFixed = new Set(oneShapePerForwardTime(geometries).map((c) => c.walks));
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
      for (const back of backs) {
        if (back.key !== 'own' && !walksFixed.has(key)) continue;
        for (const band of list) {
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
  }
  return tasks;
}

// THE ROW A FINISHED TASK BECOMES. Kept here so the worker path and the
// inline path build the same row and neither can drift.
function rowOf(task, got) {
  return {
    coin: task.coin, geometry: task.geometry, band: task.band, lookback: task.lookback || 'own', searched: task.searched,
    // the two signs this row's whole history gives, at its own look-back and
    // band -- what stage 3 reads if the row is promoted
    lean: got.lean || null,
    span: task.span, warmUp: task.warmUp,
    trades: got.trades, perTrade: got.perTrade,
    windows: got.windows, windowsUp: got.windowsUp, windowsDown: got.windowsDown,
    best: got.best, worst: got.worst, copies: got.copies, asGood: got.asGood, asGoodSlid: got.asGoodSlid,
    scan: (got.scan || []).map((w) => ({ ...w, ts: task.ts ? task.ts[w.from] : null })),
  };
}

// CHOOSE ON THE EARLY WINDOWS, READ THE LATE ONES (owner, 2026-09-17: "you
// keep saying one test would settle it and every time you want more").
//
// Every figure the walk prints was priced knowing only what sat behind it, so
// the MONEY was never in doubt. What was in doubt is the CHOICE: the look-back
// and the band that produced the best-looking rows were picked by reading the
// whole table, all 7,850 rows of it, and a choice made with the answer in view
// is not a choice anybody could have made at the time.
//
// So: for each coin and shape, cut its windows in two. Rank its rows on the
// EARLY windows alone, take the best one, and read what that one row did on
// the LATE windows, which the choosing never saw. Nothing is re-walked and no
// window is re-priced -- the per-window strip the walk already keeps carries
// everything, and the split is arithmetic on top of it.
//
// THE NULL IS PICKING BLIND. A pick has to beat what the same pair would have
// paid on its late windows if a row had been taken at random, because a pair
// whose every row pays will look like a good choice however the choice was
// made. The pick's RANK among its own rows on the late windows says the same
// thing more finely: with no skill in the choosing the pick lands in the
// middle of the pack, so the average percentile sits at about 50.
//
// WRITTEN DOWN BEFORE THE NUMBERS EXISTED (RULE SIX):
//   PASS  -- picks beat their pair's blind average on at least 60 of 90 pairs
//            (45 is chance), AND the picks' pooled late money clears the
//            0.25% round trip the system charges itself.
//   FAIL  -- 50 of 90 or fewer, or pooled late money at or under 0.25%.
//   Anything between 51 and 59 is inconclusive and is to be reported as such,
//   not argued either way.
function halfOf(rows) {
  let most = 0;
  for (const r of rows) most = Math.max(most, (r.scan || []).length);
  return Math.floor(most / 2);
}
// MADE MONEY AND PAID ARE NOT THE SAME THING (3.165.0, owner: "i'm trying to
// get a fix on good numbers on as many windows as possible without a large
// spread ... is there a better metric?").
//
// windowsUp counts a window that made anything at all; windowsPaid counts one
// that cleared the round trip, which is the only kind worth having. STRICTLY
// ABOVE, never equal: a window that made back exactly what it cost to trade
// paid nothing, and counting it says otherwise.
//
// worst is the lowest counted window over the same stretch. The two together
// are the owner's sentence in full -- as many windows as possible paying, and
// no bad ones -- and neither can be carried by a single spectacular window the
// way per trade and per trade per spread both can.
function moneyOver(scan, from, to, cost = ROUND_TRIP) {
  let n = 0; let s = 0; let up = 0; let counted = 0; let paid = 0; let worst = null;
  for (let i = from; i < to && i < scan.length; i++) {
    const w = scan[i];
    if (!w || w.thin || !w.n || w.perTrade == null) continue;
    n += w.n; s += w.perTrade * w.n; counted++;
    if (w.perTrade > 0) up++;
    if (w.perTrade > cost) paid++;
    if (worst == null || w.perTrade < worst) worst = w.perTrade;
  }
  return {
    trades: n, perTrade: n ? s / n : null, windows: counted, windowsUp: up,
    windowsPaid: paid, worst,
  };
}
// LEAVING OUT THE CHUNK SHAPE'S OWN SPAN (3.191.0, owner order).
//
// A row whose look-back is `own` reads the same window the committee's members
// already read, so promoting it adds NO member to its unit -- the unit runs as
// a plain one and the walk's finding does not travel (lib/walkset.js
// promotedUnits). On the owner's set that was 17 of 31 chosen pairs: more than
// half the reading pointing at rows that cannot be used.
//
// So the exclusion happens HERE, before anything is chosen, and not as a column
// of second-best alternates bolted on afterwards. The difference matters. Every
// figure this function reports -- the early pick, picking blind, the lead over
// it, the percentile, the whole-history columns and the pass count -- is then
// about the SAME procedure the owner would actually use. An alternate column
// would hand them a row to promote whose selection had never been tested, which
// is the shape of hindsight this whole reading exists to avoid.
//
// AND THE NUMBERS MAY GET WORSE. On a pair whose best row was `own`, the
// restricted choosing takes second best. If the count and the percentile fall,
// that is the honest answer: the walk's edge was in rows that add no member.
const isOwnLookback = (r) => r == null || r.lookback == null || String(r.lookback) === 'own';
function chooseThenRead(rows, opts = {}) {
  const { firstWindows = null, minTrades = 30, cost = ROUND_TRIP, skipOwn = false } = opts || {};
  const byPair = new Map();
  for (const r of rows || []) {
    if (!r || !Array.isArray(r.scan) || !r.scan.length) continue;
    if (skipOwn && isOwnLookback(r)) continue;
    const k = r.coin + '|' + r.geometry;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(r);
  }
  const pairs = [];
  for (const [k, group] of byPair) {
    const cut = firstWindows != null && firstWindows > 0 ? Math.floor(firstWindows) : halfOf(group);
    if (!(cut > 0)) continue;
    const scored = [];
    for (const r of group) {
      const early = moneyOver(r.scan, 0, cut, cost);
      const late = moneyOver(r.scan, cut, r.scan.length, cost);
      if (early.trades < minTrades || late.trades < minTrades) continue;
      scored.push({ row: r, early, late });
    }
    if (scored.length < 2) continue;
    const pick = scored.reduce((a, b) => (b.early.perTrade > a.early.perTrade ? b : a));
    // DID ONE SETTING WIN BOTH HALVES? (owner, 2026-09-18: "we also want on
    // here some kind of indication of whether it was the same rule that maxed
    // out on the first half and the second half ... so that we can pick things
    // that have worked with a single rule on both halves of the history").
    //
    // Every eligible row is already scored on both halves separately. The
    // reading takes the best on the early half; this also takes the best on
    // the LATE half and says whether they are the SAME ROW. Where they differ
    // it names what did win late, so how far off the pick was is readable
    // rather than a bare no.
    //
    // IT IS NOT `sameAsEarly`. That compares the early half against the WHOLE
    // history, and the whole history contains the early half, so agreement
    // there is partly baked in. These two halves share nothing.
    //
    // AND IT IS A CONSISTENCY READING, NOT A FORECAST ONE. It is worked out
    // after both halves are known, so it sits BESIDE lead rather than
    // replacing it: a row can be well ahead of picking blind without topping
    // the late half outright.
    const lateBest = scored.reduce((a, b) => (b.late.perTrade > a.late.perTrade ? b : a));
    const sameBothHalves = lateBest.row === pick.row;
    const lates = scored.map((s) => s.late.perTrade);
    const blind = lates.reduce((a, b) => a + b, 0) / lates.length;
    const sorted = lates.slice().sort((a, b) => a - b);
    const below = sorted.filter((v) => v < pick.late.perTrade).length;
    // AND THE TUNING ITSELF IS DONE ON THE WHOLE SWATH (owner order,
    // 2026-09-17: "when a unit is picked by that metric, we need to turn around
    // and actually use the entire history for determination of the look back
    // window, the band, etcetera. So choose early, read late should just be a
    // confirmation").
    //
    // Two different jobs, and they must not be confused. The early/late reading
    // answers "is this unit's choosing worth anything at all" -- it spends half
    // the history to find out, which is the price of an honest answer. It is
    // NOT the setting to trade. Once a unit has passed, the look-back and band
    // are taken from EVERYTHING there is, because throwing away half a coin's
    // history to keep a test clean leaves a worse setting than the one the
    // whole history knows about.
    //
    // So both are carried, side by side, and whether they agree is reported
    // rather than assumed.
    const whole = group
      .filter((r) => r.perTrade != null && (r.trades || 0) >= minTrades)
      .reduce((a, b) => (a == null || b.perTrade > a.perTrade ? b : a), null);
    const cut2 = k.indexOf('|');
    pairs.push({
      coin: k.slice(0, cut2), geometry: k.slice(cut2 + 1), cut, of: scored.length,
      lookback: pick.row.lookback, band: pick.row.band,
      earlyPerTrade: pick.early.perTrade, earlyTrades: pick.early.trades,
      latePerTrade: pick.late.perTrade, lateTrades: pick.late.trades,
      lateWindows: pick.late.windows, lateWindowsUp: pick.late.windowsUp,
      lateWindowsPaid: pick.late.windowsPaid, lateWorst: pick.late.worst,
      sameBothHalves,
      lateBestLookback: lateBest.row.lookback,
      lateBestBand: lateBest.row.band,
      lateBestPerTrade: lateBest.late.perTrade,
      blind, lead: pick.late.perTrade - blind,
      bestPossible: sorted[sorted.length - 1],
      percentile: scored.length > 1 ? (below / (scored.length - 1)) * 100 : 50,
      wholeLookback: whole ? whole.lookback : null,
      wholeBand: whole ? whole.band : null,
      wholePerTrade: whole ? whole.perTrade : null,
      wholeTrades: whole ? whole.trades : null,
      wholeWindows: whole ? whole.windows : null,
      wholeWindowsUp: whole ? whole.windowsUp : null,
      wholeAsGood: whole ? whole.asGood : null,
      wholeAsGoodSlid: whole ? whole.asGoodSlid : null,
      wholeOf: group.length,
      sameAsEarly: !!(whole && String(whole.lookback) === String(pick.row.lookback) && Number(whole.band) === Number(pick.row.band)),
    });
  }
  pairs.sort((a, b) => b.latePerTrade - a.latePerTrade);
  const n = pairs.length;
  let t = 0; let s = 0; let pct = 0;
  for (const p of pairs) { t += p.lateTrades; s += p.latePerTrade * p.lateTrades; pct += p.percentile; }
  const beat = pairs.filter((p) => p.lead > 0).length;
  const paid = pairs.filter((p) => p.latePerTrade - cost > 0).length;
  const pooled = t ? s / t : null;
  // the verdict is READ OFF the rule written above, never argued from the rows
  const verdict = !n ? 'nothing to read'
    : (beat >= Math.ceil(n * (60 / 90)) && pooled != null && pooled > cost) ? 'PASS'
      : (beat <= Math.floor(n * (50 / 90)) || pooled == null || pooled <= cost) ? 'FAIL' : 'inconclusive';
  return {
    pairs, cost, minTrades, firstWindows,
    of: n, beat, paid, pooled, netPooled: pooled == null ? null : pooled - cost,
    chance: n / 2, meanPercentile: n ? pct / n : null,
    sameChoice: pairs.filter((p) => p.sameAsEarly).length,
    // how many pairs one setting won BOTH halves of. Pre-registered in
    // LOOP-2026-09-18-COINS.md before this ran: more than 3 is beyond chance,
    // 0 or 1 means the column has nothing in it, 2 or 3 is inconclusive.
    sameBothHalves: pairs.filter((p) => p.sameBothHalves).length,
    wholePooled: (() => { let t = 0; let s2 = 0; for (const p of pairs) { if (p.wholePerTrade == null) continue; t += p.wholeTrades; s2 += p.wholePerTrade * p.wholeTrades; } return t ? s2 / t : null; })(),
    longChoices: pairs.filter((p) => p.lookback !== 'own' && Number(p.lookback) >= 240).length,
    verdict,
  };
}

module.exports = {
  BANDS_WHEN_UNSAID, SCRAMBLES_WHEN_UNSAID, ROUND_TRIP, chooseThenRead, moneyOver,
  forwardHoursOf, oneShapePerForwardTime,
  windowsOf, usualMoveAt, signsBefore, priceWindow, walk, scrambled, seededOrder, slidOffsets, periodsForMonths, HOURS_A_MONTH,
  walkTask, walkTasksFor, rowOf, leanOver, isOwnLookback,
};
