const { assert } = require('./helpers');
const { permQuorumCall, permQuorumBook, PERM_REGIMES } = require('../lib/batch');
const { interlacedPurge } = require('../lib/pipeline');
const { GEOMETRIES } = require('../lib/dataset');

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

module.exports = {
  async netDirectionQuorumRule() {
    // calls at period 0 across a 5-member committee: 3 up, 2 down
    const calls = [[1], [1], [1], [-1], [-1]];
    // majority side (up, 3) trades at every rung its ABSOLUTE count reaches
    assert.strictEqual(permQuorumCall(calls, 0, 1), 1);
    assert.strictEqual(permQuorumCall(calls, 0, 3), 1);
    assert.strictEqual(permQuorumCall(calls, 0, 4), 0); // count 3 < rung 4
    // net direction wins even when BOTH sides clear the rung (k=2: 3 up, 2 down)
    assert.strictEqual(permQuorumCall(calls, 0, 2), 1);
    // ties stand aside at every rung
    const tied = [[1], [1], [-1], [-1], [0]];
    assert.strictEqual(permQuorumCall(tied, 0, 1), 0);
    assert.strictEqual(permQuorumCall(tied, 0, 2), 0);
    // stand-asides don't count toward either side
    const mixed = [[0], [0], [0], [0], [-1]];
    assert.strictEqual(permQuorumCall(mixed, 0, 1), -1);
    assert.strictEqual(permQuorumCall(mixed, 0, 2), 0);
  },
  async quorumBookPricesAtTheGivenFee() {
    // two periods: a winning long (+10% move) and a stand-aside (tie)
    const periods = [
      { actual: 1, entry: 100, exit: 110 },
      { actual: 0, entry: 100, exit: 100 },
    ];
    const callArrays = [
      [1, 1],
      [1, -1],
      [-1, 0],
    ];
    const fee = 0.125;
    const b = permQuorumBook(periods, callArrays, 1, fee);
    // period 0: 2 up vs 1 down -> long; $100 * 10% - $0.25 = $9.75
    // period 1: 1 up vs 1 down -> tie, stands aside
    assert.strictEqual(b.trades, 1);
    assert.strictEqual(b.wins, 1);
    assert.ok(Math.abs(b.pnl - 9.75) < 1e-9);
    assert.ok(Math.abs(b.grossPerTrade - 10) < 1e-9);
    // acc scores both periods: the trade was right AND the stand-aside matched actual 0
    assert.ok(Math.abs(b.acc - 1) < 1e-9);
    assert.ok(Math.abs(b.tradeHit - 1) < 1e-9);
    // unpriced periods never trade
    const b2 = permQuorumBook([{ actual: 1, entry: null, exit: null }], [[1]], 1, fee);
    assert.strictEqual(b2.trades, 0);
  },
  async regimeLabelsCoverAllFiveProtocols() {
    assert.strictEqual(PERM_REGIMES.length, 2);
    const full = PERM_REGIMES.find((r) => r.key === 'full');
    const inter = PERM_REGIMES.find((r) => r.key === 'interlaced');
    // bits are (force-all, interlaced): per-spec, force-all changes nothing
    // and the chronological meta-lens retrain IS the classic window
    assert.deepStrictEqual(full.protocols, ['classic', 'ml 0-0', 'ml 1-0']);
    assert.deepStrictEqual(inter.protocols, ['ml 0-1', 'ml 1-1']);
    const covered = [...full.protocols, ...inter.protocols];
    assert.strictEqual(new Set(covered).size, 5);
  },
  async interlacedPurgeDropsBlockTails() {
    // 98 days of daily-3d chunks = exactly two 49-day blocks; purge = 5/block
    const geo = GEOMETRIES['daily-3d'];
    const t0 = Date.UTC(2024, 0, 1);
    const chunks = Array.from({ length: 98 }, (_, i) => ({ startTs: t0 + i * DAY_MS }));
    const kept = interlacedPurge(chunks, geo);
    assert.strictEqual(kept.length, 98 - 2 * 5);
    // the last 5 chunks of each block are the ones gone
    const keptTs = new Set(kept.map((c) => c.startTs));
    for (let i = 44; i < 49; i++) assert.ok(!keptTs.has(t0 + i * DAY_MS), `block-1 tail chunk ${i} must be purged`);
    for (let i = 93; i < 98; i++) assert.ok(!keptTs.has(t0 + i * DAY_MS), `block-2 tail chunk ${i} must be purged`);
    // chronological order preserved
    for (let i = 1; i < kept.length; i++) assert.ok(kept[i].startTs > kept[i - 1].startTs);
    // weekly geometry purges 2 per block (ceil(255/168))
    const geoW = GEOMETRIES['weekly-8d'];
    const weekly = Array.from({ length: 14 }, (_, i) => ({ startTs: t0 + i * 7 * DAY_MS }));
    const keptW = interlacedPurge(weekly, geoW);
    // 14 weekly chunks span 98 days = two blocks of 7 chunks; 2 purged each
    assert.strictEqual(keptW.length, 14 - 2 * 2);
  },
};
