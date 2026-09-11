// THE PASSES (SELECTION-DESIGN.md Part 1) -- one coin and shape, trained again
// with the boundary sliding forward, judged each time on the stretch after its
// own test slice.
//
// A PASS IS NOT A LAYOUT, IT IS A MODIFIER ON ONE. Whatever the set was built
// on seals what it seals first -- 13% on a 61/13/13/13 set, nothing on a
// 70/15/15 one -- and the passes then cut what is left. So these tests are
// written over BOTH, and over a range of history sizes, because code that only
// works for the set in front of us is code that fails the first time another
// set is opened.
//
// THE PROMISE THEY CARRY: no pass reads past the room it was given. It is
// tested rather than commented because the design's own table broke it --
// taking the judging width as a rounded tenth put the last pass four chunks
// past the end.
const { assert } = require('./helpers');
const sw = require('../lib/stagework');
const bw = require('../lib/bracketwork');

// the two layouts, as the engine itself computes them, never as numbers typed
// here: 'reserve61' seals 13% and splits the rest 70/15/15; 'split70' seals
// nothing and splits all of it the same way.
const roomOf = (n, layout) => (layout === 'reserve61' ? n - Math.max(2, Math.round(n * 0.13)) : n);

module.exports = {
  // THE ONE PROMISE, over both layouts and a wide range of histories
  noPassEverReadsPastTheRoomItWasGiven() {
    let checked = 0;
    for (const layout of ['reserve61', 'split70']) {
      for (let n = 200; n <= 6000; n += 7) {
        const room = roomOf(n, layout);
        for (let of = 2; of <= 8; of++) {
          let lastEnd = 0;
          for (let k = 1; k <= of; k++) {
            const g = sw.passGeometry(room, of, k);
            checked++;
            assert.strictEqual(g.room, room, `${layout}, ${n} chunks: the pass was handed ${g.room} of room, not ${room}`);
            assert.ok(g.endsAt <= room,
              `${layout}, ${n} chunks, pass ${k} of ${of}: it reads to ${g.endsAt} and the room is ${room}`);
            assert.strictEqual(g.nTrain + g.nTest, g.before, `${layout}: a pass's train and test do not fill what comes before its judge`);
            if (k > 1) {
              assert.strictEqual(g.before, lastEnd,
                `${layout}, ${n} chunks, pass ${k} of ${of}: it starts judging at ${g.before + 1} and the one before ended at ${lastEnd}`);
            }
            lastEnd = g.endsAt;
          }
          assert.strictEqual(sw.passGeometry(room, of, of).endsAt, room,
            `${layout}, ${n} chunks, ${of} passes: the last judging stretch does not end on the boundary`);
        }
      }
    }
    assert.ok(checked > 40000, `only ${checked} pass shapes were checked`);
  },

  // THE SAME ARITHMETIC ON BOTH LAYOUTS, side by side, on one real history --
  // so a reader can see that the only thing that differs is how much room the
  // set's own layout left behind.
  theSameArithmeticServesBothHistorySetups() {
    const N = 2661;
    const sealed = roomOf(N, 'reserve61');
    const whole = roomOf(N, 'split70');
    assert.strictEqual(sealed, 2315, 'a 61/13/13/13 history of 2,661 does not leave 2,315 for the passes');
    assert.strictEqual(whole, 2661, 'a 70/15/15 history seals something it should not');
    for (const room of [sealed, whole]) {
      const parts = [];
      for (let k = 1; k <= 3; k++) parts.push(sw.passGeometry(room, 3, k));
      // every pass trains and tests at the engine's own 70:15, on both
      const r = bw.splitBounds(1000, true);
      for (const g of parts) {
        assert.strictEqual(g.nTrain, Math.round(g.before * (r.nTrain / (r.nTrain + r.nTest))),
          `a pass on ${room} chunks of room does not split at the ratio every other reading uses`);
      }
      // the first pass learns on half the room, each judge starts where the
      // last ended, and the last one finishes exactly on the boundary
      assert.strictEqual(parts[0].before, parts[0].part * 3,
        `${room} chunks of room: the first pass does not learn on half of it before judging`);
      assert.strictEqual(parts[1].before, parts[0].endsAt, `${room} chunks of room: pass 2 does not start where pass 1 stopped`);
      assert.strictEqual(parts[2].before, parts[1].endsAt, `${room} chunks of room: pass 3 does not start where pass 2 stopped`);
      assert.strictEqual(parts[2].endsAt, room, `${room} chunks of room: the last pass does not finish on the boundary`);
      assert.ok(parts[0].nTrain < parts[1].nTrain && parts[1].nTrain < parts[2].nTrain,
        'the passes do not train on more history as they move forward, which is the whole point of sliding the boundary');
    }
    // AND THE FAULT THAT WAS FOUND: a ROUNDED part reads past the end. This
    // asserts the arithmetic is the floored one by showing rounded would breach.
    assert.ok(Math.round(2315 / 10) * 10 > 2315, 'a rounded tenth no longer overruns, so this is guarding nothing');
    assert.strictEqual(sw.passGeometry(2315, 5, 1).part, Math.floor(2315 / 10), 'the part is not floored');
  },

  // THE BAND COMES FROM THE TRAINING SLICE AND NEVER FROM THE JUDGE. A band
  // worked out with the judging stretch in hand has read the answer before the
  // question, and it would be invisible in every number downstream.
  aPassTakesItsBandFromItsTrainingSliceAlone() {
    const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ startTs: i * 86400000, diffPct: f(i) }));
    const quiet = mk(1386, (i) => (i < 1155 ? (i % 37) - 18 : 0));
    const wild = mk(1386, (i) => (i < 1155 ? (i % 37) - 18 : ((i % 11) - 5) * 40));
    const a = bw.splitAndLabelPass(quiet, { band: 'auto' }, 955, 231);
    const b = bw.splitAndLabelPass(wild, { band: 'auto' }, 955, 231);
    assert.strictEqual(a.bandPct, b.bandPct,
      'the band moved when only the judging stretch changed, so it is reading the stretch it is meant to judge');
    assert.strictEqual(a.trainChunks.length, 955, 'the training slice is not the length the caller stated');
    assert.strictEqual(a.holdChunks.length, 231, 'the judging stretch is not the length the caller stated');
    assert.strictEqual(a.testChunks.length, 1386 - 955 - 231, 'the test slice is not what is left between them');
    assert.ok(quiet.every((c) => c.label !== undefined), 'some chunks were left unlabelled, so the judge could not be priced');
    const MIN = require('../lib/pipeline').MIN_CHUNKS;
    assert.throws(() => bw.splitAndLabelPass(mk(MIN + 4, () => 1), { band: 'auto' }, MIN - 10, 2),
      /training chunks/, 'a pass under the engine minimum is handed back instead of refused');
    // an over-wide judging stretch is CLAMPED, and the clamp is what keeps a
    // training slice alive -- so the clamp is what gets pinned, not an exception
    const clamped = bw.splitAndLabelPass(mk(MIN + 4, () => 1), { band: 'auto' }, MIN, MIN + 3);
    assert.ok(clamped.trainChunks.length >= MIN, `an over-wide judge cut training to ${clamped.trainChunks.length}, under the minimum of ${MIN}`);
    assert.ok(clamped.testChunks.length >= 1, 'an over-wide judge left no test slice between training and judging');
    assert.strictEqual(clamped.trainChunks.length + clamped.testChunks.length + clamped.holdChunks.length, MIN + 4,
      'the clamp lost or invented chunks');
  },

  // THE JOB THAT TRAINS ONE PASS. Run with the chunk-cutting stubbed, because
  // the real thing needs candles -- but run, not scanned, so the things that
  // matter are exercised: that the parent's own layout travels untouched, that
  // the pass rides on top of it as a modifier, that every member is trained on
  // the pass's TRAIN and asked to vote on its test slice AND the stretch it is
  // judged on, and that a pass with nothing to be judged on is refused rather
  // than quietly returned.
  async theJobThatTrainsOnePassCarriesTheParentsLayoutAndRefusesAnEmptyJudge() {
    const path = require('path');
    const swPath = require.resolve('../lib/stagework');
    const real = require.cache[swPath];
    const chunk = (i) => ({ startTs: i * 86400000, diffPct: 1, x: [0, 0, 0] });
    const seen = { params: null, trained: [] };
    const stub = {
      ...require('../lib/stagework'),
      async unitChunks(combo, geometry, p) {
        seen.params = p;
        return {
          geo: { featureHours: 192 },
          split: {
            trainChunks: [chunk(1), chunk(2)],
            testChunks: [chunk(3)],
            holdChunks: p.__noJudge ? [] : [chunk(4), chunk(5)],
            bandPct: 7,
          },
          windows: { layout: p.windowLayout, pass: { of: p.pass.of, k: p.pass.k } },
        };
      },
      async trainProbMember(a) {
        seen.trained.push({ model: a.model, train: a.trainChunks.length, predict: a.predictChunks.length });
        return { saved: { kind: a.model }, picked: 1, tauProbs: [[0.5]], probs: [[0.5]] };
      },
    };
    require.cache[swPath] = { ...real, exports: stub };
    delete require.cache[require.resolve('../lib/passes')];
    try {
      const { passTrainTask } = require('../lib/passes');
      const base = {
        combo: { size: 1, trade: 'AAAUSDT' },
        geometry: 'daily-3d',
        specs: [{ model: 'logreg', view: 'full' }, { model: 'boost', view: 'prices' }],
        params: { windowLayout: 'reserve61', nullN: 20, seed: 7 },
        of: 3,
        k: 2,
      };
      const out = await passTrainTask(base);
      // THE PARENT'S LAYOUT TRAVELS UNTOUCHED, and the pass rides on top of it
      assert.strictEqual(seen.params.windowLayout, 'reserve61',
        'the job changed the layout the set was built on, so what it seals would change under it');
      assert.deepStrictEqual(seen.params.pass, { of: 3, k: 2 }, 'the pass is not handed through as a modifier');
      assert.strictEqual(seen.params.nullN, 20, 'the set\'s own settings do not reach the training job');
      // every member trained on THIS pass's train, and asked to vote on the
      // test slice and the stretch it is judged on, both
      assert.strictEqual(seen.trained.length, 2, 'not every member of the set\'s own committee was trained');
      for (const t of seen.trained) {
        assert.strictEqual(t.train, 2, 'a member was trained on something other than this pass\'s train');
        assert.strictEqual(t.predict, 3, 'a member was not asked to vote on both the test slice and the stretch it is judged on');
      }
      assert.deepStrictEqual(out.counts, { train: 2, test: 1, judge: 2 }, 'the counts a pass reports are not the ones it used');
      assert.strictEqual(out.trainedBandPct, 7, 'the band the pass trained at does not travel with it');
      assert.strictEqual(out.ts.judge.length, 2, 'the days the pass was judged on do not travel with it');
      assert.strictEqual(out.k, 2, 'a pass does not say which pass it is');
      // AND A PASS WITH NOTHING TO BE JUDGED ON IS REFUSED, never returned
      // half-formed for something downstream to read as an empty answer
      await assert.rejects(() => passTrainTask({ ...base, params: { ...base.params, __noJudge: true } }),
        /no judging stretch/, 'a pass with nothing to judge on comes back as an answer');
    } finally {
      require.cache[swPath] = real;
      delete require.cache[require.resolve('../lib/passes')];
    }
  },

  // IT IS ON THE WORKER, or nothing can run it
  theTrainingJobIsOnTheWorkersList() {
    const w = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'worker.js'), 'utf8');
    assert.ok(/passTrain: require\('\.\/passes'\)\.passTrainTask,/.test(w),
      'the job that trains a pass is not on the worker, so a run would have nothing to hand its passes to');
  },

  // THE SHAPE OF THE CHANGE IN THE ENGINE: the set's own layout seals first,
  // the pass cuts what is left, and the pass code names no layout at all. If a
  // pass ever grows its own idea of a reserve, the 13% is written twice and the
  // two will drift.
  aPassIsAModifierOnTheSetsOwnLayoutAndNamesNoneOfThem() {
    const lib = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'stagework.js'), 'utf8');
    const fn = lib.slice(lib.indexOf('async function unitChunks(combo, geometry, p) {'), lib.indexOf('const viewsFor ='));
    assert.ok(fn.length > 500, 'the one function that decides a unit\'s stretches has changed shape');
    // the pass branch runs AFTER both sealing branches, and takes no layout
    const seal = fn.indexOf("if (p.windowLayout === 'reserve61')");
    const pass = fn.indexOf('if (p.pass) {');
    assert.ok(seal > 0 && pass > seal, 'the passes are cut before the set\'s own layout has sealed what it seals');
    const branch = fn.slice(pass, fn.indexOf('const split =', pass));
    assert.ok(!/reserve61|split70|retrain72|0\.13/.test(branch),
      'the pass branch names a layout or repeats the 13%, so the sealing rule now lives in two places');
    assert.ok(branch.includes('passGeometry(workChunks.length, p.pass.of, p.pass.k)'),
      'the pass is handed something other than what the set\'s own layout left behind');
    assert.ok(branch.includes('workChunks.slice(0, passCut.endsAt)'), 'a pass can see chunks past its own judging stretch');
    // and passGeometry itself knows nothing about reserves
    const geo = lib.slice(lib.indexOf('function passGeometry(room, ofRaw, kRaw) {'), lib.indexOf('async function unitChunks'));
    assert.ok(!/reserve|0\.13/.test(geo.replace(/\/\/[^\n]*/g, '')), 'the pass arithmetic knows a reserve exists');
    // the judging stretch still lands in the held-back slot, which is what lets
    // everything downstream price it without knowing a pass happened
    assert.ok(fn.includes('splitAndLabelPass(workChunks, branch, passCut.nTrain, passCut.judge)'),
      'a pass is split by something other than the splitter that keeps the band off the judge');
    assert.ok(/hold: span\(split\.holdChunks\)/.test(fn), 'the judging stretch no longer lands in the held-back slot');
    assert.ok(fn.includes('pass: passCut ?'), 'the windows a pass used do not travel with it, so the screen would have to guess them');
  },
};
