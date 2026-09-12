// COINS: typing a coin's history into rising and falling stretches, and the
// per-coin search for the fall-back percentage (COINS.md sections 3 and 4;
// owner LOOP NOW! 2026-09-12).
//
// The success rules these check were pre-registered in
// LOOP-2026-09-12-COINS.md section A BEFORE any of this ran, which is the only
// reason a green result here means anything.
const { assert } = require('./helpers');
const { typeStretches, searchFallback } = require('../lib/coins');

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
};
