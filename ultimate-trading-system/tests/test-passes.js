// THE FIVE PASSES (SELECTION-DESIGN.md Part 1) -- one coin and shape, retrained
// with the train/test boundary sliding forward, judged on the stretch after its
// own test slice each time.
//
// THESE TESTS CARRY THE ONE PROMISE THE PART CANNOT BREAK: the sealed reserve
// appears in no pass. It is written here rather than asserted in a comment
// because the part's OWN table broke it -- taking the judging width as a rounded
// tenth put the fifth pass of a 2,315-chunk history four chunks inside the seal.
// A promise that depends on somebody re-doing that arithmetic is not a promise.
const { assert } = require('./helpers');
const sw = require('../lib/stagework');
const bw = require('../lib/bracketwork');

module.exports = {
  // SUCCESS CONDITION 1, and it is checked over a range rather than on one set,
  // because the fault it exists for was invisible on four passes out of five.
  noPassEverReachesTheSealedReserve() {
    let checked = 0;
    for (let n = 200; n <= 6000; n += 7) {
      for (let of = 2; of <= 8; of++) {
        let lastEnd = 0;
        for (let k = 1; k <= of; k++) {
          const g = sw.passGeometry(n, of, k);
          checked++;
          assert.ok(g.endsAt <= g.room,
            `${n} chunks, pass ${k} of ${of}: the judging stretch ends at ${g.endsAt} and only ${g.room} are outside the seal`);
          assert.ok(g.reserve >= 2, 'a set with no sealed reserve was handed back as though it had one');
          assert.strictEqual(g.reserve + g.room, n, 'the reserve and the room do not account for every chunk');
          // each judge starts where the last one ended: contiguous, never overlapping
          if (k > 1) {
            assert.strictEqual(g.before, lastEnd,
              `${n} chunks, pass ${k} of ${of}: its judging stretch starts at ${g.before + 1} and the one before ended at ${lastEnd}`);
          }
          lastEnd = g.endsAt;
        }
        // the last pass finishes EXACTLY on the boundary, so nothing is wasted
        // and nothing is borrowed
        const last = sw.passGeometry(n, of, of);
        assert.strictEqual(last.endsAt, last.room,
          `${n} chunks, ${of} passes: the last judging stretch ends at ${last.endsAt}, not on the boundary at ${last.room}`);
      }
    }
    assert.ok(checked > 20000, `only ${checked} pass shapes were checked`);
  },

  // THE OWNER'S OWN SET, to the chunk, because a rule that only works in general
  // is a rule nobody can check against what is in front of them
  theOwnersSetSplitsIntoFivePassesThatEndOnTheSeal() {
    const ALL = 2661;                       // 346 sealed at 13%, 2,315 outside it
    const want = [
      { train: 951, test: 204, judge: 231, from: 1156, to: 1386 },
      { train: 1141, test: 245, judge: 231, from: 1387, to: 1617 },
      { train: 1332, test: 285, judge: 231, from: 1618, to: 1848 },
      { train: 1522, test: 326, judge: 231, from: 1849, to: 2079 },
      { train: 1712, test: 367, judge: 236, from: 2080, to: 2315 },
    ];
    for (let k = 1; k <= 5; k++) {
      const g = sw.passGeometry(ALL, 5, k);
      const w = want[k - 1];
      assert.strictEqual(g.reserve, 346, 'the seal is not 13% of the history');
      assert.strictEqual(g.room, 2315, 'the room outside the seal is wrong');
      assert.strictEqual(g.nTrain, w.train, `pass ${k} trains on ${g.nTrain}, not ${w.train}`);
      assert.strictEqual(g.nTest, w.test, `pass ${k} tests on ${g.nTest}, not ${w.test}`);
      assert.strictEqual(g.judge, w.judge, `pass ${k} judges ${g.judge} chunks, not ${w.judge}`);
      assert.strictEqual(g.before + 1, w.from, `pass ${k}'s judging stretch starts at ${g.before + 1}, not ${w.from}`);
      assert.strictEqual(g.endsAt, w.to, `pass ${k}'s judging stretch ends at ${g.endsAt}, not ${w.to}`);
      // the train-to-test ratio is the engine's own 70:15, not a number typed here
      const r = bw.splitBounds(1000, true);
      assert.strictEqual(g.nTrain, Math.round(g.before * (r.nTrain / (r.nTrain + r.nTest))),
        `pass ${k} does not split its history the way every other reading of this unit splits it`);
    }
    // AND THE FAULT THAT WAS FOUND: a ROUNDED part puts the last pass inside the
    // seal. This asserts the arithmetic is the floored one, by showing the
    // rounded one would breach.
    const rounded = Math.round(2315 / 10);
    assert.strictEqual(rounded, 232, 'the arithmetic this guards against has changed');
    assert.ok(rounded * 10 > 2315, 'a rounded tenth no longer overruns, so this test is guarding nothing');
    assert.strictEqual(sw.passGeometry(ALL, 5, 1).part, Math.floor(2315 / 10), 'the part is not floored');
  },

  // THE BAND COMES FROM THE TRAINING SLICE AND NEVER FROM THE JUDGE. A band
  // fitted with the judging stretch in hand has read the answer before the
  // question, and it would be invisible in every number downstream.
  aPassTakesItsBandFromItsTrainingSliceAlone() {
    const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ startTs: i * 86400000, diffPct: f(i) }));
    // the same training slice, two completely different judging stretches
    const quiet = mk(1386, (i) => (i < 1155 ? (i % 37) - 18 : 0));
    const wild = mk(1386, (i) => (i < 1155 ? (i % 37) - 18 : ((i % 11) - 5) * 40));
    const a = bw.splitAndLabelPass(quiet, { band: 'auto' }, 955, 231);
    const b = bw.splitAndLabelPass(wild, { band: 'auto' }, 955, 231);
    assert.strictEqual(a.bandPct, b.bandPct,
      'the band moved when only the judging stretch changed, so the band is reading the stretch it is meant to be judged on');
    assert.strictEqual(a.trainChunks.length, 955, 'the training slice is not the length the caller stated');
    assert.strictEqual(a.holdChunks.length, 231, 'the judging stretch is not the length the caller stated');
    assert.strictEqual(a.testChunks.length, 1386 - 955 - 231, 'the test slice is not what is left between them');
    assert.ok(quiet.every((c) => c.label !== undefined), 'some chunks were left unlabelled, so the judge cannot be priced');
    // AND IT REFUSES rather than handing back a pass that cannot be read. The
    // minimum is the engine's own, so the case is built from it rather than from
    // a number guessed here.
    const MIN = require('../lib/pipeline').MIN_CHUNKS;
    assert.throws(() => bw.splitAndLabelPass(mk(MIN + 4, () => 1), { band: 'auto' }, MIN - 10, 2),
      /training chunks/, 'a pass whose training slice is under the engine minimum is handed back instead of refused');
    // A JUDGING STRETCH WIDER THAN THE HISTORY IS CLAMPED, NOT REFUSED, and the
    // clamp is what keeps a training slice alive -- so this pins the clamp
    // rather than an exception. Asking for a judge of MIN + 3 on MIN + 4 chunks
    // cannot be honoured, and what comes back still trains on the engine
    // minimum and still has a test slice between the two.
    const clamped = bw.splitAndLabelPass(mk(MIN + 4, () => 1), { band: 'auto' }, MIN, MIN + 3);
    assert.ok(clamped.trainChunks.length >= MIN,
      `an over-wide judging stretch cut the training slice to ${clamped.trainChunks.length}, under the engine minimum of ${MIN}`);
    assert.ok(clamped.testChunks.length >= 1, 'an over-wide judging stretch left no test slice between training and judging');
    assert.strictEqual(clamped.trainChunks.length + clamped.testChunks.length + clamped.holdChunks.length, MIN + 4,
      'the clamp lost or invented chunks');
  },

  // A PASS HAS NO HELD-BACK SLICE OF ITS OWN: its judging stretch takes that
  // slot, which is what lets everything downstream price it without knowing a
  // pass happened. If that ever stops being true, the pricing silently reads
  // the wrong stretch.
  theJudgingStretchSitsInTheHeldBackSlot() {
    const lib = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'stagework.js'), 'utf8');
    const fn = lib.slice(lib.indexOf('async function unitChunks(combo, geometry, p) {'), lib.indexOf('const viewsFor ='));
    assert.ok(fn.includes("if (p.windowLayout === 'pass') {"), 'the pass layout is gone from the one place a unit\'s stretches are decided');
    assert.ok(fn.includes('const g = passGeometry(workChunks.length, (p.pass || {}).of, (p.pass || {}).k);'),
      'the pass shape is worked out somewhere other than the one function that owns that arithmetic');
    assert.ok(fn.includes('workChunks = workChunks.slice(0, g.before + g.judge);'),
      'a pass can see chunks past its own judging stretch');
    assert.ok(fn.includes('splitAndLabelPass(workChunks, branch, passCut.nTrain, passCut.judge)'),
      'a pass is split by something other than the splitter that keeps the band off the judge');
    assert.ok(/hold: span\(split\.holdChunks\)/.test(fn), 'the judging stretch no longer lands in the held-back slot');
    assert.ok(fn.includes('pass: passCut ?'), 'the windows a pass used do not travel with it, so the screen would have to guess them');
  },
};
