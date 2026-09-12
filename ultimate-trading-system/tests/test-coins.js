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
  splitOfTime, worstTailSlice, balanceDrift, trainingWeights,
  partsFor, coinReading,
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
  nothingInHereRefusesACoin() {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'coins.js'), 'utf8');
    for (const word of ['eligible', 'ineligible', 'rejected', 'excluded']) {
      assert.ok(!new RegExp(`\\b${word}\\b`).test(src),
        `lib/coins.js must not decide whether a coin is ${word} — this tab reports (COINS.md section 8)`);
    }
    const { prices } = builtPath(3);
    for (const fn of [() => typeStretches(prices, 5), () => searchFallback(prices, { target: 999 })]) {
      const out = fn();
      assert.ok(!('pass' in out) && !('ok' in out) && !('eligible' in out),
        'no function here answers with a pass, an ok or an eligibility');
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

    const unweightedFast = 7;
    const unweightedSlow = 35;
    assert.ok(Math.abs(unweightedSlow / unweightedFast - 5) < 1e-12,
      'unweighted, the slow five weeks outpull the fast week five to one');

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
    const worst = worstTailSlice(moves);
    assert.ok(worst.balance <= 0.02,
      `the worst slice must see the one-way tail, got ${worst.balance}`);
    assert.ok(worst.from >= 160, 'and it must point AT the tail, not somewhere else');

    // C4.2: balanced everywhere and both read near a half
    const even = [];
    for (let i = 0; i < 200; i++) even.push(i % 2 ? 1 : -1);
    assert.ok(Math.abs(splitOfTime(even).balance - 0.5) < 1e-9);
    assert.ok(worstTailSlice(even).balance >= 0.45, 'nothing one-way anywhere, so no slice is one-way');
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
        // and the reading of held DID move, or nothing was being reported
        const heldBefore = plain.perPart.find((p) => p.part === 'held').split.balance;
        const heldAfter = got.perPart.find((p) => p.part === 'held').split.balance;
        if (name !== 'a saw') {
          assert.ok(heldAfter < 0.02,
            `${layout}: with ${name} after the end of test, held must read as one-way (got ${heldAfter}) — or nothing is being reported`);
          assert.notStrictEqual(heldAfter, heldBefore, `${layout}: ${name} must move the reading of held`);
        }
      }
    }
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
    for (const p of r.perPart) {
      assert.ok(typeof p.turns === 'number', `${p.part} must report its turns`);
      assert.ok(p.stretches.rising && p.stretches.falling, `${p.part} must report both types`);
      assert.ok(p.split && typeof p.split.balance === 'number', `${p.part} must report its split of time`);
      assert.ok(typeof p.repeats.rising === 'boolean', `${p.part} must say whether a type repeats`);
      assert.ok(p.stubs <= 2, 'at most two stubs per part');
    }
    assert.ok(r.traditional.worstTailSlice && r.traditional.drift, 'both traditional numbers are on the record');
    assert.ok(r.weight && r.weight.over === 'train', 'the weight summary is over train, which is what gets trained on');
    // the vector itself is NOT stored -- it is deterministic from the moves and
    // the ceiling, and a stored copy is a second version waiting to go stale
    assert.strictEqual(r.weight.weights, undefined, 'the weight vector is recomputed, never stored beside the moves');

    const flat = JSON.stringify(r);
    for (const word of ['"pass"', '"fail"', '"eligible"', '"verdict"']) {
      assert.ok(!flat.includes(word), `the record must not carry ${word} — this tab reports (COINS.md section 8)`);
    }
  },

  // A coin the search cannot satisfy still gets a record, with the traditional
  // numbers on it and a sentence saying what happened. It is never dropped.
  aCoinTheSearchCannotSatisfyStillGetsARecord() {
    const prices = [];
    for (let i = 0; i < 300; i++) prices.push(100 + Math.sin(i / 40) * 0.4);
    const moves = prices.map((p, i) => (i ? ((p - prices[i - 1]) / prices[i - 1]) * 100 : 0.01));
    const r = coinReading(prices, moves, { layout: 'split70', target: 50, from: 5, to: 30, step: 1, cap: 20 });
    assert.strictEqual(r.search.reached, false, 'fifty changes are not in this path');
    assert.ok(r.why && /no percentage between/.test(r.why), 'and the record says why in a sentence');
    assert.ok(r.traditional.whole && r.traditional.worstTailSlice, 'the traditional numbers are still there');
    assert.strictEqual(r.perPart, null, 'there is no typing to report per part, and it says so with null rather than zeros');
    assert.ok(r.parts.length === 3, 'and the parts are still described');
  },
};
