// coins.js -- COINS: vetting a coin's history before anything is trained
// (COINS.md; owner LOOP NOW! 2026-09-12).
//
// NOTHING HERE TRAINS ANYTHING AND NOTHING HERE REFUSES A COIN. Every function
// below produces a number to be shown. The owner, 2026-09-12: "We're not even
// blocking coins with this anyways. We're only reporting." A function that
// returns a pass or a fail has misunderstood the tab.
//
// A price series here is one price per period, in period order. That is what a
// chunk store already is -- c1, the price a trade would open at -- so the
// boundaries snap to period boundaries for free (COINS.md section 3) and
// nothing has to round anything to a calendar.

// ---- the typing -------------------------------------------------------------

// HOW A TURN IS FOUND (COINS.md section 3): walk forward keeping the running
// high; when price has fallen back from that high by AT LEAST pctBack, the
// high is where the rising stretch ended and the falling one began. Mirrored
// for the other direction.
//
// AT LEAST, NOT MORE THAN. The comparison is `>=` and always has been; this
// line and COINS.md section 3 both said "more than", which is a different rule
// at the exact boundary. The wording was corrected to the code (2026-09-12,
// found by the adversarial pass) rather than the other way round: changing the
// comparison would move every number on the tab, and nothing on either side of
// that boundary is more defensible than the other.
//
// IT IS A RETURN, NEVER A PRICE LEVEL. The fall is measured against the
// extreme it is retracing from, so a 10% move counts the same at $50 and at
// $5,000 -- which is what stops a model learning this price level rather than
// what a falling market looks like.
//
// The two comparisons are deliberately asymmetric in their base: a fall is
// (high - p) / high and a rise is (p - low) / low. Each is measured from the
// extreme it is retracing, which is the only base that means anything.
function typeStretches(prices, pctBack) {
  const n = Array.isArray(prices) ? prices.length : 0;
  const pct = Number(pctBack);
  if (!(pct > 0)) throw new Error('the fall-back percentage must be above zero');
  if (n < 2) return { pct, turns: [], stretches: n ? [{ from: 0, to: 0, type: 'rising', open: true }] : [] };

  const frac = pct / 100;
  const turns = [];
  const stretches = [];
  let dir = null;                 // 'rising' | 'falling', unknown until price moves
  // A PRICE OF ZERO OR BELOW IS NOT A BASE A RETURN CAN BE MEASURED FROM, so it
  // never becomes the running extreme and never triggers a comparison. The first
  // version guarded the division with `lo > 0` at the comparison alone, and
  // because the running low only ever falls until a turn resets it, one zero
  // switched rise detection off for the WHOLE of the rest of the series: ten
  // periods with three obvious reversals came back as one stretch and no turns.
  // The period is still inside its stretch; it just cannot be an extreme.
  let hi = prices[0] > 0 ? prices[0] : null; let hiIdx = 0;
  let lo = prices[0] > 0 ? prices[0] : null; let loIdx = 0;
  let start = 0;                  // where the stretch in progress began

  // A turn CLOSES the stretch in progress at the extreme, and opens the next
  // one there. The extreme belongs to the stretch that ended at it, so the
  // next stretch starts on the following period and no period is in two.
  const close = (at, type) => {
    if (at < start) return false;              // cannot close behind the start
    stretches.push({ from: start, to: at, type });
    turns.push(at);
    start = at + 1;
    return true;
  };

  for (let i = 1; i < n; i++) {
    const p = prices[i];
    if (!(p > 0)) continue;                      // see above: not a base for a return
    if (hi === null) { hi = p; hiIdx = i; lo = p; loIdx = i; continue; }
    if (p > hi) { hi = p; hiIdx = i; }
    if (p < lo) { lo = p; loIdx = i; }
    const fellBack = (hi - p) / hi >= frac;
    const roseBack = (p - lo) / lo >= frac;
    if (dir !== 'falling' && fellBack && hiIdx >= start) {
      // THE FIRST TRIGGER ONLY SETS THE DIRECTION WHEN THE EXTREME IS THE
      // START ITSELF. Found by the pre-registered check C1.3, which a
      // one-way rising path failed: with no direction yet, the rise away from
      // the opening price fired the OTHER branch and closed a falling stretch
      // that had never existed, inventing a turn at index 0 on a path that
      // never turns. Nothing was in progress before the first period, so
      // there is nothing there to close.
      if (dir === null && hiIdx === start) { dir = 'falling'; lo = p; loIdx = i; hi = p; hiIdx = i; }
      else if (close(hiIdx, 'rising')) {
        dir = 'falling';
        lo = p; loIdx = i;
        hi = p; hiIdx = i;
      }
    } else if (dir !== 'rising' && roseBack && loIdx >= start) {
      if (dir === null && loIdx === start) { dir = 'rising'; hi = p; hiIdx = i; lo = p; loIdx = i; }
      else if (close(loIdx, 'falling')) {
        dir = 'rising';
        hi = p; hiIdx = i;
        lo = p; loIdx = i;
      }
    }
  }

  // THE TAIL, AND WHY IT IS NEVER UNCLASSIFIED (COINS.md section 3: two types
  // only, no third bucket). Whatever is left after the last turn is one
  // stretch. Its type is the direction in progress; when price never moved far
  // enough for a direction to exist at all, it is whichever way the span
  // finished, so a flat coin still gets a type rather than a hole.
  //
  // AND IT IS MARKED OPEN, because a turn is not what ended it -- it ran out of
  // data. The comment above `cutAtBoundaries` defines a left-over end as a piece
  // the cut ended rather than a turn, and by that definition this is one. It was
  // not marked, so the last part of every span counted an unfinished run as a
  // whole stretch, and (worse) the walk's trailing stretch stretched to the end
  // of ALL the data, which is how price inside the sealed reserve was reaching
  // back into what train reported.
  if (start <= n - 1) {
    const type = dir || (prices[n - 1] >= prices[start] ? 'rising' : 'falling');
    stretches.push({ from: start, to: n - 1, type, open: true });
  }
  return { pct, turns, stretches };
}

// ---- the search for the percentage, per coin --------------------------------

// THE PERCENTAGE IS NOT FIXED ACROSS COINS (COINS.md section 4). What is set is
// how many changes of direction are wanted; each coin gets whatever percentage
// delivers that.
//
// THE WALK IS EXHAUSTIVE ON PURPOSE, never a bisection. The count does NOT
// simply rise as the percentage falls -- an earlier turn moves where later ones
// land -- so anything that assumes a staircase will land on the wrong rung. The
// walk is cheap and its shape, per coin, is what the screen draws.
//
// THE RULE (owner's decision, 2026-09-12): take the LARGEST percentage that
// gives AT LEAST the number asked for. Largest keeps the stretches clean;
// at-least means never coming up short.
function searchFallback(prices, opts = {}) {
  const target = Math.max(1, Math.floor(Number(opts.target) || 0));
  const from = Number(opts.from) > 0 ? Number(opts.from) : 1;
  const to = Number(opts.to) > 0 ? Number(opts.to) : 40;
  const step = Number(opts.step) > 0 ? Number(opts.step) : 0.5;
  if (to < from) throw new Error(`the percentage range runs backwards (${from} to ${to})`);

  const walk = [];
  // THE GRID IS ROUNDED TO KILL THE DUST that `from + k * step` accumulates, and
  // that is all the rounding is for. The first version worked out how many
  // decimal places to keep by reading the PRINTED form of the step -- so a step
  // below a millionth, which JavaScript prints in exponential form, read as no
  // decimal places at all and collapsed the whole grid: five thousand rows, each
  // typing the identical percentage. Significant figures do not care how the
  // number prints.
  for (let k = 0; ; k++) {
    const pct = Number((from + k * step).toPrecision(12));
    if (pct > to + 1e-9) break;
    const r = typeStretches(prices, pct);
    walk.push({ pct, turns: r.turns.length, stretches: r.stretches.length });
  }
  if (!walk.length) throw new Error('the percentage range holds no values to try');

  // Largest percentage reaching the target. The walk is in ascending order, so
  // the last one that reaches it is the largest.
  let picked = null;
  for (const w of walk) if (w.turns >= target) picked = w;

  if (picked) {
    return {
      asked: target,
      reached: true,
      pct: picked.pct,
      turns: picked.turns,
      // THE COUNT MOVES IN WHOLE STEPS and can jump straight past the target,
      // so what was delivered is reported beside what was asked. A coin that
      // overshot says so rather than looking like it landed exactly.
      overshot: picked.turns > target,
      walk,
    };
  }

  // NOTHING REACHED IT. Say so, and report the best the walk found -- never
  // hand back the smallest percentage as though it had worked (pre-registered
  // success rule C1.4).
  let best = walk[0];
  for (const w of walk) if (w.turns > best.turns || (w.turns === best.turns && w.pct > best.pct)) best = w;
  return {
    asked: target,
    reached: false,
    pct: null,
    turns: null,
    overshot: false,
    best: { pct: best.pct, turns: best.turns },
    why: `no percentage between ${from}% and ${to}% gives ${target} change(s) of direction on this coin — the most any of them gives is ${best.turns}, at ${best.pct}%`,
    walk,
  };
}


// ---- cutting at the boundaries, and counting what is left -------------------

// A stretch does not respect the divisions: the fall-back rule marks a turn
// wherever price falls back far enough and knows nothing about where `train`
// ends. Owner's decision, 2026-09-12: CUT AT EVERY BOUNDARY, so every stretch
// belongs to exactly one part (COINS.md section 5).
//
// A piece is a STUB when the cut is what ended it, rather than a turn. There
// are at most two per part, one at each end, because only the edges get cut --
// plus the unfinished run at the very end of the walk, which no turn ended
// either, so it counts as one too.
function cutAtBoundaries(stretches, parts) {
  const out = [];
  for (const part of parts) {
    const pieces = [];
    for (const s of stretches) {
      const from = Math.max(s.from, part.from);
      const to = Math.min(s.to, part.to);
      if (to < from) continue;
      pieces.push({
        from, to, type: s.type, length: to - from + 1,
        // cut on either side means the cut ended it, not a turn; and an open
        // stretch was ended by running out of data, which is not a turn either
        stub: from > s.from || to < s.to || !!s.open,
      });
    }
    out.push({ part: part.name, from: part.from, to: part.to, pieces });
  }
  return out;
}

// THE MEDIAN FULL LENGTH OF EACH TYPE, on this coin, across the parts named.
// Median rather than mean: stretch lengths are skewed by a few long trends and
// a mean would be dragged up, making every stub count for less than it
// deserves (COINS.md section 5).
function medianFullLengths(cutParts, over = null) {
  const by = { rising: [], falling: [] };
  for (const p of cutParts) {
    if (over && !over.includes(p.part)) continue;
    for (const piece of p.pieces) if (!piece.stub) by[piece.type].push(piece.length);
  }
  const med = (a) => {
    if (!a.length) return null;
    const v = a.slice().sort((x, y) => x - y);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return { rising: med(by.rising), falling: med(by.falling) };
}

// HOW MANY STRETCHES OF EACH TYPE A PART HOLDS, with stubs as fractions.
// A full stretch is 1; a stub is its length over that type's median full
// length. Two stubs of half the median add to one, which is what the owner
// asked for. A fraction rather than a threshold, because a threshold has a
// cliff and a stub one period either side of it would flip the answer.
function countStretches(cutPart, medians) {
  const out = {};
  for (const type of ['rising', 'falling']) {
    const pieces = cutPart.pieces.filter((p) => p.type === type);
    const full = pieces.filter((p) => !p.stub);
    const stubs = pieces.filter((p) => p.stub);
    const med = medians[type];
    const stubLen = stubs.reduce((a, p) => a + p.length, 0);
    out[type] = {
      full: full.length,
      stubs: stubs.length,
      stubLength: stubLen,
      median: med,
      // null, not zero, when this coin has no full stretch of the type to
      // measure a stub against: a stub with nothing to compare to has not
      // answered the question, and saying zero would read as "none of it".
      count: med ? full.length + stubLen / med : (stubs.length ? null : full.length),
    };
  }
  return out;
}

// TURNS ARE COUNTED DIRECTLY AND NEVER GET CUT (COINS.md section 5). A turn is
// either inside a part or it is not, so the handover reading needs no stub
// arithmetic at all. This is the half of the problem that dissolves.
function turnsIn(turns, part) {
  return turns.filter((t) => t >= part.from && t <= part.to).length;
}

// ---- the split of time, and the traditional score ---------------------------

// THE SPLIT OF TIME between the two types over a run of periods, as the pair of
// shares and the smaller of them. The smaller one is the whole reading: it is
// 0.5 when the two are even and 0 when everything went one way.
//
// IT READS AN UNTUNED DIRECTION -- the sign of each period's own move -- and
// never the tuned stretches. The traditional configuration has no rising/
// falling split, so building its numbers on the tuned percentage would move
// every coin's traditional score every time that percentage was re-tuned for
// something else (COINS.md section 11).
function splitOfTime(moves) {
  let up = 0; let down = 0;
  for (const m of moves) { if (m > 0) up++; else if (m < 0) down++; }
  const n = up + down;
  if (!n) return { rising: null, falling: null, balance: null, periods: 0 };
  return { rising: up / n, falling: down / n, balance: Math.min(up, down) / n, periods: n };
}

// THE WIDTHS THE TWO LAYOUTS ACTUALLY CARVE, at this many periods, read out of
// the engine's own split rather than typed (COINS.md section 11: "a window the
// size the layouts actually carve"). The first version typed 0.13 and 0.15 as a
// default argument that nothing ever passed -- a second copy of the arithmetic
// and a knob with no control, which is the fault `partsFor` refuses a hundred
// lines below and RULE FIVE forbids outright.
//
// BOTH LAYOUTS, ALWAYS, so this stays ONE reading per coin and not one per
// layout (COINS.md section 11 is explicit about that). The sealed reserve of
// the four-way split and the held-back stretch of the three-way one are the two
// tails a coin can be asked to hand over; the worst of either is the reading.
function layoutWidths(periods) {
  const seen = [];
  for (const layout of ['reserve61', 'split70']) {
    let parts;
    try { parts = partsFor(periods, layout); } catch (_) { continue; }
    const last = parts[parts.length - 1];
    const w = last.to - last.from + 1;
    if (w >= 2 && w <= periods && !seen.includes(w)) seen.push(w);
  }
  return seen.sort((a, b) => a - b);
}

// NUMBER ONE OF THE TRADITIONAL SCORE -- the worst tail slice. Slide a window
// the size the layouts actually carve across the whole span and take the WORST
// balance found anywhere. It answers the failure the owner saw directly:
// somewhere in this history there is a stretch that runs all one way.
//
// IT MOVES WITH HOW MUCH HISTORY A COIN HAS, and that is named on the screen
// rather than hidden. The window is a share of the span, so a short coin is
// measured over a short window, and a short window of a perfectly fair coin
// lands one-way often: at forty periods nearly three quarters of trendless
// coins score exactly zero, at a thousand periods none of them do. Two coins
// with different amounts of cached history are NOT comparable on this number.
function worstTailSlice(moves, widths) {
  const list = Array.isArray(widths) ? widths : [];
  let worst = null;
  const at = [];
  for (const w of list) {
    if (!(w >= 2) || w > moves.length) continue;
    // RECORDED BECAUSE IT WAS WALKED, not because it produced the answer. The
    // first version pushed inside `if (worst)`, so a width that was walked and
    // beaten vanished from the record of what was walked.
    at.push({ width: w });
    for (let i = 0; i + w <= moves.length; i++) {
      const b = splitOfTime(moves.slice(i, i + w)).balance;
      if (b == null) continue;
      if (worst == null || b < worst.balance) worst = { balance: b, from: i, to: i + w - 1, width: w };
    }
  }
  return worst ? { ...worst, widths: at } : { balance: null, from: null, to: null, width: null, widths: at };
}

// NUMBER TWO -- the drift. Cut the span into equal parts, measure each part's
// balance, and score how much that balance MOVES from part to part. This is
// what catches "the training part was a general mix and the last part was all
// one way", and the per-part balances are what the screen draws.
//
// EQUAL MEANS EQUAL. The first version took the floor of the division and gave
// the last part the whole remainder: on 159 moves the widths came out
// 19,19,19,19,19,19,19,26, and that oversized last part diluted a one-way tail
// with balanced periods and reported the drift 36% too low -- on exactly the
// case this number exists to catch. Worst seen between 40 and 400 periods was
// 47: a last part 12 wide against 5. Rounding the boundaries instead leaves
// every part within one period of every other.
function balanceDrift(moves, partsWanted = 8) {
  const k = Math.max(2, Math.floor(Number(partsWanted) || 0));
  if (moves.length < k * 2) return { drift: null, parts: [], wanted: k, why: 'too few periods to cut into that many parts' };
  const edge = (i) => Math.round((i * moves.length) / k);
  const parts = [];
  for (let i = 0; i < k; i++) {
    const from = edge(i);
    const to = edge(i + 1) - 1;
    parts.push({ from, to, ...splitOfTime(moves.slice(from, to + 1)) });
  }
  const bs = parts.map((p) => p.balance).filter((b) => b != null);
  if (bs.length < 2) return { drift: null, parts, wanted: k };
  let sum = 0;
  for (let i = 1; i < bs.length; i++) sum += Math.abs(bs[i] - bs[i - 1]);
  return { drift: sum / (bs.length - 1), parts, wanted: k };
}

// ---- the training weight this tab produces ----------------------------------

// ONE NUMBER PER PERIOD, EVERY PERIOD (COINS.md section 6). The granularity is
// not a choice: training takes one weight per row and refuses unless the list
// is exactly as long as the training rows, and one row is one period.
//
// The number is how far price moved over the span that period is about, which
// is already worked out because it is what that period's label comes from. So
// there is no new parameter, and it is not a leak: it reads the period's own
// outcome, which the training already sees as that period's label.
//
// ONE VECTOR, SHARED BY BOTH SETS. This function takes no argument saying
// which set it is for, and it must not gain one: in a fast rising week the
// rising set learns hard to call and the falling set learns hard to hold,
// because that is the week where a falling model speaking would cost the most.
//
// NORMALISED SO THE MEAN IS EXACTLY 1 AND NOTHING EXCEEDS THE CAP. Those two
// fight, so the scale is found by bisection rather than by scaling and then
// clipping -- clip after scaling and the mean is no longer 1; scale after
// clipping and the ceiling is breached.
//
// THE FIXED POINT DOES NOT ALWAYS EXIST, and the first version of this said it
// did. A period that did not move weighs nothing, so the whole of the average
// has to come from the ones that did: the ceiling has to be at least the period
// count divided by how many of them moved. Below that, this says so in a
// sentence and names the ceiling that would work, rather than quietly serving a
// mean that is not 1 and calling it normalised.
function trainingWeights(moves, opts = {}) {
  const cap = Number(opts.cap);
  if (!(cap > 1)) throw new Error(`the weight ceiling must be above 1 — a ceiling of ${opts.cap} cannot leave the average at 1`);
  const raw = moves.map((m) => Math.abs(Number(m) || 0));
  const n = raw.length;
  if (!n) return { weights: [], cap, mean: null, capped: 0 };
  const total = raw.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return { weights: raw.map(() => 1), cap, mean: 1, capped: 0, why: 'nothing moved in any period, so every period weighs the same' };

  // A PERIOD THAT DID NOT MOVE WEIGHS NOTHING, and that is what makes the mean
  // reachable or not. Found by the pre-registered check C3.1, which failed on
  // five periods where only one moved: with four weights pinned at zero, the
  // whole of the mean has to come from the fifth, and no scale can lift it past
  // the ceiling divided by five. The comment here used to claim the fixed point
  // exists whenever the ceiling is above 1. It does not — it exists when the
  // ceiling is at least the period count divided by how many of them moved.
  const moved = raw.filter((w) => w > 0).length;
  const needed = moved ? n / moved : Infinity;
  if (cap < needed - 1e-12) {
    // NOT A REFUSAL OF THE COIN (COINS.md section 8) -- the weights are still
    // produced and still say which periods matter. What is reported is that
    // the average could not be brought to 1 under this ceiling, and the
    // ceiling that would do it, because the ceiling is the owner's control.
    const weights = raw.map((w) => (w > 0 ? cap : 0));
    return {
      weights,
      cap,
      mean: weights.reduce((a, b) => a + b, 0) / n,
      capped: moved,
      reachedMean: false,
      needCap: needed,
      why: `only ${moved} of ${n} periods moved at all, so a ceiling of at least ${needed.toFixed(2)} is needed before the average weight can reach 1 — at ${cap} it cannot`,
    };
  }

  const meanAt = (sc) => raw.reduce((a, w) => a + Math.min(sc * w, cap), 0) / n;
  let lo = 0;
  let hi = 1;
  while (meanAt(hi) < 1 && hi < 1e12) hi *= 2;
  // THE DOUBLING CAN RUN OUT BEFORE IT FINDS AN UPPER BRACKET, and then there
  // is nothing to bisect between. The first version went straight on: every
  // midpoint tested low, `lo` climbed to `hi`, and it returned "reached" with a
  // mean of 0.11. It takes moves near the smallest number the machine can tell
  // from zero, so no real price reaches it -- but the sentence this function
  // already writes for the other unreachable case was being bypassed rather
  // than extended, which is the fault, not the odds of hitting it.
  if (meanAt(hi) < 1) {
    const weights = raw.map((w) => Math.min(hi * w, cap));
    return {
      weights,
      cap,
      mean: weights.reduce((a, b) => a + b, 0) / n,
      capped: weights.filter((w) => w >= cap - 1e-12).length,
      reachedMean: false,
      needCap: null,
      why: 'the moves in this stretch are so small that no scale this machine can hold lifts the average weight to 1 — '
        + `the largest it reaches is ${meanAt(hi).toPrecision(3)}`,
    };
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (meanAt(mid) < 1) lo = mid; else hi = mid;
  }
  const sc = (lo + hi) / 2;
  const weights = raw.map((w) => Math.min(sc * w, cap));
  const mean = weights.reduce((a, b) => a + b, 0) / n;
  return { weights, cap, mean, capped: weights.filter((w) => w >= cap - 1e-12).length, reachedMean: true };
}

// ---- the parts of history, read from the engine's own arithmetic ------------

// NEVER TYPED AS 61/13/13/13 OR 70/15/15. The divisions come from the same
// splitBounds the sweep engine splits by, and the sealed reserve comes off
// exactly the way the engine seals it -- 13% of the span, before the split.
// Typing the percentages here would be a second copy of the arithmetic, and
// two copies drift.
function partsFor(n, layout) {
  const { splitBounds, reserveChunks } = require('./bracketwork');
  if (layout === 'reserve61') {
    const nReserve = reserveChunks(n);
    const rest = n - nReserve;
    const b = splitBounds(rest, true);
    return [
      { name: 'train', from: 0, to: b.nTrain - 1 },
      { name: 'test', from: b.nTrain, to: b.nTrain + b.nTest - 1 },
      { name: 'held', from: b.nTrain + b.nTest, to: rest - 1 },
      { name: 'reserve', from: rest, to: n - 1 },
    ];
  }
  if (layout === 'split70') {
    const b = splitBounds(n, true);
    return [
      { name: 'train', from: 0, to: b.nTrain - 1 },
      { name: 'test', from: b.nTrain, to: b.nTrain + b.nTest - 1 },
      { name: 'held', from: b.nTrain + b.nTest, to: n - 1 },
    ];
  }
  throw new Error(`unknown window layout '${layout}'`);
}

// A SPLIT THAT LEAVES A STRETCH WITH NOTHING IN IT IS NOT A SPLIT, and saying
// so is the honest answer for a coin with almost no history. It is NOT a refusal
// of the coin (COINS.md section 8): the traditional score and every other layout
// are still read, and the sentence goes on the record beside them. The floor
// this puts on the period count is whatever the engine's own arithmetic implies
// -- there is no number typed here to be argued with.
function checkedParts(n, layout) {
  const parts = partsFor(n, layout);
  for (const p of parts) {
    if (p.to < p.from) {
      throw new Error(`${n} periods do not divide into ${layout} — the split leaves '${p.name}' with no periods in it`);
    }
  }
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].from !== parts[i - 1].to + 1) {
      throw new Error(`${n} periods do not divide into ${layout} — '${parts[i - 1].name}' and '${parts[i].name}' do not meet`);
    }
  }
  if (parts[0].from !== 0 || parts[parts.length - 1].to !== n - 1) {
    throw new Error(`${n} periods do not divide into ${layout} — the parts do not cover the span`);
  }
  return parts;
}

// ---- the traditional score, one per coin, no layout ------------------------

// ONE READING PER COIN, NOT ONE PER LAYOUT (COINS.md section 11 is explicit).
// It used to be computed inside the per-layout reading, so every record on disk
// carried two byte-identical copies of it -- two copies of one fact, which is
// the thing RULE NINE exists to stop.
//
// NOTHING TUNED GOES INTO IT. The direction of each period is read from the
// sign of that period's own move, never from the tuned stretches, so re-tuning
// the fall-back percentage for two-set training can never move a coin's
// traditional score (COINS.md section 11).
// CAN EITHER NUMBER TELL THIS COIN FROM A COIN WITH NO TREND AT ALL, at this
// much history? (Owner order, 2026-09-12: "plan the code based on the length of
// the history. And if you have to make some kind of flag or warning if there's
// not enough history and things get sketchy, just put that on the screen." And
// on where the line sits: "that's the code that needs to put something on the
// screen. Not you.")
//
// SO THERE IS NO LINE TO SET, and no number typed anywhere. The coin's OWN
// moves are shuffled into a different order many times and the same two numbers
// read off each shuffle. A shuffle has the coin's periods and none of its
// order, so it is that coin with its trend taken away.
//
// If every shuffle gives the SAME answer as every other, the number is not
// reading the coin at all -- it is a constant of how much history there is, and
// it cannot separate this coin from any other of that length. That is the whole
// test and it has no threshold in it. At forty periods the worst tail slice
// reads 0 for the coin and 0 for every shuffle of it; past a few hundred the
// shuffles spread out and it separates cleanly.
//
// THE SHUFFLE IS DETERMINISTIC. Same coin, same answer, every time, for ever --
// there is no randomness in anything this system reports (RULE SEVEN).
function shuffledCopy(arr, seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}
function canTheReadingTell(moves, opts = {}) {
  const tries = Math.max(2, Math.floor(Number(opts.shuffles) || 0) || 200);
  const widths = layoutWidths(moves.length);
  const realWorst = worstTailSlice(moves, widths).balance;
  const realDrift = balanceDrift(moves, opts.driftParts).drift;
  const worst = [];
  const drift = [];
  for (let i = 0; i < tries; i++) {
    const mixed = shuffledCopy(moves, 20260912 + i);
    const w = worstTailSlice(mixed, widths).balance;
    const d = balanceDrift(mixed, opts.driftParts).drift;
    if (w != null) worst.push(w);
    if (d != null) drift.push(d);
  }
  // THE TEST, AND IT HAS NO THRESHOLD IN IT: could a coin with no trend at all,
  // of exactly this length, have produced the number this coin produced? The
  // shuffles ARE that coin -- its own periods, its trend taken away -- so if
  // the coin's own answer sits anywhere inside the range they cover, the answer
  // says nothing about this coin that its length does not already say.
  //
  // THE FIRST VERSION OF THIS ASKED A WEAKER QUESTION -- whether the shuffles
  // ever disagreed with each other -- and it passed a forty-period coin, which
  // is the exact case the pre-registered rule said it had to catch. Two answers
  // out of two hundred is not a number that can tell anything apart. The rule
  // was written before the code and it caught the code, which is what it is for.
  const say = (real, list, name) => {
    if (real == null || !list.length) {
      return { canTell: false, of: list.length, low: null, high: null, value: real ?? null,
        why: `${name} could not be worked out over ${moves.length} periods at all` };
    }
    const low = Math.min(...list);
    const high = Math.max(...list);
    const canTell = real < low || real > high;
    return {
      canTell,
      value: real,
      low,
      high,
      of: list.length,
      why: canTell ? null
        : `${moves.length} periods is too few for ${name} to say anything about this coin. Shuffle its own periods `
          + `into ${list.length} different orders -- the same coin with its trend taken away -- and they score `
          + `between ${low.toFixed(3)} and ${high.toFixed(3)}. This coin scores ${real.toFixed(3)}, which is inside `
          + 'that. A coin with no trend at all could have scored the same, so the number is telling you how much '
          + 'history there is, not what is in it.',
    };
  };
  return {
    worstTailSlice: say(realWorst, worst, 'the worst tail slice'),
    drift: say(realDrift, drift, 'the drift'),
    periods: moves.length,
    shuffles: tries,
  };
}

function traditionalReading(moves, opts = {}) {
  return {
    whole: splitOfTime(moves),
    worstTailSlice: worstTailSlice(moves, layoutWidths(moves.length)),
    drift: balanceDrift(moves, opts.driftParts),
    // whether either number can tell this coin apart from one with no trend at
    // all, at this much history -- derived, never a typed line (see above)
    canTell: canTheReadingTell(moves, opts),
    // NAMED, BECAUSE BOTH NUMBERS MOVE WITH IT. The window the worst tail slice
    // slides is a share of the span and the drift's parts are a share of the
    // span, so a coin with less cached history is measured over shorter runs
    // and reads worse on one and better on the other. Two coins with different
    // amounts of history are not comparable on either number, and the screen
    // has to say so rather than rank them side by side in silence.
    periods: moves.length,
  };
}

// ---- one coin, one window layout, one reading -------------------------------

// THE SEARCH READS `train` AND `test` ONLY (COINS.md section 7). The settled
// percentage is then applied to `held` and `reserve` and what is there is
// REPORTED -- never fed back. So you find out before sweeping that a coin's
// held-back stretch runs one way, instead of finding out at Verify after the
// whole sweep is spent.
//
// AND "NEVER FED BACK" MEANS EVERY NUMBER, NOT JUST THE PERCENTAGE. The first
// version drew the stretches with ONE walk over the whole span and only then
// cut them at the boundaries. The percentage was clean and stayed clean under
// attack -- but the stretches were not. A high near the end of `test` only
// becomes a turn once price has fallen back from it, and that fall-back can
// arrive in `held` or in the sealed `reserve`; until it does, the walk's last
// stretch runs to the end of ALL the data. So whether a piece sitting inside
// `test` was a whole stretch or a left-over end depended on price the reading
// is forbidden to consider, and the median those left-over ends are measured
// against was built from that same set. Two series identical for every period
// of `train` and `test` and `held`, differing only inside the sealed reserve,
// reported different medians and a different number of stretches in `train`.
//
// SO EVERY PART IS DRAWN BY A WALK THAT STOPS AT THAT PART'S OWN END. `train`
// is read from a walk over `train`; `test` from a walk over `train` + `test`;
// and so on out to the whole span for the last part. The walk is
// prefix-deterministic -- every stretch closed by a turn is identical in any
// walk that reaches that far -- so the only thing this changes is the
// unfinished run at the end, which is exactly the thing that was reaching back.
// Nothing later can move an earlier part's figures now, at any distance.
//
// AND NOTHING HERE REFUSES THE COIN. Every field below is a figure to look at.
function coinReading(prices, moves, opts = {}) {
  if (!Array.isArray(prices) || !Array.isArray(moves)) throw new Error('coinReading wants a price per period and a move per period');
  if (prices.length !== moves.length) throw new Error(`${prices.length} prices and ${moves.length} moves — there must be one of each per period`);
  const layout = String(opts.layout || '');
  const parts = checkedParts(prices.length, layout);
  const searchEnd = parts[1].to;                       // the end of `test`

  const search = searchFallback(prices.slice(0, searchEnd + 1), {
    target: opts.target, from: opts.from, to: opts.to, step: opts.step,
  });

  // THE WEIGHT SUMMARY, over `train`, which is what gets trained on. The vector
  // itself is NOT stored: it is deterministic from the moves and the ceiling,
  // and a stored copy is a second version of the same fact waiting to go stale
  // (RULE NINE). Sweep recomputes it from this same function.
  const trainMoves = moves.slice(parts[0].from, parts[0].to + 1);
  const w = trainingWeights(trainMoves, { cap: opts.cap });

  const out = {
    layout,
    periods: prices.length,
    parts: parts.map((p) => ({ ...p, periods: p.to - p.from + 1 })),
    searchedOver: { from: 0, to: searchEnd, parts: [parts[0].name, parts[1].name] },
    search,
    // NEITHER OF THESE NEEDS THE PERCENTAGE, so neither waits on it. The split
    // of time reads the sign of each period's own move; the training weight
    // reads how far each period moved and the owner's ceiling. The first
    // version returned both as null whenever the percentage search came up
    // short -- so a coin the search could not satisfy was withheld the one
    // number this tab exists to hand to Sweep, because a different reading
    // failed. COINS.md section 8 lists the split per part as a reading in its
    // own right.
    split: parts.map((p) => ({ part: p.name, from: p.from, to: p.to, ...splitOfTime(moves.slice(p.from, p.to + 1)) })),
    weight: {
      cap: w.cap, mean: w.mean, capped: w.capped, reachedMean: w.reachedMean !== false,
      needCap: w.needCap ?? null, why: w.why ?? null, over: parts[0].name, periods: trainMoves.length,
    },
    typed: null,
    medians: null,
    perPart: null,
  };

  if (!search.reached) {
    out.why = search.why;
    return out;
  }

  // ONE WALK PER PART END, and none of them sees past the part it is for.
  const walks = new Map();
  const walkTo = (end) => {
    if (!walks.has(end)) walks.set(end, typeStretches(prices.slice(0, end + 1), search.pct));
    return walks.get(end);
  };
  const whole = walkTo(prices.length - 1);

  // A TURN IS CONFIRMED LATER THAN THE PERIOD IT MARKS, and that makes the
  // search's count a floor rather than the final one. Found by looking at the
  // output on 2026-09-12, not by being told.
  //
  // The rule marks the high as the turn only once price has fallen back from
  // it, which happens some periods later. So a turn sitting near the end of
  // `test` cannot be confirmed from `train` and `test` alone -- the fall-back
  // that proves it is in `held`.
  //
  // THE SEARCH IS LEFT AS IT IS, ON PURPOSE, and so are the per-part figures:
  // letting those turns into either would give `held` a vote, which is exactly
  // what COINS.md section 7 forbids. Turns are only ever ADDED by later data
  // and never taken away, so what the search counted is a floor and the reading
  // errs in the honest direction. What is NOT acceptable is the two numbers
  // disagreeing silently, so both are reported, plainly labelled, and the gap
  // is named in a sentence.
  const withLater = whole.turns.filter((t) => t <= searchEnd).length;
  out.searchedOver.turnsTheSearchCounted = search.turns;
  out.searchedOver.turnsOnceLaterDataIsSeen = withLater;
  if (withLater !== search.turns) {
    out.searchedOver.note = `${withLater - search.turns} more change(s) of direction sit inside train and test `
      + 'than the search could count: a turn is only confirmed once price has fallen back from it, and for a turn '
      + 'near the end of test that fall-back is in held. The search is not allowed to look there, so it counted '
      + 'what it could see. The figures per part below are the ones the search could see.';
  }

  const cut = parts.map((p) => cutAtBoundaries(walkTo(p.to).stretches, [p])[0]);
  const medians = medianFullLengths(cut, [parts[0].name, parts[1].name]);
  out.typed = { pct: search.pct, turns: whole.turns.length, stretches: whole.stretches.length };
  out.medians = medians;
  out.perPart = cut.map((c) => ({
    part: c.part,
    from: c.from,
    to: c.to,
    periods: c.to - c.from + 1,
    // TURNS, COUNTED DIRECTLY. They never get cut, so this needs no stub
    // arithmetic (COINS.md section 5).
    turns: turnsIn(walkTo(c.to).turns, c),
    stretches: countStretches(c, medians),
    // THE SPLIT IS ALREADY ABOVE, in `split`, computed whether the search
    // reached or not. Repeating it here would be two copies of one fact.
    stubs: c.pieces.filter((p) => p.stub).length,
  }));

  return out;
}


module.exports = {
  typeStretches, searchFallback,
  cutAtBoundaries, medianFullLengths, countStretches, turnsIn,
  splitOfTime, layoutWidths, worstTailSlice, balanceDrift, shuffledCopy, canTheReadingTell, traditionalReading,
  trainingWeights,
  partsFor, checkedParts, coinReading,
};
