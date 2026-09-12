// passes.js -- THE FIVE PASSES (VERIFY-DESIGN.md Part 1): one coin and
// shape, its forecasts TRAINED AGAIN with the boundary sliding forward, and
// judged each time on the stretch immediately after that pass's own test
// slice.
//
// WHY TRAINING AGAIN IS THE WHOLE POINT. The set's live forecasts were trained
// on everything up to the end of train. Reading them on an earlier stretch
// would be marking a model on its own homework. So each pass trains from
// scratch on only what came before its judging stretch, and that stretch is
// then genuinely unseen BY THAT PASS'S FORECASTS. It is also why a run costs
// hours rather than minutes.
//
// WHAT THIS FILE HOLDS is the one worker task -- the training and the votes for
// a single pass. The arithmetic that says where a pass begins and ends is
// passGeometry in stagework.js, and the cut itself is the `pass` modifier in
// unitChunks; neither belongs here, because the screen prints the plan before
// any of this runs.
//
// A PASS'S JUDGING STRETCH ARRIVES IN THE HELD-BACK SLOT, which is what lets
// the pricing task read it without knowing a pass happened at all.
const sw = require('./stagework');
const bracketLib = require('./bracket');

// ONE PASS'S FORECASTS, TRAINED (worker-safe). The members and their views are
// the stage 2 record's own specs, so a pass trains exactly the committee the
// set was built from -- a different committee would be a different question.
// The chunks are that pass's, and the votes on its test slice and its judging
// stretch come back with each member's saved model, in the shape the stage 3
// pricing task already reads.
async function passTrainTask(task) {
  const { combo, geometry, specs, of, k } = task;
  const pin = task.pin && typeof task.pin === 'string' ? require('./pin').pinnedFilesOf({ detailFile: task.pin }) : null;
  // THE PARENT'S OWN LAYOUT TRAVELS UNTOUCHED in params.windowLayout, so
  // whatever it seals is sealed before the pass cuts anything (3.111.1). The
  // pass is a modifier on that layout, never a replacement for it.
  const p = { ...task.params, pinnedFiles: pin, pass: { of, k } };
  const { geo, split, windows } = await sw.unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks } = split;
  if (!holdChunks.length) throw new Error(`pass ${k} of ${of} came back with no judging stretch`);
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  // votes are wanted on BOTH the test slice and the judging stretch: the test
  // slice is what a pass's own reading of its settings is taken on, the
  // judging stretch is what it is judged on.
  const predictChunks = [...testChunks, ...holdChunks];
  const members = [];
  for (const spec of specs) {
    const viewIdx = views[spec.view];
    if (!viewIdx) throw new Error(`no view called '${spec.view}' on this coin and shape`);
    // eslint-disable-next-line no-await-in-loop
    const m = await sw.trainProbMember({ model: spec.model, viewIdx, trainChunks, predictChunks });
    members.push({ spec: { model: spec.model, view: spec.view }, saved: m.saved, picked: m.picked, tauProbs: m.tauProbs, probs: m.probs });
  }
  return {
    of, k, trainedBandPct: split.bandPct, windows,
    counts: { train: trainChunks.length, test: testChunks.length, judge: holdChunks.length },
    ts: { test: testChunks.map((c) => c.startTs), judge: holdChunks.map((c) => c.startTs) },
    members,
  };
}

module.exports = { passTrainTask };
