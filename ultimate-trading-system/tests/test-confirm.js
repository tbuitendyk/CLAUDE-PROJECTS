// THE CONFIRMATION OVERLAY'S ARITHMETIC (COINS.md section 11), by hand. The
// verdict's order was written before any number existed; these hold the code
// to it.
const { assert } = require('./helpers');
const C = require('../lib/confirm');

module.exports = {
  theDialHasThreeValuesAndTwoMultipliers() {
    assert.deepStrictEqual([...C.CONFIRM_VALUES], ['off', 'confirmed only', 'sized']);
    assert.deepStrictEqual(C.multipliersOf('off', 5, 5), { kx: 1, ux: 1 }, 'off prices everything at size 1 whatever the boxes say');
    assert.deepStrictEqual(C.multipliersOf('confirmed only', 5, 5), { kx: 1, ux: 0 }, 'confirmed only drops the unconfirmed');
    assert.deepStrictEqual(C.multipliersOf('sized', 2, 0.5), { kx: 2, ux: 0.5 });
    assert.deepStrictEqual(C.multipliersOf('sized'), { kx: C.DEFAULT_KX, ux: C.DEFAULT_UX }, 'the defaults are 2 and 1');
    assert.strictEqual(C.multiplierOrRefuse('', 'x', 2), 2);
    assert.strictEqual(C.multiplierOrRefuse('1.5', 'x', 2), 1.5);
    assert.throws(() => C.multiplierOrRefuse(-1, 'confirmed ×', 2), /confirmed × must be a number of zero or more/);
    assert.throws(() => C.multiplierOrRefuse('two', 'confirmed ×', 2), /zero or more/);
  },

  theLeanAndTheSplitByHand() {
    // after rising lean short (-1), after falling lean long (+1): the reverting units
    const signs = C.leanSigns('rfsrf', { rising: -1, falling: 1 });
    assert.deepStrictEqual(signs, [-1, 1, 0, -1, 1]);
    const calls = [-1, -1, 1, 1, 0];
    const s = C.splitCalls(calls, signs);
    assert.deepStrictEqual(s.c, [-1, 0, 0, 0, 0], 'confirmed: the call agrees with the lean');
    assert.deepStrictEqual(s.u, [0, -1, 0, 1, 0], 'unconfirmed: the call disagrees');
    assert.deepStrictEqual(s.z, [0, 0, 1, 0, 0], 'no lean: the decision sat under the band; a call of 0 is no trade anywhere');
    // no signs at all: everything is a no-lean trade
    const n = C.splitCalls(calls, null);
    assert.deepStrictEqual([n.c, n.u, n.z], [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [-1, -1, 1, 1, 0]]);
  },

  theMoneyAndSizeUnderTheMultipliers() {
    const parts = { c: { pnl: 10, n: 4 }, u: { pnl: -6, n: 3 }, z: { pnl: 2, n: 2 } };
    const off = C.combine(parts, 1, 1);
    assert.deepStrictEqual([off.pnl, off.trades, off.size], [6, 9, 9], 'at size 1 the money is the plain sum');
    const only = C.combine(parts, 1, 0);
    assert.deepStrictEqual([only.pnl, only.trades, only.size], [12, 6, 6], 'confirmed only drops the unconfirmed money and trades');
    const sized = C.combine(parts, 2, 0.5);
    assert.deepStrictEqual([sized.pnl, sized.trades, sized.size], [20 - 3 + 2, 9, 8 + 1.5 + 2], 'sized scales money and size alike');
    assert.deepStrictEqual(sized.at1, { pnl: 6, size: 9 }, 'and carries the size-1 figures to compare against');
  },

  // THE VERDICT, in the order section 11 wrote it
  theVerdictIsDecidedInTheWrittenOrder() {
    const V = (parts, kx = 2, ux = 1) => C.verdictOf(parts, kx, ux);
    // no lean anywhere: nothing to judge
    assert.strictEqual(V({ c: { pnl: 0, n: 0 }, u: { pnl: 0, n: 0 }, z: { pnl: 5, n: 3 } }), null);
    // confirmed trades lose: sizing them up loses more -> adds nothing
    assert.strictEqual(V({ c: { pnl: -4, n: 4 }, u: { pnl: 3, n: 3 }, z: { pnl: 1, n: 1 } }), 'adds nothing');
    // confirmed trades break even: sizing them changes nothing, and the same money is not more money
    assert.strictEqual(V({ c: { pnl: 0, n: 4 }, u: { pnl: 3, n: 3 }, z: { pnl: 1, n: 1 } }), 'adds nothing');
    // confirmed trades make the same per trade as everything else: doubling
    // them adds money but not per unit of size -> just leverage
    assert.strictEqual(V({ c: { pnl: 4, n: 4 }, u: { pnl: 3, n: 3 }, z: { pnl: 1, n: 1 } }), 'just leverage');
    // confirmed trades are better per trade than the unconfirmed but not than
    // the no-lean ones -> adds value, not better signal
    assert.strictEqual(V({ c: { pnl: 8, n: 4 }, u: { pnl: -3, n: 3 }, z: { pnl: 3, n: 1 } }), 'adds value');
    // confirmed beat both other kinds per trade -> better signal
    assert.strictEqual(V({ c: { pnl: 8, n: 4 }, u: { pnl: -3, n: 3 }, z: { pnl: 1, n: 1 } }), 'better signal');
    // with no no-lean trades at all, beating the unconfirmed is enough
    assert.strictEqual(V({ c: { pnl: 8, n: 4 }, u: { pnl: -3, n: 3 }, z: { pnl: 0, n: 0 } }), 'better signal');
    // with no unconfirmed trades the confirmed cannot be shown better than them: adds value at most
    assert.strictEqual(V({ c: { pnl: 8, n: 4 }, u: { pnl: 0, n: 0 }, z: { pnl: 1, n: 1 } }), 'adds value');
    // confirmed only (1, 0): dropping losing unconfirmed trades adds value
    assert.strictEqual(V({ c: { pnl: 8, n: 4 }, u: { pnl: -3, n: 3 }, z: { pnl: 1, n: 1 } }, 1, 0), 'better signal');
    assert.strictEqual(V({ c: { pnl: 8, n: 4 }, u: { pnl: 3, n: 3 }, z: { pnl: 1, n: 1 } }, 1, 0), 'adds nothing', 'dropping winning trades adds nothing');
    for (const w of C.VERDICTS) assert.ok(C.verdictWhy(w).length > 20, `${w} says what it rests on`);
  },

  // THE SPLIT CHANGES NO MONEY AT SIZE ONE, ON THE SIMULATOR ITSELF. The worker
  // prices the three kinds of call as three runs of the one simulator and adds
  // the money back up; that is only right because a period's trade is priced
  // on its own candles and nothing carries between periods. Held here on a
  // fixture, through the worker's own window pricer: off and sized x1/x1 are
  // the same money to the cent, sized x2/x1 adds exactly the confirmed money,
  // and confirmed only takes exactly the unconfirmed money and trades away.
  theSplitChangesNoMoneyAtSizeOneOnTheSimulator() {
    const { simCell } = require('../lib/bracket');
    const { GEOMETRIES } = require('../lib/dataset');
    const { FEE_PER_LEG: FEE } = require('../lib/paper');
    const sw = require('../lib/stagework');
    const geo = GEOMETRIES['daily-3d'];
    const HOUR = 3600000;
    // four periods a week apart; each gets its own bars from its entry hour,
    // rising in the first and third, falling in the second and fourth
    const t0 = Date.UTC(2024, 0, 1);
    const periods = [0, 1, 2, 3].map((i) => ({ startTs: t0 + i * 7 * 24 * HOUR }));
    const m = new Map();
    periods.forEach((p, i) => {
      const up = i % 2 === 0;
      for (let h = 0; h <= 80; h++) {
        const o = 100 + (up ? 1 : -1) * h * 0.2;
        m.set(p.startTs + geo.entryOffsetH * HOUR + h * HOUR, { open: o, high: o + 0.6, low: o - 0.6, close: o });
      }
    });
    const cell = { entry: 'market', gate: null, dMult: null, tHours: 41, trailMult: null, armMult: null };
    const calls = [1, 1, -1, -1];
    const signs = [1, -1, 0, -1];   // confirmed, unconfirmed, no lean, confirmed
    const plain = simCell(cell, periods, calls, m, geo, 2, FEE);
    assert.strictEqual(plain.trades, 4, 'the fixture trades every period');
    const off = sw.priceLeanWindow(cell, periods, calls, m, geo, 2, FEE, signs, { confirm: 'off' }, true);
    assert.strictEqual(off.parts, null, 'off prices plain');
    assert.deepStrictEqual([off.res.pnl, off.res.trades], [plain.pnl, plain.trades]);
    const at1 = sw.priceLeanWindow(cell, periods, calls, m, geo, 2, FEE, signs, { confirm: 'sized', kx: 1, ux: 1 }, true);
    assert.ok(Math.abs(at1.res.pnl - plain.pnl) < 1e-9, `sized x1/x1 is the plain money: ${at1.res.pnl} vs ${plain.pnl}`);
    assert.strictEqual(at1.res.trades, plain.trades);
    assert.deepStrictEqual([at1.parts.c.n, at1.parts.u.n, at1.parts.z.n], [2, 1, 1], 'two confirmed, one unconfirmed, one with no lean');
    const c = at1.parts.c.pnl; const u = at1.parts.u.pnl; const z = at1.parts.z.pnl;
    assert.ok(Math.abs(c + u + z - plain.pnl) < 1e-9, 'the three parts add up to the plain money');
    const sized = sw.priceLeanWindow(cell, periods, calls, m, geo, 2, FEE, signs, { confirm: 'sized', kx: 2, ux: 1 }, true);
    assert.ok(Math.abs(sized.res.pnl - (plain.pnl + c)) < 1e-9, 'x2 on the confirmed adds exactly the confirmed money once more');
    assert.strictEqual(sized.res.trades, 4, 'every trade is still taken');
    assert.strictEqual(sized.size, 2 * 2 + 1 + 1, 'and the size deployed says what was bet');
    const only = sw.priceLeanWindow(cell, periods, calls, m, geo, 2, FEE, signs, { confirm: 'confirmed only' }, true);
    assert.ok(Math.abs(only.res.pnl - (plain.pnl - u)) < 1e-9, 'confirmed only takes exactly the unconfirmed money away');
    assert.strictEqual(only.res.trades, 3, 'and the unconfirmed trade with it');
    assert.ok(only.res.maxDrawdown != null || only.res.wins != null, 'the rich pass is there on the real window');
    assert.deepStrictEqual([only.kx, only.ux], [1, 0]);
    // no signs at all: plain, whatever the dial says
    const none = sw.priceLeanWindow(cell, periods, calls, m, geo, 2, FEE, null, { confirm: 'sized', kx: 2, ux: 1 }, false);
    assert.strictEqual(none.parts, null);
    assert.strictEqual(none.res.pnl, plain.pnl);
  },

  theSumsAcrossUnitsAreTheSameSixNumbersAdded() {
    let acc = null;
    acc = C.addParts(acc, { c: { pnl: 1, n: 1 }, u: { pnl: 2, n: 2 }, z: { pnl: 3, n: 3 } });
    acc = C.addParts(acc, { c: { pnl: 10, n: 1 }, u: null, z: { pnl: 0.5, n: 1 } });
    assert.deepStrictEqual(acc, { c: { pnl: 11, n: 2 }, u: { pnl: 2, n: 2 }, z: { pnl: 3.5, n: 4 } });
  },
};
