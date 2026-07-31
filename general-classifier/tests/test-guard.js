// The cache-write guard (owner-ordered 2026-07-31): while a screen/sweep
// runs, nothing may write the candle cache its workers are reading. Load
// Data always writes; a single run writes only when months are missing.
const { assert } = require('./helpers');
const { monthList, loadRefusal, runRefusal } = require('../lib/guard');

const CACHED = { DOTUSDT: ['2024-01', '2024-02', '2024-03'], BTCUSDT: ['2024-01', '2024-02', '2024-03'] };
const cached = (sym) => CACHED[sym] || [];
const REQ = { allLoaded: false, tradeSymbol: 'DOTUSDT', compareSymbol: 'BTCUSDT', startMonth: '2024-01', endMonth: '2024-03' };

module.exports = {
  async loadDataIsRefusedWhileAJobRuns() {
    const msg = loadRefusal('walkforward-x');
    assert.ok(msg && msg.includes('walkforward-x'), 'the refusal names the running job');
    assert.strictEqual(loadRefusal(null), null, 'no job, no refusal');
  },
  async aRunThatWouldDownloadIsRefusedButCachedRunsPass() {
    // fully cached range: read-only, allowed even mid-job
    assert.strictEqual(runRefusal('walkforward-x', REQ, cached), null);
    // a month is missing: the run would write the cache — refused, naming
    // the job and the months
    const msg = runRefusal('walkforward-x', { ...REQ, endMonth: '2024-05' }, cached);
    assert.ok(msg && msg.includes('walkforward-x') && msg.includes('2024-04'), `refusal names job and month: ${msg}`);
    // "all loaded data" fetches nothing, allowed regardless of ranges
    assert.strictEqual(runRefusal('walkforward-x', { ...REQ, allLoaded: true, endMonth: '2024-09' }, cached), null);
    // no job running: everything passes
    assert.strictEqual(runRefusal(null, { ...REQ, endMonth: '2024-05' }, cached), null);
  },
  async theMonthWalkCrossesYearsAndRefusesGarbage() {
    assert.deepStrictEqual(monthList('2023-11', '2024-02'), ['2023-11', '2023-12', '2024-01', '2024-02']);
    assert.deepStrictEqual(monthList('2024-03', '2024-03'), ['2024-03']);
    assert.deepStrictEqual(monthList('garbage', '2024-01'), []);
    assert.deepStrictEqual(monthList('2024-05', '2024-01'), [], 'inverted range yields nothing');
  },
};
