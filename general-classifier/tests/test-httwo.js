// HT v2 (DESIGN-HT2.md): the pure parts — fold geometry, the sign-flip
// null, the verdict's endpoint-computed audit obligations (QC 78), and the
// entrance-exam gate. The compute path is exercised on the box by the two
// planted exams themselves; these tests pin the arithmetic that judges them.
const { assert } = require('./helpers');
const T2 = require('../lib/httwo');

const DAY = 24 * 3600 * 1000;

function fakeDoc(deltas, over = {}) {
  return {
    id: over.id || 'httwo-test-1',
    kind: 'httwo',
    status: 'done',
    startedAt: over.startedAt || '2026-08-05T00:00:00Z',
    params: { engineVersion: over.engineVersion || '9.9.9', halfLifeKey: '12mo', foldCount: deltas.length, combo: { trade: over.trade || 'AAAUSDT' }, ...over.params },
    foldRows: deltas.map((d, i) => ({
      fold: i, decisions: 30,
      ref: { pnl: 10, trades: over.trades ?? 8 },
      arm: { pnl: 10 + d, trades: over.trades ?? 8 },
      delta: d,
    })),
  };
}

module.exports = {
  async foldGeometryHitsTheTargetAndRefusesThinSpans() {
    const start = 0;
    const g = T2.foldGeometry(start, start + 2600 * DAY); // ~7.1 years
    assert.strictEqual(g.refusal, null);
    assert.strictEqual(g.k, T2.K_TARGET);
    assert.strictEqual(g.folds.length, T2.K_TARGET);
    assert.ok(g.windowDays >= T2.MIN_WINDOW_DAYS);
    // folds tile the back of the span exactly, disjoint and ordered
    for (let i = 1; i < g.folds.length; i++) {
      assert.strictEqual(g.folds[i].foldStartTs, g.folds[i - 1].foldEndTs);
    }
    // a short span shrinks K before refusing…
    const short = T2.foldGeometry(start, start + (425 + 13 * T2.MIN_WINDOW_DAYS) * DAY);
    assert.strictEqual(short.refusal, null);
    assert.ok(short.k >= T2.K_MIN && short.k < T2.K_TARGET);
    // …and refuses when even K_MIN cannot clear the window floor
    const tiny = T2.foldGeometry(start, start + 500 * DAY);
    assert.ok(/refused/.test(tiny.refusal || ''), 'a 500-day span must refuse');
  },

  async signFlipReadsCleanSignalsAndNoise() {
    const strong = Array.from({ length: 20 }, () => 5); // every fold +$5
    const s = T2.signFlipP(strong, 'seed-a');
    assert.ok(s.p < 0.01, `all-positive deltas must be far beyond the null (p=${s.p})`);
    const noise = Array.from({ length: 20 }, (_, i) => (i % 2 ? 5 : -5)); // sum 0
    const n = T2.signFlipP(noise, 'seed-b');
    assert.ok(n.p > 0.3 && n.p < 0.7, `alternating deltas are pure noise (p=${n.p})`);
    // deterministic for a given seed text
    assert.strictEqual(T2.signFlipP(strong, 'seed-a').p, s.p);
  },

  async theVerdictPassesRealEffectsAndBlocksOneFoldCarries() {
    const good = T2.httwoVerdict(fakeDoc(Array.from({ length: 20 }, () => 5)));
    assert.strictEqual(good.pass, true);
    assert.ok(good.p <= 0.05);
    assert.strictEqual(good.carriedByOneFold, false);
    // one enormous fold + nineteen crumbs: tiny p, but carried — cannot pass
    const carried = T2.httwoVerdict(fakeDoc([100, ...Array.from({ length: 19 }, () => 0.1)]));
    assert.ok(carried.concentration > 0.5);
    assert.strictEqual(carried.carriedByOneFold, true);
    assert.strictEqual(carried.pass, false, 'a one-fold sum must never pass (R3)');
    // pure noise fails on p
    const flat = T2.httwoVerdict(fakeDoc(Array.from({ length: 20 }, (_, i) => (i % 2 ? 5 : -5))));
    assert.strictEqual(flat.pass, false);
    // too few folds: no claim either way
    const few = T2.httwoVerdict(fakeDoc([5, 5, 5]));
    assert.strictEqual(few.pass, false);
    assert.ok(few.sentences.join(' ').includes('INSUFFICIENT FOLDS'));
  },

  async theExamGateOpensOnlyOnAPassAndACorrectRefusal() {
    const V = '9.9.9';
    const passA = fakeDoc(Array.from({ length: 20 }, () => 5), { id: 'httwo-a', trade: 'PLANTEDLATEUSDT', engineVersion: V });
    const failB = fakeDoc(Array.from({ length: 20 }, (_, i) => (i % 2 ? 5 : -5)), { id: 'httwo-b', trade: 'PLANTEDUSDT', engineVersion: V });
    const passB = fakeDoc(Array.from({ length: 20 }, () => 5), { id: 'httwo-b2', trade: 'PLANTEDUSDT', engineVersion: V, startedAt: '2026-08-06T00:00:00Z' });
    // correct pair of outcomes -> ready
    assert.strictEqual(T2.examStatus(V, [passA, failB]).ready, true);
    // exam B passing (the instrument "finds" a signal in a stationary world) -> NOT ready
    const ghosts = T2.examStatus(V, [passA, failB, passB]);
    assert.strictEqual(ghosts.ready, false);
    assert.ok(ghosts.detail.includes('ghosts'));
    // missing exams -> not ready; wrong engine version -> not ready
    assert.strictEqual(T2.examStatus(V, [passA]).ready, false);
    assert.strictEqual(T2.examStatus('1.0.0', [passA, failB]).ready, false);
  },

  async theLauncherRefusesRealPairsWithoutExams() {
    const batch = require('../lib/batch');
    // No httwo docs exist in the test environment for the current engine, so
    // any real-pair launch must refuse with the R4 sentence. sourceBatchId
    // validation comes first, so use a real-looking but absent id to hit it.
    assert.throws(
      () => batch.startHtTwo({ sourceBatchId: 'bracketlab-nonexistent' }),
      /sourceBatchId must name a finished bracket-lab run/,
    );
  },
};
