const { assert } = require('./helpers');
const { FEATURE_NAMES, viewIndices } = require('../lib/features');
const { summarizeConsensus, CONSENSUS_VIEWS, CONSENSUS_MODELS } = require('../lib/batch');

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
  async consensusAggregatesPerPair() {
    const run = (trade, view, model, shift, hindsightEdge, balancedAcc = 0.4) => ({
      trade,
      compare: 'BTCUSDT',
      model,
      view,
      shift,
      status: 'done',
      error: null,
      metrics: { hindsightEdge, edge: hindsightEdge, balancedEdge: 0, balancedAcc },
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
