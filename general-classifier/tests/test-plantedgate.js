// Launch-crossing coverage for the planted-check gate (QC 69: a green suite
// over dead launchers is worthless — these drive the real entry points).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assert } = require('./helpers');
const planted = require('../lib/planted');
const batch = require('../lib/batch');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');

function censusRow(extra) {
  return {
    trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null,
    geometry: 'daily-1d', decision: 'argmax', windowLayout: 'split70',
    nullDealSeed: null, shiftFrac: null, holdPnl: null, holdAlwaysLong: null,
    ...extra,
  };
}

function gateDoc(id, engineVersion, nullBests) {
  return {
    id, kind: 'bracketlab', status: 'done',
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    params: { plantedGate: true, engineVersion, windowLayout: 'split70' },
    edgeCensus: [
      censusRow({ holdPnl: 100, holdAlwaysLong: -5 }),
      ...nullBests.map((v, i) => censusRow({ nullDealSeed: i + 1, holdPnl: v, holdAlwaysLong: -5 })),
    ],
    leaders: [],
  };
}

module.exports = {
  async spanCoversOldestToNewestOfTheRealData() {
    fs.mkdirSync(CACHE, { recursive: true });
    const files = ['REALAAUSDT-1h-1999-01.json', 'REALBBUSDT-1h-2099-01-01.json'];
    try {
      for (const f of files) fs.writeFileSync(path.join(CACHE, f), '[]');
      const span = planted.plantedSpan();
      assert.strictEqual(span.fromMonth, '1999-01', 'oldest real month wins');
      assert.strictEqual(span.toDate, '2099-01-01', 'newest real DATE wins, day files included');
    } finally {
      for (const f of files) fs.rmSync(path.join(CACHE, f), { force: true });
    }
  },
  async generatorWritesTheSpanDeterministically() {
    const span = { fromMonth: '2025-01', toDate: '2025-02-01' };
    const jan = path.join(CACHE, `${planted.PLANTED_SYMBOL}-1h-2025-01.json`);
    const feb = path.join(CACHE, `${planted.PLANTED_SYMBOL}-1h-2025-02.json`);
    try {
      const out = planted.generatePlanted(span);
      assert.strictEqual(out.days, 32);
      assert.strictEqual(out.months, 2);
      const janRows = JSON.parse(fs.readFileSync(jan, 'utf8'));
      const febRows = JSON.parse(fs.readFileSync(feb, 'utf8'));
      assert.strictEqual(janRows.length, 31 * 24, 'January complete');
      assert.strictEqual(febRows.length, 24, 'February partial: exactly the covered day');
      assert.ok(janRows.every((r) => r.open > 0 && r.high >= r.low && Number.isFinite(r.ts)), 'sane candles');
      const first = fs.readFileSync(jan, 'utf8');
      planted.generatePlanted(span);
      assert.strictEqual(fs.readFileSync(jan, 'utf8'), first, 'same span, same seed -> byte-identical');
    } finally {
      for (const f of [jan, feb]) fs.rmSync(f, { force: true });
    }
  },
  async staleMonthsDieWhenTheSpanShrinks() {
    const old = path.join(CACHE, `${planted.PLANTED_SYMBOL}-1h-2030-12.json`);
    const jan = path.join(CACHE, `${planted.PLANTED_SYMBOL}-1h-2025-01.json`);
    try {
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(old, '[]');
      planted.generatePlanted({ fromMonth: '2025-01', toDate: '2025-01-05' });
      assert.ok(!fs.existsSync(old), 'a fabricated month outliving the real data is a lie about coverage');
    } finally {
      for (const f of [old, jan]) fs.rmSync(f, { force: true });
    }
  },
  async theReservedPairIsRefusedInRealRuns() {
    let err = null;
    try {
      batch.startBracketLab({
        universe: [planted.PLANTED_SYMBOL, 'DOTUSDT'], sizes: { singles: true },
        allLoaded: true, windowLayout: 'split70',
      });
    } catch (e) { err = e; }
    assert.ok(err, 'must refuse');
    assert.ok(/reserved fabricated pair/.test(err.message), `wrong refusal: ${err.message}`);
  },
  async aGateRunSweepsExactlyTheReservedPair() {
    let err = null;
    try {
      batch.startBracketLab({
        universe: ['DOTUSDT'], sizes: { singles: true },
        allLoaded: true, windowLayout: 'split70', plantedGate: true,
      });
    } catch (e) { err = e; }
    assert.ok(err, 'must refuse');
    assert.ok(/exactly \[PLANTEDUSDT\]/.test(err.message), `wrong refusal: ${err.message}`);
  },
  async historyTuningRefusesThePlantedCalibration() {
    fs.mkdirSync(BATCH_DIR, { recursive: true });
    const doc = gateDoc('bracketlab-20990101-0004-planted-gate-t8', '1.33.0', [1]);
    const file = path.join(BATCH_DIR, `${doc.id}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(doc));
      let err = null;
      try {
        await batch.startHistoryTuning({
          sourceBatchId: doc.id,
          combo: { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 },
          branch: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
          declaredCell: { quorum: 3, gate: 'directional', entry: 'breakout', dMult: 1, tHours: 41, bandPct: 1.1 },
        });
      } catch (e) { err = e; }
      assert.ok(err, 'must refuse');
      assert.ok(/planted check/.test(err.message), `wrong refusal: ${err.message}`);
    } finally {
      fs.rmSync(file, { force: true });
    }
  },
  async theVerdictAppliesTheStampedRules() {
    // PASS: plant found (+$100), beats always-long (-$5), every null board
    // best below the quarter-line ($25).
    const pass = planted.gateVerdict(gateDoc('g1', '1.33.0', [10, 5, -3, 20]));
    assert.strictEqual(pass.pass, true, pass.sentences.join(' | '));
    // FAIL: one null board at $30 crosses the quarter-line — the nulls did
    // not destroy the planted money, so the instrument is not measuring
    // information.
    const fail = planted.gateVerdict(gateDoc('g2', '1.33.0', [10, 30, -3, 20]));
    assert.strictEqual(fail.pass, false);
    assert.ok(fail.sentences.some((s) => /FAIL G3/.test(s)), fail.sentences.join(' | '));
    // Unreadable always-long counts as failed, never as passed.
    const doc = gateDoc('g3', '1.33.0', [1, 1, 1, 1]);
    doc.edgeCensus[0].holdAlwaysLong = null;
    const noLong = planted.gateVerdict(doc);
    assert.strictEqual(noLong.pass, false);
    assert.ok(noLong.sentences.some((s) => /unreadable counts as failed/.test(s)));
  },
  async aPassBelongsToItsEngineVersionOnly() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-gate-'));
    try {
      fs.writeFileSync(path.join(dir, 'bracketlab-20990101-0005-planted-gate.json'),
        JSON.stringify(gateDoc('bracketlab-20990101-0005-planted-gate', '9.9.8', [1, 2, 3, 4])));
      const same = planted.gateStatus('9.9.8', dir);
      assert.strictEqual(same.state, 'PASS');
      const newer = planted.gateStatus('9.9.9', dir);
      assert.strictEqual(newer.state, 'NOT CHECKED', 'a new engine is a new instrument');
      assert.ok(/9\.9\.8/.test(newer.detail), 'the old PASS is named, not hidden');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};
