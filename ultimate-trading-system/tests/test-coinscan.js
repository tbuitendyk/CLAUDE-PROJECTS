// WALK IT FORWARD: every number priced knowing only what sat behind it
// (owner's design, 2026-09-17).
//
// The success rules these check were agreed before the walk ran on any real
// coin, which is the only reason a green result here means anything:
//
//   1. a window never reads its own outcomes to decide how to trade them
//   2. a relationship that starts halfway through shows as starting halfway
//      through, not as a whole history that was always good
//   3. a planted relationship beats its own scrambled copies; noise does not
//   4. a tail too short for a whole window is dropped, never reported short
const { assert } = require('./helpers');
const {
  windowsOf, usualMoveAt, signsBefore, walk, scrambled, periodsForMonths,
  walkTask, walkTasksFor, rowOf, walkEverything,
} = require('../lib/coinscan');
const fs = require('fs');
const path = require('path');

// A COIN MADE TO ORDER. `switchAt` is where the relationship starts: before
// it the outcome ignores the move entirely, after it a big rise is always
// followed by a fall and a big fall by a rise.
function madeUpCoin(n, switchAt) {
  const move = []; const out = [];
  let s = 11;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const m = (rnd() - 0.5) * 20;
    move.push(m);
    if (i < switchAt) out.push((rnd() - 0.5) * 4);
    else out.push(m > 4 ? -3 : (m < -4 ? 3 : (rnd() - 0.5) * 0.4));
  }
  return { move, out };
}

const BASE = { band: 100, span: 120, warmUp: 240, usual: 'trailing', signsMode: 'rolled', floor: 5 };

function theWindowsStartAfterTheWarmUpAndTheShortTailIsDropped() {
  const w = windowsOf(1000, 240, 120);
  assert(w[0].from === 240, `the first window starts at the warm-up, not ${w[0].from}`);
  for (let i = 1; i < w.length; i++) {
    assert(w[i].from === w[i - 1].to + 1, 'the windows meet with no gap and no overlap');
    assert(w[i].to - w[i].from + 1 === 120, 'every window is a whole window');
  }
  assert(w[w.length - 1].to < 1000, 'no window runs past the end');
  assert(1000 - 1 - w[w.length - 1].to < 120, 'the dropped tail is shorter than one window');
}

function theUsualMoveTrailingSeesOnlyWhatIsBehindIt() {
  const move = [1, 1, 1, 1, 1, 50, 50, 50, 50, 50];
  const early = usualMoveAt(move, 5, 'trailing');
  const whole = usualMoveAt(move, 5, 'whole');
  assert(early === 1, `trailing at period 5 reads only the quiet half, got ${early}`);
  assert(whole > early, `the whole-history figure sees the loud half too, got ${whole} against ${early}`);
}

function theSignsAreLearnedFromBeforeTheWindowAndNothingElse() {
  // every outcome AFTER index 10 is huge and positive; the signs taken at 10
  // must not feel it at all
  const move = []; const out = [];
  for (let i = 0; i < 40; i++) { move.push(i % 2 ? 5 : -5); out.push(i < 10 ? (i % 2 ? -1 : 1) : 100); }
  const s = signsBefore(move, out, 10, 1);
  assert(s.r === -1, `after a rise the periods before 10 lost, so the sign is -1, got ${s.r}`);
  assert(s.f === 1, `after a fall the periods before 10 gained, so the sign is +1, got ${s.f}`);
  assert(s.nr === 5 && s.nf === 5, `only the ten periods before were read, got ${s.nr} and ${s.nf}`);
}

function aRelationshipThatStartsHalfwayShowsAsStartingHalfway() {
  const n = 1800;
  const switchAt = 900;
  const { move, out } = madeUpCoin(n, switchAt);
  const w = walk(move, out, BASE);
  const before = w.rows.filter((r) => !r.thin && r.n && r.to < switchAt);
  const after = w.rows.filter((r) => !r.thin && r.n && r.from > switchAt + BASE.span);
  assert(before.length >= 3, `there are windows before the switch to read, got ${before.length}`);
  assert(after.length >= 3, `there are windows after it to read, got ${after.length}`);
  const avg = (a) => a.reduce((x, r) => x + r.perTrade, 0) / a.length;
  assert(avg(after) > avg(before) + 1, `the late windows must stand out: early ${avg(before).toFixed(3)}, late ${avg(after).toFixed(3)}`);
  const upBefore = before.filter((r) => r.perTrade > 0).length;
  assert(upBefore <= Math.ceil(before.length * 0.75), `before the switch the windows are a coin flip, not ${upBefore} of ${before.length} up`);
}

function aWindowNeverReadsItsOwnOutcomesToDecideHowToTradeThem() {
  // THE CAUSALITY GUARD. Rewriting the outcomes of the LAST window alone must
  // leave every window before it identical -- if any earlier figure moves, a
  // window somewhere read something ahead of itself.
  const n = 1500;
  const { move, out } = madeUpCoin(n, 300);
  const a = walk(move, out, BASE);
  const last = a.rows.filter((r) => r.n).pop();
  const out2 = out.slice();
  for (let i = last.from; i <= last.to; i++) out2[i] = -out2[i] * 9;
  const b = walk(move, out2, BASE);
  for (let i = 0; i < a.rows.length; i++) {
    if (a.rows[i].from >= last.from) continue;
    assert(a.rows[i].n === b.rows[i].n, `window at ${a.rows[i].from} changed its trade count when a LATER window's outcomes were rewritten`);
    const x = a.rows[i].perTrade; const y = b.rows[i].perTrade;
    assert((x == null && y == null) || Math.abs(x - y) < 1e-12, `window at ${a.rows[i].from} changed its money when a LATER window's outcomes were rewritten: ${x} against ${y}`);
  }
}

function aPlantedRelationshipBeatsItsScramblesAndNoiseDoesNot() {
  const real = madeUpCoin(1800, 0);
  const got = scrambled(real.move, real.out, BASE, 12, 'planted');
  assert(got.real.perTrade > 1, `the planted relationship pays, got ${got.real.perTrade}`);
  assert(got.asGood === 0, `no scrambled copy should match a planted relationship, ${got.asGood} did`);

  // THE COMPARISON HAS TO BE FAIR, AND ONE COIN CANNOT SHOW THAT. Checked on
  // ONE noise coin this failed on the first seed tried and the implementation
  // was innocent: beating all twelve happens about one time in thirteen by
  // chance, so a single draw is a coin flip dressed as a guard. Twenty coins
  // with nothing in them must land ACROSS the range; if the null were biased
  // -- if the real series were flattered by how the copies are dealt -- nearly
  // all twenty would beat all twelve, and that is what this catches.
  const beatThemAll = [];
  for (let seed = 1; seed <= 20; seed++) {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const move = []; const out = [];
    for (let i = 0; i < 1800; i++) { move.push((rnd() - 0.5) * 20); out.push((rnd() - 0.5) * 4); }
    const none = scrambled(move, out, BASE, 12, `noise${seed}`);
    if (none.asGood === 0) beatThemAll.push(seed);
  }
  assert(beatThemAll.length <= 8, `noise must not beat its own copies as a rule: ${beatThemAll.length} of 20 coins with nothing in them beat all twelve, and about 1 or 2 is fair`);
}

function aWindowUnderTheFloorIsLeftOutOfTheTotalsAndSaysSo() {
  const { move, out } = madeUpCoin(1200, 0);
  const tight = walk(move, out, { ...BASE, band: 900, floor: 20 });
  const thin = tight.rows.filter((r) => r.thin);
  assert(thin.length >= 1, 'a band this wide leaves windows under the floor');
  assert(tight.windows + thin.length === tight.rows.length, 'every window is either counted or marked thin, never both and never neither');
  for (const r of thin) assert(r.n < 20, `a thin window has fewer than the floor, got ${r.n}`);
}

// THE TWO BOXES' ALLOW-LIST LIVES HERE, and test-sweepcontract.js points at
// this test by name for it. A value neither box offers must land on the safe
// one rather than doing something the screen never showed.
function anythingButTheTwoValuesEachBoxOffersFallsToItsSafeOne() {
  const { move, out } = madeUpCoin(1500, 0);
  const same = (a, b, what) => {
    assert(a.rows.length === b.rows.length, `${what}: the same windows`);
    for (let i = 0; i < a.rows.length; i++) {
      const x = a.rows[i].perTrade; const y = b.rows[i].perTrade;
      assert((x == null && y == null) || Math.abs(x - y) < 1e-12, `${what}: window ${i} differs, ${x} against ${y}`);
    }
  };
  same(walk(move, out, { ...BASE, usual: 'trailing' }), walk(move, out, { ...BASE, usual: 'nonsense' }), 'an unknown usual-move value reads trailing');
  same(walk(move, out, { ...BASE, signsMode: 'rolled' }), walk(move, out, { ...BASE, signsMode: 'nonsense' }), 'an unknown leaning value rolls');
  // and the two each box DOES offer are genuinely different, or the check above
  // would pass on a walk that ignored the box entirely
  const trailing = walk(move, out, { ...BASE, usual: 'trailing' });
  const whole = walk(move, out, { ...BASE, usual: 'whole' });
  const rolled = walk(move, out, { ...BASE, signsMode: 'rolled' });
  const fixed = walk(move, out, { ...BASE, signsMode: 'fixed', fixedUpTo: 400 });
  assert(trailing.trades !== whole.trades || Math.abs((trailing.perTrade || 0) - (whole.perTrade || 0)) > 1e-9, 'trailing and whole history are not the same walk');
  assert(rolled.trades !== fixed.trades || Math.abs((rolled.perTrade || 0) - (fixed.perTrade || 0)) > 1e-9, 'rolled and learned-once are not the same walk');
}

function monthsBecomeDecisionsOnEachShapesOwnClock() {
  assert(periodsForMonths(6, 24) === 183, `six months of daily steps is 183 decisions, got ${periodsForMonths(6, 24)}`);
  assert(periodsForMonths(6, 168) === 26, `six months of weekly steps is 26 decisions, got ${periodsForMonths(6, 168)}`);
  assert(periodsForMonths(0, 24) === 0, 'no months is no decisions rather than a crash');
}

// EVERY WALK IS LISTED BEFORE ANY OF IT RUNS, so the screen can say "0 of 450"
// from the first second instead of one word that could mean anything.
function everyWalkIsListedUpFrontOnePerCoinShapeAndBand() {
  const { move, out } = madeUpCoin(900, 0);
  const records = [
    { coin: 'AAAUSDT', read: true, shapes: { 'daily-1d': { move, out, periods: 900, ts: move.map((_, i) => i) } } },
    { coin: 'BBBUSDT', read: true, shapes: { 'daily-1d': { move, out, periods: 900, ts: move.map((_, i) => i) } } },
    { coin: 'CCCUSDT', read: false, shapes: { 'daily-1d': { move, out, periods: 900 } } },
  ];
  const geos = { 'daily-1d': { stepHours: 24 } };
  const plain = walkTasksFor(records, geos, { bands: [50, 100], sweetSpots: null, windowMonths: 6, warmUpMonths: 12 });
  assert(plain.length === 4, `two coins read, two bands, so four walks, got ${plain.length}`);
  assert(!plain.some((t) => t.coin === 'CCCUSDT'), 'a coin that could not be read is not walked');
  assert(!plain.some((t) => t.searched), 'with no sweet spot given, no walk is marked searched');
  const withSpot = walkTasksFor(records, geos, { bands: [50, 100], sweetSpots: { 'AAAUSDT|daily-1d': 175 }, windowMonths: 6, warmUpMonths: 12 });
  assert(withSpot.length === 5, `the one sweet spot adds one walk, got ${withSpot.length}`);
  const spot = withSpot.filter((t) => t.searched);
  assert(spot.length === 1 && spot[0].band === 175 && spot[0].coin === 'AAAUSDT', 'exactly the sweet spot walk is marked searched');
  // a sweet spot the owner already typed is not walked twice
  const dup = walkTasksFor(records, geos, { bands: [50, 175], sweetSpots: { 'AAAUSDT|daily-1d': 175 }, windowMonths: 6, warmUpMonths: 12 });
  assert(dup.length === 4, `a sweet spot already in the typed bands is not walked twice, got ${dup.length}`);
}

// THE WORKER PATH AND THE ONE-THREAD PATH MUST AGREE TO THE DIGIT. Four
// hundred walks moved onto the pool in 3.158.0; if the two ever differ, a
// number on the screen depends on how many cores the box has.
async function theWorkerPathAndTheOneThreadPathGiveTheSameRows() {
  const { move, out } = madeUpCoin(1200, 0);
  const records = [{ coin: 'AAAUSDT', read: true, shapes: { 'daily-1d': { move, out, periods: 1200, ts: move.map((_, i) => 1000 + i) } } }];
  const geos = { 'daily-1d': { stepHours: 24 } };
  const opts = { bands: [100, 150], sweetSpots: null, windowMonths: 6, warmUpMonths: 12, scrambles: 4, floor: 5 };
  const oneThread = await walkEverything(records, geos, opts, null);
  const viaTasks = walkTasksFor(records, geos, opts).map((t) => rowOf(t, walkTask(t.payload)));
  assert(oneThread.length === viaTasks.length, `the same number of rows, ${oneThread.length} against ${viaTasks.length}`);
  for (let i = 0; i < oneThread.length; i++) {
    assert(JSON.stringify(oneThread[i]) === JSON.stringify(viaTasks[i]),
      `row ${i} differs between the two paths:\n  one thread: ${JSON.stringify(oneThread[i]).slice(0, 220)}\n  tasks:      ${JSON.stringify(viaTasks[i]).slice(0, 220)}`);
  }
}

// THE POOL CAN ACTUALLY RUN IT. A task kind registered on one side and not the
// other is how a walk would silently fall back to the main thread.
function thePoolKnowsTheWalkOnBothItsPaths() {
  const pool = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pool.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'lib', 'worker.js'), 'utf8');
  assert(/coinWalk: require\('\.\/coinscan'\)\.walkTask,/.test(pool), 'the inline path runs the walk');
  assert(/coinWalk: require\('\.\/coinscan'\)\.walkTask,/.test(worker), 'and so does a worker thread');
}

// THE SCREEN SAYS WHAT THE BOX IS DOING, AND KEEPS SAYING IT (owner,
// 2026-09-17: "there's no indication it's working, and it looks like it's not
// working"). The press starts a run and answers at once; the panel polls it,
// counts it off with the box's busy share, offers Stop, and picks a running
// walk back up when the tab is opened again.
function theWalkSaysWhatItIsDoingAndSurvivesLeavingTheTab() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(/app\.post\('\/api\/coins\/walk'/.test(srv), 'the press has a door');
  assert(/app\.get\('\/api\/coins\/walk'/.test(srv), 'and the count has one');
  assert(/app\.post\('\/api\/coins\/walk\/stop'/.test(srv), 'and Stop has one');
  assert(/walking · \$\{st\.done\} of \$\{st\.of\}/.test(src), 'the line counts the walks off');
  assert(/\$\{fCpuWords\(st\.cpu\)\}/.test(src), 'and says how busy the box is, the same words every other progress line uses');
  assert(/across \$\{st\.workers\} worker/.test(src), 'and how many workers it is across');
  assert(/cWalkPoll = setTimeout\(cWalkTick, 1000\)/.test(src), 'it polls once a second while it runs');
  assert(/if \(tab !== 'coins'\) return;/.test(src), 'and stops the moment the tab is left');
  assert(/cWalkBind\(\);\n  cWalkTick\(\);/.test(src), 'opening the tab picks a running walk back up');
  assert(/<button id="wStop">Stop<\/button>/.test(src), 'Stop is offered while it runs');
  // RULE FOUR: the buttons sit in a row of their own, the way every other
  // button on this screen does -- mixed in with the two-line labels they
  // floated off the baseline of the boxes beside them.
  const rowWithRun = /<div class="row">\s*<button id="wRun"[^>]*>Walk it forward<\/button>\s*\$\{walking \? '<button id="wStop">Stop<\/button>' : ''\}\s*<span id="wOut"/;
  assert(rowWithRun.test(src), 'the buttons and the line share a row with no field in it');
}

module.exports = {
  theWindowsStartAfterTheWarmUpAndTheShortTailIsDropped,
  theUsualMoveTrailingSeesOnlyWhatIsBehindIt,
  theSignsAreLearnedFromBeforeTheWindowAndNothingElse,
  aRelationshipThatStartsHalfwayShowsAsStartingHalfway,
  aWindowNeverReadsItsOwnOutcomesToDecideHowToTradeThem,
  aPlantedRelationshipBeatsItsScramblesAndNoiseDoesNot,
  aWindowUnderTheFloorIsLeftOutOfTheTotalsAndSaysSo,
  anythingButTheTwoValuesEachBoxOffersFallsToItsSafeOne,
  monthsBecomeDecisionsOnEachShapesOwnClock,
  everyWalkIsListedUpFrontOnePerCoinShapeAndBand,
  theWorkerPathAndTheOneThreadPathGiveTheSameRows,
  thePoolKnowsTheWalkOnBothItsPaths,
  theWalkSaysWhatItIsDoingAndSurvivesLeavingTheTab,
};
