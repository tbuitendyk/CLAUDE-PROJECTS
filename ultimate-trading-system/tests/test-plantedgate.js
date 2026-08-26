// Launch-crossing coverage for the planted-check gate (QC 69: a green suite
// over dead launchers is worthless — these drive the real entry points).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assert } = require('./helpers');
const planted = require('../lib/planted');
const batch = require('../lib/batch');
const rowstore = require('../lib/rowstore');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');
const RECORD_DIR = path.join(__dirname, '..', 'data', 'gate-records');

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
    params: { plantedGate: true, engineVersion, windowLayout: 'split70', labelShiftReps: nullBests.length },
    failures: [],
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
    // THE BOUNDARY: a null board landing exactly ON the quarter-line fails —
    // the rule is "below", and a sign slip (< vs <=) must not survive.
    const onLine = planted.gateVerdict(gateDoc('g4', '1.33.0', [25, 1, 1, 1]));
    assert.strictEqual(onLine.pass, false, 'exactly the quarter-line is NOT below it');
    // A shrunken population fails: three boards scored where four were
    // declared reads as a pass earned on fewer draws than stamped.
    const shrunk = gateDoc('g5', '1.33.0', [1, 1, 1]);
    shrunk.params.labelShiftReps = 4;
    assert.strictEqual(planted.gateVerdict(shrunk).pass, false);
    // Zero null boards can never pass.
    assert.strictEqual(planted.gateVerdict(gateDoc('g6', '1.33.0', [])).pass, false);
    // Recorded unit failures fail the calibration outright.
    const withFailures = gateDoc('g7', '1.33.0', [1, 1, 1, 1]);
    withFailures.failures = [{ key: 'x', error: 'boom' }];
    const fv = planted.gateVerdict(withFailures);
    assert.strictEqual(fv.pass, false);
    assert.ok(fv.sentences.some((s) => /FAIL G4/.test(s)));
  },
  async staleDayFilesInsideABundledMonthDoNotShrinkTheSpan() {
    // Review 2026-08-03: a leftover day file inside the newest BUNDLED month
    // made cacheState's `to` read '…-07-15' while the bundle covers July 31 —
    // the fabricated pair would then trail the real data it mirrors.
    fs.mkdirSync(CACHE, { recursive: true });
    const files = ['REALCCUSDT-1h-2099-01.json', 'REALCCUSDT-1h-2099-01-15.json'];
    try {
      for (const f of files) fs.writeFileSync(path.join(CACHE, f), '[]');
      assert.strictEqual(planted.plantedSpan().toDate, '2099-01-31', 'the bundle\'s full month wins over its stale day file');
    } finally {
      for (const f of files) fs.rmSync(path.join(CACHE, f), { force: true });
    }
  },
  // THE PRIMARY PATH: the verdict is written when the gate run STOPS, not when
  // somebody deletes it. Every save of a stopped gate run keeps it — which is
  // why a run that ends by being interrupted or by erroring is recorded too,
  // and why the delete only has to cover gate runs that finished before any of
  // this existed. Driven through setBatchNotes because that is a real exported
  // caller of the save.
  async savingAStoppedGateRunKeepsItsVerdict() {
    const doc = gateDoc('bracketlab-20990303-0001-planted-gate', '9.9.2', [1, 2, 3, 4]);
    const file = path.join(BATCH_DIR, `${doc.id}.json`);
    const rec = path.join(RECORD_DIR, `${doc.id}.json`);
    try {
      fs.mkdirSync(BATCH_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      assert.ok(!fs.existsSync(rec), 'nothing kept yet — the file was put there behind the save');
      batch.setBatchNotes(doc.id, 'a note');
      assert.ok(fs.existsSync(rec), 'saving a stopped gate run must keep its verdict');
      assert.strictEqual(JSON.parse(fs.readFileSync(rec, 'utf8')).pass, true);
      assert.strictEqual(JSON.parse(fs.readFileSync(rec, 'utf8')).runDeleted, false,
        'the run is still on the box, so nothing says it is gone');
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(rec, { force: true });
    }
  },

  // THE VERDICT OUTLIVES THE RUN (owner, 2026-08-22): "if i delete a planted
  // check saved run on Boards then the planted check status goes away. the
  // status should be persisted even if i choose to delete the run from the
  // list."
  //
  // Driven through the REAL delete, not through recordGate — the defect was
  // that the status came from the same file the delete button removes, so a
  // test that never presses delete cannot see it.
  async deletingAGateRunKeepsItsVerdict() {
    const doc = gateDoc('bracketlab-20990301-0001-planted-gate', '9.9.7', [1, 2, 3, 4]);
    const file = path.join(BATCH_DIR, `${doc.id}.json`);
    const rec = path.join(RECORD_DIR, `${doc.id}.json`);
    try {
      fs.mkdirSync(BATCH_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const out = batch.deleteBatch(doc.id);
      assert.strictEqual(out.removed.plantedCheckVerdictKept, true,
        'the delete must report that the verdict was kept — the owner is told what survives');
      assert.ok(!fs.existsSync(file), 'the run itself really is gone');
      assert.ok(fs.existsSync(rec), 'the verdict went away with the run');
      const kept = JSON.parse(fs.readFileSync(rec, 'utf8'));
      assert.strictEqual(kept.pass, true, 'a PASS must still read as a PASS after the run is deleted');
      assert.strictEqual(kept.engineVersion, '9.9.7', 'the kept verdict names the engine it judged');
      assert.strictEqual(kept.runDeleted, true, 'and it says the rows behind it are gone');
      assert.ok(kept.sentences.some((x) => /PLANTED CHECK PASS/.test(x)), 'the reasons are kept, not just the flag');
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(rec, { force: true });
    }
  },

  // THE ROWS ARE READ BEFORE THEY ARE DESTROYED. Building the verdict means
  // reading the run's board, so a delete that removed the rows first would
  // keep "UNREADABLE" — the fault this change exists to fix, in a smaller
  // shape. This run's rows live only in the row store, which is where a real
  // run's rows live.
  async theVerdictIsTakenWhileTheRowsAreStillThere() {
    const doc = gateDoc('bracketlab-20990302-0001-planted-gate', '9.9.6', [1, 2, 3, 4]);
    const rows = doc.edgeCensus;
    delete doc.edgeCensus;                       // nothing inline: the store is the only copy
    const file = path.join(BATCH_DIR, `${doc.id}.json`);
    const rec = path.join(RECORD_DIR, `${doc.id}.json`);
    try {
      fs.mkdirSync(BATCH_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(doc.id, 'census');
      for (const r of rows) w.push(r);
      w.close();
      assert.ok(rowstore.exists(doc.id, 'census'), 'the rows are in the store to begin with');

      batch.deleteBatch(doc.id);
      const kept = JSON.parse(fs.readFileSync(rec, 'utf8'));
      assert.strictEqual(kept.pass, true,
        `the verdict was taken after the rows went: ${kept.sentences.join(' | ')}`);
      assert.ok(!kept.sentences.some((x) => /UNREADABLE/.test(x)),
        'an unreadable verdict must never be the thing that gets kept');
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(rec, { force: true });
      rowstore.remove(doc.id);
    }
  },

  // THE VERDICT READS ROWS THE DOCUMENT ONLY COUNTS (owner order, 2026-08-26:
  // "fix all"). Since the rows moved to disk, a finished run's document
  // carries counts, not rows — and the two readers that took documents at
  // face value (the completion-time record, the strip's re-read of runs on
  // disk) called a healthy gate UNREADABLE, which counts as FAIL. The owner's
  // gate of 2026-08-25 failed exactly this way: +$293.92 real, every copy
  // negative, verdict "no real (unscrambled) money rows".
  async theVerdictReadsRowsTheDocumentOnlyCounts() {
    const doc = gateDoc(`bracketlab-20990401-${process.pid}-planted-gate`, '9.9.4', [1, 2, 3, 4]);
    const rows = doc.edgeCensus;
    delete doc.edgeCensus;                       // the document counts, the store holds
    const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-runs-'));
    const recs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-recs-'));
    try {
      const w = rowstore.writer(doc.id, 'census');
      for (const r of rows) w.push(r);
      w.close();
      // the reader a bare document reaches — recordGate at completion
      const v = planted.gateVerdict(doc);
      assert.ok(!v.sentences.some((x) => /UNREADABLE/.test(x)),
        `a healthy gate whose rows live in the store read as unreadable: ${v.sentences.join(' | ')}`);
      assert.strictEqual(v.pass, true, 'and it is the pass the rows plainly are');
      // the reader the strip reaches — a raw file parse of the run on disk
      fs.writeFileSync(path.join(runs, `${doc.id}.json`), JSON.stringify(doc));
      const strip = planted.gateStatus('9.9.4', runs, recs);
      assert.strictEqual(strip.state, 'PASS',
        `the strip re-read the run from disk and said ${strip.state}: ${strip.detail}`);
    } finally {
      rowstore.remove(doc.id);
      fs.rmSync(runs, { recursive: true, force: true });
      fs.rmSync(recs, { recursive: true, force: true });
    }
  },

  // A verdict kept by the reader that could not see stored rows is retaken
  // while the rows still exist — trusted, it would hold its wrong FAIL until
  // deletion. The retake happens inside recordGate, so every caller heals it:
  // the next save, the delete, and the boot sweep.
  async aKeptVerdictFromTheOldReaderIsRetakenWhileTheRowsExist() {
    const doc = gateDoc(`bracketlab-20990402-${process.pid}-planted-gate`, '9.9.3', [1, 2, 3, 4]);
    const rows = doc.edgeCensus;
    delete doc.edgeCensus;
    const recs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-recs-'));
    try {
      const w = rowstore.writer(doc.id, 'census');
      for (const r of rows) w.push(r);
      w.close();
      fs.writeFileSync(path.join(recs, `${doc.id}.json`), JSON.stringify({
        id: doc.id, engineVersion: '9.9.3', status: 'done',
        startedAt: doc.startedAt, finishedAt: doc.finishedAt,
        pass: false, checks: [], sentences: [`UNREADABLE: ${doc.id} has no real (unscrambled) money rows`],
        recordedAt: doc.finishedAt, runDeleted: false, deletedAt: null,
      }));
      const rec = planted.recordGate(doc, recs);
      assert.strictEqual(rec.pass, true, 'the wrong FAIL was trusted instead of retaken');
      assert.ok(!rec.sentences.some((x) => /UNREADABLE/.test(x)), 'the unreadable sentence survived the retake');
      const onDisk = JSON.parse(fs.readFileSync(path.join(recs, `${doc.id}.json`), 'utf8'));
      assert.strictEqual(onDisk.pass, true, 'the retaken verdict reached the kept file');
      // and a record the CURRENT reader wrote is one comparison, no work
      const again = planted.recordGate(doc, recs);
      assert.strictEqual(again.recordedAt, rec.recordedAt,
        'a current-reader record was rebuilt on an ordinary save — the cheap comparison is gone');
    } finally {
      rowstore.remove(doc.id);
      fs.rmSync(recs, { recursive: true, force: true });
    }
  },

  // A record whose run is deleted is never retaken, whatever reader wrote it:
  // its rows are gone, so a retake could only manufacture the UNREADABLE the
  // kept record exists to outlive.
  async aDeletedRunsVerdictIsNeverRetaken() {
    const doc = gateDoc(`bracketlab-20990403-${process.pid}-planted-gate`, '9.9.2', [1]);
    delete doc.edgeCensus;                       // no rows anywhere: they are gone
    const recs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-recs-'));
    try {
      fs.writeFileSync(path.join(recs, `${doc.id}.json`), JSON.stringify({
        id: doc.id, engineVersion: '9.9.2', status: 'done',
        startedAt: doc.startedAt, finishedAt: doc.finishedAt,
        pass: true, checks: [], sentences: ['PLANTED CHECK PASS on engine 9.9.2: kept'],
        recordedAt: doc.finishedAt, runDeleted: true, deletedAt: doc.finishedAt,
      }));
      const rec = planted.recordGate(doc, recs);
      assert.strictEqual(rec.pass, true, 'a deleted run\'s kept PASS was retaken into a manufactured failure');
      assert.strictEqual(rec.recordedAt, doc.finishedAt, 'the kept record was rewritten');
    } finally {
      fs.rmSync(recs, { recursive: true, force: true });
    }
  },

  // The boot sweep is the third healer: a stale-reader record left by an old
  // service heals the moment the new one starts, not when somebody edits
  // notes or deletes the run. Source-pinned the same way the completion hook
  // is — the sweep runs at module load, which a test cannot re-run.
  theBootSweepRetakesStaleGateRecords() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    const sweep = src.slice(0, src.indexOf('let saveSeq'));
    assert.ok(/plantedGate/.test(sweep) && /recordGate\(hydrate\(doc\)\)/.test(sweep),
      'the boot sweep no longer retakes gate records — a wrong kept verdict waits for a save or a delete');
  },

  // What the badge at the top of the page reads once the run is gone.
  async theStatusIsReadFromTheKeptVerdictWhenTheRunIsGone() {
    const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-gate-'));
    const recs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-recs-'));
    try {
      fs.writeFileSync(path.join(recs, 'bracketlab-20990101-0007-planted-gate.json'), JSON.stringify({
        id: 'bracketlab-20990101-0007-planted-gate', engineVersion: '9.9.5', status: 'done',
        startedAt: '2099-01-01T00:00:00.000Z', finishedAt: '2099-01-01T00:10:00.000Z',
        pass: true, checks: [], sentences: ['PLANTED CHECK PASS on engine 9.9.5'], runDeleted: true,
      }));
      const s = planted.gateStatus('9.9.5', runs, recs);
      assert.strictEqual(s.state, 'PASS', 'no run on disk, and the check still stands');
      assert.strictEqual(s.lastGate.runDeleted, true, 'the page can say the run is not openable');
      assert.ok(/deleted/.test(s.detail), `the detail must say so plainly: ${s.detail}`);
      assert.strictEqual(planted.gateStatus('9.9.6', runs, recs).state, 'NOT CHECKED',
        'a kept verdict still belongs to its own engine version only');
    } finally {
      fs.rmSync(runs, { recursive: true, force: true });
      fs.rmSync(recs, { recursive: true, force: true });
    }
  },

  // A RUN THAT IS STILL HERE IS READ AGAIN. The kept record is a fallback for
  // rows that no longer exist, never a cache that shadows rows that do — a
  // change to the reading rules has to reach every run it still can.
  async aRunStillOnDiskIsReadFromItsRowsNotFromTheRecord() {
    const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-gate-'));
    const recs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-recs-'));
    const id = 'bracketlab-20990101-0008-planted-gate';
    try {
      // On disk: a null board at $30, over the quarter-line, so it FAILS.
      fs.writeFileSync(path.join(runs, `${id}.json`), JSON.stringify(gateDoc(id, '9.9.4', [10, 30, -3, 20])));
      // Kept: a stale PASS for the same run.
      fs.writeFileSync(path.join(recs, `${id}.json`), JSON.stringify({
        id, engineVersion: '9.9.4', status: 'done', startedAt: '2099-01-01T00:00:00.000Z',
        finishedAt: '2099-01-01T00:10:00.000Z', pass: true, checks: [], sentences: ['stale PASS'], runDeleted: false,
      }));
      const s = planted.gateStatus('9.9.4', runs, recs);
      assert.strictEqual(s.state, 'FAIL', 'the rows on disk win over the record taken from them');
      assert.ok(!s.lastGate.sentences.some((x) => /stale PASS/.test(x)), 'and the stale sentences are not shown');
    } finally {
      fs.rmSync(runs, { recursive: true, force: true });
      fs.rmSync(recs, { recursive: true, force: true });
    }
  },

  // Nothing else gets a record, and nothing gets one before it has stopped.
  async onlyTheGateIsRecordedAndOnlyOnceItHasStopped() {
    const recs = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-recs-'));
    try {
      const ordinary = gateDoc('bracketlab-20990101-0009-ordinary', '9.9.3', [1, 2, 3, 4]);
      ordinary.params.plantedGate = false;
      assert.strictEqual(planted.recordGate(ordinary, recs), null, 'an ordinary sweep is not a calibration');

      const going = gateDoc('bracketlab-20990101-0010-planted-gate', '9.9.3', [1, 2, 3, 4]);
      going.status = 'running';
      assert.strictEqual(planted.recordGate(going, recs), null, 'a running gate has no verdict yet');

      const done = gateDoc('bracketlab-20990101-0011-planted-gate', '9.9.3', [1, 2, 3, 4]);
      const first = planted.recordGate(done, recs);
      assert.strictEqual(first.pass, true);
      assert.strictEqual(first.runDeleted, false, 'the run is still there at this point');
      // Saving again must not re-read the board: same status, same finish time.
      const again = planted.recordGate(done, recs);
      assert.strictEqual(again.recordedAt, first.recordedAt, 'an unchanged run is not re-read on every save');
      assert.strictEqual(fs.readdirSync(recs).length, 1, 'one run, one record');
    } finally {
      fs.rmSync(recs, { recursive: true, force: true });
    }
  },

  async anUnreadableNewestGateRecordBlocksOlderVerdicts() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planted-gate-'));
    try {
      fs.writeFileSync(path.join(dir, 'bracketlab-20990101-0006-planted-gate.json'),
        JSON.stringify(gateDoc('bracketlab-20990101-0006-planted-gate', '9.9.8', [1, 2, 3, 4])));
      fs.writeFileSync(path.join(dir, 'bracketlab-20990102-0000-planted-gate.json'), '{ torn json');
      const s = planted.gateStatus('9.9.8', dir);
      assert.strictEqual(s.state, 'NOT CHECKED', 'an older PASS must not shadow an unreadable newer record');
      assert.ok(/unreadable/.test(s.detail));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
