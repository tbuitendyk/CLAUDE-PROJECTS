// COINS: typing a coin's history into rising and falling stretches, and the
// per-coin search for the fall-back percentage (COINS.md sections 3 and 4;
// owner LOOP NOW! 2026-09-12).
//
// The success rules these check were pre-registered in
// LOOP-2026-09-12-COINS.md section A BEFORE any of this ran, which is the only
// reason a green result here means anything.
const { assert } = require('./helpers');
const {
  typeStretches, searchFallback,
  cutAtBoundaries, medianFullLengths, countStretches, turnsIn,
  splitOfTime, layoutWidths, worstTailSlice, balanceDrift, shuffledCopy, canTheReadingTell, traditionalReading, trainingWeights,
  partsFor, checkedParts, coinReading,
} = require('../lib/coins');

// A PRICE PATH WITH TURNS WHERE WE PUT THEM. Each leg moves `swing` percent
// from where the last one ended, in `legLen` equal steps, so the turns land on
// known indices and nowhere else.
function builtPath(legs, { start = 100, swing = 20, legLen = 10 } = {}) {
  const prices = [start];
  const peaks = [];
  let p = start;
  for (let i = 0; i < legs; i++) {
    const up = i % 2 === 0;
    const target = up ? p * (1 + swing / 100) : p / (1 + swing / 100);
    for (let k = 1; k <= legLen; k++) prices.push(p + (target - p) * (k / legLen));
    p = target;
    if (i < legs - 1) peaks.push(prices.length - 1);      // the turn is the leg's last index
  }
  return { prices, peaks };
}

module.exports = {
  // C1.1 and C1.2: the turns land where they were built, and the stretches
  // tile the whole span with no gaps, no overlaps and nothing empty.
  theTurnsLandWhereTheyWereBuiltAndTheStretchesTileTheSpan() {
    for (const legs of [2, 3, 4, 5, 8]) {
      const { prices, peaks } = builtPath(legs, { swing: 20, legLen: 10 });
      // a percentage well inside the swing finds every built turn and no other
      for (const pct of [5, 8, 10, 12]) {
        const r = typeStretches(prices, pct);
        assert.deepStrictEqual(r.turns, peaks,
          `${legs} legs at ${pct}%: the turns must be exactly the ones the path was built with`);

        // every index in exactly one stretch, in order, nothing empty
        let expect = 0;
        for (const s of r.stretches) {
          assert.strictEqual(s.from, expect, 'the stretches must be contiguous with no gap');
          assert.ok(s.to >= s.from, 'no stretch may be empty');
          expect = s.to + 1;
        }
        assert.strictEqual(expect, prices.length, 'the stretches must cover the whole span');

        // and they alternate: two of a kind in a row means a turn was missed
        for (let i = 1; i < r.stretches.length; i++) {
          assert.notStrictEqual(r.stretches[i].type, r.stretches[i - 1].type,
            'stretches must alternate — two of a kind in a row is a missed turn');
        }
        assert.strictEqual(r.stretches[0].type, 'rising', 'this path starts by rising');
      }
    }
  },

  // C1.3: a path that only rises is ONE stretch and ZERO turns, whatever
  // percentage is asked for. Nothing is left unclassified either (two types
  // only, no third bucket).
  aPathThatOnlyRisesIsOneStretchAndNoTurns() {
    const prices = [];
    for (let i = 0; i < 200; i++) prices.push(100 * (1 + i * 0.004));
    for (const pct of [1, 3, 7, 15, 40]) {
      const r = typeStretches(prices, pct);
      assert.strictEqual(r.turns.length, 0, `${pct}%: a one-way path has no turns`);
      assert.strictEqual(r.stretches.length, 1, `${pct}%: and exactly one stretch`);
      assert.strictEqual(r.stretches[0].type, 'rising');
      assert.strictEqual(r.stretches[0].from, 0);
      assert.strictEqual(r.stretches[0].to, prices.length - 1);
    }
    // the mirror, and a dead flat path, which still gets a type rather than a hole
    const down = prices.slice().reverse();
    assert.strictEqual(typeStretches(down, 5).stretches[0].type, 'falling');
    const flat = new Array(50).fill(100);
    const f = typeStretches(flat, 5);
    assert.strictEqual(f.stretches.length, 1, 'a flat path is one stretch');
    assert.ok(f.stretches[0].type === 'rising' || f.stretches[0].type === 'falling',
      'and it is one of the two types — there is no third bucket');
  },

  // IT READS RETURNS, NEVER PRICE LEVELS (COINS.md section 3). The same shape
  // at ten times the price must type identically, or a model can learn the
  // price level instead of the condition.
  theTypingIsTheSameAtAnyPriceLevel() {
    const { prices } = builtPath(6, { start: 50, swing: 18, legLen: 12 });
    const dear = prices.map((p) => p * 100);
    const cheap = prices.map((p) => p / 7);
    const a = typeStretches(prices, 9);
    const b = typeStretches(dear, 9);
    const c = typeStretches(cheap, 9);
    assert.deepStrictEqual(b.turns, a.turns, 'a hundred times the price must type the same');
    assert.deepStrictEqual(c.turns, a.turns, 'a seventh of the price must type the same');
  },

  // C1.4 and C1.5: the search takes the LARGEST percentage reaching the target,
  // says so plainly when nothing reaches it, and reports what it delivered
  // beside what was asked.
  theSearchTakesTheLargestPercentageThatReachesTheTarget() {
    const { prices } = builtPath(9, { swing: 20, legLen: 10 });
    const got = searchFallback(prices, { target: 4, from: 1, to: 30, step: 0.5 });
    assert.strictEqual(got.reached, true, 'this path can give four changes of direction');
    assert.ok(got.turns >= 4, 'and the pick must reach the target');

    // LARGEST: nothing above the pick reaches the target
    for (const w of got.walk) {
      if (w.pct > got.pct) {
        assert.ok(w.turns < got.asked,
          `${w.pct}% reaches ${w.turns} and is larger than the pick at ${got.pct}% — the pick was not the largest`);
      }
    }
    assert.strictEqual(got.overshot, got.turns > got.asked, 'overshot says whether it delivered more than asked');

    // NOTHING REACHES IT: it must say so and report the best, never quietly
    // hand back the smallest percentage.
    const flat = [];
    for (let i = 0; i < 120; i++) flat.push(100 + Math.sin(i / 9) * 0.05);
    const none = searchFallback(flat, { target: 40, from: 5, to: 30, step: 1 });
    assert.strictEqual(none.reached, false, 'forty changes are not in this path');
    assert.strictEqual(none.pct, null, 'and no percentage is handed back as though one worked');
    assert.ok(none.best && typeof none.best.turns === 'number', 'the best it found is reported');
    assert.ok(/no percentage between/.test(none.why), 'and it says so in a sentence');
    assert.ok(none.walk.length > 1, 'the walk is reported either way');
  },

  // THE TEST OF THE TEST, pre-registered in the loop record before any of this
  // ran: the count against percentage is NOT a clean staircase, because an
  // earlier turn moves where the later ones land. The loop record said that if
  // no path showed it, the test was too easy rather than the code being right.
  //
  // THE FIRST VERSION OF THIS TEST WAS TOO EASY AND FAILED. It swept forty
  // smooth sine paths and found nothing. A probe over four hundred rough walks
  // found five, all of them at high percentages where the turn count is small
  // — so the effect is real, it is rare (about one path in eighty), and smooth
  // paths cannot show it. The pre-registration is the only reason that was
  // caught rather than written up as "monotone, claim withdrawn".
  //
  // So this pins a KNOWN case by seed, which is a permanent fact about the
  // algorithm, and sweeps for more beside it. A search rewritten as a
  // bisection — which assumes the staircase — fails on the pinned case.
  theCountAgainstPercentageIsNotAStaircase() {
    // deterministic, no random source: the same walk every run, on every box
    const walkPath = (seed, n = 400) => {
      let s2 = (seed * 7919) >>> 0;
      const rnd = () => ((s2 = (s2 * 1664525 + 1013904223) >>> 0) / 4294967296);
      const prices = [100];
      for (let i = 1; i < n; i++) prices.push(prices[i - 1] * (1 + (rnd() - 0.5) * 0.09));
      return prices;
    };

    // THE PINNED CASE. On this path a LARGER percentage finds MORE turns.
    const prices = walkPath(8);
    const at = (pct) => typeStretches(prices, pct).turns.length;
    assert.strictEqual(at(15.75), 5, 'the pinned path gives five turns at 15.75%');
    assert.strictEqual(at(16), 6, 'and SIX at 16% — a larger percentage finding more turns');

    // which means the largest percentage reaching a target is NOT simply the
    // last one before the count drops below it. The search has to walk.
    const got = searchFallback(prices, { target: 6, from: 1, to: 30, step: 0.25 });
    assert.strictEqual(got.reached, true, 'six changes are reachable on this path');
    assert.ok(got.pct >= 16,
      `the pick must be at least 16% — a search that stopped at the first drop below the target would have taken ${got.pct}%`);
    for (const w of got.walk) {
      if (w.pct > got.pct) assert.ok(w.turns < 6, `${w.pct}% reaches ${w.turns} and is above the pick`);
    }

    // and it is not a one-off: sweep and count how many paths show it at all
    let seen = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const p = walkPath(seed);
      let prev = null;
      for (let pct = 0.5; pct <= 30.0001; pct += 0.25) {
        const t = typeStretches(p, Number(pct.toFixed(4))).turns.length;
        if (prev !== null && t > prev) { seen++; break; }
        prev = t;
      }
    }
    assert.ok(seen >= 3,
      `only ${seen} of four hundred rough walks showed the count rising with the percentage — `
      + 'the effect is documented in COINS.md section 4 and if it has gone the section is wrong');
  },

  // A refusal is a bug on this tab. Nothing here may hand back a verdict.
  // A CLOSED LIST OF FORBIDDEN WORDS IS NOT A CHECK -- a refusal under any word
  // the list does not name walks straight past it, and a negative scan also
  // passes trivially when the code is deleted. So this reads the SHAPE of what
  // comes back: whatever a reading grows, it may not grow a yes-or-no.
  nothingInHereRefusesACoin() {
    const { prices } = builtPath(3);
    let st = 606;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const long = [100];
    for (let i = 1; i < 220; i++) long.push(long[i - 1] * (1 + (rnd() - 0.47) * 5 / 100));
    const lm = long.map((p, i) => (i ? ((p - long[i - 1]) / long[i - 1]) * 100 : 0.1));

    const outs = [
      typeStretches(prices, 5),
      searchFallback(prices, { target: 999 }),
      splitOfTime(lm),
      worstTailSlice(lm, layoutWidths(lm.length)),
      balanceDrift(lm, 8),
      traditionalReading(lm, { driftParts: 8 }),
      trainingWeights(lm, { cap: 20 }),
      coinReading(long, lm, { layout: 'reserve61', target: 4, from: 1, to: 25, step: 0.5, cap: 20 }),
      coinReading(long, lm, { layout: 'split70', target: 900, from: 1, to: 25, step: 0.5, cap: 20 }),
    ];
    // A BARE true/false ANYWHERE IN A READING IS A VERDICT wearing a reading's
    // clothes. Five are legitimate and every one of them is named here with
    // what it is about, and not one of them is about the coin's worth:
    // `reached` says whether the search found a percentage; `overshot` whether
    // the count landed on the target or jumped past it; `stub` whether a piece
    // was ended by a cut rather than a turn; `open` whether the walk ran out of
    // data mid-stretch; `reachedMean` whether the average weight could be
    // brought to 1 under the owner's ceiling. Anything else that is a bare yes
    // or no has to be argued for in this list before it can ship.
    const allowed = new Set(['reached', 'overshot', 'stub', 'open', 'reachedMean', 'canTell']);
    const walk = (v, path) => {
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
      if (!v || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        assert.ok(typeof x !== 'boolean' || allowed.has(k),
          `${path}.${k} is a bare yes or no — this tab reports and never refuses (COINS.md section 8). `
          + 'If it is a reading, it is a number or a sentence; if it is a verdict, it may not be here.');
        walk(x, `${path}.${k}`);
      }
    };
    outs.forEach((o, i) => walk(o, `reading ${i}`));

    // AND NOTHING HERE THROWS ON A COIN. Every shape of bad input a real coin
    // could arrive in comes back as a reading with a sentence, never an error.
    for (const [what, prices2] of [
      ['a flat coin', new Array(200).fill(100)],
      ['a coin that only rises', new Array(200).fill(0).map((_, i) => 100 * (1.01 ** i))],
      ['a coin that only falls', new Array(200).fill(0).map((_, i) => 100 * (0.99 ** i))],
      ['a coin with an unusable price in it', new Array(200).fill(0).map((_, i) => (i === 50 ? 0 : 100 + Math.sin(i / 5) * 20))],
      ['a coin that barely moves', new Array(200).fill(0).map((_, i) => 100 + Math.sin(i / 30) * 1e-6)],
    ]) {
      const mv = prices2.map((p, i) => (i ? ((p - prices2[i - 1]) / (prices2[i - 1] || 1)) * 100 : 0));
      for (const layout of ['reserve61', 'split70']) {
        const r = coinReading(prices2, mv, { layout, target: 6, from: 1, to: 30, step: 0.5, cap: 20 });
        assert.ok(r && r.layout === layout, `${what} under ${layout} must still come back with a reading`);
        assert.ok(r.split && r.split.length >= 3, `${what}: the split of time is reported whatever else happened`);
        assert.ok(r.weight && r.weight.mean != null, `${what}: the training weight is reported whatever else happened`);
        if (!r.search.reached) assert.ok(r.why && r.why.length > 10, `${what}: and a sentence saying what happened`);
      }
    }
  },
// ---- C2: cutting at the boundaries -----------------------------------------

  // C2.1, C2.2 and C2.5, all pre-registered. The pieces sum back to the
  // original, the turn counts are IDENTICAL before and after cutting, and no
  // part ever holds more than two stubs.
  cuttingSplitsAStretchWithoutLosingOrInventingAnyPeriod() {
    const { prices } = builtPath(7, { swing: 20, legLen: 13 });
    const r = typeStretches(prices, 9);
    const n = prices.length;
    const parts = [
      { name: 'train', from: 0, to: Math.round(n * 0.61) - 1 },
      { name: 'test', from: Math.round(n * 0.61), to: Math.round(n * 0.74) - 1 },
      { name: 'held', from: Math.round(n * 0.74), to: Math.round(n * 0.87) - 1 },
      { name: 'reserve', from: Math.round(n * 0.87), to: n - 1 },
    ];
    const cut = cutAtBoundaries(r.stretches, parts);

    // every period lands in exactly one piece of exactly one part
    let seen = 0;
    for (const p of cut) {
      let expect = p.from;
      for (const piece of p.pieces) {
        assert.strictEqual(piece.from, expect, 'the pieces of a part must be contiguous');
        expect = piece.to + 1;
        seen += piece.length;
      }
      assert.strictEqual(expect, p.to + 1, `${p.part} must be covered end to end`);
      // C2.5: at most two stubs per part, because only the edges get cut
      const stubs = p.pieces.filter((x) => x.stub).length;
      assert.ok(stubs <= 2, `${p.part} came back with ${stubs} stubs — only the two edges can be cut`);
      // and a stub can only be at an edge
      for (let i = 0; i < p.pieces.length; i++) {
        if (p.pieces[i].stub) assert.ok(i === 0 || i === p.pieces.length - 1, 'a stub can only be at an edge');
      }
    }
    assert.strictEqual(seen, n, 'cutting must neither lose nor invent a period');

    // C2.2: TURNS ARE THE SAME BEFORE AND AFTER. If this ever fails, the claim
    // that handover needs no stub arithmetic is wrong and COINS.md section 5
    // has to be reopened.
    const after = parts.reduce((a, p) => a + turnsIn(r.turns, p), 0);
    assert.strictEqual(after, r.turns.length, 'cutting must not cut a turn');
  },

  // C2.3 and C2.4: a stub counts as its share of the median, and two half-median
  // stubs add to exactly one.
  twoStubsOfHalfTheMedianAddUpToOne() {
    // eight full rising stretches of length 10, so the median is plainly 10
    const pieces = [];
    for (let i = 0; i < 8; i++) pieces.push({ from: i * 10, to: i * 10 + 9, type: 'rising', length: 10, stub: false });
    const cutPart = { part: 'train', from: 0, to: 79, pieces };
    const med = medianFullLengths([cutPart]);
    assert.strictEqual(med.rising, 10, 'the median full length is ten');

    const withStubs = {
      part: 'test',
      pieces: [
        { from: 0, to: 4, type: 'rising', length: 5, stub: true },
        { from: 5, to: 9, type: 'rising', length: 5, stub: true },
      ],
    };
    const c = countStretches(withStubs, med);
    assert.ok(Math.abs(c.rising.count - 1) < 1e-12,
      `two stubs of half the median must add to one, got ${c.rising.count}`);
    assert.strictEqual(c.rising.full, 0);
    assert.strictEqual(c.rising.stubs, 2);

    // a full stretch is one, and a tiny stub against a big median is nearly nothing
    const tiny = { part: 'test', pieces: [{ from: 0, to: 2, type: 'rising', length: 3, stub: true }] };
    assert.ok(Math.abs(countStretches(tiny, med).rising.count - 0.3) < 1e-12);

    // and a stub with no full stretch of its type to measure against reads as
    // UNANSWERED, never as zero
    const orphan = { part: 'test', pieces: [{ from: 0, to: 4, type: 'falling', length: 5, stub: true }] };
    assert.strictEqual(countStretches(orphan, med).falling.count, null,
      'a stub with nothing to compare to has not answered the question');
  },

  // ---- C3: the training weight ------------------------------------------------

  // C3.3, the number pre-registered in the loop record before any of it ran:
  // the owner's own example must reproduce. 7 periods moving 1.6% and 35 moving
  // 0.086% -- unweighted the slow group outpulls the fast 5.00 to 1; weighted,
  // the fast group outpulls the slow by 3.73 +/- 0.05 to 1.
  theOwnersOwnExampleReproduces() {
    const moves = [];
    for (let i = 0; i < 7; i++) moves.push(1.6);
    for (let i = 0; i < 35; i++) moves.push(0.086);

    // UNWEIGHTED, THE SLOW FIVE WEEKS OUTPULL THE FAST WEEK FIVE TO ONE. Read
    // off the fixture rather than asserted about it: the first version of this
    // line divided 35 by 7 and checked the answer was 5, which is arithmetic on
    // two literals written three lines above and cannot fail whatever the code
    // does.
    const flatWeights = new Array(moves.length).fill(1);
    const unweightedFast = flatWeights.slice(0, 7).reduce((a, b) => a + b, 0);
    const unweightedSlow = flatWeights.slice(7).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(unweightedFast / unweightedSlow - 0.2) < 1e-12,
      'unweighted, the fast week pulls a fifth of what the slow five weeks pull');

    const w = trainingWeights(moves, { cap: 20 });
    const fast = w.weights.slice(0, 7).reduce((a, b) => a + b, 0);
    const slow = w.weights.slice(7).reduce((a, b) => a + b, 0);
    const ratio = fast / slow;
    assert.ok(Math.abs(ratio - 3.73) <= 0.05,
      `the pre-registered band is 3.73 +/- 0.05 and the weighting gives ${ratio.toFixed(4)} — `
      + 'outside it means the arithmetic written into COINS.md section 6 is wrong');
  },

  // C3.1 and C3.2: the mean is exactly 1 and nothing exceeds the ceiling, on
  // shapes chosen to make those two fight.
  theMeanWeightIsOneAndNothingExceedsTheCeiling() {
    const cases = [
      [1.6, 0.086, 3, 0.001, 12, 0.4],
      new Array(200).fill(0).map((_, i) => (i === 0 ? 500 : 0.01)),   // one violent period
      new Array(50).fill(0).map((_, i) => (i % 2 ? 1 : -1)),          // signs must not matter
    ];
    for (const moves of cases) {
      for (const cap of [1.5, 3, 20]) {
        const w = trainingWeights(moves, { cap });
        assert.strictEqual(w.reachedMean, true, 'these shapes can all reach an average of 1');
        assert.ok(Math.abs(w.mean - 1) < 1e-9,
          `mean must be 1, got ${w.mean} (cap ${cap}, ${moves.length} periods)`);
        for (const x of w.weights) {
          assert.ok(x <= cap + 1e-9, `a weight of ${x} broke the ceiling of ${cap}`);
          assert.ok(x >= 0, 'no weight may be negative');
        }
      }
    }
    // the sign of the move must not change its weight
    const a = trainingWeights([2, -3, 1], { cap: 20 }).weights;
    const b = trainingWeights([-2, 3, -1], { cap: 20 }).weights;
    assert.deepStrictEqual(b, a, 'a fall of 3% must weigh the same as a rise of 3%');
    // a ceiling at or below 1 cannot leave the mean at 1, and it says so
    assert.throws(() => trainingWeights([1, 2], { cap: 1 }), /ceiling must be above 1/);

    // AND THE CASE THAT BROKE THE FIRST VERSION. A period that did not move
    // weighs nothing, so with four of five periods flat the whole average has
    // to come from the fifth and no scale can lift it past the ceiling over
    // five. This must say so and name the ceiling that would work -- never
    // hand back a mean that is not 1 while calling itself normalised.
    const thin = trainingWeights([0, 0, 5, 0, 0], { cap: 1.5 });
    assert.strictEqual(thin.reachedMean, false, 'it must not claim an average it did not reach');
    assert.ok(Math.abs(thin.needCap - 5) < 1e-9, `a ceiling of five would do it, it says ${thin.needCap}`);
    assert.ok(/only 1 of 5 periods moved/.test(thin.why), 'and it says why in a sentence');
    // raise the ceiling to what it named and the average is reachable
    const ok = trainingWeights([0, 0, 5, 0, 0], { cap: 5 });
    assert.strictEqual(ok.reachedMean, true);
    assert.ok(Math.abs(ok.mean - 1) < 1e-9);
    // nothing moved at all: every period weighs the same rather than dividing by zero
    const dead = trainingWeights([0, 0, 0], { cap: 20 });
    assert.deepStrictEqual(dead.weights, [1, 1, 1]);
  },

  // C3.4: ONE VECTOR, SHARED BY BOTH SETS. The function must not learn which
  // set it is for -- if it ever needs to, the design was wrong.
  theWeightIsOneVectorAndKnowsNothingAboutWhichSetItIsFor() {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'coins.js'), 'utf8');
    assert.ok(/function trainingWeights\(moves, opts = \{\}\) \{/.test(src),
      'trainingWeights takes the moves and its options, and nothing that says which set it is for');
    const at = src.indexOf('function trainingWeights(');
    const nextSection = src.indexOf('\n// ----', at);
    const body = src.slice(at, nextSection > 0 ? nextSection : src.length);
    for (const word of ['rising', 'falling']) {
      assert.ok(!new RegExp(`\\b${word}\\b`).test(body),
        `the body of trainingWeights mentions "${word}" — it is ONE vector shared by both sets, and a function that knows which side it is weighting has already gone wrong`);
    }
    // and the same moves give the same weights however they are asked for
    const once = trainingWeights([3, 1, 4, 1, 5], { cap: 20 }).weights;
    const twice = trainingWeights([3, 1, 4, 1, 5], { cap: 20 }).weights;
    assert.deepStrictEqual(twice, once, 'it is deterministic');
  },

  // ---- C4: the traditional score ----------------------------------------------

  // C4.1, pre-registered: on a span balanced overall whose last 13% only rises,
  // the worst tail slice reads at or near 0 while the whole-span balance reads
  // near 0.5. If they move together, the number is measuring nothing.
  theWorstTailSliceSeesAOneWayTailThatTheWholeSpanBalanceHides() {
    const moves = [];
    for (let i = 0; i < 174; i++) moves.push(i % 2 ? 1 : -1);   // dead balanced
    for (let i = 0; i < 26; i++) moves.push(1);                 // the last 13% only rises
    const whole = splitOfTime(moves);
    assert.ok(Math.abs(whole.balance - 0.5) < 0.07,
      `the whole span must still read near balanced, got ${whole.balance}`);
    const widths = layoutWidths(moves.length);
    const worst = worstTailSlice(moves, widths);
    assert.ok(worst.balance <= 0.02,
      `the worst slice must see the one-way tail, got ${worst.balance}`);
    assert.ok(worst.from >= 160, 'and it must point AT the tail, not somewhere else');

    // C4.2: balanced everywhere and both read near a half
    const even = [];
    for (let i = 0; i < 200; i++) even.push(i % 2 ? 1 : -1);
    assert.ok(Math.abs(splitOfTime(even).balance - 0.5) < 1e-9);
    assert.ok(worstTailSlice(even, layoutWidths(even.length)).balance >= 0.45, 'nothing one-way anywhere, so no slice is one-way');

    // THE WIDTHS ARE THE CALLER'S. Hand it a width and it must walk THAT width,
    // not one of its own choosing. (The reviewer's mutation "ignore the caller's
    // widths" was green: nothing checked.)
    for (const w of [4, 7, 31]) {
      const got = worstTailSlice(moves, [w]);
      assert.strictEqual(got.width, w, `asked for a window of ${w} and got ${got.width}`);
      assert.strictEqual(got.to - got.from + 1, w, 'the slice named must be the width asked for');
      assert.deepStrictEqual(got.widths, [{ width: w }], 'the record of what was walked must name that width');
    }

    // AND IT IS THE WORST FOUND ANYWHERE, one period at a time. A window that
    // steps three at a time would step straight over this one. (Also green
    // before: nothing pinned the stride.)
    const hidden = [];
    for (let i = 0; i < 60; i++) hidden.push(i % 2 ? 1 : -1);
    for (let i = 0; i < 5; i++) hidden[31 + i] = 1;             // one-way run at 31..35, an odd start
    const found = worstTailSlice(hidden, [5]);
    assert.strictEqual(found.from, 31, `the worst five-wide window starts at 31, got ${found.from}`);
    assert.strictEqual(found.balance, 0, 'and it runs entirely one way');

    // A PERIOD THAT DID NOT MOVE IS NEITHER. Count a zero as a rise and a coin
    // that mostly sits still reads as one-way rising, which is a false alarm on
    // the one number that is supposed to raise them.
    const still = new Array(40).fill(0);
    still[10] = 1; still[11] = -1; still[12] = 1; still[13] = -1;
    assert.strictEqual(splitOfTime(still).periods, 4, 'only the periods that moved are counted');
    assert.strictEqual(splitOfTime(still).balance, 0.5, 'and those four are evenly split');

    // NO WIDTH IS NO READING, and it says so rather than guessing.
    const none = worstTailSlice(moves, []);
    assert.deepStrictEqual({ balance: none.balance, width: none.width, widths: none.widths },
      { balance: null, width: null, widths: [] }, 'with no width to walk there is no reading');

    // EVERY WIDTH WALKED IS RECORDED, whether or not it produced the answer.
    const flat = worstTailSlice(new Array(60).fill(0), [8, 9]);
    assert.deepStrictEqual(flat.widths, [{ width: 8 }, { width: 9 }],
      'a width that was walked and found nothing must still be in the record of what was walked');
  },

  // THE WIDTHS COME FROM THE ENGINE'S OWN SPLIT, never typed here. They are the
  // last stretch each window layout carves, so a change to how the engine seals
  // moves this with it.
  theTailWidthsAreTheOnesTheLayoutsActuallyCarve() {
    const { splitBounds, reserveChunks } = require('../lib/bracketwork');
    for (const n of [40, 61, 100, 159, 200, 725, 1000]) {
      const sealed = reserveChunks(n);
      const held = splitBounds(n, true).nHold;
      const want = [...new Set([sealed, held])].filter((w) => w >= 2 && w <= n).sort((a, b) => a - b);
      assert.deepStrictEqual(layoutWidths(n), want,
        `${n} periods: the widths must be the sealed reserve (${sealed}) and the held-back stretch (${held})`);
    }
    // and it is ONE reading per coin, so it never asks which layout it is for
    assert.strictEqual(layoutWidths.length, 1, 'the widths are a function of the period count alone');
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'coins.js'), 'utf8');
    const at = src.indexOf('function layoutWidths');
    const body = src.slice(at, src.indexOf('function worstTailSlice', at));
    // ASKED AS A VALUE, NOT AS A SPELLING. This used to match /0\.13|0\.15/,
    // and `.13`, `0.130` and `13e-2` are the same number to the engine and
    // invisible to that -- so the second copy this exists to stop could be
    // typed straight back in with a green suite.
    const { numberLiteralsIn } = require('./helpers');
    const SHARES = [0.13, 0.15];
    const typedIn = (chunk) => numberLiteralsIn(chunk).filter((v) => SHARES.includes(v));
    assert.deepStrictEqual(typedIn(body), [],
      'the shares are typed in layoutWidths, which is the second copy this exists to stop');
    assert.deepStrictEqual(typedIn(src.slice(src.indexOf('function worstTailSlice'), src.indexOf('function balanceDrift'))), [],
      'the shares are typed in worstTailSlice');
  },

  // C4.3: the traditional numbers read an UNTUNED direction. Re-tune the
  // fall-back percentage and they must not move at all.
  theTraditionalNumbersDoNotMoveWhenTheTunedPercentageMoves() {
    const { prices } = builtPath(9, { swing: 17, legLen: 11 });
    const moves = [];
    for (let i = 1; i < prices.length; i++) moves.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
    const before = { worst: worstTailSlice(moves).balance, drift: balanceDrift(moves, 8).drift };
    // the tuned typing changes wildly across these percentages
    const counts = [3, 9, 20].map((p) => typeStretches(prices, p).turns.length);
    assert.ok(new Set(counts).size > 1, 'the tuned typing must actually differ across these percentages');
    const after = { worst: worstTailSlice(moves).balance, drift: balanceDrift(moves, 8).drift };
    assert.deepStrictEqual(after, before, 'the traditional numbers must not read the tuned percentage');
  },

  // The drift number does what it says: it moves when the balance moves from
  // part to part, and sits at zero when every part is the same.
  theDriftMovesOnlyWhenTheBalanceMovesFromPartToPart() {
    const even = [];
    for (let i = 0; i < 240; i++) even.push(i % 2 ? 1 : -1);
    const flat = balanceDrift(even, 8);
    assert.ok(flat.drift < 1e-9, `every part identical must drift at zero, got ${flat.drift}`);
    assert.strictEqual(flat.parts.length, 8);

    const swinging = [];
    for (let p = 0; p < 8; p++) {
      for (let i = 0; i < 30; i++) swinging.push(p % 2 ? 1 : (i % 2 ? 1 : -1));
    }
    assert.ok(balanceDrift(swinging, 8).drift > 0.3,
      'parts that alternate between balanced and one-way must drift hard');
  },
  // ---- C5: the per-coin record --------------------------------------------

  // THE DIVISIONS COME FROM THE ENGINE'S OWN ARITHMETIC, never typed here as
  // 61/13/13/13 and 70/15/15. Two copies of the same percentages drift.
  theWindowLayoutsAreReadFromTheEnginesOwnSplit() {
    const { splitBounds } = require('../lib/bracketwork');
    for (const n of [200, 400, 1000, 2661]) {
      const four = partsFor(n, 'reserve61');
      const three = partsFor(n, 'split70');
      assert.deepStrictEqual(four.map((p) => p.name), ['train', 'test', 'held', 'reserve']);
      assert.deepStrictEqual(three.map((p) => p.name), ['train', 'test', 'held']);
      for (const parts of [four, three]) {
        let expect = 0;
        for (const p of parts) {
          assert.strictEqual(p.from, expect, 'the parts must be contiguous');
          assert.ok(p.to >= p.from, 'no part may be empty');
          expect = p.to + 1;
        }
        assert.strictEqual(expect, n, 'the parts must cover every period');
      }
      // and they agree with splitBounds rather than with a typed percentage
      const nReserve = Math.max(2, Math.round(n * 0.13));
      const b4 = splitBounds(n - nReserve, true);
      assert.strictEqual(four[0].to + 1, b4.nTrain, 'train is what splitBounds says on the unsealed part');
      assert.strictEqual(n - four[3].from, nReserve, 'and the reserve is sealed the way the engine seals it');
      const b3 = splitBounds(n, true);
      assert.strictEqual(three[0].to + 1, b3.nTrain, 'train is what splitBounds says on the whole span');
    }
    assert.throws(() => partsFor(400, 'something-else'), /unknown window layout/);
  },

  // THE ONE THAT MATTERS MOST (COINS.md section 7): the search reads `train`
  // and `test` ONLY. Rewrite everything after `test` and the percentage the
  // search picks must not move by a hair.
  theSearchNeverReadsHeldOrReserve() {
    const base = [100];
    let st = 4242;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 1; i < 500; i++) base.push(base[i - 1] * (1 + (rnd() - 0.48) * 5 / 100));
    const moves = base.map((p, i) => (i ? ((p - base[i - 1]) / base[i - 1]) * 100 : 0.1));

    for (const layout of ['reserve61', 'split70']) {
      const parts = partsFor(base.length, layout);
      const end = parts[1].to;
      const opts = { layout, target: 5, from: 1, to: 25, step: 0.5, cap: 20 };
      const plain = coinReading(base, moves, opts);

      // three different futures, all wild, none of which may touch the search
      // A UNIFORM RESCALE IS NOT A DIFFERENT FUTURE. The first version of
      // this used p / 6, which leaves every return identical -- the
      // returns-not-levels property doing exactly what it is there for, and
      // the test was wrong to expect the reading to move. These three change
      // the direction mix itself.
      for (const [name, step] of [
        ['every period rises', 1.012],
        ['every period falls', 0.988],
        ['a saw', null],
      ]) {
        const other = base.slice();
        for (let i = end + 1; i < other.length; i++) {
          other[i] = step === null
            ? other[i - 1] * ((i - end) % 2 ? 1.03 : 0.97)
            : other[i - 1] * step;
        }
        const om = other.map((p, i) => (i ? ((p - other[i - 1]) / other[i - 1]) * 100 : 0.1));
        const got = coinReading(other, om, opts);
        assert.strictEqual(got.search.pct, plain.search.pct,
          `${layout}: ${name} after the end of test moved the percentage the search picked`);
        assert.deepStrictEqual(got.search.walk, plain.search.walk,
          `${layout}: ${name} changed the walk itself — held and reserve got a vote`);

        // AND NOT ONE FIGURE FOR train OR test MAY MOVE EITHER. This is the
        // half the first version of this guard could not see: it asserted the
        // two fields that cannot move and left every other one free. The
        // stretches were drawn by a single walk over the whole span, so a high
        // near the end of test only became a turn once price fell back from it
        // somewhere in held or in the sealed reserve -- and until it did, the
        // walk's last stretch ran to the end of ALL the data. Two series
        // identical through held, differing only inside the reserve, reported
        // different medians and a different count of stretches in TRAIN.
        assert.deepStrictEqual(got.medians, plain.medians,
          `${layout}: ${name} after the end of test moved the median stretch length`);
        for (const part of ['train', 'test']) {
          const a = plain.perPart.find((p) => p.part === part);
          const b = got.perPart.find((p) => p.part === part);
          assert.deepStrictEqual(b, a,
            `${layout}: ${name} after the end of test moved what ${part} reports`);
          const sa = plain.split.find((p) => p.part === part);
          const sb = got.split.find((p) => p.part === part);
          assert.deepStrictEqual(sb, sa, `${layout}: ${name} moved ${part}'s split of time`);
        }
        // and the reading of held DID move, or nothing was being reported
        const heldBefore = plain.split.find((p) => p.part === 'held').balance;
        const heldAfter = got.split.find((p) => p.part === 'held').balance;
        if (name !== 'a saw') {
          assert.ok(heldAfter < 0.02,
            `${layout}: with ${name} after the end of test, held must read as one-way (got ${heldAfter}) — or nothing is being reported`);
          assert.notStrictEqual(heldAfter, heldBefore, `${layout}: ${name} must move the reading of held`);
        }
      }
    }
  },

  // EVERY PART IS DRAWN BY A WALK THAT STOPS AT ITS OWN END, which is the rule
  // the guard above tests one instance of. Here it is head on: change ONE
  // period and nothing before that period may move, at any distance.
  nothingAfterAPartCanMoveWhatThatPartReports() {
    let st = 90210;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const base = [100];
    for (let i = 1; i < 320; i++) base.push(base[i - 1] * (1 + (rnd() - 0.47) * 6 / 100));
    const mv = (s) => s.map((p, i) => (i ? ((p - s[i - 1]) / s[i - 1]) * 100 : 0.1));
    const opts = { layout: 'reserve61', target: 5, from: 1, to: 25, step: 0.5, cap: 20 };
    const parts = partsFor(base.length, 'reserve61');
    const plain = coinReading(base, mv(base), opts);

    // PART ONE: at the settled percentage, each part's pieces are the ones a
    // walk that STOPS AT THAT PART'S END produces. Worked out here from
    // scratch, so it cannot agree with the reading by sharing its mistake --
    // which is what a fixture-and-a-hope test does. Under the version that
    // drew every part from one whole-span walk, this fails on the parts whose
    // last stretch had not turned yet.
    for (const p of parts) {
      const own = cutAtBoundaries(typeStretches(base.slice(0, p.to + 1), plain.search.pct).stretches, [p])[0];
      const got = plain.perPart.find((x) => x.part === p.name);
      assert.deepStrictEqual(got.stubs, own.pieces.filter((x) => x.stub).length,
        `${p.name} was not cut from a walk that stops at ${p.to}`);
      for (const type of ['rising', 'falling']) {
        const mine = own.pieces.filter((x) => x.type === type);
        assert.strictEqual(got.stretches[type].full, mine.filter((x) => !x.stub).length,
          `${p.name}: whole ${type} stretches must be the ones a walk stopping at ${p.to} leaves`);
        assert.strictEqual(got.stretches[type].stubLength, mine.filter((x) => x.stub).reduce((a, x) => a + x.length, 0),
          `${p.name}: the left-over ${type} length must be what a walk stopping at ${p.to} leaves`);
      }
      assert.strictEqual(got.turns, turnsIn(typeStretches(base.slice(0, p.to + 1), plain.search.pct).turns, p),
        `${p.name}'s turns must be the ones a walk stopping at ${p.to} found`);
    }
    // and the medians read train and test and stop there
    assert.deepStrictEqual(plain.medians, medianFullLengths(
      parts.map((p) => cutAtBoundaries(typeStretches(base.slice(0, p.to + 1), plain.search.pct).stretches, [p])[0]),
      ['train', 'test'],
    ), 'the median is not the median of what train and test leave');

    // PART TWO: replace the whole future past the end of test and nothing
    // moves -- not the percentage, not the median, not one figure for train or
    // for test. COINS.md section 7: held and reserve are reported and never
    // fed back. Four different futures, from every seventh period on, because
    // a uniform nudge leaves the shape of the path intact and never reaches
    // the case this is about (a peak at the end of test that later price
    // either does or does not confirm).
    //
    // ONLY PAST THE END OF test. Inside train or test a change moves the
    // percentage the search picks, and a different percentage re-types
    // everything, train included. That is the design and not a leak.
    const futures = [['everything rises', (p) => p * 1.03], ['everything falls', (p) => p * 0.97],
      ['a saw', (p, i) => p * (i % 2 ? 1.05 : 0.95)], ['dead flat', (p) => p]];
    let past = 0;
    for (let at = parts[1].to + 1; at < base.length; at += 7) {
      for (const [name, step] of futures) {
        const other = base.slice();
        for (let i = at; i < other.length; i++) other[i] = step(other[i - 1], i - at);
        const got = coinReading(other, mv(other), opts);
        past++;
        assert.strictEqual(got.search.pct, plain.search.pct, `${name} from period ${at} moved the percentage`);
        assert.deepStrictEqual(got.medians, plain.medians, `${name} from period ${at} moved the median`);
        for (const nm of ['train', 'test']) {
          assert.deepStrictEqual(got.perPart.find((p) => p.part === nm), plain.perPart.find((p) => p.part === nm),
            `${name} from period ${at} moved what ${nm} reports`);
          assert.deepStrictEqual(got.split.find((p) => p.part === nm), plain.split.find((p) => p.part === nm),
            `${name} from period ${at} moved ${nm}'s split of time`);
        }
        // and held's own figures do not move when only the reserve does
        if (at > parts[2].to) {
          assert.deepStrictEqual(got.perPart.find((p) => p.part === 'held'), plain.perPart.find((p) => p.part === 'held'),
            `${name} from period ${at}, inside the sealed reserve, moved what held reports`);
        }
      }
    }
    assert.ok(past >= 40, `this must actually replace the future many times over — it only did so ${past} time(s)`);
  },

  // A TURN IS CONFIRMED LATER THAN THE PERIOD IT MARKS, so the search's count
  // is a floor. Found by looking at the output rather than by being told. The
  // two numbers must never disagree silently.
  theGapBetweenWhatTheSearchSawAndWhatIsThereIsReported() {
    const prices = [100];
    let st = 12345;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 1; i < 400; i++) prices.push(prices[i - 1] * (1 + (rnd() - 0.48) * 6 / 100));
    const moves = prices.map((p, i) => (i ? ((p - prices[i - 1]) / prices[i - 1]) * 100 : 0.1));
    const r = coinReading(prices, moves, { layout: 'reserve61', target: 6, from: 1, to: 25, step: 0.5, cap: 20 });

    assert.strictEqual(r.searchedOver.turnsTheSearchCounted, 6, 'the search counted six on this path at this target');
    assert.strictEqual(r.searchedOver.turnsOnceLaterDataIsSeen, 7, 'and typing the whole span shows seven inside the same window');
    assert.ok(/more change\(s\) of direction sit inside train and test/.test(r.searchedOver.note),
      'the gap must be named on the record, never left to be noticed');

    // TURNS ARE ONLY EVER ADDED BY LATER DATA, NEVER TAKEN AWAY. That is what
    // makes the search's count a floor and the reading honest in the direction
    // that matters. If this ever fails the search is no longer a lower bound.
    for (const pct of [4, 7, 10, 14, 20]) {
      const parts = partsFor(prices.length, 'reserve61');
      const end = parts[1].to;
      const trunc = typeStretches(prices.slice(0, end + 1), pct).turns;
      const whole = typeStretches(prices, pct).turns.filter((t) => t <= end);
      for (const t of trunc) {
        assert.ok(whole.includes(t),
          `${pct}%: the turn at ${t} was seen on the truncated span and lost on the whole one — the search is not a floor`);
      }
    }
  },

  // The record carries what section 12 says it carries, and none of it is a
  // verdict. This tab reports.
  theRecordCarriesEveryReadingAndNoVerdict() {
    const prices = [100];
    let st = 777;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 1; i < 450; i++) prices.push(prices[i - 1] * (1 + (rnd() - 0.47) * 5 / 100));
    const moves = prices.map((p, i) => (i ? ((p - prices[i - 1]) / prices[i - 1]) * 100 : 0.1));
    const r = coinReading(prices, moves, { layout: 'reserve61', target: 4, from: 1, to: 25, step: 0.5, cap: 20, driftParts: 8 });

    assert.ok(r.search.reached, 'this path reaches four changes of direction');
    assert.strictEqual(r.perPart.length, 4, 'one reading per part of history');
    // EVERY PART'S BOUNDS ARE THE ENGINE'S, and every count is read from them.
    // Presence and type checks let all of these through: turns always zero, a
    // period count off by one, a part's split read one period past its end.
    const eng = partsFor(prices.length, 'reserve61');
    assert.deepStrictEqual(r.perPart.map((p) => [p.part, p.from, p.to, p.periods]),
      eng.map((p) => [p.name, p.from, p.to, p.to - p.from + 1]),
      'the parts on the record are not the ones the engine carves');
    assert.deepStrictEqual(r.split.map((s) => [s.part, s.from, s.to]), eng.map((p) => [p.name, p.from, p.to]),
      'the split of time is not read over the parts the engine carves');
    for (const s of r.split) {
      assert.deepStrictEqual({ ...splitOfTime(moves.slice(s.from, s.to + 1)), part: s.part, from: s.from, to: s.to }, s,
        `${s.part}'s split of time is not the split of ${s.part}`);
    }
    let seenTurns = 0;
    for (const p of r.perPart) {
      assert.strictEqual(p.turns, turnsIn(typeStretches(prices.slice(0, p.to + 1), r.search.pct).turns, p),
        `${p.part}'s turn count is not the turns inside ${p.part}`);
      seenTurns += p.turns;
      assert.ok(p.stretches.rising && p.stretches.falling, `${p.part} must report both types`);
      assert.ok(p.stubs <= 2, 'at most two stubs per part');
    }
    assert.ok(seenTurns > 0, 'a path with changes of direction must land some of them inside the parts');
    assert.strictEqual(r.typed.pct, r.search.pct, 'the typing must be at the percentage the search picked');
    assert.deepStrictEqual(r.searchedOver.parts, ['train', 'test'],
      'the search reads train and test and says so — naming any other part here is a false claim');
    assert.strictEqual(r.searchedOver.to, eng[1].to, 'the search window ends where test ends');

    // THE TRADITIONAL NUMBERS ARE NOT HERE. They are one per coin, not one per
    // layout (COINS.md section 11), so they live beside the readings on the
    // record and not inside each one -- two copies of one fact is what RULE
    // NINE forbids.
    assert.strictEqual(r.traditional, undefined, 'the traditional score is per coin, not per layout');

    assert.ok(r.weight && r.weight.over === 'train', 'the weight summary is over train, which is what gets trained on');
    assert.strictEqual(r.weight.periods, eng[0].to - eng[0].from + 1,
      'the weight summary says train but was worked out over some other stretch');
    assert.deepStrictEqual(
      trainingWeights(moves.slice(eng[0].from, eng[0].to + 1), { cap: 20 }).weights.map((w) => Math.round(w * 1e9)),
      trainingWeights(moves.slice(eng[0].from, eng[0].to + 1), { cap: 20 }).weights.map((w) => Math.round(w * 1e9)),
      'the weight arithmetic is not deterministic');
    // THE CEILING IS THE CALLER'S, never a constant. Two different ceilings must
    // give two different summaries, or the box on the screen does nothing.
    const lowCap = coinReading(prices, moves, { layout: 'reserve61', target: 4, from: 1, to: 25, step: 0.5, cap: 1.5 });
    assert.strictEqual(lowCap.weight.cap, 1.5, 'the record must carry the ceiling it was read at');
    assert.notDeepStrictEqual(lowCap.weight.capped, r.weight.capped, 'the ceiling on the record does nothing');
    // the vector itself is NOT stored -- it is deterministic from the moves and
    // the ceiling, and a stored copy is a second version waiting to go stale
    for (const k of Object.keys(r.weight)) {
      assert.ok(!Array.isArray(r.weight[k]), `the weight vector is stored on the record under '${k}'`);
    }

    // NOTHING IN THE RECORD IS A VERDICT. A closed list of four words is not a
    // check -- a refusal under any fifth name walks straight past it -- so this
    // reads the record's own SHAPE: every key it carries is one this test names.
    const known = new Set(['layout', 'periods', 'parts', 'searchedOver', 'search', 'split', 'weight', 'typed', 'medians', 'perPart', 'why']);
    for (const k of Object.keys(r)) {
      assert.ok(known.has(k), `the record grew a key this test has never seen: '${k}' — if it is a reading, name it here; if it is a verdict, it may not be on this tab`);
    }
    for (const v of Object.values(r)) {
      assert.ok(typeof v !== 'boolean', 'a bare true/false on the record is a verdict wearing a reading\'s clothes');
    }
  },

  // A coin the search cannot satisfy still gets a record, with everything on it
  // that did not need the search. It is never dropped.
  aCoinTheSearchCannotSatisfyStillGetsARecord() {
    const prices = [];
    for (let i = 0; i < 300; i++) prices.push(100 + Math.sin(i / 40) * 0.4);
    const moves = prices.map((p, i) => (i ? ((p - prices[i - 1]) / prices[i - 1]) * 100 : 0.01));
    const r = coinReading(prices, moves, { layout: 'split70', target: 50, from: 5, to: 30, step: 1, cap: 20 });
    assert.strictEqual(r.search.reached, false, 'fifty changes are not in this path');
    assert.ok(r.why && /no percentage between/.test(r.why), 'and the record says why in a sentence');
    assert.strictEqual(r.perPart, null, 'there is no typing to report per part, and it says so with null rather than zeros');
    assert.ok(r.parts.length === 3, 'and the parts are still described');

    // AND THE READINGS THAT NEVER NEEDED THE PERCENTAGE ARE STILL THERE. The
    // split of time reads the sign of each period's own move; the training
    // weight reads how far each period moved and the owner's ceiling. Neither
    // touches the search, and withholding them because a different reading
    // failed keeps the one number this tab produces for Sweep off the record.
    assert.strictEqual(r.split.length, 3, 'the split of time is reported for every part');
    for (const s of r.split) assert.ok(typeof s.balance === 'number', `${s.part} must still report its split`);
    assert.ok(r.weight && r.weight.mean != null, 'the training weight is still worked out');
    assert.strictEqual(r.weight.over, 'train', 'and it is still over train');
  },

  // ---- C5: the record on disk, and what it says about itself ------------------

  // THE PROVENANCE BLOCK IS REAL, and a reader can tell one record's shape from
  // another's. This is the rule that had no test at all: it lives in the runner,
  // and nothing in the suite loaded the runner.
  everyRecordSaysWhatItIsAndWhenItWasTaken() {
    const runner = require('../lib/coinsrun');
    const rec = runner.blankRecord('LTCUSDT', 'daily-4d', { target: 6 }, 'no cached prices');
    assert.strictEqual(rec.v, runner.RECORD_V, 'a record says which shape it is');
    assert.strictEqual(rec.read, false, 'a record that could not be read says so');
    assert.ok(rec.why && rec.why.length > 5, 'and says why in a sentence');
    assert.ok(rec.provenance.release === require('../package.json').version,
      'a record names the release that took it');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(rec.provenance.capturedAt), 'and when it was taken');
    assert.deepStrictEqual(rec.params, { target: 6 }, 'and the values it was read at');
    // AND IT IS STILL NOT A VERDICT: `read` says whether there was anything to
    // measure, never whether the coin is any good.
    const flat = JSON.stringify(rec);
    for (const word of ['pass', 'fail', 'eligible', 'verdict', 'reject', 'block']) {
      assert.ok(!new RegExp(`"[^"]*${word}[^"]*"\\s*:`, 'i').test(flat),
        `the record carries a key with '${word}' in its name — this tab reports (COINS.md section 8)`);
    }
  },

  // THE WINDOW LAYOUTS THE RUNNER READS ARE THE ONES THE DROPDOWN OFFERS. Typed
  // in the runner they were a second copy: add one to the vocabulary and the
  // screen offers it while every cell for it comes back empty.
  theRunnerReadsEveryLayoutTheScreenOffers() {
    const runner = require('../lib/coinsrun');
    const offered = require('../lib/vocabulary').vocabulary().windowLayout.map((o) => o.value);
    assert.deepStrictEqual(runner.layouts(), offered,
      'the runner reads a different set of window layouts from the one the screen offers');
    assert.ok(offered.length >= 2, 'both window layouts must be offered');
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
    assert.ok(!/'reserve61'|'split70'/.test(src), 'the runner types a window layout name');
  },

  // A FILE THAT CANNOT BE READ BACK IS NAMED, NEVER DROPPED IN SILENCE. Dropping
  // it made a release bump delete the owner's readings from the screen with
  // nothing saying where they went (RULE NINE).
  aRecordThisReleaseCannotReadIsNamedRatherThanHidden() {
    const fs = require('fs');
    const path = require('path');
    const runner = require('../lib/coinsrun');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'coinsrec-'));
    const real = runner.recordFile('AAAUSDT', 'daily-4d');
    const home = path.dirname(real);
    const made = [];
    const write = (name, body) => { const f = path.join(home, name); fs.writeFileSync(f, body); made.push(f); };
    try {
      fs.mkdirSync(home, { recursive: true });
      write('ZZZAUSDT__testshape.json', `${JSON.stringify({ ...runner.blankRecord('ZZZAUSDT', 'testshape', {}, 'nothing'), v: runner.RECORD_V })}\n`);
      write('ZZZBUSDT__testshape.json', `${JSON.stringify({ ...runner.blankRecord('ZZZBUSDT', 'testshape', {}, 'nothing'), v: 0 })}\n`);
      write('ZZZCUSDT__testshape.json', '{"v":2,"coin":"ZZZ');
      const got = runner.coinsRecords({ geometry: 'testshape' });
      assert.deepStrictEqual(got.records.map((r) => r.coin), ['ZZZAUSDT'], 'the readable record is served');
      assert.deepStrictEqual(got.unreadable.map((u) => u.coin).sort(), ['ZZZBUSDT', 'ZZZCUSDT'],
        'both the older shape and the broken file must be NAMED, not dropped');
      for (const u of got.unreadable) assert.ok(/read the coin again/.test(u.why), `${u.coin} must say what to do about it`);
      assert.strictEqual(got.recordVersion, runner.RECORD_V, 'the answer says which shape this release reads');
      assert.strictEqual(got.rareSideWeighting, false, 'and says plainly that a rare side is not weighted up at all');
      assert.strictEqual(got.thinSide, undefined, 'the level that was worked out from a ceiling the engine never applies must not come back');
    } finally {
      for (const f of made) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
      try { fs.rmdirSync(dir); } catch (_) { /* gone */ }
    }
  },

  // THE LEVEL BELOW WHICH WEIGHTING CANNOT HELP IS THE ENGINE'S OWN, not a
  // number typed on a screen (COINS.md section 8, finding 1 in section 14).
  // THE SCREEN MAY NOT PROMISE WEIGHTING THAT DOES NOT HAPPEN (3.121.0).
  //
  // 3.119.0 put a figure on the Coins screen -- "a side thinner than 1.7% will
  // not be rescued by weighting" -- worked out from the class ceiling in
  // `lib/bracket.js`. That ceiling sits inside `trainMember`, and the
  // three-stage engine does not call it: it trains through `trainProbMember`,
  // which passes the money weights and no class weights at all. The sentence
  // was true of code the owner never runs.
  //
  // This pins the fact, not the wording: whatever the screen says about a thin
  // side, it must not say weighting will help while the trainer passes none.
  theTrainerWeighsNoRareAnswerUpAndTheScreenDoesNotPretendItDoes() {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

    // 1. the trainer the engine really runs passes no class weights
    const work = strip(fs.readFileSync(path.join(root, 'lib', 'stagework.js'), 'utf8'));
    const fn = work.slice(work.indexOf('async function trainProbMember('), work.indexOf('\n}', work.indexOf('async function trainProbMember(')));
    assert.ok(fn.length > 500, 'the trainer the engine runs has changed shape — re-aim this before trusting it');
    const weighs = /classWeights/.test(fn);

    // 2. and the one that does is called by nothing in lib/
    const libDir = path.join(root, 'lib');
    const callers = fs.readdirSync(libDir).filter((f) => f.endsWith('.js') && f !== 'bracket.js')
      .filter((f) => /\btrainMember\s*\(/.test(strip(fs.readFileSync(path.join(libDir, f), 'utf8'))));

    // 3. so the screen must not promise it
    const page = strip(fs.readFileSync(path.join(root, 'public', 'construct.js'), 'utf8'));
    const at = page.indexOf('async function drawCoins()');
    const screen = page.slice(at, page.indexOf('\n}', page.indexOf('$(\'#cRun\').onclick', at)));
    assert.ok(screen.length > 1000, 'the Coins screen has changed shape — re-aim this before trusting it');
    const promises = /rescued by weighting|weighting can correct|thinner than weighting/.test(screen);

    if (!weighs && !callers.length) {
      assert.ok(!promises,
        'the trainer weighs no rare answer up and nothing in lib/ calls the one that does, yet the Coins screen '
        + 'still tells the owner weighting will rescue a thin side. That sentence is about code they never run.');
      const run = strip(fs.readFileSync(path.join(root, 'lib', 'coinsrun.js'), 'utf8'));
      assert.ok(!/thinSideLevel/.test(run), 'the runner still works out a level from a ceiling the engine never applies');
    } else {
      // the engine has GAINED class weighting since this was written. That is a
      // change worth noticing rather than passing quietly, so it says so.
      assert.ok(promises,
        `the engine now weighs a rare answer up (classWeights in the trainer: ${weighs}; callers of trainMember in lib/: `
        + `${callers.join(', ') || 'none'}) and the Coins screen no longer says so — the two have come apart again, `
        + 'the other way round this time.');
    }
  },

  // ---- what the adversarial pass on the tests themselves found unpinned -------
  // Every one of these was a mutation that broke something real and left the
  // whole suite green (2026-09-12). Named for what they pin, not for the
  // mutation, because the next wrong version will not be the same wrong version.

  // C1.5: the count moves in whole steps and can jump straight past the target,
  // and `overshot` says which happened. It was never generated landing EXACTLY
  // on target, so permanently true was green.
  overshotSaysWhetherTheCountLandedOnTheTargetOrJumpedPastIt() {
    const { prices } = builtPath(9, { swing: 20, legLen: 10 });   // eight built turns
    const exact = searchFallback(prices, { target: 8, from: 5, to: 12, step: 0.5 });
    assert.strictEqual(exact.reached, true, 'eight changes are in this path');
    assert.strictEqual(exact.turns, 8, 'and the search finds exactly eight');
    assert.strictEqual(exact.overshot, false, 'landing on the target is not an overshoot');
    const under = searchFallback(prices, { target: 3, from: 5, to: 12, step: 0.5 });
    assert.strictEqual(under.turns, 8, 'the largest percentage in this band still gives eight');
    assert.strictEqual(under.overshot, true, 'asking for three and getting eight is an overshoot and must say so');
    assert.strictEqual(under.asked, 3, 'and the record keeps what was asked for');
  },

  // C6/C7: every one of the four search controls is the owner's. Three of them
  // could be ignored outright with the suite green.
  everyValueTheOwnerSetsForTheSearchIsObeyed() {
    const { prices } = builtPath(9, { swing: 20, legLen: 10 });
    const pcts = (o) => searchFallback(prices, o).walk.map((w) => w.pct);

    // `from` is where it starts
    assert.strictEqual(pcts({ target: 2, from: 3, to: 9, step: 1 })[0], 3, 'the walk must start at `from`');
    assert.strictEqual(pcts({ target: 2, from: 7.5, to: 9, step: 0.5 })[0], 7.5, 'including a fractional `from`');
    // `to` is where it stops, and nothing beyond it is ever typed
    for (const to of [9, 14, 22, 31]) {
      const w = pcts({ target: 2, from: 1, to, step: 1 });
      assert.strictEqual(w[w.length - 1], to, `the walk must reach \`to\` (${to})`);
      assert.ok(w.every((p) => p <= to + 1e-9), `nothing past \`to\` (${to}) may be tried`);
    }
    // `step` is the gap, and the grid is even at any step
    for (const step of [0.25, 0.5, 1, 2.5]) {
      const w = pcts({ target: 2, from: 1, to: 11, step });
      for (let i = 1; i < w.length; i++) {
        assert.ok(Math.abs((w[i] - w[i - 1]) - step) < 1e-9,
          `at step ${step} the grid jumps ${w[i] - w[i - 1]} between ${w[i - 1]} and ${w[i]}`);
      }
      assert.strictEqual(new Set(w).size, w.length, `at step ${step} the walk repeats a percentage`);
    }
    // A STEP TOO SMALL TO PRINT AS A DECIMAL is still a step. JavaScript prints
    // anything below a millionth in exponential form, and reading the decimal
    // places out of the printed form collapsed the whole grid onto one value.
    const tiny = pcts({ target: 2, from: 1, to: 1.000005, step: 1e-7 });
    assert.strictEqual(new Set(tiny).size, tiny.length, 'a step below a millionth collapsed the grid onto one percentage');
    assert.strictEqual(tiny.length, 51, 'fifty-one values fit between 1 and 1.000005 at a ten-millionth');

    // and when nothing reaches, the best is the true best of what was walked
    const flat = new Array(80).fill(100).map((v, i) => v + Math.sin(i / 9) * 0.2);
    const miss = searchFallback(flat, { target: 40, from: 2, to: 9, step: 1 });
    assert.strictEqual(miss.reached, false, 'forty changes are not in a flat path');
    const walked = searchFallback(flat, { target: 40, from: 2, to: 9, step: 1 }).walk;
    const trueBest = walked.reduce((a, b) => (b.turns > a.turns || (b.turns === a.turns && b.pct > a.pct) ? b : a), walked[0]);
    assert.deepStrictEqual({ pct: miss.best.pct, turns: miss.best.turns }, { pct: trueBest.pct, turns: trueBest.turns },
      'the best reported is not the best of what was actually walked');
    assert.ok(miss.why.includes('2%') && miss.why.includes('9%'),
      `the sentence must name the range that was walked, got: ${miss.why}`);
  },

  // C1.2 at its hardest corner: a path whose last leg is ONE period. Tightening
  // the tail test by one leaves that period in no stretch at all.
  aOnePeriodTailIsStillInAStretch() {
    const prices = [];
    let p = 100;
    for (let i = 0; i < 30; i++) { p *= 1.02; prices.push(p); }
    prices.push(p * 0.9);                        // one period, a 10% drop, confirming the turn at 29
    const r = typeStretches(prices, 10);
    let covered = 0;
    for (const s of r.stretches) covered += s.to - s.from + 1;
    assert.strictEqual(covered, prices.length, 'every period must be inside exactly one stretch');
    assert.strictEqual(r.stretches[r.stretches.length - 1].to, prices.length - 1, 'the last period is in the last stretch');
    assert.deepStrictEqual(r.turns, [29], 'and the turn is at the high');
  },

  // A PRICE OF ZERO CANNOT BE A BASE FOR A RETURN, and it must not silence the
  // comparison for the rest of the series. One zero used to switch rise
  // detection off permanently.
  aPriceOfZeroCostsThatPeriodAndNoOther() {
    const withZero = [100, 50, 0, 50, 100, 150, 100, 50, 100, 150];
    const withReal = [100, 50, 25, 50, 100, 150, 100, 50, 100, 150];
    const z = typeStretches(withZero, 10);
    const n = typeStretches(withReal, 10);
    assert.strictEqual(z.turns.length, n.turns.length,
      `a single unusable price cost ${n.turns.length - z.turns.length} of the ${n.turns.length} turns on this path`);
    assert.deepStrictEqual(z.turns.slice(1), n.turns.slice(1), 'and every turn after it lands in the same place');
    let covered = 0;
    for (const s of z.stretches) covered += s.to - s.from + 1;
    assert.strictEqual(covered, withZero.length, 'the unusable period is still inside a stretch');
    // a series that opens on one, too
    assert.ok(typeStretches([0, 100, 90, 120, 100, 130, 100], 10).turns.length >= 1,
      'a series whose first price is unusable must still find its turns');

    // AND A TURN IS NEVER PLACED AT ONE. This is the case the guard is really
    // for, and it took a search over four thousand paths to find one where the
    // answer visibly differs -- without the guard the running low sits at zero,
    // every later rise measures as infinite, and the walk names the unusable
    // period itself as where the market turned. Found by breaking the line on
    // purpose and looking for a path that could tell: the first version of this
    // test could not, and the guard read MISS.
    const path = [97.89, 108.69, 89.62, 0, 63.89, 78.18, 80.13, 64.95, 59.39, 65.18, 69.75, 63.23];
    const t = typeStretches(path, 5);
    assert.deepStrictEqual(t.turns, [1, 4, 6, 8, 10],
      'the turn after the unusable period must be the real low beside it, never the unusable period itself');
    for (const turn of t.turns) {
      assert.ok(path[turn] > 0, `a turn was placed at period ${turn}, where the price is ${path[turn]} — no market turned there`);
    }
  },

  // C2.2 head on: a turn that lands EXACTLY on a part boundary. No fixture had
  // one, and that is the only case the rule is about.
  aTurnOnAPartBoundaryBelongsToExactlyOnePart() {
    const parts = [{ name: 'a', from: 0, to: 9 }, { name: 'b', from: 10, to: 19 }];
    const turns = [0, 9, 10, 19];
    const counted = turns.map((t) => parts.map((p) => turnsIn([t], p)));
    for (let i = 0; i < turns.length; i++) {
      assert.strictEqual(counted[i][0] + counted[i][1], 1,
        `a turn at ${turns[i]} is counted ${counted[i][0] + counted[i][1]} times across the two parts`);
    }
    assert.deepStrictEqual(counted, [[1, 0], [1, 0], [0, 1], [0, 1]],
      'the last period of a part belongs to that part, and the first to the next');
    // and through the real reading: build a path whose turn is on the boundary
    const built = [];
    let p = 100;
    const n = 200;
    const bounds = partsFor(n, 'split70');
    for (let i = 0; i < n; i++) {
      p *= i < bounds[0].to ? 1.02 : 0.97;
      built.push(p);
    }
    const t = typeStretches(built, 10);
    assert.ok(t.turns.includes(bounds[0].to - 1) || t.turns.includes(bounds[0].to),
      `this path turns at the train boundary; the turns found were ${t.turns}`);
    const cut = cutAtBoundaries(t.stretches, bounds);
    let all = 0;
    for (const c of cut) for (const piece of c.pieces) all += piece.length;
    assert.strictEqual(all, n, 'the pieces must still tile the span exactly');
  },

  // C2.3/C2.4/C2.5 on REAL cut output. They were checked on hand-built pieces
  // with every length the same, so `stub: false` everywhere was green and so
  // was a mean in place of the median.
  theStubArithmeticRunsOnWhatTheCutterActuallyProduces() {
    const { prices } = builtPath(11, { swing: 18, legLen: 9 });
    const parts = partsFor(prices.length, 'reserve61');
    const cut = cutAtBoundaries(typeStretches(prices, 8).stretches, parts);
    const stubs = cut.reduce((a, c) => a + c.pieces.filter((x) => x.stub).length, 0);
    assert.ok(stubs >= 2, `a path with turns everywhere must leave left-over ends at the boundaries, found ${stubs}`);
    for (const c of cut) {
      assert.ok(c.pieces.filter((x) => x.stub).length <= 2, `${c.part} has more than two left-over ends`);
      for (const piece of c.pieces) {
        if (!piece.stub) continue;
        assert.ok(piece.from === c.from || piece.to === c.to || piece.to === parts[parts.length - 1].to,
          `${c.part} has a left-over end that is not at an edge`);
      }
    }
    // THE MEDIAN, NOT THE MEAN. A skew of lengths where the two differ, so
    // swapping one for the other cannot pass.
    const skew = [{ part: 'train', from: 0, to: 99, pieces: [
      { type: 'rising', length: 4, stub: false }, { type: 'rising', length: 5, stub: false },
      { type: 'rising', length: 6, stub: false }, { type: 'rising', length: 60, stub: false },
      { type: 'falling', length: 10, stub: false }, { type: 'falling', length: 10, stub: false },
    ] }];
    const med = medianFullLengths(skew);
    assert.strictEqual(med.rising, 5.5, 'the median of 4, 5, 6 and 60 is 5.5 — a mean would read 18.75');
    assert.strictEqual(med.falling, 10, 'and the median of two tens is ten');

    // THE `over` FILTER IS REAL. It is what keeps held and reserve out of the
    // median, and it had never been called with anything but undefined.
    const two = [
      { part: 'train', from: 0, to: 9, pieces: [{ type: 'rising', length: 10, stub: false }] },
      { part: 'held', from: 10, to: 19, pieces: [{ type: 'rising', length: 2, stub: false }] },
    ];
    assert.strictEqual(medianFullLengths(two).rising, 6, 'with no filter both parts are read');
    assert.strictEqual(medianFullLengths(two, ['train']).rising, 10, 'the filter must keep held out');
    assert.strictEqual(medianFullLengths(two, ['held']).rising, 2, 'and must be able to keep train out');

    // AN UNFINISHED RUN AT THE END OF THE WALK IS A LEFT-OVER END, because no
    // turn ended it -- it ran out of data. Unmarked, the last part of every
    // span counted an unfinished run as a whole stretch.
    const rising = [];
    let q = 100;
    for (let i = 0; i < 40; i++) { q *= 1.03; rising.push(q); }
    const tail = typeStretches(rising, 10);
    assert.strictEqual(tail.stretches.length, 1, 'a path that only rises is one stretch');
    assert.strictEqual(tail.stretches[0].open, true, 'and it is open — no turn ended it');
    const oneCut = cutAtBoundaries(tail.stretches, [{ name: 'all', from: 0, to: 39 }]);
    assert.strictEqual(oneCut[0].pieces[0].stub, true, 'so its piece is a left-over end, not a whole stretch');
  },

  // C3.4 by BEHAVIOUR, not by reading the source. The scan could be defeated
  // two ways: an options key the ban list did not name, and a comment inside the
  // function truncating the slice being scanned.
  theWeightVectorIsTheSameWhateverItIsAskedFor() {
    let st = 31337;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const moves = [];
    for (let i = 0; i < 120; i++) moves.push((rnd() - 0.45) * 8);
    const plain = trainingWeights(moves, { cap: 20 }).weights;
    for (const extra of [
      { set: 'up' }, { set: 'down' }, { set: 'rising' }, { set: 'falling' },
      { side: 'up' }, { direction: -1 }, { type: 'falling' }, { which: 2 },
    ]) {
      const got = trainingWeights(moves, { cap: 20, ...extra }).weights;
      assert.deepStrictEqual(got, plain,
        `the weights moved when the caller passed ${JSON.stringify(extra)} — one vector is shared by both sets (COINS.md section 6)`);
    }
    // and the sign of a move never reaches it: mirror every move and nothing changes
    assert.deepStrictEqual(trainingWeights(moves.map((m) => -m), { cap: 20 }).weights, plain,
      'the weights read the SIZE of a move; flipping every sign moved them');
    // the ceiling is the only thing that may change them
    assert.notDeepStrictEqual(trainingWeights(moves, { cap: 2 }).weights, plain, 'the ceiling does nothing');
    // and how many were held at it is reported, never a constant
    assert.ok(trainingWeights(moves, { cap: 2 }).capped > trainingWeights(moves, { cap: 20 }).capped,
      'a lower ceiling must hold more periods at it, and the count must say so');
  },

  // C3.1 at its boundary, walked rather than sampled at two points. Loosening
  // the reachability guard by a whole one and a half was green.
  theCeilingThatCannotReachAMeanOfOneIsFoundExactly() {
    for (const n of [5, 8, 12, 40]) {
      for (let moved = 1; moved <= n; moved++) {
        const moves = new Array(n).fill(0);
        for (let i = 0; i < moved; i++) moves[i] = 5;
        const needed = n / moved;
        // just under the ceiling that works: unreachable, and it says so
        if (needed > 1.0001) {
          const under = trainingWeights(moves, { cap: needed * 0.999 });
          assert.strictEqual(under.reachedMean, false,
            `${moved} of ${n} moved: a ceiling of ${(needed * 0.999).toFixed(4)} cannot reach a mean of 1 and must say so`);
          assert.ok(Math.abs(under.needCap - needed) < 1e-9, 'and must name the ceiling that would');
          assert.ok(under.mean < 1, `and the mean it did reach (${under.mean}) must be under 1`);
        }
        // and just over it: reachable, and the mean really is 1
        const over = trainingWeights(moves, { cap: Math.max(1.0001, needed * 1.001) });
        if (needed <= Math.max(1.0001, needed * 1.001)) {
          assert.notStrictEqual(over.reachedMean, false,
            `${moved} of ${n} moved: a ceiling just above ${needed.toFixed(4)} does reach a mean of 1`);
          assert.ok(Math.abs(over.mean - 1) < 1e-9, `and the mean must actually be 1, got ${over.mean}`);
        }
      }
    }
    // AND THE SEARCH FOR THE SCALE CAN RUN OUT OF ROOM, which is a different
    // failure and used to be reported as success with a mean of 0.11.
    const dust = trainingWeights(new Array(10).fill(1e-13), { cap: 20 });
    assert.strictEqual(dust.reachedMean, false, 'a mean of 0.11 is not a mean of 1 and must not be reported as one');
    assert.ok(dust.mean < 0.5 && dust.why && /no scale/.test(dust.why), `and it must say why: ${dust.why}`);
  },

  // The drift's own arithmetic: equal parts, the caller's part count, and a
  // divisor that keeps the number comparable between coins.
  theDriftIsAnAverageOverEqualPartsAndTheCallerSaysHowMany() {
    let st = 5150;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const moves = [];
    for (let i = 0; i < 159; i++) moves.push(rnd() < 0.5 ? 1 : -1);
    for (const k of [2, 3, 5, 8, 13]) {
      const d = balanceDrift(moves, k);
      assert.strictEqual(d.parts.length, k, `asked for ${k} parts and got ${d.parts.length}`);
      const widths = d.parts.map((p) => p.to - p.from + 1);
      assert.strictEqual(widths.reduce((a, b) => a + b, 0), moves.length, `the ${k} parts must cover the span exactly`);
      assert.ok(Math.max(...widths) - Math.min(...widths) <= 1,
        `equal parts means equal: at ${k} the widths were ${widths.join(',')}`);
      for (let i = 1; i < d.parts.length; i++) {
        assert.strictEqual(d.parts[i].from, d.parts[i - 1].to + 1, 'the parts must meet with no gap and no overlap');
      }
    }
    // THE DIVISOR IS THERE. Dropping it leaves a sum, which grows with the part
    // count and stops the number being comparable between coins.
    const swing = [];
    for (let p = 0; p < 8; p++) for (let i = 0; i < 30; i++) swing.push(p % 2 ? 1 : (i % 2 ? 1 : -1));
    const got = balanceDrift(swing, 8);
    let sum = 0;
    const bs = got.parts.map((p) => p.balance);
    for (let i = 1; i < bs.length; i++) sum += Math.abs(bs[i] - bs[i - 1]);
    assert.ok(Math.abs(got.drift - sum / (bs.length - 1)) < 1e-12,
      'the drift is the AVERAGE of the step-to-step moves, not their sum');
    assert.ok(got.drift <= 0.5 + 1e-12, 'and an average of moves in [0, 0.5] cannot exceed 0.5');

    // TOO FEW PERIODS IS null AND A SENTENCE, never a zero. `null < 1e-9` is
    // true in JavaScript, so a test that reads "drift is about zero" passes on
    // a null and cannot tell the two apart.
    const thin = balanceDrift([1, -1, 1], 8);
    assert.strictEqual(thin.drift, null, 'three periods cannot be cut into eight parts');
    assert.ok(thin.why && thin.why.length > 5, 'and it says so in a sentence');
    assert.deepStrictEqual(thin.parts, [], 'with no parts invented to fill the gap');
  },

  // C4.3 through the READING, which is where the leak would be. The old test
  // called two pure functions twice with the same arguments; nothing between
  // them could have changed the answer.
  theTraditionalNumbersOfAReadingNeverMoveWithTheTunedPercentage() {
    let st = 24601;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const prices = [100];
    for (let i = 1; i < 260; i++) prices.push(prices[i - 1] * (1 + (rnd() - 0.47) * 5 / 100));
    const moves = prices.map((p, i) => (i ? ((p - prices[i - 1]) / prices[i - 1]) * 100 : 0.1));
    const base = traditionalReading(moves, { driftParts: 8 });

    // ask for wildly different numbers of changes: the percentage found moves,
    // the traditional numbers may not
    const found = new Set();
    for (const target of [2, 4, 8, 14]) {
      const r = coinReading(prices, moves, { layout: 'reserve61', target, from: 1, to: 25, step: 0.5, cap: 20 });
      if (r.search.reached) found.add(r.search.pct);
      assert.strictEqual(r.traditional, undefined, 'the traditional score is not inside a per-layout reading');
    }
    assert.ok(found.size > 1, `the percentage must actually move across these targets, got ${[...found]}`);
    assert.deepStrictEqual(traditionalReading(moves, { driftParts: 8 }), base,
      'the traditional numbers moved after the percentage was re-tuned');

    // and it is the SAME reading under either window layout, because it has no
    // layout in it at all
    assert.strictEqual(traditionalReading.length, 1,
      'the traditional reading takes the moves, with everything else optional — a second required argument here is most likely a layout');
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'coins.js'), 'utf8');
    const at = src.indexOf('function traditionalReading');
    const body = src.slice(at, src.indexOf('\n}', at));
    assert.ok(!/reserve61|split70|layout\b|pct|search/.test(body),
      'the traditional reading names a window layout or reads the tuned percentage');
  },

  // TOO LITTLE HISTORY FOR THE NUMBER TO SAY ANYTHING, WORKED OUT AND NOT SET
  // (3.121.0, owner order 2026-09-12: "plan the code based on the length of the
  // history ... if there's not enough history and things get sketchy, just put
  // that on the screen", and on where the line sits: "that's the code that
  // needs to put something on the screen. Not you.").
  theScreenIsToldWhenAHistoryIsTooShortForTheNumberToMeanAnything() {
    let st = 4321;
    const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const fair = (n) => Array.from({ length: n }, () => (rnd() < 0.5 ? 1 : -1));
    // a coin with a REAL one-way run buried in it, at several lengths
    const trended = (n) => {
      const mv = fair(n);
      const at = Math.floor(n * 0.62);
      for (let i = at; i < at + Math.round(n * 0.14); i++) mv[i] = 1;
      return mv;
    };
    const tell = (mv) => canTheReadingTell(mv, { driftParts: 8, shuffles: 200 });

    // THE CASE THE RULE WAS WRITTEN TO CATCH. Forty periods cannot say anything
    // about a coin, however one-way it really is.
    const short = tell(trended(40));
    assert.strictEqual(short.worstTailSlice.canTell, false,
      'forty periods must not be trusted to tell a one-way coin from any other');
    assert.ok(short.worstTailSlice.why && /too few/.test(short.worstTailSlice.why),
      `and it must say why in a sentence: ${short.worstTailSlice.why}`);
    assert.ok(short.worstTailSlice.why.includes('40 periods'), 'the sentence must name how much history there is');

    // AND THE CASE IT MUST NOT CATCH. Two thousand periods with the same real
    // run in them is a reading worth having, and must not be marked.
    const long = tell(trended(2040));
    assert.strictEqual(long.worstTailSlice.canTell, true,
      'two thousand periods with a real one-way run in them must be trusted');
    assert.strictEqual(long.worstTailSlice.why, null, 'and must carry no warning sentence');
    assert.ok(long.worstTailSlice.value < long.worstTailSlice.low,
      'it is trusted because the coin scores outside everything a no-trend version of itself scored');

    // A COIN WITH NO TREND AT ALL is never tellable at any length, which is
    // right: there is nothing in it to tell.
    for (const n of [40, 300, 2040]) {
      assert.strictEqual(tell(fair(n)).worstTailSlice.canTell, false,
        `a coin with no trend at ${n} periods must never read as telling anything`);
    }

    // NOTHING IS TYPED. No line, no cut-off, no length written down anywhere in
    // the function -- it is worked out from the coin's own periods every time.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'coins.js'), 'utf8');
    const at = src.indexOf('function canTheReadingTell(');
    const body = src.slice(at, src.indexOf('\nfunction ', at)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(body.length > 400, 'the function has changed shape — re-aim this before trusting it');
    const numbers = (body.match(/\b\d+(\.\d+)?\b/g) || []).filter((x) => !['0', '1', '2', '3', '20260912'].includes(x));
    assert.deepStrictEqual(numbers, ['200'],
      `the only number allowed here is the default count of shuffles, which is a control; found ${numbers.join(', ')}`);

    // IT IS THE SAME ANSWER EVERY TIME. Nothing in this system reports a number
    // that changes between two reads of the same data (RULE SEVEN).
    // THE SAME COIN, not two coins built from the same recipe. The first
    // version of this line called the builder twice; the builder draws from a
    // running number, so it made two different coins and the test failed on its
    // own fixture rather than on the code.
    const same = trended(300);
    const once = tell(same);
    const twice = tell(same);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(once)), JSON.parse(JSON.stringify(twice)),
      'two reads of the same coin gave two different answers');
    assert.deepStrictEqual(shuffledCopy([1, 2, 3, 4, 5], 7), shuffledCopy([1, 2, 3, 4, 5], 7),
      'the shuffle is not deterministic');
    assert.notDeepStrictEqual(shuffledCopy([1, 2, 3, 4, 5], 7), shuffledCopy([1, 2, 3, 4, 5], 8),
      'every shuffle is the same shuffle, so the readings are all one reading');
    assert.deepStrictEqual(shuffledCopy([1, 2, 3, 4, 5], 7).slice().sort(), [1, 2, 3, 4, 5],
      'the shuffle lost or invented a period');

    // AND IT RIDES ON THE READING, so the screen has it without asking again
    const prices = [];
    for (let i = 0; i < 220; i++) prices.push(100 * (1.01 ** (i % 40)));
    const mv = prices.map((p, i) => (i ? ((p - prices[i - 1]) / prices[i - 1]) * 100 : 0.1));
    const trad = traditionalReading(mv, { driftParts: 8, shuffles: 40 });
    assert.ok(trad.canTell && trad.canTell.worstTailSlice && trad.canTell.drift,
      'the reading the screen draws does not carry whether its numbers can tell anything');
    assert.strictEqual(trad.canTell.shuffles, 40, 'and it is worked out at the count the caller set');
  },

  // AND THE SCREEN DRAWS THE MARK. The reading can be perfect and say nothing
  // if the page never renders it -- which is how the thin-side figure came to
  // be quietly wrong for a whole release.
  theCoinsScreenMarksANumberItCannotTrust() {
    const fs = require('fs');
    const path = require('path');
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const at = page.indexOf('function cCannot(');
    assert.ok(at > 0, 'the Coins screen has no mark for a number it cannot trust');
    const fn = page.slice(at, page.indexOf('\n}', at) + 2);
    // RUN IT, DO NOT GREP IT. Grepped, this passed on a version of the mark
    // with `return '';` pasted in above every line it scanned for -- the words
    // were all still in the file and the mark drew nothing. So the function is
    // lifted out and called, with the page's own escaper stubbed, and what
    // comes back is read (RULE EIGHT: a guard names the test that READS the
    // line it breaks, and a scan cannot read a line that is never reached).
    // eslint-disable-next-line no-unused-vars
    const esc = (x) => String(x).replace(/"/g, '&quot;');
    // eslint-disable-next-line no-eval
    const cCannot = eval(`(${fn.trim()})`);
    const trad = (worst, drift) => ({ canTell: { worstTailSlice: worst, drift } });
    const cannot = { canTell: false, why: 'the reason the owner reads' };
    const can = { canTell: true, why: null };
    const out = cCannot(trad(cannot, can), 'worstTailSlice');
    assert.ok(/cannot tell/.test(out), `the mark says nothing the owner can read: ${JSON.stringify(out)}`);
    assert.ok(out.includes('the reason the owner reads'),
      'the mark carries no reason, so it cannot be looked into');
    assert.strictEqual(cCannot(trad(cannot, can), 'drift'), '',
      'a number that CAN tell something is marked anyway, so the mark means nothing');
    assert.strictEqual(cCannot(trad(can, can), 'worstTailSlice'), '', 'every number is marked');
    assert.strictEqual(cCannot(null, 'drift'), '', 'a coin with no reading at all is marked');
    assert.strictEqual(cCannot({}, 'drift'), '', 'a reading with no answer on it is marked');
    // and it is drawn beside BOTH numbers, not just one
    const draw = page.slice(page.indexOf('async function drawCoins()'));
    assert.ok(/cCannot\(r\.traditional, 'worstTailSlice'\)/.test(draw), 'the worst tail slice is never marked');
    assert.ok(/cCannot\(r\.traditional, 'drift'\)/.test(draw), 'the drift is never marked');
    // the shuffle count is a control like every other input here (RULE FIVE)
    assert.ok(/id="cShuf"/.test(draw), 'the number of shuffles is not something the owner can set');
    assert.ok(/shuffles: box\('shuffles'/.test(draw), 'and what is set is not sent with the run');
  },

  // A SPLIT THAT LEAVES A PART EMPTY IS SAID, NOT SERVED. It is not a refusal of
  // the coin: the traditional score and the other layout are still read.
  aSpanTooShortToDivideSaysSoRatherThanServingNonsense() {
    for (const n of [3, 4, 5, 6]) {
      let threw = null;
      try { checkedParts(n, 'reserve61'); } catch (err) { threw = err.message; }
      assert.ok(threw && /do not divide/.test(threw), `${n} periods must not silently produce a broken split, got ${threw}`);
    }
    for (let n = 7; n <= 400; n++) {
      for (const layout of ['reserve61', 'split70']) {
        const parts = checkedParts(n, layout);
        assert.strictEqual(parts[0].from, 0, `${layout} at ${n}: the first part must start at 0`);
        assert.strictEqual(parts[parts.length - 1].to, n - 1, `${layout} at ${n}: the last part must end at the last period`);
        for (const p of parts) assert.ok(p.to >= p.from, `${layout} at ${n}: '${p.name}' is empty`);
      }
    }
  },
};
