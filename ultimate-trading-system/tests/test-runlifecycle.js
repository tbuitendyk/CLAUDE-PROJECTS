// A RUN THAT STOPS MUST SAY SO, AND A RUN THAT IS FINISHED WITH MUST BE
// REMOVABLE (owner, 2026-08-22).
//
// What happened: the owner started their first wide sweep — 123,624 units, 100
// null boards — pressed the theme button, and came back to an empty form. A few
// minutes later the job was gone. The Sweep section said "No job running.",
// which is the same thing it says when nothing was ever started.
//
// The service had died of a full JavaScript heap, five minutes in, 316 units
// through. Two things put it there and both are fixed here:
//
//   * pool.map keeps every worker result until the run ends. Every long-job
//     caller in this codebase streams its results through onSettled and never
//     looks at the array — so all six were holding one result per unit that
//     nothing would ever read. pool.forEach is the same thing without the array.
//
//   * saveBatch rewrites the WHOLE run document, pretty-printed, and the
//     per-unit callbacks called it once per unit. This run's document was 2 MB
//     (its declared set alone is 1.4 MB), so finishing would have meant
//     building a 2 MB string 123,624 times. Progress saves are throttled now;
//     anything that ENDS something still writes at once.
//
// And two things about being told:
//
//   * an interrupted run records WHERE it got to and WHY it stopped, on the
//     record, because by the time anyone looks the thing that stopped it is
//     gone from the screen;
//   * the Sweep section reports a job that ended badly instead of saying the
//     same words it says for no job at all.
//
// Watched failing 2026-08-22: reverting any one of the four fails its own test
// below; putting `saveBatch` back in the per-unit callbacks fails
// perUnitTicksDoNotRewriteTheWholeDocumentEveryTime.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const BATCH_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');
const POOL_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'pool.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Same throwaway data folder the campaign delete tests use: the batch store
// lives at a fixed path under data/, so the module is re-required against a
// scratch copy.
function withScratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-run-'));
  const realData = path.join(ROOT, 'data');
  const stash = `${realData}.stash-${process.pid}`;
  const hadData = fs.existsSync(realData);
  if (hadData) fs.renameSync(realData, stash);
  fs.mkdirSync(path.join(realData, 'batches'), { recursive: true });
  fs.mkdirSync(path.join(realData, 'models'), { recursive: true });
  fs.mkdirSync(path.join(realData, 'ht'), { recursive: true });
  const gdir = path.join(dir, 'gl'); const sdir = path.join(dir, 'su');
  fs.mkdirSync(gdir); fs.mkdirSync(sdir);
  const prevG = process.env.GC_GREENLIGHTS_DIR; const prevS = process.env.GC_SETUPS_DIR;
  process.env.GC_GREENLIGHTS_DIR = gdir; process.env.GC_SETUPS_DIR = sdir;
  const mods = ['lib/campaign', 'lib/batch', 'lib/live/greenlight', 'lib/live/setups'];
  mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  try {
    return fn({ gdir, sdir, realData, batch: require(path.join(ROOT, 'lib/batch')) });
  } finally {
    if (prevG === undefined) delete process.env.GC_GREENLIGHTS_DIR; else process.env.GC_GREENLIGHTS_DIR = prevG;
    if (prevS === undefined) delete process.env.GC_SETUPS_DIR; else process.env.GC_SETUPS_DIR = prevS;
    fs.rmSync(realData, { recursive: true, force: true });
    if (hadData) fs.renameSync(stash, realData);
    fs.rmSync(dir, { recursive: true, force: true });
    mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  }
}

const writeRun = (realData, id, over) => fs.writeFileSync(path.join(realData, 'batches', `${id}.json`),
  JSON.stringify({
    id, kind: 'bracketlab', status: 'done', startedAt: '2026-01-01T00:00:00Z',
    params: { campaign: 'c' }, runs: [], leaders: [], ...(over || {}),
  }));
const writeGl = (gdir, id, runId) => fs.writeFileSync(path.join(gdir, `${id}.json`),
  JSON.stringify({ id, campaign: 'c', createdUtc: '2026-01-02T00:00:00Z', name: 'g', why: 'w',
    sourceRun: { id: runId }, configSnapshot: {} }));

module.exports = {
  // ---------------------------------------------------------- the heap itself
  // THE defect. A streaming caller must not be handed an array it never reads.
  async forEachKeepsNothingAndMapStillCollects() {
    const { Pool } = require('../lib/pool');
    const pool = new Pool(1);            // inline lane: no worker threads in tests
    try {
      const payloads = [1, 2, 3, 4, 5].map((n) => n);
      const seen = [];
      const nothing = await pool.forEach('ping', payloads, (settled, i) => { seen.push(i); });
      assert.strictEqual(nothing, undefined,
        'forEach must return nothing — a caller who wanted the array has to find out at once, not read silent nulls');
      assert.deepStrictEqual(seen, [0, 1, 2, 3, 4], 'every payload still reaches onSettled, in order');

      const collected = await pool.map('ping', payloads);
      assert.strictEqual(collected.length, 5, 'map still hands back one slot per payload');
      for (const c of collected) assert.strictEqual(c.ok, true, 'and each slot carries its result');
    } finally { pool.abort(); }
  },

  // Every long job in the codebase streams. If one goes back to map it is
  // holding a result per unit again, and the next wide sweep dies the same way.
  everyLongJobStreamsInsteadOfCollecting() {
    const strays = [];
    const re = /await pool\.map\('(\w+)'/g;
    let m = re.exec(BATCH_SRC);
    while (m) { strays.push(m[1]); m = re.exec(BATCH_SRC); }
    assert.deepStrictEqual(strays, [],
      `these long jobs collect a result per unit they never read: ${strays.join(', ')} — use pool.forEach`);
    for (const kind of ['unit', 'htPass', 'nullRotation', 'htTwoFold']) {
      assert.ok(new RegExp(`pool\\.forEach\\('${kind}'`).test(BATCH_SRC),
        `the ${kind} job must stream its results, not collect them`);
    }
    // and the two must not drift apart: one lane implementation, two doors
    assert.ok(/async _lanes\(kind, payloads, onSettled, collect\)/.test(POOL_SRC),
      'map and forEach must share one lane implementation, or they will diverge on ordering or abort');
  },

  // The other half of the heap: a 2 MB document rewritten per unit.
  perUnitTicksDoNotRewriteTheWholeDocumentEveryTime() {
    // every bracketPerfTick site is a per-unit tick and must use the throttle
    const ticks = BATCH_SRC.split('bracketPerfTick(doc);').slice(1);
    assert.ok(ticks.length >= 3, 'the sweep, promote and null-replay ticks must all still exist');
    ticks.forEach((after, i) => {
      const next = after.slice(0, 160);
      assert.ok(/saveProgress\(doc\)/.test(next),
        `per-unit tick ${i + 1} still calls saveBatch — a 2 MB document written once per unit is what filled the heap`);
      assert.ok(!/\bsaveBatch\(doc\)/.test(next),
        `per-unit tick ${i + 1} writes the whole document unconditionally`);
    });
    assert.ok(/const PROGRESS_SAVE_MS = \d+;/.test(BATCH_SRC), 'the throttle interval must be named and findable');
    // one clock: a full save counts as the last write
    assert.ok(/lastSaveAt = Date\.now\(\);/.test(BATCH_SRC.slice(BATCH_SRC.indexOf('function saveBatch'))),
      'saveBatch must wind the same clock saveProgress reads, or there are two notions of "last written"');
    // and a failure is never throttled away
    const rf = BATCH_SRC.slice(BATCH_SRC.indexOf('function recordFailure'), BATCH_SRC.indexOf('function recordFailure') + 700);
    assert.ok(/lastSaveAt = 0;/.test(rf),
      'a failure must reach disk at the next tick — a failure nobody can read is a failure nobody knows happened');
  },

  // The ceiling the box runs under has to be the one this service is allowed,
  // not the one node picks for itself.
  theServiceRunsWithAHeapCeilingThatMatchesItsAllowance() {
    const unit = fs.readFileSync(path.join(ROOT, 'deploy', 'ultimate-trading-system.service'), 'utf8');
    const m = unit.match(/--max-old-space-size=(\d+)/);
    assert.ok(m, 'the unit must set a heap ceiling — node\'s own default is about 1 GB and this service is allowed more');
    const heapMb = Number(m[1]);
    const high = unit.match(/MemoryHigh=(\d+)G/);
    assert.ok(high, 'the unit must still declare MemoryHigh');
    const highMb = Number(high[1]) * 1024;
    assert.ok(heapMb < highMb,
      `the heap ceiling (${heapMb} MB) must sit below MemoryHigh (${highMb} MB) — node's non-heap footprint needs room too`);
    assert.ok(heapMb > 1024,
      `a ceiling of ${heapMb} MB is no better than node's own default — the sweep died at 1024 MB`);
  },

  // ------------------------------------------------------------- being told
  // A run that stopped must leave behind what it was doing when it stopped.
  anInterruptedRunRecordsWhereItGotToAndWhy() {
    const { markInterrupted } = require('../lib/batch');
    const doc = markInterrupted({
      id: 'r1', status: 'running', progress: 'slim 316/123624',
      perf: { phase: 'slim', unitsDone: 316, unitsTotal: 123624 },
    });
    assert.strictEqual(doc.status, 'interrupted');
    assert.ok(doc.error, 'an interrupted run with no reason recorded is indistinguishable from one that never started');
    assert.ok(/316\/123624/.test(doc.error), 'the reason must say how far it got');
    assert.strictEqual(doc.interruptedWhere, 'slim 316/123624', 'and record it as its own field, not only inside a sentence');
    assert.ok(/start it again/i.test(doc.error), 'and say what the owner can do about it');
    assert.ok(doc.finishedAt, 'and when it ended');
  },

  // The reason has to travel to the picker, or the only screen that could show
  // it is the one nobody has a reason to open.
  theRunListCarriesHowARunEnded() {
    const { listRow } = require('../lib/batch');
    const row = listRow({ id: 'r1', status: 'interrupted', startedAt: 'x', error: 'it stopped', interruptedWhere: 'slim 1/2' });
    assert.strictEqual(row.error, 'it stopped');
    assert.strictEqual(row.interruptedWhere, 'slim 1/2');
    // and the screen must actually read it
    assert.ok(/The last job did not finish/.test(UI),
      'the Sweep section must report a job that ended badly, not say the same words it says for no job at all');
    assert.ok(/This run did not finish/.test(UI),
      'and the run itself must say so when it is opened');
  },

  // -------------------------------------------------------------- deleting
  async aRunCanBeDeletedWithItsModelAndTuningFiles() {
    withScratch(({ realData, batch }) => {
      writeRun(realData, 'run-a');
      fs.mkdirSync(path.join(realData, 'models', 'run-a'), { recursive: true });
      fs.writeFileSync(path.join(realData, 'models', 'run-a', 'm1.json'), '{}');
      fs.mkdirSync(path.join(realData, 'ht', 'run-a'), { recursive: true });
      fs.writeFileSync(path.join(realData, 'ht', 'run-a', 't1.json'), '{}');

      const found = batch.runContents('run-a');
      assert.strictEqual(found.locked, false, 'a finished run nothing stands on is deletable');
      assert.strictEqual(found.counts.modelFiles, 1);
      assert.strictEqual(found.counts.tuningFiles, 1);

      batch.deleteBatch('run-a');
      assert.ok(!fs.existsSync(path.join(realData, 'batches', 'run-a.json')), 'the run file is still there');
      assert.ok(!fs.existsSync(path.join(realData, 'models', 'run-a')), 'its saved models are still there');
      assert.ok(!fs.existsSync(path.join(realData, 'ht', 'run-a')), 'its tuning files are still there');
    });
  },

  // THE ONE THE OWNER ASKED FOR BY NAME: they want to restart that sweep
  // themselves, and a file being deleted under a job that is writing it is how
  // a run half-exists.
  async theRunningRunIsRefused() {
    withScratch(({ realData, batch }) => {
      writeRun(realData, 'run-live', { status: 'running' });
      const found = batch.runContents('run-live');
      assert.strictEqual(found.locked, true, 'the running run must be locked');
      assert.ok(/going right now/.test(found.lockedWhy), 'and say why in words the owner can act on');
      assert.throws(() => batch.deleteBatch('run-live'), /cannot be deleted/);
      assert.ok(fs.existsSync(path.join(realData, 'batches', 'run-live.json')), 'the running run was deleted anyway');
    });
  },

  // A greenlight names the run its evidence came from. Deleting the run would
  // leave something that may be trading pointing at evidence that is gone.
  async aRunAGreenlightStandsOnIsRefused() {
    withScratch(({ realData, gdir, batch }) => {
      writeRun(realData, 'run-ev');
      writeGl(gdir, 'gl-1', 'run-ev');
      const found = batch.runContents('run-ev');
      assert.strictEqual(found.locked, true, 'a run a greenlight names must be locked');
      assert.strictEqual(found.greenlights.length, 1, 'and the greenlight must be named, not just counted');
      assert.throws(() => batch.deleteBatch('run-ev'), /cannot be deleted/);
      assert.ok(fs.existsSync(path.join(realData, 'batches', 'run-ev.json')), 'a run with evidence on it was deleted anyway');
    });
  },

  // The route is guarded like the other thing on this system that cannot be
  // undone: the id comes back twice or nothing happens.
  theDeleteRouteDemandsTheIdTwiceAndIsGuarded() {
    const at = SERVER.indexOf("app.post('/api/run/delete'");
    assert.ok(at > 0, 'the run-delete route must exist');
    const route = SERVER.slice(at, at + 1200);
    assert.ok(/csrfGuard/.test(route), 'it must be guarded like the other unrepeatable actions');
    assert.ok(/body\.confirm !== body\.id/.test(route), 'the id must be given twice or nothing is deleted');
    assert.ok(/RUN_LOCKED/.test(route), 'a refusal must come back as a refusal, not a generic failure');
    // and the screen must offer it, with the same read-before-you-answer order
    assert.ok(/id="bDelete"/.test(UI), 'the Boards section must offer the delete');
    const h = UI.slice(UI.indexOf("$('#bDelete')"), UI.indexOf("$('#bDelete')") + 3000);
    assert.ok(h.indexOf('will permanently remove') < h.indexOf('requestAnimationFrame'),
      'the list of what goes must be written before the page is given a chance to paint');
    assert.ok(h.indexOf('requestAnimationFrame') < h.indexOf('const typed = prompt('),
      'and painted before the box blocks the browser');
  },

  // EVERY PROMOTED UNIT LEAVES A RECORD, AND EXACTLY ONE (owner, 2026-08-22).
  //
  // A branch sat in the promote callback for a unit that trained and reached no
  // cell. It could never run: its condition was a subset of the one above it,
  // which had already taken every case it could apply to. Had it run it would
  // have thrown — it named variables belonging to the first pass — and written
  // into the first pass's collection.
  //
  // I reported it to the owner as a gap: "those units are recorded nowhere".
  // That was wrong. They ARE recorded, a few lines up, by the else that writes
  // a census row saying no cell reached the trade floor. What was there was a
  // duplicate of that, written wrong, somewhere it could not reach — and while
  // it sat there it went on looking like a gap.
  //
  // Watched failing 2026-08-22: putting the branch back fails this on both
  // counts — the promote callback writing into the first pass's collection, and
  // a condition that can never be true.
  everyPromotedUnitLeavesExactlyOneCensusRow() {
    const at = BATCH_SRC.indexOf('const promPayloads = promPending.map');
    assert.ok(at > 0, 'the promote stage must still exist');
    const cb = BATCH_SRC.slice(at, BATCH_SRC.indexOf('pool.abort();', at));

    // the two ways a promoted unit can come back, and both write a census row
    assert.ok(/if \(res\.best \|\| res\.bestEdge\) \{/.test(cb),
      'a promoted unit with a result must be recorded');
    const elseAt = cb.indexOf('No qualifying cell at all');
    assert.ok(elseAt > 0, 'and one WITHOUT a result must be recorded too — the denominator has to stay honest');
    assert.ok(/no execution cell reached/.test(cb.slice(elseAt, elseAt + 900)),
      'saying so in words, not left as a blank to be read as zero');

    // the promote stage must never write into the first pass's collection
    assert.ok(!/rows\.slim\.push/.test(cb),
      'the promote callback writes into the first pass\'s rows — that record would name a unit by the wrong pass');

    // and no branch whose condition another has already taken
    assert.ok(!/else if \(settled\.ok && settled\.value && !settled\.value\.best\)/.test(cb),
      'a branch sits here whose condition the one above it has already taken, so it can never run');
  },

  // -------------------------------------------------------------- resuming
  // ONE NAME FOR A UNIT. The resume decides what is left by comparing the key
  // a finished unit recorded against the key the rebuilt unit computes. Three
  // places used to spell that out separately; if any two disagree the resume
  // either does work twice or skips work it never did, and nothing on the
  // screen would say which.
  aUnitHasExactlyOneName() {
    const { unitFullKey } = require('../lib/batch');
    const c = { trade: 'AAAUSDT', ctx1: null, ctx2: null, size: 1 };
    const b = { geometry: 'daily-3d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
    assert.strictEqual(unitFullKey(c, b, {}), 'AAAUSDT|||daily-3d|argmax|auto|24-7');
    assert.strictEqual(unitFullKey(c, b, { nullDealSeed: 7 }), 'AAAUSDT|||daily-3d|argmax|auto|24-7|n7');
    assert.strictEqual(unitFullKey(c, b, { shiftFrac: 0.5 }), 'AAAUSDT|||daily-3d|argmax|auto|24-7|s0.500');
    assert.strictEqual(unitFullKey(c, b, { shiftFrac: null, nullDealSeed: null }), unitFullKey(c, b, {}),
      'an explicit null is the same unit as no mention at all');
    // and there must be no second copy of the expression left anywhere
    const copies = (BATCH_SRC.match(/\|s\$\{[a-z]*\.?shiftFrac\.toFixed\(3\)\}/g) || []).length;
    assert.strictEqual(copies, 1,
      `the unit-name expression is written ${copies} times — the resume compares those names, so they must be one expression`);
  },

  // The promoted record has to be able to say which unit it is, or a run that
  // stopped during the second pass would score all of it again.
  theCensusRowCarriesItsOwnKey() {
    const at = BATCH_SRC.indexOf('rows.census.push({');
    assert.ok(at > 0, 'the promote stage must still write a census row');
    const row = BATCH_SRC.slice(at, at + 2500);
    assert.ok(/key: l\.key,/.test(row),
      'a census row that cannot name its unit is a row only its neighbours can place — and the resume cannot use it');
  },

  // WHAT IT REFUSES is the whole point. Half a board scored against one
  // history and half against another is not one board, and nothing on the
  // finished screen would say so.
  async resumeRefusesEverythingItCannotPickUpHonestly() {
    withScratch(({ realData, batch }) => {
      const ENGINE = require('../lib/batch');
      const good = { status: 'interrupted', params: { campaign: 'c' }, dataManifest: { overallDigest: 'abc123def456' }, plan: { units: 10 }, slimResults: [{ key: 'k1' }] };
      writeRun(realData, 'ok-run', good);
      const okRun = batch.resumeContents('ok-run');
      // the fixture has to name the engine this box is on, or it is refused for
      // that instead and the test proves nothing
      assert.ok(okRun.engineNow, 'the engine version must be reported');
      writeRun(realData, 'ok-run', { ...good, params: { campaign: 'c', engineVersion: okRun.engineNow } });
      const ok = batch.resumeContents('ok-run');
      assert.strictEqual(ok.resumable, true, `a stopped sweep must be resumable: ${ok.why.join('; ')}`);
      assert.strictEqual(ok.unitsScored, 1);
      assert.strictEqual(ok.unitsLeft, 9);

      const cases = [
        ['done-run', { ...good, status: 'done' }, /finished/],
        ['live-run', { ...good, status: 'running' }, /going right now/],
        ['err-run', { ...good, status: 'error' }, /only one that was interrupted or cancelled/],
        ['old-run', { ...good, params: { engineVersion: '0.0.1' } }, /engine 0\.0\.1/],
        ['nofp-run', { ...good, params: { engineVersion: okRun.engineNow }, dataManifest: null }, /never recorded which price files/],
        ['wf-run', { ...good, kind: 'walkforward' }, /only a sweep/],
      ];
      for (const [id, over, expect] of cases) {
        writeRun(realData, id, over);
        const r = batch.resumeContents(id);
        assert.strictEqual(r.resumable, false, `${id} must not be resumable`);
        assert.ok(r.why.some((w) => expect.test(w)), `${id} refused for the wrong reason: ${r.why.join('; ')}`);
        assert.throws(() => batch.resumeBracketLab(id), /cannot be picked up/, `${id} must refuse to start`);
      }
      assert.ok(ENGINE, 'engine module loaded');
    });
  },

  // The price files are checked at the moment of resuming, not when the button
  // is drawn: a fingerprint taken earlier could be stale by the time anybody
  // presses anything.
  theHistoryIsCheckedWhenItStartsNotWhenItIsOffered() {
    const at = BATCH_SRC.indexOf('const stamped = stampManifest(doc.id, symbols);');
    assert.ok(at > 0, 'the manifest must still be stamped after the pre-warm');
    const after = BATCH_SRC.slice(at, at + 1800);
    assert.ok(/if \(resume\) \{/.test(after), 'a resumed run must compare the fingerprint at that moment');
    assert.ok(/was !== now/.test(after), 'and refuse when it differs');
    assert.ok(/would make half this board answer a different question/.test(after),
      'and say why, in terms of what it costs the reader');
    assert.ok(after.indexOf('was !== now') < after.indexOf('doc.dataManifest = stamped;'),
      'the comparison must happen BEFORE the old fingerprint is overwritten, or there is nothing to compare against');
  },

  // Everything already scored is kept, and the run says it was picked up.
  aResumedRunKeepsItsBoardAndSaysItWasResumed() {
    assert.ok(/doc = resume;/.test(BATCH_SRC), 'a resumed run must be the SAME document, not a copy with pieces carried across');
    const at = BATCH_SRC.indexOf('doc = resume;');
    const blk = BATCH_SRC.slice(at, at + 1400);
    for (const kept of ['doc.leaders', 'doc.failures']) {
      assert.ok(blk.includes(kept), `${kept} must survive a resume — it is computed record`);
    }
    // The three big collections moved to disk on 2026-08-22, so surviving a
    // resume means the writers REOPEN the same files rather than the document
    // carrying arrays across. A second file beside the first would be a second,
    // shorter truth about the same run.
    assert.ok(/const rows = openRowStores\(doc\.id\);/.test(BATCH_SRC),
      'the run must open its row files by run id, so a resumed run appends to the ones it already wrote');
    assert.ok(/const prev = exists\(runId, name\)/.test(fs.readFileSync(path.join(ROOT, 'lib', 'rowstore.js'), 'utf8')),
      'a writer over an existing file must adopt its columns and its count, not start again at zero');
    assert.ok(/doc\.resumes\.push\(\{/.test(BATCH_SRC),
      'a board built over two sittings must say so, or it reads as one uninterrupted run');
    assert.ok(/skippedUnits/.test(BATCH_SRC) && /dataDigest/.test(BATCH_SRC),
      'the resume record must say how much was skipped and against which history');
    // the counters are recomputed, never carried: the stale ones counted
    // failures as done, and a failure is exactly what gets another go
    assert.ok(/doc\.perf\.unitsDone = skipped;/.test(BATCH_SRC),
      'progress must be recomputed from what is recorded, not carried over from the crash');
  },

  // Both passes are filtered, and by the pending list — indexing the callback
  // into the UNFILTERED array is how a resume writes one unit's result under
  // another unit's name.
  bothPassesSkipWhatIsAlreadyDone() {
    assert.ok(/const slimPending = doneSlim\.size \? units\.filter/.test(BATCH_SRC), 'the first pass must skip finished units');
    assert.ok(/const promPending = donePromote\.size \? promote\.filter/.test(BATCH_SRC), 'the second pass must too');
    assert.ok(/const \{ c, b \} = slimPending\[i\];/.test(BATCH_SRC),
      'the first pass callback must index the PENDING list, or results land under the wrong unit');
    assert.ok(/const l = promPending\[i\];/.test(BATCH_SRC),
      'and so must the second');
    // with nothing to skip, the pending list IS the whole list — the ordinary
    // launch must be untouched by any of this
    assert.ok(/: units;/.test(BATCH_SRC) && /: promote;/.test(BATCH_SRC),
      'with no resume both passes must be the identical arrays the ordinary launch always used');
  },

  theResumeRouteIsGuardedAndTheScreenOffersIt() {
    const at = SERVER.indexOf("app.post('/api/run/resume'");
    assert.ok(at > 0, 'the resume route must exist');
    const route = SERVER.slice(at, at + 900);
    assert.ok(/csrfGuard/.test(route), 'it starts hours of work on the box, so it is guarded');
    assert.ok(/NOT_RESUMABLE/.test(route), 'a refusal must come back as a refusal');
    assert.ok(/batchId: batch\.resumeBracketLab/.test(route),
      'it must answer in the same shape a fresh launch does, so the page reads one contract');
    assert.ok(/id="bResume"/.test(UI), 'the Boards section must offer it');
    assert.ok(/doc\.status === 'interrupted' \|\| doc\.status === 'cancelled'\) \? '' : 'disabled'/.test(UI),
      'and offer it only on a run that stopped — a control that is live when it cannot work teaches people to ignore refusals');
    const h = UI.slice(UI.indexOf("$('#bResume')"), UI.indexOf("$('#bResume')") + 2600);
    assert.ok(/api\/resume-contents/.test(h), 'it must say what is left before it starts anything');
    assert.ok(h.indexOf('still to score') < h.indexOf('requestAnimationFrame'),
      'and that has to be written before the page is given a chance to paint');
    assert.ok(h.indexOf('requestAnimationFrame') < h.indexOf('confirm('),
      'and painted before the box blocks the browser');
  },

  // ------------------------------------------------------- the form remembers
  theSweepFormSurvivesARedrawAndShowsTheRunningJob() {
    assert.ok(/const SWEEP_FORM_KEY = /.test(UI), 'the form must keep what is in it across a redraw');
    assert.ok(/document\.querySelectorAll\('#view \[id\^="sw"\]'\)/.test(UI),
      'the control list must be asked of the page — a list written here needs remembering when a control is added');
    assert.ok(/if \(runDoc\) fillSweepForm\(runDoc\.params \|\| \{\}, /.test(UI),
      'with a job running, the form must show THAT job\'s settings');
    assert.ok(/else restoreSweepForm\(\);/.test(UI),
      'with nothing running, it must show whatever the owner last had in it');
    // and it must not overwrite the owner's draft with the running job's values
    const at = UI.indexOf('else restoreSweepForm();');
    const after = UI.slice(at, at + 1200);
    assert.ok(/if \(runDoc\) \{/.test(after) && /\} else \{/.test(after),
      'remembering must be wired only when the form is the owner\'s own');
    assert.ok(after.indexOf('addEventListener(\'change\', rememberSweepForm)') > after.indexOf('} else {'),
      'the form is only remembered while it is the owner\'s, never while it mirrors a running job');
  },
};
