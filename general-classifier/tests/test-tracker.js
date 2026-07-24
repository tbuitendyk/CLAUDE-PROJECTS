const { assert, makeRng } = require('./helpers');
const { voteOf, pnlFor, trainSpec, predictSpec, refEdgesFromDoc, isLive, SPECS, NOTIONAL, FEE_PER_LEG } = require('../lib/tracker');
const { buildChunks, toHourlyMap } = require('../lib/dataset');

const HOUR_MS = 3_600_000;
const MON = Date.UTC(2026, 0, 5); // Monday 00:00 UTC

module.exports = {
  async pnlMath() {
    // shared source of truth: tracker re-exports lib/paper.js
    const paper = require('../lib/paper');
    assert.strictEqual(paper.pnlFor, pnlFor);
    assert.strictEqual(NOTIONAL, 100);
    assert.strictEqual(FEE_PER_LEG, 0.5);
    // long: +10% move -> $10 gross - $1 fees
    assert.ok(Math.abs(pnlFor(1, 100, 110) - 9) < 1e-9);
    // short: -10% move -> $10 gross - $1 fees
    assert.ok(Math.abs(pnlFor(-1, 100, 90) - 9) < 1e-9);
    // wrong-way long loses the move plus fees
    assert.ok(Math.abs(pnlFor(1, 100, 95) - -6) < 1e-9);
    // flat price = pure fee loss either direction
    assert.ok(Math.abs(pnlFor(1, 100, 100) - -1) < 1e-9);
    assert.ok(Math.abs(pnlFor(-1, 100, 100) - -1) < 1e-9);
    // no trade, no fees
    assert.strictEqual(pnlFor(0, 100, 137), 0);
  },
  async voteMajorityAndTies() {
    const mk = (labels) => Object.fromEntries(labels.map((l, i) => [`s${i}`, l]));
    assert.strictEqual(voteOf(mk([1, 1, 1, 1, 1, 0, -1, 0])), 1);
    assert.strictEqual(voteOf(mk([-1, -1, -1, 0, 0, 1, -1, -1])), -1);
    assert.strictEqual(voteOf(mk([1, 1, 1, 1, -1, -1, -1, -1])), 0); // tie -> stand aside
    assert.strictEqual(voteOf(mk([1, 1, 1, 0, 0, 0, -1, -1])), 0); // tie incl. zero -> stand aside
  },
  async frozenModelsRoundTripThroughJson() {
    // Train tiny specs on synthetic chunks, serialize like the tracker does
    // (JSON), reload, and demand IDENTICAL predictions.
    const rng = makeRng(23);
    const chunks = [];
    for (let i = 0; i < 80; i++) {
      const x = Array.from({ length: 44 }, () => rng() * 2 - 1);
      const gap = x[0] - x[8];
      chunks.push({ x, label: gap > 0.3 ? 1 : gap < -0.3 ? -1 : 0 });
    }
    for (const spec of [SPECS[0], SPECS[1], SPECS.find((s) => s.key === 'cross/boost')]) {
      const saved = await trainSpec(spec, chunks, () => {});
      const revived = JSON.parse(JSON.stringify(saved));
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(
          predictSpec(revived, chunks[i].x),
          predictSpec(saved, chunks[i].x),
          `${spec.key} prediction changed after JSON round-trip`
        );
      }
    }
  },
  async liveDeadlineIsThursdayNoon() {
    // TRACKER.md (amended 2026-07-23): LIVE = recorded before the outcome
    // window opens, Thu 12:00 UTC = chunk start + 252h.
    const chunkStart = Date.UTC(2026, 6, 13); // Mon Jul 13
    const thuNoon = chunkStart + 252 * 3_600_000;
    assert.strictEqual(new Date(thuNoon).getUTCDay(), 4);
    assert.strictEqual(new Date(thuNoon).getUTCHours(), 12);
    assert.ok(isLive(thuNoon - 1, chunkStart)); // 11:59:59.999 Thu -> live
    assert.ok(!isLive(thuNoon, chunkStart)); // 12:00:00 Thu -> seeded
    assert.ok(isLive(chunkStart + 200 * 3_600_000, chunkStart)); // Tue-late recording is fine now
  },
  async screenReferenceEdgesExtractAndMedian() {
    const run = (trade, view, model, shift, edge, status = 'done') => ({
      trade, view, model, shift, status,
      metrics: status === 'done' ? { hindsightEdge: edge } : null,
    });
    const doc = {
      kind: 'consensus',
      runs: [
        run('DOTUSDT', 'full', 'logreg', 0, 0.10),
        run('DOTUSDT', 'full', 'boost', 0, 0.02),
        run('DOTUSDT', 'cross', 'logreg', 0, 0.06),
        run('DOTUSDT', 'cross', 'boost', 0, -0.01),
        run('DOTUSDT', 'prices', 'logreg', 11, 0.99), // null shift: excluded
        run('DOTUSDT', 'volume', 'logreg', 0, 0.04, 'error'), // failed: excluded
        run('AVAXUSDT', 'full', 'logreg', 0, 0.5), // other pair: excluded
      ],
    };
    const ref = refEdgesFromDoc(doc, 'DOTUSDT');
    assert.deepStrictEqual(Object.keys(ref.specs).sort(), ['cross/boost', 'cross/logreg', 'full/boost', 'full/logreg']);
    assert.ok(Math.abs(ref.median - 0.04) < 1e-12); // median of [-0.01, 0.02, 0.06, 0.10]
    assert.strictEqual(refEdgesFromDoc(doc, 'NOPEUSDT'), null);
    assert.strictEqual(refEdgesFromDoc({ kind: 'screen', runs: [] }, 'DOTUSDT'), null); // pair screens don't qualify
  },
  async unlabeledTailChunksEmergeForPrediction() {
    // 10 days of data: one complete chunk (Mon->Mon) whose label windows
    // haven't happened yet. Default build drops it; prediction mode keeps it.
    const rows = [];
    for (let i = 0; i < 10 * 24; i++) {
      const ts = MON + i * HOUR_MS;
      rows.push({ ts, open: 100, high: 100, low: 100, close: 100, quoteVolume: 1 });
    }
    const map = toHourlyMap(rows);
    const dropped = buildChunks(map, map, 2);
    assert.strictEqual(dropped.chunks.length, 0);
    const kept = buildChunks(map, map, 2, 'compressed', { includeUnlabeled: true });
    assert.strictEqual(kept.chunks.length, 1);
    assert.strictEqual(kept.chunks[0].label, null);
    assert.strictEqual(kept.chunks[0].x.length, 44);
  },
};
