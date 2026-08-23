// A FEE IS A PERCENTAGE OF WHAT IS TRADED (owner order, 2026-08-23).
//
// "all trading fees are going to be percentage based ... we're gonna get all
// that fixed dollar amount business out of the fees."
//
// The system used to charge $0.125 A LEG — a number of dollars, which is only
// the right cost at one single trade size. It read as 0.125% purely because the
// paper clip is $100. And the SAME name meant two different things in two halves
// of the engine: lib/stoptuner.js has always taken a fraction, so every caller
// that spanned both carried a hand conversion, and getting one wrong had already
// cost a reading — the dollar figure passed straight into the tuner made a 25%
// round-trip hurdle instead of 0.25% and mislabelled almost every trade.
//
// This file pins the whole guarantee: one meaning, the same money at the paper
// size, dollars refused everywhere they could enter, and every run recorded
// before the change still priced at the cost it was actually found under.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { FEE_PER_LEG, FEE_ROUND_TRIP, MAX_FEE_PER_LEG, NOTIONAL,
  feeRate, feeFracOf, pnlAt } = require('../lib/paper');
const bracketLib = require('../lib/bracket');
const batch = require('../lib/batch');

const ROOT = path.join(__dirname, '..');
const DOLLAR_FEE = 0.125;          // what it used to be, per leg, in dollars

module.exports = {
  // The rate, stated once.
  async theFeeIsARateNotAnAmount() {
    assert.strictEqual(FEE_PER_LEG, 0.00125, 'the lab fee is 0.125% of the position, per leg');
    assert.strictEqual(FEE_ROUND_TRIP, 0.0025, 'both legs');
    assert.strictEqual(100 * FEE_PER_LEG, 0.125, 'and it is exactly the 0.125% the old dollar figure meant at $100');
  },

  // THE MIGRATION IS A RE-EXPRESSION, NOT A CHANGE. $0.125 on a $100 clip is
  // 0.00125 of the position, so every number this engine ever produced at the
  // paper size must come back BIT-identical — not close, identical. A row
  // re-scored today has to match the one already stored, or the system stops
  // being re-derivable from its own inputs.
  //
  // This test used to try ten hand-picked prices and pass. That was not enough
  // to know: the first version of the change wrote the arithmetic the tidier way
  // round (NOTIONAL * (gross - cost)), those ten agreed, and a sweep of 800,000
  // random pairs then disagreed in 11.5% of them — always in the last bit of a
  // double. So the sweep is the test now, and the ten are gone.
  async theMoneyIsUnchangedAtThePaperClip() {
    const oldWay = (dir, entry, exit) => {
      const gross = dir === 1 ? NOTIONAL * (exit / entry - 1) : NOTIONAL * (1 - exit / entry);
      return gross - 2 * DOLLAR_FEE;                     // the dollar arithmetic, verbatim
    };
    // Fixed seed: this must be the same 100,000 comparisons on every machine and
    // every run, or a failure is not something anybody can go and look at.
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let compared = 0;
    for (let i = 0; i < 50000; i++) {
      const a = Math.exp((rnd() - 0.5) * 24);            // 1e-5 to 1e5, real coin prices span it
      const b = a * (0.5 + rnd());
      for (const dir of [1, -1]) {
        const was = oldWay(dir, a, b);
        const now = pnlAt(dir, a, b, FEE_PER_LEG);
        assert.strictEqual(now, was,
          `${dir === 1 ? 'long' : 'short'} ${a} -> ${b} came back ${now} where the dollar arithmetic gave ${was}`);
        compared += 1;
      }
    }
    assert.strictEqual(compared, 100000, 'the sweep did not run');

    // The bracket and market simulators take the round trip off in dollars too,
    // worked out from the rate. At the paper clip that must land on the same 25
    // cents, exactly, or every stored board moves in its last digit.
    assert.strictEqual(NOTIONAL * 2 * FEE_PER_LEG, 2 * DOLLAR_FEE,
      'the round trip on the paper clip is no longer the 25 cents every stored board was scored with');
  },

  // What comes off a trade is the round-trip RATE applied to what is traded —
  // stated as a share, so it follows the trade size instead of being fixed to
  // one. That is the whole of the owner's order in one assertion.
  async theCostTakenOffIsAShareOfThePosition() {
    const flat = pnlAt(1, 100, 100, FEE_PER_LEG);
    assert.ok(Math.abs(flat - -(NOTIONAL * FEE_ROUND_TRIP)) < 1e-12,
      `a trade that went nowhere should cost the round-trip rate on what it traded, got ${flat}`);
    const free = pnlAt(1, 100, 100, 0);
    assert.strictEqual(free, 0, 'and at no fee it costs nothing');
    // Double the rate, double the cost — a rate, not a constant.
    assert.ok(Math.abs(pnlAt(1, 100, 100, 2 * FEE_PER_LEG) - 2 * flat) < 1e-12,
      'the cost does not scale with the rate, so the rate is not what is being charged');
  },

  // DOLLARS CANNOT COME BACK BY ACCIDENT. Every door a fee can walk through
  // refuses the old value by name rather than charging a hundred times the real
  // cost quietly. This is what makes it structural instead of remembered.
  async everyDoorRefusesADollarAmount() {
    const geo = { entryOffsetH: 0, exitOffsetH: 1 };
    const map = new Map([[0, { open: 100, high: 101, low: 99, close: 100 }]]);
    const periods = [{ startTs: 0 }];
    const doors = {
      feeRate: () => feeRate(DOLLAR_FEE, 'test'),
      pnlAt: () => pnlAt(1, 100, 110, DOLLAR_FEE),
      simMarket: () => bracketLib.simMarket(periods, [1], map, geo, { tHours: 1, feePerLeg: DOLLAR_FEE }),
      simBracket: () => bracketLib.simBracket(periods, [1], map, geo, { dPct: 2, tHours: 1, gate: 'always', feePerLeg: DOLLAR_FEE }),
      feeFracOf: () => feeFracOf({ feePerLeg: DOLLAR_FEE, feeUnits: 'fraction' }),
    };
    for (const [name, call] of Object.entries(doors)) {
      let err = null;
      try { call(); } catch (e) { err = e; }
      assert.ok(err, `${name} accepted ${DOLLAR_FEE} a leg — that is dollars, and as a rate it is 12.5%`);
      assert.ok(/FRACTIONS here, not dollars/.test(err.message),
        `${name} refused for the wrong reason: ${err.message}`);
    }
    // The rail sits well clear of any real fee and well below any dollar one.
    assert.ok(MAX_FEE_PER_LEG > 0.01 && MAX_FEE_PER_LEG < DOLLAR_FEE,
      `the rail at ${MAX_FEE_PER_LEG} must pass a real fee and refuse every dollar value this system used`);
  },

  // QC 74: a run already recorded is never destroyed, and rereading $0.125 as
  // 12.5% a leg would destroy what every one of its numbers meant.
  async aRunRecordedInDollarsStillPricesAtItsOwnCost() {
    assert.strictEqual(feeFracOf({ feePerLeg: DOLLAR_FEE }), FEE_PER_LEG,
      'a run recorded before the change must read back as the same real cost');
    assert.strictEqual(feeFracOf({ feePerLeg: 0.00125, feeUnits: 'fraction' }), FEE_PER_LEG,
      'a run recorded since is taken as it stands');
    assert.strictEqual(feeFracOf({}), FEE_PER_LEG, 'a run that never said falls back to the lab rate');
    assert.strictEqual(feeFracOf({ feePerLeg: 'nonsense' }), FEE_PER_LEG, 'and so does one that cannot be read');
    // The two are the SAME cost written two ways, so nothing may report them as
    // a mismatch — a warning nobody can act on is worse than no warning.
    assert.strictEqual(feeFracOf({ feePerLeg: DOLLAR_FEE }),
      feeFracOf({ feePerLeg: 0.00125, feeUnits: 'fraction' }));
  },

  // THE ONE THAT WOULD HAVE BEEN WORST. Picking up an interrupted sweep, firing
  // a null draw and grading a reserve all hand a stored run's own parameters
  // back to a launcher. Handed over unconverted, the launcher's safety rail
  // would have CLAMPED $0.125 down to the 5%-a-leg ceiling — so the picked-up
  // half of a sweep would finish priced at forty times what its first half paid,
  // with nothing on any screen saying so.
  async replayingAnOldRunPricesItAtTheCostItWasFoundUnder() {
    const old = batch.replayParams({ feePerLeg: DOLLAR_FEE, universe: ['BTCUSDT'] });
    assert.strictEqual(old.feePerLeg, FEE_PER_LEG, 'a picked-up run must pay what it was paying');
    assert.strictEqual(old.feeUnits, 'fraction', 'and it must say which units that is in');
    assert.deepStrictEqual(old.universe, ['BTCUSDT'], 'everything else is carried through untouched');
    const current = batch.replayParams({ feePerLeg: 0.002, feeUnits: 'fraction' });
    assert.strictEqual(current.feePerLeg, 0.002, 'a run already in fractions is left alone');
    // Nothing may go through the launcher's rail without being converted first.
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');
    assert.ok(/startBracketLab\(replayParams\(doc\.params\)/.test(src),
      'the resume hands stored parameters straight to the launcher again');
  },

  // The old NAME is gone as well as the old value: nothing can still be reading
  // a dollar fee from anywhere, because there is nothing to read.
  async theDollarConstantIsGoneFromTheWholeTree() {
    const paper = require('../lib/paper');
    assert.strictEqual(paper.REAL_FEE_PER_LEG, undefined,
      'lib/paper.js still exports the dollar-per-leg constant');
    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'data' || e.name === 'ARCHIVE') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith('.js') || e.name.endsWith('.html')) out.push(full);
      }
      return out;
    };
    const offenders = [];
    for (const f of walk(ROOT)) {
      const rel = path.relative(ROOT, f);
      if (rel.startsWith('tests/adversarial')) continue;   // a written record of past attacks
      // This file names both on purpose — it is the thing doing the checking.
      if (rel === path.join('tests', 'test-fees.js')) continue;
      const src = fs.readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '');
      if (/REAL_FEE_PER_LEG|feePerLegUsd/.test(src)) offenders.push(rel);
    }
    assert.deepStrictEqual(offenders, [],
      `these still name a dollar-per-leg fee: ${offenders.join(', ')}`);
  },
};
