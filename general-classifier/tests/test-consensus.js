const { assert } = require('./helpers');
const { FEATURE_NAMES, viewIndices } = require('../lib/features');
const { summarizeConsensus, voteBook, SUPER_QUORUM, CONSENSUS_VIEWS, CONSENSUS_MODELS } = require('../lib/batch');
const { voteOf, superOf, pnlFor, directionalCall } = require('../lib/paper');
const { deriveShift } = require('../lib/pipeline');

module.exports = {
  async viewsPartitionSensibly() {
    assert.strictEqual(viewIndices('full').length, 44);
    assert.strictEqual(viewIndices('volume').length, 5); // 2x dayvol_cv + 2x dayvol_last_ratio + rel_vol_log
    assert.strictEqual(viewIndices('cross').length, 4);
    assert.strictEqual(viewIndices('prices').length, 39); // everything except the 5 volume features
    // prices + volume covers everything exactly once
    const union = new Set([...viewIndices('prices'), ...viewIndices('volume')]);
    assert.strictEqual(union.size, 44);
    assert.throws(() => viewIndices('nope'), /unknown feature view/);
    // spot-check membership
    const names = viewIndices('cross').map((i) => FEATURE_NAMES[i]);
    assert.deepStrictEqual(names, ['rel_total_ret', 'rel_ret_last24h', 'rel_vol_log', 'ret_correlation']);
  },
  async fractionalShiftsMapIntoTheBufferedCycle() {
    // 310-week pair: rotations live in [8, 302], spread with the fraction.
    assert.strictEqual(deriveShift(310, 0.0001), 8);
    assert.strictEqual(deriveShift(310, 0.5), 8 + Math.round(0.5 * 294));
    assert.ok(deriveShift(310, 0.9999) <= 302);
    // monotone in frac
    assert.ok(deriveShift(310, 0.7) > deriveShift(310, 0.3));
    // more requests than distinct rotations -> collisions happen (callers
    // group by derived value, so duplicates collapse instead of double-count)
    const vals = new Set();
    for (let k = 1; k <= 1000; k++) vals.add(deriveShift(310, k / 1001));
    assert.ok(vals.size <= 295 && vals.size >= 290, `distinct rotations ${vals.size}`);
    assert.throws(() => deriveShift(18, 0.5), /too few chunks/);
  },
  async nullSamplesGroupByEffectiveShift() {
    const run = (shift, effectiveShift, edge) => ({
      trade: 'AAAUSDT',
      compare: 'BTCUSDT',
      model: 'logreg',
      view: 'full',
      shift,
      effectiveShift,
      status: 'done',
      error: null,
      metrics: { hindsightEdge: edge, edge, balancedEdge: 0, balancedAcc: 0.4 },
    });
    // real run positive; four null samples but two collapse to rotation 40
    const runs = [
      run(0, 0, 0.05),
      run(1, 40, 0.1), // beats real
      run(2, 40, 0.1), // duplicate rotation -> same sample, must not double-count
      run(3, 90, -0.02),
      run(4, 140, -0.01),
    ];
    const s = summarizeConsensus(runs);
    const a = s.pairs[0];
    assert.strictEqual(a.null.shifts, 3); // 40, 90, 140 — not 4
    assert.ok(Math.abs(a.null.exceedRate - 1 / 3) < 1e-9);
  },
  async directionalCallIgnoresTheDormantClass() {
    // P(0) can dominate outright and still never win at tau=0 — standing
    // aside only happens on ties or below-threshold confidence.
    assert.strictEqual(directionalCall({ '-1': 0.2, 0: 0.5, 1: 0.3 }, 0), 1);
    assert.strictEqual(directionalCall({ '-1': 0.3, 0: 0.5, 1: 0.2 }, 0), -1);
    assert.strictEqual(directionalCall({ '-1': 0.25, 0: 0.5, 1: 0.25 }, 0), 0); // exact tie
    assert.strictEqual(directionalCall({ '-1': 0.2, 0: 0.5, 1: 0.3 }, 0.4), 0); // under threshold
    assert.strictEqual(directionalCall({ '-1': 0.2, 0: 0.35, 1: 0.45 }, 0.4), 1); // over it
    assert.strictEqual(directionalCall({ '-1': 0.55, 0: 0.05, 1: 0.4 }, 0.5), -1);
  },
  async superGateNeedsSixOfEight() {
    assert.strictEqual(SUPER_QUORUM, 6);
    assert.strictEqual(superOf([1, 1, 1, 1, 1, 1, 0, -1]), 1); // 6 up
    assert.strictEqual(superOf([-1, -1, -1, -1, -1, -1, -1, 1]), -1); // 7 down
    assert.strictEqual(superOf([1, 1, 1, 1, 1, 0, 0, -1]), 0); // 5 up: majority vote fires, gate doesn't
    assert.strictEqual(superOf([1, 1, 1, 1, 1, -1, -1, -1]), 0); // 5-3 plurality is not conviction
    assert.strictEqual(superOf([0, 0, 0, 0, 0, 0, 0, 0]), 0);
    assert.strictEqual(superOf([1, 1, 1, 1, 1, 1, 1, 1]), 1);
    // quorum is an absolute count: 5 specs present can never clear 6
    assert.strictEqual(superOf([1, 1, 1, 1, 1], 6), 0);
  },
  async voteBookCarriesBothBooks() {
    // 8 specs, 3 periods: unanimous up / 5-3 split / 6 down.
    const col = (arr) => arr; // per-spec rows, transposed below
    const perPeriod = [
      [1, 1, 1, 1, 1, 1, 1, 1], // vote +1, super +1
      [1, 1, 1, 1, 1, -1, -1, -1], // vote +1, super 0
      [-1, -1, -1, -1, -1, -1, 0, 0], // vote -1, super -1
    ];
    const group = {
      bestConstant: 1 / 3,
      rows: [
        { week: 'p1', actual: 1, entry: 100, exit: 110 },
        { week: 'p2', actual: -1, entry: 100, exit: 90 },
        { week: 'p3', actual: -1, entry: 100, exit: 95 },
      ],
      preds: Array.from({ length: 8 }, (_, s) => perPeriod.map((p) => col(p)[s])),
    };
    const { stats, superStats, rows } = voteBook(group);
    assert.deepStrictEqual(rows.map((r) => r.vote), [1, 1, -1]);
    assert.deepStrictEqual(rows.map((r) => r.sup), [1, 0, -1]);
    // vote: +9 (long into +10%), -11 (long into -10%), +4 (short into -5%)
    assert.ok(Math.abs(stats.pnl - (9 - 11 + 4)) < 1e-9);
    assert.strictEqual(stats.trades, 3);
    // super: skips the split period entirely — fewer trades, fewer fees
    assert.ok(Math.abs(superStats.pnl - (9 + 4)) < 1e-9);
    assert.strictEqual(superStats.trades, 2);
    assert.strictEqual(superStats.wins, 2);
    // both books miss p2 (actual -1; vote said +1, super stood aside) -> 2/3 each
    assert.ok(Math.abs(stats.acc - 2 / 3) < 1e-9);
    assert.ok(Math.abs(superStats.acc - 2 / 3) < 1e-9);
  },
  async superStatsFlowIntoTheSummary() {
    const run = (shift) => ({
      trade: 'AAAUSDT',
      compare: 'BTCUSDT',
      model: 'logreg',
      view: 'full',
      shift,
      effectiveShift: shift ? shift * 10 : 0,
      status: 'done',
      error: null,
      metrics: { hindsightEdge: 0.05, edge: 0.05, balancedEdge: 0, balancedAcc: 0.4 },
    });
    const votes = {
      AAAUSDT: {
        real: {
          pnl: 12, trades: 5, wins: 3, acc: 0.5, trueEdge: 0.1, specsInVote: 8,
          super: { pnl: 8, trades: 2, wins: 2, acc: 0.55, trueEdge: 0.15, specsInVote: 8 },
          rows: [{ week: 'w1' }],
          specPreds: { 'full/logreg': [1] },
        },
        nulls: {
          10: { pnl: 20, trades: 6, acc: 0.5, trueEdge: 0.12, super: { pnl: 9, trades: 3, acc: 0.4, trueEdge: -0.01 } },
          20: { pnl: -5, trades: 4, acc: 0.3, trueEdge: -0.08, super: { pnl: -2, trades: 1, acc: 0.3, trueEdge: -0.1 } },
        },
      },
    };
    const s = summarizeConsensus([run(0), run(1), run(2)], votes);
    const a = s.pairs[0];
    assert.strictEqual(a.superVote.pnl, 8);
    assert.strictEqual(a.vote.super, undefined); // super lives in its own field
    assert.strictEqual(a.vote.specPreds, undefined); // raw preds never bloat the summary
    assert.strictEqual(a.nullVote.superShifts, 2);
    assert.ok(Math.abs(a.nullVote.superExceedPnl - 0.5) < 1e-9); // 9 >= 8, -2 < 8
    assert.ok(Math.abs(a.nullVote.superExceedEdge - 0) < 1e-9); // neither null edge beats 0.15
    // old-format votes (no super) keep working
    const old = summarizeConsensus([run(0)], { AAAUSDT: { real: { pnl: 1, trades: 1, wins: 1, rows: [] }, nulls: {} } });
    assert.strictEqual(old.pairs[0].superVote, null);
  },
  async voteRuleMatchesTheTracker() {
    // Same semantics as tracker.js voteOf: outright majority wins, ANY tie
    // for the top count stands aside.
    assert.strictEqual(voteOf([1, 1, 1, 1, 1, 0, 0, -1]), 1);
    assert.strictEqual(voteOf([-1, -1, -1, 0, 0, 1, 1, -1]), -1);
    assert.strictEqual(voteOf([1, 1, 1, 1, -1, -1, -1, -1]), 0); // 4-4 tie
    assert.strictEqual(voteOf([1, 1, 1, 0, 0, 0, -1, -1]), 0); // 3-3 top tie
    assert.strictEqual(voteOf([0, 0, 0, 0, 0, 0, 0, 0]), 0);
    assert.strictEqual(voteOf([1, 1, 1, 0, 0, -1, -1, -1]), 0); // 3-3 outer tie
    assert.strictEqual(voteOf([1, 1, 1, 1, 0, 0, 0, -1]), 1); // 4-3-1
  },
  async voteBookTradesTheVote() {
    // 4 test periods; 3 specs. Votes: +1, tie->0, -1, +1-unpriced.
    const group = {
      bestConstant: 0.5,
      rows: [
        { week: 'w1', actual: 1, entry: 100, exit: 110 }, // vote +1 -> +$9 win
        { week: 'w2', actual: 0, entry: 100, exit: 90 }, // tie -> stand aside, $0
        { week: 'w3', actual: 1, entry: 100, exit: 105 }, // vote -1 -> -$6 loss
        { week: 'w4', actual: -1, entry: null, exit: null }, // vote +1 but unpriced
      ],
      preds: [
        [1, 1, -1, 1],
        [1, 0, -1, 1],
        [1, -1, -1, 1],
      ],
    };
    const { stats, rows } = voteBook(group);
    assert.deepStrictEqual(rows.map((r) => r.vote), [1, 0, -1, 1]);
    assert.ok(Math.abs(rows[0].pnl - 9) < 1e-9); // 100*(110/100-1) - 1
    assert.strictEqual(rows[1].pnl, 0);
    assert.ok(Math.abs(rows[2].pnl + 6) < 1e-9); // short into a +5% move
    assert.strictEqual(rows[3].pnl, null);
    assert.ok(Math.abs(stats.pnl - 3) < 1e-9);
    assert.strictEqual(stats.trades, 2); // stand-aside and unpriced don't trade
    assert.strictEqual(stats.wins, 1);
    assert.strictEqual(stats.unpriced, 1);
    assert.strictEqual(stats.scored, 4);
    assert.ok(Math.abs(stats.acc - 0.5) < 1e-9); // w1 (+1=+1) and w2 (0=0)
    assert.ok(Math.abs(stats.trueEdge - 0) < 1e-9); // 0.5 acc - 0.5 bestConstant
    assert.strictEqual(stats.specsInVote, 3);
    // book P&L is per-row pnlFor, so paper economics can never drift
    assert.strictEqual(rows[0].pnl, pnlFor(1, 100, 110));
  },
  async voteStatsMergeIntoTheSummary() {
    const run = (shift, edge) => ({
      trade: 'AAAUSDT',
      compare: 'BTCUSDT',
      model: 'logreg',
      view: 'full',
      shift,
      effectiveShift: shift ? shift * 10 : 0,
      status: 'done',
      error: null,
      metrics: { hindsightEdge: edge, edge, balancedEdge: 0, balancedAcc: 0.4 },
    });
    const runs = [run(0, 0.05), run(1, 0.01), run(2, -0.01)];
    const votes = {
      AAAUSDT: {
        real: { pnl: 12, trades: 5, wins: 3, unpriced: 0, scored: 10, acc: 0.5, trueEdge: 0.1, specsInVote: 8, rows: [{ week: 'w1' }] },
        nulls: {
          10: { pnl: 20, trades: 6, wins: 4, acc: 0.5, trueEdge: 0.12, specsInVote: 8 }, // beats real on both
          20: { pnl: -5, trades: 4, wins: 1, acc: 0.3, trueEdge: -0.08, specsInVote: 8 },
        },
      },
    };
    const s = summarizeConsensus(runs, votes);
    const a = s.pairs[0];
    assert.strictEqual(a.vote.pnl, 12);
    assert.strictEqual(a.vote.rows, undefined); // rows stay on doc.votes, not in the summary
    assert.strictEqual(a.nullVote.shifts, 2);
    assert.ok(Math.abs(a.nullVote.exceedPnl - 0.5) < 1e-9);
    assert.ok(Math.abs(a.nullVote.exceedEdge - 0.5) < 1e-9);
    // without votes the fields are null and nothing breaks (old docs)
    const bare = summarizeConsensus(runs);
    assert.strictEqual(bare.pairs[0].vote, null);
    assert.strictEqual(bare.pairs[0].nullVote, null);
  },
  async consensusAggregatesPerPair() {
    const run = (trade, view, model, shift, hindsightEdge, balancedAcc = 0.4) => ({
      trade,
      compare: 'BTCUSDT',
      model,
      view,
      shift,
      status: 'done',
      error: null,
      metrics: { hindsightEdge, edge: hindsightEdge, balancedEdge: 0, balancedAcc, paperPnl: 100 * hindsightEdge },
    });
    const runs = [];
    // Pair A: 6 of 8 real specs positive; nulls (2 shifts) score 0/8 and 8/8.
    for (const v of CONSENSUS_VIEWS) {
      for (const m of CONSENSUS_MODELS) {
        const positive = !(v === 'volume'); // 6 of 8 positive
        runs.push(run('AAAUSDT', v, m, 0, positive ? 0.05 : -0.02));
        runs.push(run('AAAUSDT', v, m, 11, -0.01)); // null shift 1: all negative
        runs.push(run('AAAUSDT', v, m, 28, 0.09)); // null shift 2: all positive (beats real)
      }
    }
    // Pair B: 1 of 8 positive, no nulls.
    for (const v of CONSENSUS_VIEWS) {
      for (const m of CONSENSUS_MODELS) {
        runs.push(run('BBBUSDT', v, m, 0, v === 'cross' && m === 'logreg' ? 0.01 : -0.03));
      }
    }
    const s = summarizeConsensus(runs);
    assert.strictEqual(s.kind, 'consensus');
    assert.deepStrictEqual(s.pairs.map((p) => p.trade), ['AAAUSDT', 'BBBUSDT']); // sorted by consensus
    const a = s.pairs[0];
    assert.strictEqual(a.specs, 8);
    assert.strictEqual(a.positive, 6);
    assert.ok(Math.abs(a.fraction - 0.75) < 1e-9);
    assert.ok(a.medianTrueEdge > 0);
    // paper aggregate mirrors the edge logic: median of the specs' books +
    // the count that finished positive (fixture: pnl = 100 × edge)
    assert.ok(Math.abs(a.medianPaperPnl - 5) < 1e-9);
    assert.strictEqual(a.positivePaper, 6);
    assert.strictEqual(a.null.shifts, 2);
    assert.ok(Math.abs(a.null.exceedRate - 0.5) < 1e-9); // one of two null shifts beat the real run
    const b = s.pairs[1];
    assert.strictEqual(b.positive, 1);
    assert.strictEqual(b.null, null);
    // ranked per-spec detail excludes null-shift runs
    assert.strictEqual(s.ranked.length, 16);
    assert.ok(s.ranked.every((r) => r.view));
  },
};
