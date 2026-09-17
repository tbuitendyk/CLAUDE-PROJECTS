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
  walkTask, walkTasksFor, rowOf,
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

// THE TASK WRAPPER CHANGES NOTHING ABOUT THE ARITHMETIC. A walk is split into
// a task per coin, shape, look-back and band and sent to a worker, so the row
// that comes back has been through walkTask and rowOf rather than through
// scrambled() directly. If those two ever disagreed, a figure on the screen
// would depend on how the work was divided up.
//
// 3.159.0: this used to compare against walkEverything, a whole second
// implementation kept alive only to be compared with -- which is a second copy
// however it is justified. It is deleted; this checks the wrapper against the
// arithmetic it wraps, which is the thing that can actually drift.
async function theTaskWrapperGivesExactlyWhatTheArithmeticGives() {
  const { move, out } = madeUpCoin(1200, 0);
  const records = [{ coin: 'AAAUSDT', read: true, shapes: { 'daily-1d': { move, out, periods: 1200, ts: move.map((_, i) => 1000 + i) } } }];
  const geos = { 'daily-1d': { stepHours: 24 } };
  const opts = { bands: [100, 150], sweetSpots: null, windowMonths: 6, warmUpMonths: 12, scrambles: 4, floor: 5 };
  const tasks = walkTasksFor(records, geos, opts);
  assert(tasks.length === 2, `two bands, two tasks, got ${tasks.length}`);
  for (const t of tasks) {
    const viaTask = rowOf(t, walkTask(t.payload));
    const direct = scrambled(t.payload.move, t.payload.out, t.payload.opts, t.payload.copies, t.payload.seedText);
    assert(viaTask.trades === direct.real.trades, `band ${t.band}: trades differ`);
    assert(Math.abs(viaTask.perTrade - direct.real.perTrade) < 1e-12, `band ${t.band}: money differs`);
    assert(viaTask.windows === direct.real.windows && viaTask.windowsUp === direct.real.windowsUp, `band ${t.band}: the window counts differ`);
    assert(viaTask.asGood === direct.asGood, `band ${t.band}: the scrambled count differs`);
    assert(viaTask.scan.length === direct.real.rows.length, `band ${t.band}: the strip differs`);
    assert(viaTask.lookback === 'own', `band ${t.band}: a walk with no look-back asked for reads the shape's own`);
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

// EVERY COLUMN SORTS, THE WAY BOARDS ALREADY DID (owner, 2026-09-17). A box
// beside the table was a second way of doing something this screen does one
// way, and it could not sort half the columns at all.
function everyColumnOfTheWalkTableSorts() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  assert(!/<select id="wSort">/.test(src), 'the sort box is gone, not left beside the sorters');
  for (const key of ['coin', 'geometry', 'band', 'trades', 'perTrade', 'windows', 'windowsUp', 'best', 'worst', 'asGood']) {
    assert(new RegExp(`cWalkSortBtn\\('${key}'`).test(src), `the ${key} column has a sorter`);
  }
  assert(/data-wsort="\$\{key\}"/.test(src), 'each sorter names its column');
  assert(/cState\.wDir = cState\.wDir === 'asc' \? 'desc' : 'asc';/.test(src), 'a second click flips it');
  assert(/if \(cState\.wSort !== key\) \{ cState\.wSort = key; cState\.wDir = first; \}/.test(src), 'a different column starts at its own first direction');
  assert(/if \(a == null\) return 1;\s*\n\s*if \(b == null\) return -1;/.test(src),
    'a row with nothing in the sorted column goes last whichever way the arrow points -- sorting a missing figure as a very small one would put unreadable rows at the top of an ascending sort and read as a result');
}

// THE HEADINGS STAY PUT WHILE THE ROWS SCROLL (owner, 2026-09-17). Four
// hundred rows with the headings off the top of the screen is a table you
// cannot read. Built the same way the Stage 4 table already does it, not a
// second way.
function theWalkTableKeepsItsHeadingsWhileTheRowsScroll() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.html'), 'utf8');
  assert(/<div class="cwbox"><table class="cgap cpassers">/.test(src), 'the rows sit in their own box');
  assert(/<\/table><\/div>/.test(src), 'and the box closes after the table');
  assert(/div\.cwbox \{ overflow:auto; max-height:24rem; \}/.test(css), 'the box scrolls and is about fifteen rows deep');
  assert(/div\.cwbox table thead th \{ position:sticky; top:0;/.test(css), 'the headings are stuck to the top of that box');
  assert(/box-shadow:inset 0 -1px 0 var\(--line\)/.test(css.slice(css.indexOf('div.cwbox'))),
    'the line under the heading is a shadow -- a collapsed border on a sticky cell scrolls away with its row');
}

// WINDOWS UP ORDERS BY SHARE, AND MORE WINDOWS WINS A TIE (owner, 2026-09-17:
// "ordering the table by WINDOWS UP ought to put 8/8 at the top ... higher
// denominator beats lower"). A plain share put a ONE-window row of six trades
// above eight of eight, because both are 1.0 and the tie fell to the coin's
// name. Sixteen rows on the owner's run had every window up and fourteen sat
// on three windows or fewer.
function windowsUpOrdersByShareAndMoreWindowsWinsATie() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  assert(/const second = how === 'windowsUp' \? \(r\) => r\.windows : null;/.test(src),
    'the share carries a second key, the count of windows');
  assert(/if \(second\) \{ const d = second\(y\) - second\(x\); if \(d\) return d; \}/.test(src),
    'and more windows ranks above fewer at the same share, in BOTH directions -- more evidence beats less whichever way the arrow points');
  assert(/if \(a !== b\) return dir \* \(a - b\);/.test(src), 'the share is still the first key');
}

// OPENING A ROW DOES NOT THROW THE TABLE BACK TO THE TOP (owner, 2026-09-17).
// Two scroll bars to keep since the headings were frozen: the page's and the
// rows' box. Both are read BEFORE the panel is replaced, for the reason
// drawBoardsHoldingPlace gives -- a place read after the rebuild is the one
// the browser clamped to, not the owner's.
function openingARowLeavesBothScrollBarsWhereTheyWere() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const fn = src.slice(src.indexOf('function cWalkRepaint()'), src.indexOf('function cWalkBind()'));
  assert(/const y = window\.scrollY;/.test(fn), 'the page place is taken');
  assert(/const top = box \? box\.scrollTop : 0;/.test(fn), 'and the rows box place');
  assert(fn.indexOf('const top =') < fn.indexOf('wrap.innerHTML = cWalkPanel()'),
    'both are taken BEFORE the panel is replaced, or the figure read is the clamped one');
  assert(/b\.scrollTop = top; b\.scrollLeft = left;/.test(fn), 'the box is put back');
  assert(/window\.scrollTo\(0, y\)/.test(fn), 'and the page');
  assert(/holdScrollMemory\(\)/.test(fn), 'and the tab memory is held so it cannot overwrite it');
  assert(/requestAnimationFrame\(\(\) => requestAnimationFrame\(/.test(fn), 'put back after the layout has settled, not during it');
}

// THE STRIP IS STYLED AGAINST CLASSES THAT EXIST, AND SAYS HOW MANY WINDOWS
// WERE EMPTY (owner, 2026-09-17: "+2.062020-01+1.182020-07..."). The first
// version used .cwstrip and .cwwin and defined neither, so every date and
// figure ran together into one string of digits -- RULE FOUR's "never style
// against a class that does not exist", walked into head first. And a wide
// band leaves whole half-years with too few trades, so a row reading 8 of 8
// is eight COUNTED windows out of thirteen and the owner could not see that.
function theWindowStripIsReadableAndSaysWhatIsMissing() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.html'), 'utf8');
  for (const cls of ['div.cwstrip', 'div.cwstrip span.cwwin', 'div.cwstrip span.cwwin i', 'div.cwstrip span.cwwin b', 'p.cwsays']) {
    assert(css.includes(`${cls} {`), `${cls} is styled, not used against nothing`);
  }
  assert(/div\.cwstrip span\.cwwin \{ display:flex; flex-direction:column;/.test(css),
    'each window stacks its date over its figure, so which belongs to which cannot be misread');
  assert(/<i>\$\{esc\(cDay\(w\.ts\)\)\.slice\(0, 7\)\}<\/i><b/.test(src), 'the date comes first, then the figure');
  assert(/window\(s\) in this coin's history · \$\{all\.length - blanks\} counted/.test(src),
    'the line above the strip says how many windows there are against how many counted');
  assert(/had too few trades to count and show as a dash/.test(src), 'and says what a dash means');
  assert(/NOT how many windows the coin has/.test(src), 'the windows column says what it does not count');
}

// THE LOOK-BACK IS ITS OWN AXIS (owner, 2026-09-17). The shape decides the
// trade; the look-back decides what is looked at. A look-back the record does
// not carry is left out rather than guessed at.
function theLookBackIsItsOwnAxisAndOnlyWhatTheRecordCarries() {
  const { move, out } = madeUpCoin(900, 0);
  const back = move.map((m, i) => (i < 40 ? null : m * 0.5));
  const records = [{ coin: 'AAAUSDT', read: true, shapes: { 'daily-1d': { move, out, periods: 900, ts: move.map((_, i) => i), moves: { 72: back } } } }];
  const geos = { 'daily-1d': { stepHours: 24 } };
  const base = { bands: [100], sweetSpots: null, windowMonths: 6, warmUpMonths: 12 };
  const none = walkTasksFor(records, geos, base);
  assert(none.length === 1 && none[0].lookback === 'own', 'with none asked for, only the shape\'s own');
  const one = walkTasksFor(records, geos, { ...base, lookbacks: [72] });
  assert(one.length === 2, `the shape's own and the one look-back, got ${one.length}`);
  assert(one.map((t) => t.lookback).join(',') === 'own,72', `both axes, got ${one.map((t) => t.lookback).join(',')}`);
  assert(one[1].payload.move === back, 'the look-back task carries the look-back array, not the shape\'s own');
  // a look-back the record does not hold is not invented
  const missing = walkTasksFor(records, geos, { ...base, lookbacks: [72, 336] });
  assert(missing.length === 2, `336 is not in the record so it is not walked, got ${missing.length} tasks`);
  // the seed differs per look-back, or two axes would share one set of copies
  assert(one[0].payload.seedText !== one[1].payload.seedText, 'each look-back gets its own scrambled copies');
}

// BOTH LOOK-BACK BOXES ARE ON SCREEN, AND THEY ARE IN THE RIGHT PLACES. The
// one that decides what gets STORED sits on Coins beside the band, because it
// is measured when the coins are read and a change to it means nothing until
// they are read again. The one that decides what gets WALKED sits on Walk it
// forward, because it costs nothing and can be changed between walks.
function bothLookBackBoxesAreOnScreenWhereTheyBelong() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
  const run = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(/id="cBacks"/.test(src), 'the store box is on Coins');
  assert(/id="wBacks"/.test(src), 'the walk box is on Walk it forward');
  assert(/look-backs to store, hours/.test(src), 'and it says what it does');
  assert(/look-backs to try, hours/.test(src), 'and so does the other');
  assert(/cBacks: /.test(help) && /wBacks: /.test(help), 'both are described on Help');
  assert(/app\.post\('\/api\/coins\/lookbacks'/.test(srv), 'the store box has a door');
  assert(/read the coins again for this to reach the records/.test(run),
    'and setting them SAYS a read is needed, rather than looking as though it took effect');
  assert(/const RECORD_V = 9;/.test(run), 'the record shape moved, so a record written under the old reading is refused rather than mixed in');
  assert(/look-back\$\{cWalkSortBtn\('lookback', 'asc'\)\}/.test(src), 'the table has a look-back column and it sorts');
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
  theTaskWrapperGivesExactlyWhatTheArithmeticGives,
  thePoolKnowsTheWalkOnBothItsPaths,
  theWalkSaysWhatItIsDoingAndSurvivesLeavingTheTab,
  everyColumnOfTheWalkTableSorts,
  theWalkTableKeepsItsHeadingsWhileTheRowsScroll,
  windowsUpOrdersByShareAndMoreWindowsWinsATie,
  openingARowLeavesBothScrollBarsWhereTheyWere,
  theWindowStripIsReadableAndSaysWhatIsMissing,
  theLookBackIsItsOwnAxisAndOnlyWhatTheRecordCarries,
  bothLookBackBoxesAreOnScreenWhereTheyBelong,
};
