const { assert } = require('./helpers');
const { inspectDump, pairAgreement, withTradeRate } = require('../lib/inspect');
const { nullVerdict } = require('../lib/verdict');

// Hand-built dump: 3 members, 4 hold periods, votes chosen so every figure is
// checkable by eye.
const DUMP = {
  shiftFrac: null,
  bandPct: 1.5,
  specs: [
    { model: 'logreg', view: 'full', regime: 'full' },
    { model: 'boost', view: 'prices', regime: 'interlaced' },
    { model: 'logreg', view: 'volume', regime: 'full' },
  ],
  models: [{ kind: 'logreg' }, { kind: 'boost' }, { kind: 'logreg' }],
  votes: {
    search: [[1, 1, 0, -1], [1, -1, 0, -1], [0, 0, 0, 0]],
    hold:   [[1, 1, -1, 0], [1, 1, -1, 0], [0, -1, 1, 0]],
  },
  labels: { search: [1, 0, 0, -1], hold: [1, 1, -1, 0] },
  startTs: { search: [1, 2, 3, 4], hold: [5, 6, 7, 8] },
  perMember: [
    { spec: {}, search: { testAcc: 0.5 }, hold: { testAcc: 1.0 } },
    { spec: {}, search: { testAcc: 0.25 }, hold: { testAcc: 0.75 } },
    { spec: {}, search: { testAcc: 0.1 }, hold: { testAcc: 0.2 } },
  ],
};

module.exports = {
  async insideViewCountsAreCheckableByEye() {
    const d = inspectDump(DUMP, 2);
    assert.strictEqual(d.members.length, 3);
    // member 1 commits in 3 of 4 hold periods
    assert.ok(Math.abs(d.members[0].activeHold - 0.75) < 1e-9);
    // member 3 commits in 2 of 4
    assert.ok(Math.abs(d.members[2].activeHold - 0.5) < 1e-9);
    // committee at quorum 2 on hold: periods 1,2,3 trade (two agree), 4 flat
    assert.strictEqual(d.committee.holdTrades, 3);
    // member 1 voted with the trade in all 3 traded periods
    assert.strictEqual(d.members[0].withTradeHold, 1);
    // member 3 agreed with the trade in 0 of the 3 (votes 0,-1,1 vs trades 1,1,-1)
    assert.strictEqual(d.members[2].withTradeHold, 0);
    // members 1 and 2 committed together on hold periods 1,2,3 and always agreed
    assert.strictEqual(pairAgreement(DUMP.votes.hold[0], DUMP.votes.hold[1], 3), 1);
    // pairwise honours the min-overlap floor: with only 2 shared commitments
    // between members 1 and 3, the matrix must say "not enough" rather than 0%
    assert.strictEqual(d.pairwise[0][2], null);
    // models flagged present
    assert.ok(d.members.every((m) => m.hasModel));
  },
  async withTradeRateIgnoresFlatCommitteePeriods() {
    // committee [1,0,-1]: only periods 1 and 3 count; member votes [1,1,1]
    // matches once -> 50%. A naive divide-by-all would say 33%.
    assert.strictEqual(withTradeRate([1, 1, 1], [1, 0, -1]), 0.5);
  },
  async nullVerdictRanksAgainstTheRightPopulations() {
    const mkRow = (t, g, dc, shift, pnl) => ({
      trade: t, geometry: g, decision: dc, shiftFrac: shift, holdPnl: pnl,
    });
    const realDoc = { id: 'real-run', edgeCensus: [
      mkRow('AAA', 'daily-3d', 'argmax', null, 100),
      mkRow('BBB', 'daily-3d', 'argmax', null, 400),   // board best
      mkRow('CCC', 'daily-3d', 'argmax', null, -50),
    ] };
    // 3 scrambles; BBB's own noise: 350, -20, 10. Board maxima: 350, 90, 380.
    const nullDoc = { id: 'null-run', edgeCensus: [
      mkRow('AAA', 'daily-3d', 'argmax', 0.25, -30), mkRow('BBB', 'daily-3d', 'argmax', 0.25, 350), mkRow('CCC', 'daily-3d', 'argmax', 0.25, -100),
      mkRow('AAA', 'daily-3d', 'argmax', 0.50, 90),  mkRow('BBB', 'daily-3d', 'argmax', 0.50, -20), mkRow('CCC', 'daily-3d', 'argmax', 0.50, -70),
      mkRow('AAA', 'daily-3d', 'argmax', 0.75, -10), mkRow('BBB', 'daily-3d', 'argmax', 0.75, 10),  mkRow('CCC', 'daily-3d', 'argmax', 0.75, 380),
    ] };
    const v = nullVerdict(realDoc, nullDoc, { trade: 'BBB', geometry: 'daily-3d', decision: 'argmax' });
    // per-setup: BBB real 400 beats 350, -20, 10 -> 3/3 PASS
    assert.strictEqual(v.perSetup.beats, 3);
    assert.ok(v.perSetup.passes);
    // selection-aware: real best 400 vs board maxima 350, 90, 380 -> 3/3 PASS,
    // and the maxima must come from DIFFERENT setups per draw (max over the
    // population, not BBB tracked through the draws)
    assert.strictEqual(v.selection.beats, 3);
    assert.deepStrictEqual(v.selection.draws.map((d) => d.setup),
      ['BBB|||daily-3d|argmax', 'AAA|||daily-3d|argmax', 'CCC|||daily-3d|argmax']); // keys carry ctx slots since 2026-08-04
    // sanity counts the POPULATION (5 of 9 rows negative), not the maxima
    assert.ok(Math.abs(v.sanity.negativeShare - 5 / 9) < 1e-9);
    // and a weaker real board must FAIL the selection test: drop BBB to 200
    realDoc.edgeCensus[1].holdPnl = 200;
    const v2 = nullVerdict(realDoc, nullDoc, null);
    assert.strictEqual(v2.selection.beats, 1); // 200 beats only the 90 draw
    assert.ok(!v2.selection.passes);
  },
};
