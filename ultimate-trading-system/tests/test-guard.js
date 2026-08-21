// The cache-write guard (owner-ordered 2026-07-31): the guarded write
// paths — Load Data, book drafts, downloading runs, downloading rotation
// quotes — refuse while a screen/sweep is reading the cache; the
// background timers (auto-refresh and the book ticks) are gated at their
// timers in server.js. lib/guard.js's header states the exact scope.
const { assert } = require('./helpers');
const { monthList, loadRefusal } = require('../lib/guard');

const CACHED = { DOTUSDT: ['2024-01', '2024-02', '2024-03'], BTCUSDT: ['2024-01', '2024-02', '2024-03'] };
const cached = (sym) => CACHED[sym] || [];
const REQ = { allLoaded: false, tradeSymbol: 'DOTUSDT', compareSymbol: 'BTCUSDT', startMonth: '2024-01', endMonth: '2024-03' };

module.exports = {
  async loadDataIsRefusedWhileAJobRuns() {
    const msg = loadRefusal('walkforward-x');
    assert.ok(msg && msg.includes('walkforward-x'), 'the refusal names the running job');
    assert.strictEqual(loadRefusal(null), null, 'no job, no refusal');
  },
  async theMonthWalkCrossesYearsAndRefusesGarbage() {
    assert.deepStrictEqual(monthList('2023-11', '2024-02'), ['2023-11', '2023-12', '2024-01', '2024-02']);
    assert.deepStrictEqual(monthList('2024-03', '2024-03'), ['2024-03']);
    assert.deepStrictEqual(monthList('garbage', '2024-01'), []);
    assert.deepStrictEqual(monthList('2024-05', '2024-01'), [], 'inverted range yields nothing');
  },
};
