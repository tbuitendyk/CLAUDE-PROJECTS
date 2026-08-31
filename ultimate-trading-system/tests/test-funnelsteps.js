// The Funnel's readings (lib/funnel.js). These are the tests that say the
// instrument works, so each one pins a way it could look right and be wrong.
//
// Watched failing while writing them: reading avgHold instead of avgTest passes
// every arithmetic test in here and silently spends the held-back window;
// splitting the rows by position instead of by name makes theHalvesDoNotDepend
// OnRowOrder disagree with itself; dropping the one-slice guard makes a
// single-coin probe report "1 of 1 positive", which reads as a pass.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const F = require('../lib/funnel');

// A full-factorial board where tHours genuinely moves the money, gate moves it
// a little, and dMult does nothing at all -- so a reading that cannot tell
// those three apart fails here.
function board() {
  const rows = [];
  for (const t of [41, 65, 89, 113, 137]) {
    for (const d of [0.25, 0.5, 1, 1.5]) {
      for (const g of ['active', 'always', 'directional']) {
        rows.push({
          label: `t${t} d${d} ${g}`,
          tHours: t, dMult: d, gate: g, entry: 'breakout',
          decision: 'argmax', weekdaysOnly: false, bandMode: 'auto',
          agreeRule: 'count', agreeBar: 'all', agreePct: 60, agreeCopy: 98,
          agreeBoth: false, agreePersist: 0, trailMult: null, armMult: null,
          avgTest: ((t - 89) / 40) * 10 + (g === 'always' ? -3 : 0) + (((t * 7) + (d * 13)) % 3) * 0.4,
          // the held-back money is on the row and must never be read by a step
          avgHold: 999,
        });
      }
    }
  }
  return rows;
}

module.exports = {
  // THE ONE RULE THE WHOLE DESIGN RESTS ON. Six steps of narrowing on test
  // money spend nothing; the same six on held-back money spend the only window
  // that can judge the answer. A reading that used avgHold would pass every
  // other test in this file.
  theFunnelNeverReadsHeldBackMoney() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'funnel.js'), 'utf8');
    // COMMENTS STRIPPED FIRST. The file quotes bracketwork's "judge on holdout"
    // rule in prose, and a guard that cannot tell a quotation from a field read
    // fires on the very comment explaining why the rule exists -- which teaches
    // whoever hits it to loosen the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    assert.ok(!/avgHold|holdout|heldBack/.test(code),
      'no step may READ the held-back window; it is opened once, at the end');
    assert.ok(/const TEST_MONEY = 'avgTest'/.test(src),
      'and the field it does read is named in exactly one place');
    // and prove it by behaviour, not only by grep: change only the held-back
    // money and nothing the funnel says may move
    const a = F.step1(board());
    const b = F.step1(board().map((r) => ({ ...r, avgHold: -50000 })));
    assert.deepStrictEqual(a.dials.map((d) => d.dial), b.dials.map((d) => d.dial));
  },

  // The reading has to separate a dial that moves the money from one that does
  // not. If it cannot do that, nothing downstream is worth building.
  movementSeparatesADialThatMattersFromOneThatDoesNot() {
    const s1 = F.step1(board());
    const order = s1.dials.map((d) => d.dial);
    assert.strictEqual(order[0], 'tHours', `tHours must lead: ${order.slice(0, 3).join(', ')}`);
    const m = Object.fromEntries(s1.dials.map((d) => [d.dial, d.m]));
    assert.ok(m.tHours > 5, `a dial built to move the money must show it: ${m.tHours}`);
    assert.ok(m.dMult < 0.5, `a dial built to do nothing must show that too: ${m.dMult}`);
    assert.ok(m.tHours > m.gate && m.gate > m.dMult, 'and the ordering is the finding');
  },

  // "Flat" is a finding. "There was nothing to compare" is not. Printing them
  // the same tells the owner a dial was tested when it never was.
  aDialSweptAtOneValueIsNotReportedAsFlat() {
    const s1 = F.step1(board());
    const skipped = s1.skipped.map((x) => x.dial);
    assert.ok(skipped.includes('entry'), 'entry has one value on this board and must be skipped');
    assert.ok(!s1.dials.some((d) => d.dial === 'entry'), 'and must not appear among the measured');
    const why = s1.skipped.find((x) => x.dial === 'entry').why;
    assert.ok(/one value/.test(why), `and must say why: ${why}`);
    assert.strictEqual(F.movement(board(), 'entry').m, null);
  },

  // Two reads of one set must split it the same way, or the two could disagree
  // about whether a dial is stable purely because the rows arrived in a
  // different order.
  theHalvesDoNotDependOnRowOrder() {
    const rows = board();
    const [a1] = F.splitHalf(rows, 'seed-1');
    const [a2] = F.splitHalf([...rows].reverse(), 'seed-1');
    assert.deepStrictEqual(
      a1.map((r) => r.label).sort(),
      a2.map((r) => r.label).sort(),
      'the half a setting lands in must be a function of its name, not its position',
    );
    const [a3] = F.splitHalf(rows, 'seed-2');
    assert.notDeepStrictEqual(
      a1.map((r) => r.label).sort(),
      a3.map((r) => r.label).sort(),
      'and a different seed must give a different split, or the seed does nothing',
    );
    assert.ok(a1.length > rows.length * 0.3 && a1.length < rows.length * 0.7,
      `the halves must be halves: ${a1.length} of ${rows.length}`);
  },

  // Every step answers with no null set anywhere in sight -- the owner's second
  // ruling. Split-half needs no deals, no noise board, and no extra capture.
  everyStepAnswersWithNoNullSetAtAll() {
    const rows = board().map((r) => {
      const { avgHold, ...rest } = r;
      return rest;   // no beat, no pairs, no lead, no deals: nothing null at all
    });
    const s1 = F.step1(rows);
    assert.ok(s1.dials.length > 0, 'step 1 must still answer');
    assert.ok(s1.splitHalf.agrees === true || s1.splitHalf.agrees === false,
      'and must still reach a split-half verdict');
    assert.strictEqual(s1.noiseTwin, null, 'with the noise twin explicitly absent, not omitted');
    const s2 = F.step2(rows, 'tHours');
    assert.ok(s2.shape, 'step 2 must still answer');
    assert.ok(s2.splitHalf, 'and still split');
    assert.strictEqual(s2.noiseTwin, null);
    const s3 = F.step3(rows, 'tHours', 'gate', { floor: 2 });
    assert.ok(s3.grid.length > 0, 'step 3 must still answer');
  },

  // A spike is the shape luck makes. Calling it a hill is how a fluke gets
  // carried forward, so the two must never collapse into each other.
  aSpikeIsNotAHill() {
    const flat = [1, 1, 1, 1, 1].map((v, i) => ({ value: String(i), n: 10, mean: v }));
    assert.strictEqual(F.shapeClass(flat, 0.5), 'flat');

    const ramp = [1, 2, 3, 4, 5].map((v, i) => ({ value: String(i), n: 10, mean: v }));
    assert.strictEqual(F.shapeClass(ramp, 0.5), 'monotone');

    const hill = [1, 3, 5, 3, 1].map((v, i) => ({ value: String(i), n: 10, mean: v }));
    assert.strictEqual(F.shapeClass(hill, 0.5), 'hill');

    // one value far clear of an otherwise flat menu
    const spike = [1, 1, 9, 1, 1].map((v, i) => ({ value: String(i), n: 10, mean: v }));
    assert.strictEqual(F.shapeClass(spike, 0.5), 'spike');

    // and the same thing sitting at the end of the menu is still a spike --
    // luck does not care where on the axis it landed
    const edge = [9, 1, 1, 1, 1].map((v, i) => ({ value: String(i), n: 10, mean: v }));
    assert.strictEqual(F.shapeClass(edge, 0.5), 'spike');

    // scatter as wide as the spread means there is no shape to read
    assert.strictEqual(F.shapeClass(spike, 50), 'flat');
  },

  // THE MARGINAL IS ONLY HONEST ON A BALANCED GRID. Group by one dial and the
  // others average out -- but only if each value was swept against the same
  // spread of everything else. A confounded marginal looks exactly like a real
  // one, so the reading has to say so itself.
  theMarginalSaysWhenTheGridIsLopsided() {
    const even = F.movement(board(), 'tHours');
    assert.strictEqual(even.balance.balanced, true, 'a full grid is balanced');
    assert.strictEqual(even.balance.even, 1);
    assert.deepStrictEqual(F.step1(board()).lopsided, [], 'and nothing is flagged');

    const lop = board().filter((r) => r.tHours !== 137 || r.gate === 'active');
    const m = F.movement(lop, 'tHours');
    assert.strictEqual(m.balance.balanced, false, 'an under-swept value is not balanced');
    assert.ok(m.balance.smallest < m.balance.largest);
    assert.ok(F.step1(lop).lopsided.includes('tHours'), 'and step 1 names it');
  },

  // A square built from two settings is not a hole and it is not a reading.
  // Dropping it would read as "nothing here"; keeping it unmarked would let the
  // best-looking square on the grid be the emptiest one.
  theThinSquareFloorMarksRatherThanDrops() {
    const out = F.step3(board(), 'tHours', 'gate', { floor: 10 });
    assert.strictEqual(out.squares, 15, '5 values by 3 values is 15 squares');
    assert.strictEqual(out.grid.length, 15, 'every square is present, thin or not');
    assert.strictEqual(out.thin, 15, 'each holds 4 settings, so all 15 are thin at a floor of 10');
    for (const c of out.grid) {
      assert.strictEqual(c.n, 4, 'and each keeps its own count');
      assert.ok(c.mean != null, 'and its money, so a thin square can still be looked at');
    }
    assert.strictEqual(F.step3(board(), 'tHours', 'gate', { floor: 4 }).thin, 0);
  },

  // Picking a threshold blind is what this tab exists to end, and that applies
  // to the tab's own thresholds first.
  theFloorPageShowsWhatEachChoiceCosts() {
    const out = F.step3(board(), 'tHours', 'gate', { floor: 0 });
    const cost = F.floorCost(out, [1, 4, 5, 20]);
    assert.deepStrictEqual(cost, [
      { floor: 1, keeps: 15, of: 15 },
      { floor: 4, keeps: 15, of: 15 },
      { floor: 5, keeps: 0, of: 15 },
      { floor: 20, keeps: 0, of: 15 },
    ]);
    assert.ok(F.floorCost(out).length > 0, 'and it offers a default ladder when none is asked for');
  },

  // THE SINGLE-COIN PROBE. With one coin there is nothing to compare across, so
  // the step falls through -- and it must say which weaker check it made and
  // what it passed over. Silently skipping is the failure.
  theHoldsAcrossStepNamesTheAxisItUsed() {
    const many = F.holdsAxisFor({ coins: 8, shapes: 3, thirds: true, freeDials: 4 });
    assert.strictEqual(many.axis, 'coins');
    assert.strictEqual(many.weaker, false);
    assert.deepStrictEqual(many.passedOver, []);

    const oneCoin = F.holdsAxisFor({ coins: 1, shapes: 3, thirds: true, freeDials: 4 });
    assert.strictEqual(oneCoin.axis, 'shapes');
    assert.strictEqual(oneCoin.weaker, true, 'a fallback must announce that it is weaker');
    assert.ok(/1 coin/.test(oneCoin.passedOver[0].why), `and say why it passed coins over: ${oneCoin.passedOver[0].why}`);

    const probe = F.holdsAxisFor({ coins: 1, shapes: 1, thirds: true, freeDials: 4 });
    assert.strictEqual(probe.axis, 'thirds', 'one coin and one shape falls to the thirds of the window');
    assert.strictEqual(probe.passedOver.length, 2);

    const bare = F.holdsAxisFor({ coins: 1, shapes: 1, thirds: false, freeDials: 4 });
    assert.strictEqual(bare.axis, 'dials');

    const nothing = F.holdsAxisFor({ coins: 1, shapes: 1, thirds: false, freeDials: 0 });
    assert.strictEqual(nothing.axis, null, 'and when there is no check left it says so rather than inventing one');
    assert.strictEqual(nothing.passedOver.length, 4);
  },

  // "1 of 1 positive" reads as a pass and is not a reading at all.
  theHoldsAcrossStepRefusesAOneSliceAnswer() {
    const one = F.holdsAcross([{ key: 'BTCUSDT', n: 40, mean: 5 }], 'coins');
    assert.strictEqual(one.positive, null, 'no count may be reported from one slice');
    assert.ok(/one slice is not a comparison/.test(one.why), one.why);

    const none = F.holdsAcross([], 'coins');
    assert.strictEqual(none.positive, null);
    assert.ok(none.why);

    const real = F.holdsAcross([
      { key: 'A', n: 40, mean: 5 }, { key: 'B', n: 40, mean: -2 }, { key: 'C', n: 40, mean: 1 },
    ], 'coins');
    assert.strictEqual(real.positive, 2);
    assert.strictEqual(real.of, 3);
    assert.strictEqual(real.worst.key, 'B', 'and the worst slice is named, not averaged away');

    // a slice under the floor is thin, and thin slices cannot make a comparison
    const thin = F.holdsAcross([
      { key: 'A', n: 40, mean: 5 }, { key: 'B', n: 2, mean: 900 },
    ], 'coins', { floor: 10 });
    assert.strictEqual(thin.thin, 1);
    assert.strictEqual(thin.positive, null, 'one usable slice is still one slice');
  },
};
