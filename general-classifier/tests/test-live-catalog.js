// Data catalog + repair (plan phase 7). Pure catalog logic on synthetic
// setups + a stubbed cache; repair is exercised against a fake fetcher so no
// network and no real cache writes.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GC_SETUPS_DIR = process.env.GC_SETUPS_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cat-'));

const binance = require('../lib/binance');
const cat = require('../lib/live/catalog');

function setup(id, trade, ctx1, ctx2, state = 'live') {
  return { id, state, configSnapshot: { combo: { trade, ctx1, ctx2, size: 3 } } };
}

module.exports.monthsBetweenIsInclusiveAndRollsYears = function () {
  assert.deepStrictEqual(cat.monthsBetween('2025-11', '2026-02'),
    ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepStrictEqual(cat.monthsBetween('2026-03', '2026-03'), ['2026-03']);
};

module.exports.requiredPairsUnionsActiveSetupsOnly = function () {
  const pairs = cat.requiredPairs([
    setup('a', 'LTCUSDT', 'XRPUSDT', 'BCHUSDT', 'live'),
    setup('b', 'XLMUSDT', 'DOTUSDT', 'TRXUSDT', 'paper'),
    setup('c', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'draft'),   // draft -> excluded
    setup('d', 'LTCUSDT', 'XRPUSDT', 'BCHUSDT', 'stopped'), // stopped -> excluded
  ]);
  assert.deepStrictEqual(pairs,
    ['BCHUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'XLMUSDT', 'XRPUSDT']);
};

module.exports.catalogFlagsMissingMonthsAgainstCoverage = function () {
  const orig = binance.coveredMonths;
  binance.coveredMonths = (sym) => (sym === 'AAAUSDT'
    ? ['2026-01', '2026-02', '2026-04']   // 2026-03 missing
    : []);                                 // BBBUSDT: no data at all
  try {
    const now = Date.UTC(2026, 3, 15); // 2026-04
    const c = cat.buildCatalog(now, [setup('s', 'AAAUSDT', 'BBBUSDT', null)]);
    const aaa = c.entries.find((e) => e.symbol === 'AAAUSDT');
    assert.deepStrictEqual(aaa.required, ['2026-01', '2026-02', '2026-03', '2026-04']);
    assert.deepStrictEqual(aaa.missing, ['2026-03'], 'the gap is flagged');
    const bbb = c.entries.find((e) => e.symbol === 'BBBUSDT');
    assert.ok(/no data/.test(bbb.note), 'a pair with no data is surfaced, not silently ok');
    assert.strictEqual(c.ok, false, 'a missing month makes the catalog not-ok');
  } finally { binance.coveredMonths = orig; }
};

module.exports.repairFetchesMissingMonthsExceptTheCurrentPartial = async function () {
  const origCovered = binance.coveredMonths;
  const origMonthly = binance.monthlyKlines;
  const asked = [];
  binance.coveredMonths = () => ['2026-01', '2026-04']; // 02,03 missing; 04 = current partial
  binance.monthlyKlines = async (sym, y, m) => { asked.push(`${sym} ${y}-${String(m).padStart(2, '0')}`); return [{}]; };
  try {
    const now = Date.UTC(2026, 3, 10); // 2026-04 is the current month
    const out = await cat.repair(now, { setups: [setup('s', 'AAAUSDT', null, null)] });
    // 2026-02 and 2026-03 fetched; 2026-04 (current partial) NOT bundled
    assert.deepStrictEqual(asked.sort(), ['AAAUSDT 2026-02', 'AAAUSDT 2026-03']);
    assert.deepStrictEqual(out.fetched.sort(), ['AAAUSDT 2026-02', 'AAAUSDT 2026-03']);
    assert.strictEqual(out.failed.length, 0);
  } finally { binance.coveredMonths = origCovered; binance.monthlyKlines = origMonthly; }
};

module.exports.repairReportsFetchFailuresWithoutThrowing = async function () {
  const origCovered = binance.coveredMonths;
  const origMonthly = binance.monthlyKlines;
  binance.coveredMonths = () => ['2026-01', '2026-04'];
  binance.monthlyKlines = async () => { throw new Error('portal 404'); };
  try {
    const now = Date.UTC(2026, 3, 10);
    const out = await cat.repair(now, { setups: [setup('s', 'AAAUSDT', null, null)] });
    assert.strictEqual(out.fetched.length, 0);
    assert.ok(out.failed.length >= 1 && /portal 404/.test(out.failed[0].error),
      'a failed fetch is reported, not thrown');
  } finally { binance.coveredMonths = origCovered; binance.monthlyKlines = origMonthly; }
};
