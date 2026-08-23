// The planted check for the deal construction + execution machinery:
// plant a vote->price link in synthetic data; the real call stream must
// harvest it through the same simulator the boards use, and the dealt
// stream (register 66 construction) must destroy it. This is the automated
// half of the calibration gate; the on-box planted run before first real
// use is the other half (manifest item 4).
const { assert } = require('./helpers');
const { FEE_PER_LEG } = require('../lib/paper');
const bracketLib = require('../lib/bracket');
const { nullRng, dealVotes } = require('../lib/walkforward');

const HOUR = 3600 * 1000;

// Synthetic world: daily periods; on days where the planted call is +1 the
// price grinds UP through the day, else it wobbles flat. A directional-gate
// breakout cell profits iff the calls carry the plant.
function syntheticWorld(nDays, seedCalls) {
  const tradeMap = new Map();
  const periods = [];
  let price = 100;
  const plantShare = seedCalls.filter((c) => c === 1).length / nDays;
  // One pass over every hour, day-of-hour call lookup — no overlapping
  // writes (the first version of this world wrote each day's candles twice
  // and silently shifted the plant by a day; kept as the lesson).
  for (let h = 0; h < (nDays + 2) * 24; h++) {
    const day = Math.floor(h / 24);
    const call = day < nDays ? seedCalls[day] : 0;
    // Flat overall: up-grind on planted days, matched down-grind elsewhere,
    // so the MARKET carries no profit and only correctly TIMED longs win.
    const drift = call === 1 ? 0.4 : -0.4 * (plantShare / (1 - plantShare));
    price += drift;
    tradeMap.set(h * HOUR, { open: price, high: price + 0.25, low: price - 0.25, close: price });
  }
  for (let d = 0; d < nDays; d++) {
    periods.push({ startTs: d * 24 * HOUR, endTs: (d + 1) * 24 * HOUR });
  }
  return { periods, tradeMap };
}

const GEO = { entryOffsetH: 0, featureHours: 24 };
const CELL = { entry: 'breakout', gate: 'directional', dMult: 1, tHours: 24, quorum: 1 };

module.exports = {
  async theRealStreamHarvestsThePlantAndTheDealtStreamDoesNot() {
    const n = 160;
    const rng = nullRng(7, 'planted', 0, 0, 'gen');
    const calls = Array.from({ length: n }, () => (rng() < 0.25 ? 1 : 0));
    const { periods, tradeMap } = syntheticWorld(n, calls);
    const real = bracketLib.simCell(CELL, periods, calls, tradeMap, GEO, 1.0, FEE_PER_LEG);
    assert.ok(real.trades >= 15, `the plant trades (${real.trades})`);
    assert.ok(real.pnl > 0, `the real stream harvests the plant (+$${real.pnl.toFixed(2)})`);

    // Ten independent deals: same vote mix, dates destroyed.
    const dealt = [];
    for (let seed = 1; seed <= 10; seed++) {
      const d = dealVotes(calls, nullRng(seed, 'planted', 0, 0, 'deal'));
      // mix preserved exactly
      assert.strictEqual(d.filter((c) => c === 1).length, calls.filter((c) => c === 1).length);
      dealt.push(bracketLib.simCell(CELL, periods, d, tradeMap, GEO, 1.0, FEE_PER_LEG).pnl);
    }
    const sorted = dealt.slice().sort((a, b) => a - b);
    const beat = dealt.filter((p) => p >= real.pnl).length;
    assert.strictEqual(beat, 0, `no dealt stream matches the plant (${beat}/10 did; dealt best $${sorted[9].toFixed(2)} vs real $${real.pnl.toFixed(2)})`);
    assert.ok(sorted[5] < real.pnl * 0.5, `the dealt median sits far below the plant (median $${sorted[5].toFixed(2)})`);
  },
  async theDealIsDeterministicPerSeedAndIndependentAcrossMembers() {
    const calls = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0));
    const a = dealVotes(calls, nullRng(5, 'k', 0, 0, 'x'));
    const b = dealVotes(calls, nullRng(5, 'k', 0, 0, 'x'));
    assert.deepStrictEqual(a, b, 'same seed, same deal');
    const c = dealVotes(calls, nullRng(5, 'k', 0, 1, 'x'));
    assert.notDeepStrictEqual(a, c, 'members deal independently');
    const d = dealVotes(calls, nullRng(6, 'k', 0, 0, 'x'));
    assert.notDeepStrictEqual(a, d, 'seeds deal independently');
  },
};
