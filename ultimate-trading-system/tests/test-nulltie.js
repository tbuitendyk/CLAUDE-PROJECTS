// A TIE IS NOT A LOSS (owner order, 2026-08-30: "fix that").
//
// `beat its own null set` counts how many of a setting's shuffled copies the
// real run came out STRICTLY ahead of. With gate `always` a position opens
// every period whatever the committee voted — simBracket reads the call once,
// to decide which rails may open, and with `always` that decision ignores it.
// So every copy makes exactly the same money as the real run, nothing is
// strictly ahead of anything, the count is 0 of 1,000, and the column read
// 0.0% — which is what a setting that LOST all thousand reads. Two opposite
// meanings under one number, and the owner had no way to tell them apart.
//
// The first test below is the load-bearing one: it RUNS the simulation on both
// gates and proves the claim rather than asserting somebody's belief about it.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const bracket = require('../lib/bracket');

const ROOT = path.join(__dirname, '..');
const JS = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const STAGES = () => fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');

// A small, entirely made-up market. Deterministic, no randomness anywhere: a
// price that swings a clean ±2% so a ±1% rail is reached in BOTH directions
// depending where in the swing a period starts, and NARROW bars so reaching a
// rail takes a few hours rather than happening inside the first one.
//
// THAT SECOND PART IS THE WHOLE FIXTURE. The first version used bars whose
// every high and low straddled both rails at once, which meant a one-rail
// setting and a two-rail one stopped out identically every single period —
// so the market could not tell them apart, and a gate rewritten to read the
// votes sailed through the test that exists to catch exactly that.
const HOUR = 3600000;
const T0 = 1700000000000;
function fixture() {
  const periods = [];
  const tradeMap = new Map();
  for (let i = 0; i < 300; i++) {
    const p = 100 * (1 + 0.02 * Math.sin(i / 9));
    tradeMap.set(T0 + i * HOUR, { open: p, high: p * 1.0015, low: p * 0.9985, close: p });
  }
  for (let i = 0; i < 40; i++) periods.push({ startTs: T0 + i * 7 * HOUR });
  const calls = periods.map((_, i) => [1, 0, -1, 1, 0][i % 5]);
  return { periods, calls, tradeMap };
}
const GEO = { entryOffsetH: 0 };
const CELL = { entry: 'breakout', dMult: 1, tHours: 6, trailMult: null, armMult: null };
const run = (gate, calls) => {
  const { periods, tradeMap } = fixture();
  return bracket.simCell({ ...CELL, gate }, periods, calls, tradeMap, GEO, 1, 0.0004);
};
const shuffled = (calls) => calls.slice().reverse();

module.exports = {
  // THE CLAIM ITSELF, run rather than believed.
  async underAlwaysTheVotesChangeNothingAndUnderTheOthersTheyDo() {
    const { calls } = fixture();
    const other = shuffled(calls);
    assert.notDeepStrictEqual(calls, other, 'the fixture shuffle is not a shuffle');

    // NOT just a shuffle. A shuffle that happens not to matter would pass this
    // while a gate that half-reads the call slipped through — it did, when this
    // test was first written. Under a correct `always` the answer cannot depend
    // on the calls AT ALL, so every one of these must land on the same money:
    // the real calls, their shuffle, all buys, all sells, all silent, and no
    // calls whatsoever.
    const zeros = calls.map(() => 0);
    const ways = [['the real votes', calls], ['them shuffled', other],
      ['all buys', calls.map(() => 1)], ['all sells', calls.map(() => -1)],
      ['all silent', zeros], ['no votes at all', null]];
    const first = run('always', calls);
    assert.ok(first.trades > 0, 'the fixture makes no trades under always, so it can show nothing');
    // AND THE MARKET MUST BE ABLE TO TELL ONE RAIL FROM TWO, or "always ignores
    // the votes" is a claim about a market where nothing could have differed.
    const buys = run('directional', calls.map(() => 1));
    const sells = run('directional', calls.map(() => -1));
    assert.ok(buys.trades > 0 && sells.trades > 0,
      'the fixture never opens in one of the two directions, so it cannot show a one-rail setting '
      + 'differing from a two-rail one');
    assert.notStrictEqual(buys.pnl, sells.pnl, 'the fixture cannot tell a buy from a sell');
    assert.notStrictEqual(buys.pnl, first.pnl,
      'one rail and both rails make the same money in this fixture, so it cannot show that always '
      + 'ignores the votes — this is the degenerate market the fixture comment warns about');
    for (const [what, c] of ways) {
      const r = run('always', c);
      assert.deepStrictEqual({ pnl: r.pnl, trades: r.trades, stops: r.stops },
        { pnl: first.pnl, trades: first.trades, stops: first.stops },
        `gate always gave a different answer for ${what} — it is reading the votes now, so the whole `
        + 'reason those rows cannot be measured has gone. Reconsider the fix rather than loosen this.');
    }

    // and the gates that DO read the votes must actually differ, or the
    // fixture proves nothing about the first two lines
    let differed = 0;
    for (const gate of ['active', 'directional']) {
      const b1 = run(gate, calls);
      const b2 = run(gate, other);
      if (b1.pnl !== b2.pnl || b1.trades !== b2.trades) differed++;
    }
    assert.strictEqual(differed, 2,
      'the fixture does not make active and directional differ when the votes are shuffled, so it '
      + 'cannot show that always is the special case');
  },

  // The count needs STRICTLY ahead, which is why a tie counts as nothing.
  async aTieCountsAsNothingBecauseTheCountWantsStrictlyAhead() {
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    assert.ok(/if \(hRes\.pnl > dRes\.pnl\) beat\+\+;/.test(sw),
      'the head-to-head no longer counts strictly-ahead — if it counts ties as wins now, every '
      + 'always setting would read 100% instead, which is the same fault pointing the other way');
  },

  async onePlaceAnswersWhetherANullSetCanBeBeaten() {
    assert.strictEqual(typeof bracket.nullSetCanBeat, 'function',
      'nothing answers whether a null set can be beaten under a given gate');
    assert.strictEqual(bracket.nullSetCanBeat('always'), false);
    for (const g of bracket.GATES.filter((x) => x !== 'always')) {
      assert.strictEqual(bracket.nullSetCanBeat(g), true, `${g} reads the votes and must be measurable`);
    }
    // Everything downstream asks IT, rather than testing the gate again itself.
    const st = STAGES();
    const own = (st.match(/'always'/g) || []).length;
    assert.strictEqual(own, 0,
      'lib/stages.js decides for itself somewhere whether a gate is always, instead of asking '
      + 'bracket.nullSetCanBeat — that is the same fact written twice, which is how a dimension '
      + 'added to the agreement was once missed in one key of three');
  },

  // The gate has to come back out of a setting's name, because a Table 3.B row
  // knows its setting only by name.
  async theGateSurvivesTheRoundTripThroughASettingsName() {
    const st = STAGES();
    const from = st.indexOf('const gateOfShape =');
    assert.ok(from > 0, 'nothing reads the gate back out of a setting name');
    // eslint-disable-next-line no-eval
    const readGate = eval(`${st.slice(from, st.indexOf('\n', from))}; gateOfShape`);
    const shapeFrom = st.indexOf('function shapeLabel(cell) {');
    // eslint-disable-next-line no-eval
    const writeShape = eval(`${st.slice(shapeFrom, st.indexOf('\n}\n', shapeFrom) + 3)}; shapeLabel`);
    for (const gate of bracket.GATES) {
      for (const trailMult of [null, 2]) {
        const label = writeShape({ entry: 'breakout', gate, dMult: 1.5, tHours: 12, trailMult, armMult: 1 });
        assert.strictEqual(readGate(label), gate, `the gate does not survive "${label}"`);
      }
    }
    // a market setting has no gate at all, and must never read as always
    const m = writeShape({ entry: 'market', tHours: 8 });
    assert.strictEqual(bracket.nullSetCanBeat(readGate(m)), true,
      `a market setting reads as unmeasurable through its name "${m}"`);
  },

  // Emptied ONCE, before anything sorts, filters, averages or prints it.
  async theEmptiedNumberIsEmptyEverywhereAndNotJustOnScreen() {
    const st = STAGES();
    assert.ok(/function nullSetHonest\(r\) \{[\s\S]{0,220}nullTies: true/.test(st),
      'nothing marks the rows whose null-set numbers cannot mean anything');
    assert.ok(/_beatPct: \(r\) => \(r\.nullTies \|\| !r\.pairs \? null/.test(st),
      'the filters and the four numbers beside each box still read a share for a row that has none, '
      + 'so a floor would keep it as a zero');
    assert.ok(/if \(kind === 'share'\) return row\.nullTies \|\| !row\.pairs \? null/.test(st),
      'the sort still reads a share for a row that has none, so those rows sort as the worst '
      + 'measured rows instead of sitting after them');
    // Table 3.A: marked before the sort AND before the filters
    const ranked = st.slice(st.indexOf('function stage3Ranked('), st.indexOf('function stage3CoinRows('));
    assert.strictEqual((ranked.match(/nullSetHonest\(/g) || []).length, 2,
      'Table 3.A marks its rows on only one of the two paths through it — with a saved sort, or '
      + 'without one — so which reading the owner gets depends on whether a column is picked');
    assert.ok(ranked.indexOf('nullSetHonest(') < ranked.indexOf('applyFilters('),
      'Table 3.A filters before it marks, so a floor on the share keeps rows that have none');
    // Table 3.B, and the records opening below it
    const coins = st.slice(st.indexOf('function stage3Coins('), st.indexOf('function stage3Ranked('));
    assert.ok(/t\.coins\.map\(honest\)\.filter\(clears\)/.test(coins),
      'Table 3.B filters before it marks, so a floor on the share keeps rows that have none');
    const recs = st.slice(st.indexOf('function stage3CoinRows('), st.indexOf('function stage3CoinRows(') + 1400);
    assert.ok(/nullSetHonest\(\{ \.\.\.r,/.test(recs),
      'the records opening below a Table 3.B row still print 0.0% where nothing was measured');
  },

  async bothColumnsSayItTheSameWayAndTheScreenSaysWhy() {
    const js = JS();
    assert.ok(/const B_TIED = "/.test(js), 'the two columns have no shared wording for why they are empty');
    assert.ok(/const bDash = \(tied\) => \(tied \? `<span class="muted" title="\$\{B_TIED\}">/.test(js),
      'the empty cell no longer turns on whether every comparison tied, so it reads as missing data '
      + 'rather than as a tie — the wording can still be sitting there unreachable');
    assert.ok(/function bShare\(share, beat, pairs, tied\) \{\n  if \(tied \|\| share == null\) return bDash\(tied\);/.test(js),
      'beat its own null set still prints a share for a row where every comparison tied');
    assert.ok(/const bLead = \(v, tied\) => \(v == null \? bDash\(tied\)/.test(js),
      'lead over null set does not explain itself where it is empty for the same reason');
    // all three Stage 3 tables pass the flag; stage 1 and stage 2 have no gate
    // and must be left exactly as they were
    const passes = (js.match(/bShare\([^)]*, r\.nullTies\)/g) || []).length;
    assert.strictEqual(passes, 3,
      `expected Table 3.A, Table 3.B and the records below it to pass the mark, found ${passes}`);
    assert.ok(/bLead\(r\.avgLead, r\.nullTies\)/.test(js), 'Table 3.A does not pass the mark to its lead column');
  },
};
