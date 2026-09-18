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
//   5. a SLIDING copy cuts the link between reading and outcome just as
//      completely as a dealt one -- a planted relationship beats both
//   6. and on a coin that simply drifts one way and then the other, with the
//      reading knowing nothing about the outcome, the DEALT copies come out
//      far harder to beat than they should be and the SLID ones come out
//      fair. Written down before this release shipped, on made-up coins.
const { assert } = require('./helpers');
const {
  windowsOf, usualMoveAt, signsBefore, walk, scrambled, slidOffsets, periodsForMonths,
  walkTask, walkTasksFor, rowOf, chooseThenRead, moneyOver, ROUND_TRIP,
  forwardHoursOf, oneShapePerForwardTime,
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
    assert(viaTask.asGoodSlid === direct.asGoodSlid, `band ${t.band}: the slid count differs`);
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
  for (const key of ['coin', 'geometry', 'band', 'lookback', 'trades', 'perTrade', 'windows', 'windowsUp', 'paid', 'best', 'worst', 'asGood', 'asGoodSlid']) {
    assert(new RegExp(`cWalkSortBtn\\('${key}'`).test(src), `the ${key} column has a sorter`);
  }
  // 3.164.0: one sorting mechanism, two tables -- the walk's own button is a
  // thin call onto cSortBtn, which names the column through data-<attr>
  assert(/return ` <button data-\$\{attr\}="\$\{key\}"/.test(src), 'each sorter names its column');
  assert(/function cWalkSortBtn\(key, firstDir\) \{ return cSortBtn\('wSorts', 'wsort', key, firstDir\); \}/.test(src),
    'and the walk\'s table sorts through the one mechanism, not a second copy of it');
  // 3.164.0: a click CYCLES -- off, this way, the other way, off -- and more
  // than one column can be in the sort at once, in the order they were clicked.
  assert(/else if \(list\[at\]\.dir === first\) list\[at\] = \{ key, dir: other \};/.test(src), 'a second click flips it');
  assert(/if \(at < 0\) list\.push\(\{ key, dir: first \}\);/.test(src), 'a different column starts at its own first direction, at the end of the order');
  assert(/else list\.splice\(at, 1\);/.test(src), 'and a third click drops it out of the sort, leaving the rest alone');
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
  // 3.164.0: the sort takes a LIST of columns, so the share's second key moved
  // inside the loop that walks it. Same rule, same both-directions guarantee.
  assert(/windowsUp: \(r\) => \(r\.windows \? r\.windowsUp \/ r\.windows : null\),/.test(src),
    'the share carries a second key, the count of windows');
  // 3.165.0: the sorter no longer tests for the one key it happened to know
  // about -- each table hands it a map of which columns are shares and what
  // sits behind them, so a share column added later cannot be left without a
  // second key by nobody remembering to add one.
  assert(/const deep = DEPTH && DEPTH\[s\.key\];\s*\n\s*if \(deep\) \{ const d = deep\(y\) - deep\(x\); if \(d\) return d; \}/.test(src),
    'and more windows ranks above fewer at the same share, in BOTH directions -- more evidence beats less whichever way the arrow points');
  assert(/const C_WALK_DEPTH = \{ windowsUp: \(r\) => r\.windows, paid: \(r\) => r\.windows \};/.test(src),
    'the walk names BOTH of its shares there, or the new column ranks a row of three windows above a row of fifteen');
  assert(/function cWalkSorted\(rows\) \{ return cSortRows\(rows, cState\.wSorts, C_WALK_OF, cWalkTie, C_WALK_DEPTH\); \}/.test(src),
    'and the map actually reaches the sorter');
  assert(/function cSplitSorted\(pairs\) \{ return cSortRows\(pairs, cState\.sSorts, C_SPLIT_OF, cSplitTie, C_SPLIT_DEPTH\); \}/.test(src),
    'the same on choose early, read late');
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
  // OWNER, 2026-09-17: "make them both wider so that I can get a longer range
  // of hours in and see the whole string." Both hold the same kind of string,
  // so both are the same width, and a width that fits about a dozen entries.
  const widthOf = (id) => {
    const m = new RegExp(`id="${id}"[^>]*style="width:(\\d+)rem"`).exec(src)
      || new RegExp(`id="${id}"[^>]*?style="width:(\\d+)rem"`).exec(src);
    return m ? Number(m[1]) : null;
  };
  const a = widthOf('cBacks'); const b = widthOf('wBacks');
  assert(a != null && b != null, `both look-back boxes state a width, got ${a} and ${b}`);
  assert(a === b, `the two look-back boxes hold the same kind of string, so they are the same width: ${a}rem against ${b}rem`);
  assert(a >= 24, `a long range of hours has to be readable in the box, and ${a}rem is not enough`);
}

// ONE OUTCOME'S NEIGHBOURS ARE THE ONES IT ACTUALLY HAD. A slid copy is the
// whole outcome series moved along and wrapped round, so it holds every
// outcome exactly once and every outcome keeps the outcome that followed it --
// except at the single seam where the end meets the beginning.
function aSlidCopyKeepsEveryOutcomeBesideTheOnesItHappenedBeside() {
  const n = 500;
  const out = []; for (let i = 0; i < n; i++) out.push(i);
  const offsets = slidOffsets(n, 40, 12345);
  assert(offsets.length === 40, `forty copies, forty offsets, got ${offsets.length}`);
  assert(new Set(offsets).size === 40, 'no two copies of the same walk slide to the same place');
  for (const k of offsets) assert(k >= 1 && k <= n - 1, `an offset of ${k} is either no slide at all or off the end`);
  assert(JSON.stringify(slidOffsets(n, 40, 12345)) === JSON.stringify(offsets), 'the same seed gives the same offsets tomorrow');
  assert(JSON.stringify(slidOffsets(n, 40, 999)) !== JSON.stringify(offsets), 'a different seed gives different ones');
  for (const k of offsets.slice(0, 5)) {
    const slid = []; for (let i = 0; i < n; i++) slid.push(out[(i + k) % n]);
    assert(new Set(slid).size === n, `offset ${k}: every outcome is still there exactly once`);
    let seams = 0;
    for (let i = 0; i + 1 < n; i++) if (slid[i + 1] !== slid[i] + 1) seams++;
    assert(seams <= 1, `offset ${k}: a slide has ONE seam where the end meets the beginning, got ${seams} breaks in the run`);
  }
  assert(slidOffsets(2, 10, 1).length === 0, 'a series too short to slide anywhere is not pretended to be slid');
  assert(slidOffsets(500, 0, 1).length === 0, 'no copies asked for, none built');
}

// AND IT STILL CUTS THE THING THE COPY EXISTS TO CUT. A copy that kept the
// link between reading and outcome would be no yardstick at all, and a slide
// is a gentler operation than a deal -- so this is the guard that says the
// gentler one is still enough.
function aPlantedRelationshipBeatsItsSlidCopiesToo() {
  const real = madeUpCoin(1800, 0);
  const got = scrambled(real.move, real.out, BASE, 12, 'planted-slide');
  assert(got.real.perTrade > 1, `the planted relationship pays, got ${got.real.perTrade}`);
  assert(got.asGoodSlid === 0, `no slid copy should match a planted relationship, ${got.asGoodSlid} did`);
  assert(got.asGood === 0, 'and neither should a dealt one');
}

// THE MEASUREMENT THIS RELEASE IS FOR, WRITTEN DOWN BEFORE IT SHIPPED. A coin
// that simply drifts one way for a stretch and then the other, with the
// reading knowing NOTHING about the outcome: there is no edge here and every
// copy should be beaten about half the time. Dealing the outcomes into a new
// order destroys the drift entirely, and the dealt copies come out far
// stronger than fair -- about 80% of them as good as the real row, where 50%
// is fair. Sliding keeps every run of drift intact and lands near fair.
//
// This is the OPPOSITE direction to what I told the owner it would show, and
// it is left here in its own words so nobody re-derives the wrong story from
// the shape of the fix (RULE SIX: hunt your own instrument).
function theDealtCopiesAreUnfairOnADriftingCoinAndTheSlidOnesAreNot() {
  const COINS = 10; const COPIES = 16; const N = 1400;
  let dealt = 0; let slid = 0;
  for (let seed = 1; seed <= COINS; seed++) {
    let s = (seed * 2654435761) >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gauss = () => { let u = 0; let v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const move = []; const out = []; let mu = 0; let left = 0;
    for (let i = 0; i < N; i++) {
      if (left <= 0) { mu = (rnd() < 0.5 ? 1 : -1) * 0.45; left = 150; }
      left--;
      move.push(gauss() * 10);          // the reading is disconnected from the outcome
      out.push(mu + gauss() * 0.7);     // and the outcome drifts in runs
    }
    const g = scrambled(move, out, BASE, COPIES, `drift${seed}`);
    dealt += g.asGood / COPIES; slid += g.asGoodSlid / COPIES;
  }
  const d = (dealt / COINS) * 100; const l = (slid / COINS) * 100;
  assert(d >= 70, `dealing destroys the drift and flatters the copies: at least 70% of them should come out as good, got ${d.toFixed(1)}%`);
  assert(l <= 68, `sliding keeps the drift, so the slid copies should land near the fair 50%, got ${l.toFixed(1)}%`);
  assert(d - l >= 15, `the two nulls must disagree on a drifting coin, and they differ by only ${(d - l).toFixed(1)} points`);
}

// BOTH COUNTS REACH THE TABLE, side by side, and neither replaces the other:
// the difference between them is the measurement.
function bothCopyCountsAreOnTheTableSideBySide() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
  assert(/>scrambles as good\$\{cWalkSortBtn\('asGood', 'asc'\)\}/.test(src), 'the dealt count keeps its column');
  assert(/>slides as good\$\{cWalkSortBtn\('asGoodSlid', 'asc'\)\}/.test(src), 'and the slid count has one beside it');
  assert(/<td>\$\{scr\}<\/td><td>\$\{sld\}<\/td>/.test(src), 'both are drawn on every row');
  assert(/const sld = r\.asGoodSlid == null \? '—'/.test(src), 'a row with no slid count shows a dash, not a nought');
  assert(/<tr class="cwscan"><td colspan="16">/.test(src), 'the opened strip spans the table, which is as wide as the table is');
  assert(/scrambled and \$\{a\.scrambles == null \? 10 : a\.scrambles\} sliding copies/.test(src), 'the finished line says both kinds were built');
  assert(/Each copy is built two ways and BOTH are reported/.test(help), 'and Help says the one box builds both');
}

// THE LATE HALF IS NEVER LOOKED AT WHILE CHOOSING, AND THE EARLY HALF IS NEVER
// COUNTED IN THE ANSWER. Two rows, hand-built: one is the best thing on the
// early windows and worthless afterwards, the other the reverse. The early one
// has to be the pick and the late figure reported for it has to be its OWN
// late figure -- if either half leaked into the other, this comes out wrong.
function theEarlyHalfChoosesAndOnlyTheLateHalfIsRead() {
  const win = (perTrade, n = 50) => ({ n, perTrade, thin: false });
  const rows = [
    { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: 'own', band: 100,
      scan: [win(9), win(9), win(9), win(9), win(-4), win(-4), win(-4), win(-4)] },
    { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: '336', band: 200,
      scan: [win(-4), win(-4), win(-4), win(-4), win(9), win(9), win(9), win(9)] },
  ];
  const got = chooseThenRead(rows, { minTrades: 10 });
  assert(got.pairs.length === 1, `one coin and shape, one row of answer, got ${got.pairs.length}`);
  const p = got.pairs[0];
  assert(p.cut === 4, `eight windows cut in half is four, got ${p.cut}`);
  assert(p.lookback === 'own', `the early winner is picked, not the late one, got ${p.lookback}`);
  assert(Math.abs(p.earlyPerTrade - 9) < 1e-9, `its early money is its own, got ${p.earlyPerTrade}`);
  assert(Math.abs(p.latePerTrade + 4) < 1e-9, `and the figure reported is its LATE money, got ${p.latePerTrade}`);
  assert(Math.abs(p.blind - 2.5) < 1e-9, `picking blind is the average of both rows' late money, got ${p.blind}`);
  assert(p.lead < 0, 'a pick that fell apart afterwards must read as a loss against picking blind');
  assert(p.percentile === 0, `it was the worst of the two on the late windows, so the bottom of the pack, got ${p.percentile}`);
  // and the money is trade-weighted, not window-averaged
  const uneven = moneyOver([{ n: 100, perTrade: 1, thin: false }, { n: 1, perTrade: 100, thin: false }], 0, 2);
  assert(Math.abs(uneven.perTrade - (100 * 1 + 1 * 100) / 101) < 1e-9, `a window of one trade cannot weigh the same as a window of a hundred, got ${uneven.perTrade}`);
  // a thin window is not counted at either end
  const thin = moneyOver([{ n: 4, perTrade: 50, thin: true }, { n: 10, perTrade: 2, thin: false }], 0, 2);
  assert(thin.trades === 10 && Math.abs(thin.perTrade - 2) < 1e-9, 'a window under the floor is left out of the totals');
}

// A CHOICE THAT CARRIES NOTHING LANDS IN THE MIDDLE OF THE PACK. Twelve rows
// per coin whose early and late halves are unrelated to each other: the pick
// should sit at about the 50th percentile and win about half the time. This is
// the guard that says the reading is not rigged to look positive -- without it
// a bug that reported the BEST late row instead of the chosen one would pass
// every other test in this file.
function aChoiceThatCarriesNothingLandsAtThePackAverage() {
  let s = 20260917;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = [];
  for (let c = 0; c < 40; c++) {
    for (let i = 0; i < 12; i++) {
      const scan = [];
      for (let w = 0; w < 10; w++) scan.push({ n: 40, perTrade: (rnd() - 0.5) * 6, thin: false });
      rows.push({ coin: `C${c}USDT`, geometry: 'daily-1d', lookback: String(i), band: 100, scan });
    }
  }
  const got = chooseThenRead(rows, { minTrades: 10 });
  assert(got.of === 40, `forty coins to read, got ${got.of}`);
  assert(got.meanPercentile > 33 && got.meanPercentile < 67,
    `with nothing carried the picks land mid-pack, and ${got.meanPercentile.toFixed(0)} is not mid-pack`);
  assert(got.beat >= 12 && got.beat <= 28,
    `and they beat picking blind about half the time, not ${got.beat} of 40`);
  assert(got.verdict !== 'PASS', 'a table with nothing in it must never read PASS');
}

// AND ONE THAT CARRIES SOMETHING RISES ABOVE IT. The same shape, except each
// coin has one row that is genuinely better in BOTH halves. It must be picked
// and it must read near the top of the pack.
function aChoiceThatCarriesSomethingRisesAboveIt() {
  let s = 777;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = [];
  for (let c = 0; c < 40; c++) {
    for (let i = 0; i < 12; i++) {
      const edge = i === 7 ? 2.4 : 0;
      const scan = [];
      for (let w = 0; w < 10; w++) scan.push({ n: 40, perTrade: edge + (rnd() - 0.5) * 2, thin: false });
      rows.push({ coin: `C${c}USDT`, geometry: 'daily-1d', lookback: String(i), band: 100, scan });
    }
  }
  const got = chooseThenRead(rows, { minTrades: 10 });
  assert(got.meanPercentile > 80, `a real edge is found and holds, so the picks sit near the top, got ${got.meanPercentile.toFixed(0)}`);
  assert(got.beat >= 34, `and beat picking blind nearly every time, got ${got.beat} of ${got.of}`);
  assert(got.verdict === 'PASS', `this is what a pass looks like, got ${got.verdict}`);
  const wrong = got.pairs.filter((p) => p.lookback !== '7').length;
  assert(wrong <= 4, `the planted row is the one chosen, and ${wrong} of ${got.of} chose something else`);
}

// THE SCREEN CARRIES IT, with its door, its two boxes and the pass mark said
// out loud on the page rather than kept in a commit message.
function theChooseEarlyPanelIsOnScreenWithItsDoorAndItsWords() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
  const run = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
  assert(/app\.post\('\/api\/coins\/walk\/split'/.test(srv), 'the reading has a door');
  assert(/coinsWalkSplit/.test(run) && /coinsWalkSplit,/.test(run), 'and the runner answers it and is exported');
  assert(/<button id="sRun" class="pri">Choose early, read late<\/button>/.test(src), 'the button is on screen');
  assert(/id="sCut"/.test(src) && /id="sMin"/.test(src), 'and both of its boxes');
  assert(/windows to choose on \(blank = half\)/.test(src), 'the cut box says what it does');
  assert(/fewest trades each half must have/.test(src), 'and so does the floor box');
  assert(/at least 60 of 90/.test(src), 'the pass mark is ON THE PAGE, not only in a commit message');
  assert(/sCut: /.test(help) && /sMin: /.test(help) && /sRun: /.test(help), 'all three are described on Help');
  // RULE FOUR: the button sits in a row of its own, and the table styles
  // against a class the stylesheet actually defines
  assert(/<div class="row">\s*<button id="sRun"/.test(src), 'the button has its own row, like every other button here');
  const mine = /<div class="cwbox"><table class="cgap"><thead><tr>\s*<th title="the coin">coin\$\{cSortBtn\('sSorts', 'ssort', 'coin', 'asc'\)\}<\/th>/.test(src);
  assert(mine, 'the new table styles against cgap, which the stylesheet defines');
  // 3.162.0: the whole-history tuning rides beside the confirmation, and the
  // page says which of the two to tune with rather than leaving it to be guessed
  for (const [head, key] of [['whole look-back', 'wholeLookback'], ['whole band', 'wholeBand'],
    ['whole per trade', 'wholePerTrade'], ['same pick', 'sameAsEarly']]) {
    assert(new RegExp(`>${head}\\$\\{cSortBtn\\('sSorts', 'ssort', '${key}'`).test(src),
      `the ${head} column is on the table and it sorts`);
  }
  assert(/What to tune with is the whole history, not this reading/.test(src),
    'and the page SAYS the whole history is the tuning and this reading is only the confirmation');
  // and the page says which shapes a fixed look-back stands down
  assert(/At a fixed look-back a chunk shape is only how long the trade is held/.test(src),
    'the collapse is said on the page, not done quietly');
  assert(/function cCollapseLine\(\)/.test(src) && /cCollapse\.map/.test(src),
    'and the line is built from what the box sent, never typed');
  const run2 = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
  assert(/collapse: require\('\.\/coinscan'\)\.oneShapePerForwardTime/.test(run2),
    'the box works it out from GEOMETRIES and sends it');
}

// THE CLAIM THE COLLAPSE RESTS ON, PROVED FROM THE GEOMETRIES THEMSELVES
// rather than asserted (owner order, 2026-09-17). Two daily shapes that hold a
// trade for the same length of time buy and sell at the same instants, one
// chunk apart: daily-2d's chunk at S opens at S+49h and closes at S+66h, and
// daily-1d's chunk at S+24h opens at S+24+25=S+49h and closes at S+24+42=S+66h.
// Every daily shape sits on the SAME grid of chunk starts, because dailyStarts()
// reads the first and last timestamp and nothing about the geometry. So the two
// are one trade series indexed a day apart, and walking both is walking one
// twice. If anybody retimes a shape in lib/dataset.js, this fails.
function theTwoShapesThatCollapseREALLYAreTheSameTrade() {
  const { GEOMETRIES } = require('../lib/dataset');
  const groups = new Map();
  for (const [key, g] of Object.entries(GEOMETRIES)) {
    const fwd = forwardHoursOf(g);
    assert(fwd != null && fwd > 0, `${key} must state how long it holds, got ${fwd}`);
    if (!groups.has(fwd)) groups.set(fwd, []);
    groups.get(fwd).push(key);
  }
  for (const [fwd, keys] of groups) {
    for (const a of keys) for (const b of keys) {
      if (a === b) continue;
      const A = GEOMETRIES[a]; const B = GEOMETRIES[b];
      assert(A.anchor === B.anchor, `${a} and ${b} hold for the same ${fwd}h but are anchored differently, so they are NOT the same trade`);
      assert(A.stepHours === B.stepHours, `${a} and ${b} step differently, so they are not one grid`);
      const gap = Number(B.entryOffsetH) - Number(A.entryOffsetH);
      assert(gap % Number(A.stepHours) === 0,
        `${a} and ${b} hold for the same ${fwd}h but their entries are ${gap}h apart, which is not a whole number of ${A.stepHours}h steps -- they are different trades and must not be collapsed`);
      assert(Number(B.exitOffsetH) - Number(A.exitOffsetH) === gap,
        `${a} and ${b} must be shifted by the same amount at both ends, or they are different trades`);
    }
  }
  // and the reading at 'own' really is different per shape, which is why 'own'
  // keeps every one of them: it spans the shape's own distance to its entry
  const owns = Object.values(GEOMETRIES).map((g) => Number(g.entryOffsetH));
  assert(new Set(owns).size === owns.length, 'every shape reaches its entry from a different distance, so at own no two are the same');
}

// SO ONE SHAPE PER FORWARD TIME IS WALKED, and the one that is walked is the
// one that demands the fewest unbroken hours from its chunk start, because
// that is the one a price gap costs least.
function aFixedLookBackWalksOneShapePerForwardTimeAndOwnWalksThemAll() {
  const { GEOMETRIES } = require('../lib/dataset');
  const groups = oneShapePerForwardTime(GEOMETRIES);
  assert(groups.length === 3, `five shapes, three forward times, got ${groups.length}`);
  assert(groups.map((g) => g.forwardHours).join(',') === '17,41,60', `shortest hold first, got ${groups.map((g) => g.forwardHours).join(',')}`);
  for (const g of groups) {
    for (const stood of g.standsFor) {
      assert(Number(GEOMETRIES[g.walks].featureHours) < Number(GEOMETRIES[stood].featureHours),
        `${g.walks} is walked instead of ${stood}, so it must be the one asking for fewer unbroken hours`);
    }
  }
  // a shape with no offsets to compare is never stood down -- guessing is worse
  const odd = oneShapePerForwardTime({ 'a': { featureHours: 24 }, 'b': { featureHours: 24 } });
  assert(odd.length === 2 && odd.every((g) => !g.standsFor.length), 'two shapes that state no entry or exit are both walked');

  // and the task list obeys it
  const { move, out } = madeUpCoin(900, 0);
  const moves = { 72: move.map((m) => m * 0.5), 336: move.map((m) => m * 0.4) };
  const shapes = {};
  for (const k of Object.keys(GEOMETRIES)) shapes[k] = { move, out, periods: 900, ts: move.map((_, i) => i), moves };
  const records = [{ coin: 'AAAUSDT', read: true, shapes }];
  const base = { bands: [200, 250], sweetSpots: null, windowMonths: 6, warmUpMonths: 12 };
  const own = walkTasksFor(records, GEOMETRIES, base);
  assert(own.length === 5 * 2, `at own every shape is walked: five shapes, two bands, got ${own.length}`);
  const fixed = walkTasksFor(records, GEOMETRIES, { ...base, lookbacks: [72, 336] });
  // own on all five, plus two look-backs on three shapes only
  assert(fixed.length === (5 + 3 * 2) * 2, `five at own plus three per look-back, two look-backs, two bands = ${(5 + 3 * 2) * 2}, got ${fixed.length}`);
  const stoodDown = new Set(oneShapePerForwardTime(GEOMETRIES).flatMap((g) => g.standsFor));
  for (const t of fixed) {
    if (t.lookback === 'own') continue;
    assert(!stoodDown.has(t.geometry), `${t.geometry} stands down at a fixed look-back and must not be walked, ${t.lookback}h was`);
  }
  assert(fixed.some((t) => t.lookback === 'own' && stoodDown.has(t.geometry)), 'and it IS still walked at its own span');
  // the saving is the point: nearly half the fixed-look-back rows go
  const before = 5 * 2 * 2; const after = 3 * 2 * 2;
  assert(after < before, `the collapse has to actually save work: ${after} against ${before}`);
}

// THE CONFIRMATION AND THE TUNING ARE TWO DIFFERENT ANSWERS, CARRIED TOGETHER
// (owner order, 2026-09-17: "choose early, read late should just be a
// confirmation, but we need to be able to do the actual tuning or retain the
// tuning on the entire history swath"). The early pick is what the first half
// liked; the whole-history pick is what to trade. They need not agree, and when
// they do not the reading says so rather than quietly reporting one of them.
function theWholeHistoryTuningRidesBesideTheConfirmation() {
  const win = (perTrade, n = 50) => ({ n, perTrade, thin: false });
  // row A wins the early half and loses the late; row B is steadier and wins
  // over the whole swath. The early pick must be A, the whole pick must be B.
  const rowA = { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: 'own', band: 100,
    scan: [win(9), win(9), win(9), win(9), win(-6), win(-6), win(-6), win(-6)], trades: 400, perTrade: 1.5, windows: 8, windowsUp: 4, asGood: 40, asGoodSlid: 44 };
  const rowB = { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: '336', band: 250,
    scan: [win(2), win(2), win(2), win(2), win(3), win(3), win(3), win(3)], trades: 400, perTrade: 2.5, windows: 8, windowsUp: 8, asGood: 0, asGoodSlid: 1 };
  const got = chooseThenRead([rowA, rowB], { minTrades: 10 });
  const p = got.pairs[0];
  assert(p.lookback === 'own' && p.band === 100, `the early half liked A, got ${p.lookback}/${p.band}`);
  assert(p.wholeLookback === '336' && p.wholeBand === 250, `the whole history picks B, got ${p.wholeLookback}/${p.wholeBand}`);
  assert(Math.abs(p.wholePerTrade - 2.5) < 1e-9, `and carries B's own whole-history money, got ${p.wholePerTrade}`);
  assert(p.sameAsEarly === false, 'and says plainly that the two disagree');
  assert(got.sameChoice === 0, `nought of one agreed, got ${got.sameChoice}`);
  assert(p.wholeAsGood === 0 && p.wholeAsGoodSlid === 1, 'the whole-history row brings its own copy counts with it');
  // when they agree it says so
  const agree = chooseThenRead([{ ...rowB }, { ...rowA, scan: [win(-1), win(-1), win(-1), win(-1), win(-1), win(-1), win(-1), win(-1)], perTrade: -1 }], { minTrades: 10 });
  assert(agree.pairs[0].sameAsEarly === true && agree.sameChoice === 1, 'when both halves and the whole swath pick the same row, that is reported too');
  // a row too thin over the whole swath is not the tuning answer
  const thin = chooseThenRead([rowA, { ...rowB, trades: 4 }], { minTrades: 10 });
  assert(thin.pairs[0].wholeLookback === 'own', 'a whole-history row under the trade floor is not chosen');
}

// EVERY HEADING SITS OVER ITS OWN FIGURES (3.162.1). The cells were drawn
// look-back then band and the headings said band then look-back, so from
// 3.159.0 until the owner spotted it the figure under "band" was the look-back,
// the figure under "look-back" was the band, and each sorter sat over the
// column beside the one it sorted. Nothing checked, which is why it stood for
// two days and shaped a reading that was reported to the owner twice.
//
// This walks both sides and holds them to ONE order. Reorder either the
// headings or the cells and it fails; add a column to one and not the other and
// it fails. The needle for each cell is a piece of what that cell actually
// draws, so a cell rewritten to draw something else fails too.
function theWalkTableHeadingsSitOverTheirOwnFigures() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const panel = /function cWalkPanel\(\) \{[\s\S]*?\n\}/.exec(src);
  assert(panel, 'the walk panel is there to read');
  const head = [...panel[0].matchAll(/cWalkSortBtn\('(\w+)'/g)].map((m) => m[1]);
  const rowFn = /function cWalkRow\(r, shapes\) \{[\s\S]*?\n\}/.exec(src);
  assert(rowFn, 'and so is the row');
  const cells = rowFn[0].slice(rowFn[0].indexOf('return `<tr>'));
  const seq = [
    ['coin', 'esc(r.coin)'],
    ['geometry', 'esc(shape)'],
    ['lookback', "r.lookback === 'own' ? 'own'"],
    ['band', '${r.band}${r.searched'],
    ['trades', '<td>${r.trades}</td>'],
    ['perTrade', '${pt}'],
    ['windows', '<td>${r.windows}</td>'],
    ['windowsUp', '${r.windowsUp} of'],
    ['paid', '${cPaid(r)} of'],
    ['best', 'r.best == null'],
    ['worst', 'r.worst == null'],
    ['spread', "cSpread(r) == null ? '—'"],
    ['perSpread', "cPerSpread(r) == null ? '—'"],
    ['asGood', '${scr}'],
    ['asGoodSlid', '${sld}'],
  ];
  assert(head.join(',') === seq.map(([k]) => k).join(','),
    `the headings must name these columns in this order: ${seq.map(([k]) => k).join(',')} -- they name ${head.join(',')}`);
  let last = -1;
  let lastKey = 'the start of the row';
  for (const [key, needle] of seq) {
    const i = cells.indexOf(needle);
    assert(i >= 0, `the row has to draw ${key}, and nothing in it matches ${JSON.stringify(needle)}`);
    assert(i > last, `the ${key} cell is drawn BEFORE ${lastKey}, but its heading comes after -- the headings and the figures are out of step`);
    last = i; lastKey = key;
  }
  // and the two that were actually swapped, named, so a failure reads plainly
  assert(cells.indexOf("r.lookback === 'own' ? 'own'") < cells.indexOf('${r.band}${r.searched'),
    'the look-back cell comes before the band cell');
  assert(panel[0].indexOf("cWalkSortBtn('lookback'") < panel[0].indexOf("cWalkSortBtn('band'"),
    'and so does the look-back heading -- this is the pair that was swapped from 3.159.0 to 3.162.1');
}

// AN EMPTY BOX HIDES NOTHING AT ALL (3.164.1, owner: "don't make a record set
// with 4896 rows and then not show it on the screen").
//
// A blank `bands` box hid every row of a 4,896-row walk. Number('') is 0, and 0
// is finite, so a helper that converted before it filtered turned an untyped
// box into "show only band 0" -- and no row has band 0. The whole table
// vanished and a note underneath narrated it.
//
// THIS RUNS THE REAL FUNCTION, not a copy of its logic and not a scan of its
// source. cWalkList lives on the page and cannot be required, so it is lifted
// out of public/construct.js and given a cState of its own. A source scan would
// not have caught this and neither would a re-implementation; only running it
// does.
function theRealWalkFilter(wF) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const m = /function cWalkList\(matches\) \{[\s\S]*?\n\}/.exec(src);
  assert(m, 'cWalkList is on the page to be read');
  // and the two derived figures it filters on, which are defined once and read
  // by the cells, the sorters and the filters alike
  const sp = /const cSpread = [^\n]*\n/.exec(src);
  const ps = /const cPerSpread = \(r\) => \{[\s\S]*?\n\};/.exec(src);
  const rt = /const C_ROUND_TRIP = [^\n]*\n/.exec(src);
  const pd = /const cPaid = \(r\) => [\s\S]*?\n[^\n]*\), 0\);\n/.exec(src);
  assert(sp && ps, 'the spread and the ratio are defined once, where the filter can see them');
  assert(rt && pd, 'and so are the round trip and the count of windows that cleared it');
  // eslint-disable-next-line no-new-func
  return new Function('cState', `${sp[0]}${ps[0]}${rt[0]}${pd[0]}\n${m[0]}; return cWalkList;`)({ wF });
}
function anEmptyFilterBoxHidesNothingAtAll() {
  const shapes = [{ key: 'daily-1d', label: 'Daily 1-day' }, { key: 'daily-3d', label: 'Daily 3-day' }];
  // best and worst are on every row on purpose: the four range boxes read them,
  // and a fixture without them made every one of those filters hide everything
  // -- which the guard caught, which is the point of running the real function.
  // A WINDOW STRIP ON EVERY ROW, for the same reason best and worst are on
  // every row: least windows paid, % counts the strip, and a fixture without
  // one would let that box hide everything without the guard noticing.
  const strip = (paid, counted) => {
    const out = [];
    for (let i = 0; i < counted; i++) out.push({ n: 20, perTrade: i < paid ? 1.5 : -1, thin: false });
    return out;
  };
  const rows = [
    { coin: 'LTCUSDT', geometry: 'daily-1d', lookback: '312', band: 200, trades: 370, perTrade: 0.879, windows: 15, windowsUp: 15, best: 3.96, worst: 0.15, asGood: 0, asGoodSlid: 0, scan: strip(15, 15) },
    { coin: 'XLMUSDT', geometry: 'daily-3d', lookback: 'own', band: 350, trades: 40, perTrade: -0.2, windows: 6, windowsUp: 2, best: 2, worst: -3, asGood: 90, asGoodSlid: 88, scan: strip(2, 6) },
    { coin: 'BTCUSDT', geometry: 'daily-1d', lookback: '48', band: 250, trades: 500, perTrade: 0.1, windows: 12, windowsUp: 7, best: 1, worst: 0, asGood: 44, asGoodSlid: 46, scan: strip(6, 12) },
  ];
  // EVERY BOX EMPTY, THE WAY THE SCREEN OPENS. Nothing may be hidden.
  for (const wF of [{}, { coin: '', shape: '', back: '', band: '', minTrades: '', minPer: '', minWindows: '', minUp: '', minPaid: '', maxGood: '', maxSlid: '' },
    { band: '' }, { band: '   ' }, { band: ' , ' }, { minTrades: '' }, { maxGood: '' },
    { minBest: '' }, { minWorst: '' }, { maxSpread: '' }, { minPerSpread: '' }, { minPaid: '' }]) {
    const got = theRealWalkFilter(wF)({ rows, shapes });
    assert(got.length === rows.length,
      `with ${JSON.stringify(wF)} nothing may be hidden, and ${rows.length - got.length} of ${rows.length} row(s) were`);
  }
  // and every box still filters when it IS typed in, or the fix would be to
  // stop filtering at all
  const f = (wF) => theRealWalkFilter(wF)({ rows, shapes }).map((r) => r.coin);
  assert.deepStrictEqual(f({ band: '200' }), ['LTCUSDT'], 'the bands box filters');
  assert.deepStrictEqual(f({ band: '200,350' }), ['LTCUSDT', 'XLMUSDT'], 'and takes a list');
  assert.deepStrictEqual(f({ coin: 'ltc' }), ['LTCUSDT'], 'the coins box filters, and does not mind the case');
  assert.deepStrictEqual(f({ shape: '3-day' }), ['XLMUSDT'], 'the shapes box filters on the label the screen shows');
  assert.deepStrictEqual(f({ back: 'own' }), ['XLMUSDT'], 'the look-backs box takes own');
  assert.deepStrictEqual(f({ back: '312' }), ['LTCUSDT'], 'and a number');
  assert.deepStrictEqual(f({ minTrades: '400' }), ['BTCUSDT'], 'fewest trades filters');
  assert.deepStrictEqual(f({ minPer: '0.5' }), ['LTCUSDT'], 'least per trade filters');
  assert.deepStrictEqual(f({ minWindows: '13' }), ['LTCUSDT'], 'fewest windows filters');
  assert.deepStrictEqual(f({ minUp: '90' }), ['LTCUSDT'], 'least windows up filters, as a share');
  assert.deepStrictEqual(f({ minPaid: '90' }), ['LTCUSDT'], 'least windows paid filters, as a share');
  assert.deepStrictEqual(f({ minPaid: '50' }), ['LTCUSDT', 'BTCUSDT'], 'and half of them is half of them, not half of the windows the coin has');
  assert.deepStrictEqual(f({ maxGood: '0' }), ['LTCUSDT'], 'most scrambles as good filters, and nought is a real answer');
  assert.deepStrictEqual(f({ maxSlid: '50' }), ['LTCUSDT', 'BTCUSDT'], 'most slides as good filters');
  // and the four that answer the range question
  assert.deepStrictEqual(f({ minBest: '3' }), ['LTCUSDT'], 'least best window filters');
  assert.deepStrictEqual(f({ minWorst: '0' }), ['LTCUSDT', 'BTCUSDT'], 'least worst window filters, and nought keeps the rows that never had a losing half-year');
  assert.deepStrictEqual(f({ maxSpread: '3' }), ['BTCUSDT'], 'most spread keeps the TIGHT rows');
  assert.deepStrictEqual(f({ minPerSpread: '0.2' }), ['LTCUSDT'], 'least per trade per spread filters');
  // a zero typed into a "fewest" box is a number, not a blank
  assert(f({ minTrades: '0' }).length === 3, 'a typed nought keeps everything, because every row has at least nought trades');
  // and the screen never leaves an empty table unexplained
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  assert(/All \$\{rows\.length\.toLocaleString\(\)\} row\(s\) of this walk are hidden by the filter boxes above/.test(src),
    'an empty table says so WHERE THE TABLE WOULD BE, not in a note under a blank space');
  assert(/<button id="wfClear2" class="pri">Clear filters<\/button>/.test(src),
    'and the way back is right there, in the same words as everywhere else');
  // a set opened, or a walk landing, starts with nothing hidden -- the boxes are
  // remembered in the browser, so filters typed for one set would otherwise
  // carry onto the next and hide a fresh table for reasons set up hours before
  assert(/cState\.wF = \{\}; cShownFor = null; cRemember\(\);\s*\n\s*cSplit = null;/.test(src),
    'opening a saved set clears the filters');
  assert(/if \(wasRunning && st && !st\.running\) \{ cState\.wF = \{\}; cShownFor = null; cRemember\(\); \}/.test(src),
    'and so does a walk landing');
}

// RULE FOUR-A: A TICK BOTTOM-ALIGNS TO THE FIELDS BESIDE IT, ALWAYS -- and a
// BUTTON never shares their row (owner, 2026-09-17: "on the coins page it's
// like you were trying to misalign everything to win an ugly award", and
// "you're sticking buttons onto the bottom of text entry fields as if that's
// good design ... trust me, it isn't").
//
// `.row` centres what is in it; a `label.f` is a caption over its box, two
// lines tall, and a tick is one. Centred, the tick floats against the middle of
// the pair. Five rows on Sweep already carried align-items:flex-end and every
// row on Coins carried nothing, which makes it a mistake rather than a choice.
// Counted rather than eyeballed, so a row added tomorrow cannot be wrong
// quietly.
function everyTickOnCoinsBottomAlignsToItsFieldsAndNoButtonSharesTheirRow() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  // the Coins screen is its own renderer plus the walk's panels it draws with
  const marks = ['function drawCoins(', 'function cWalkPanel(', 'function cSplitPanel(', 'function cWalkSetsRow(', 'function cWalkFilterRow('];
  let looked = 0;
  for (const mark of marks) {
    const at = src.indexOf(mark);
    if (at < 0) continue;
    looked++;
    const end = src.indexOf('\n}\n', at);
    const body = src.slice(at, end < 0 ? src.length : end);
    for (const m of body.matchAll(/<div class="row"[^>]*>/g)) {
      const from = m.index;
      const next = body.indexOf('<div class="row"', from + 1);
      const seg = body.slice(from, next < 0 ? body.length : next);
      const cut = seg.indexOf('</div>');
      const row = cut >= 0 ? seg.slice(0, cut) : seg;
      if (!/label class="f"/.test(row)) continue;
      const line = src.slice(0, at + from).split('\n').length;
      if (/label class="c"/.test(row)) {
        assert(/align-items:\s*flex-end/.test(m[0]),
          `the row at line ${line} holds a tick beside a field and does not bottom-align it — RULE FOUR-A`);
      }
      assert(!/<button/.test(row),
        `the row at line ${line} puts a button in with a field — a button goes in a row of its own on this screen`);
    }
  }
  assert(looked >= 4, `every panel of this screen was read, got ${looked}`);
  // and Sweep's five rows are where the pattern was copied FROM, so if they go
  // this rule has lost its precedent and somebody should know
  assert((src.match(/<div class="row"[^>]*align-items:\s*flex-end[^>]*>/g) || []).length >= 6,
    'the pattern is used across the file, not invented here');
}

// HIGH MONEY AND TIGHT WINDOWS IN ONE NUMBER (3.164.2, owner: "we need a column
// that helps us find the BEST RANGE -- which is high numbers PER TRADE combined
// with tightest possible BEST WINDOW to WORST WINDOW range").
//
// spread is the best window less the worst, in the same units as per trade, and
// the ratio is per trade divided by it. The trap is the row with ONE counted
// window: its best and its worst are the same window, so its spread is nought
// and dividing by nought would hand the top of the table to the rows with the
// least behind them -- which is exactly the fault windows up had and had fixed.
// That is what this guards.
function theSpreadAndWhatARowPaysForItAreOnTheTableAndCannotBeGamedByOneWindow() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const sp = /const cSpread = [^\n]*\n/.exec(src);
  const ps = /const cPerSpread = \(r\) => \{[\s\S]*?\n\};/.exec(src);
  assert(sp && ps, 'both figures are defined');
  // eslint-disable-next-line no-new-func
  const { cSpread, cPerSpread } = new Function(`${sp[0]}${ps[0]}\nreturn { cSpread, cPerSpread };`)();

  const row = (over) => ({ best: 3, worst: 1, perTrade: 1, windows: 10, ...over });
  assert(cSpread(row({})) === 2, `three less one is two, got ${cSpread(row({}))}`);
  assert(Math.abs(cPerSpread(row({})) - 0.5) < 1e-12, `one over two is a half, got ${cPerSpread(row({}))}`);
  // TIGHT PAYS MORE FOR THE SAME MONEY
  const tight = cPerSpread(row({ best: 1.2, worst: 0.8 }));
  const wide = cPerSpread(row({ best: 6, worst: -4 }));
  assert(tight > wide, `the same money over tighter windows must read higher: ${tight} against ${wide}`);
  // ONE WINDOW HAS NEITHER, whichever way it is dressed up
  for (const over of [{ windows: 1 }, { windows: 1, best: 9, worst: 9 }, { windows: 0 }]) {
    assert(cSpread(row(over)) === null, `a row with ${over.windows} counted window(s) has no spread`);
    assert(cPerSpread(row(over)) === null, 'and no ratio, so it cannot sit at the top of the table on nothing');
  }
  // and an unreadable window is not a spread of nought either
  assert(cSpread(row({ best: null })) === null && cSpread(row({ worst: null })) === null,
    'a window that could not be read leaves no spread');
  assert(cPerSpread(row({ perTrade: null })) === null, 'and no money means no ratio');
  assert(cPerSpread(row({ best: 1, worst: 1, windows: 9 })) === null,
    'a spread of exactly nought is refused rather than divided by');

  // both are on the table, both sort, and the sorters point the useful way:
  // small spread first, big ratio first
  assert(/>spread\$\{cWalkSortBtn\('spread', 'asc'\)\}/.test(src), 'spread is a column and sorts tight-first');
  assert(/>per trade per spread\$\{cWalkSortBtn\('perSpread', 'desc'\)\}/.test(src), 'the ratio is a column and sorts high-first');
  assert(/spread: \(r\) => cSpread\(r\),/.test(src) && /perSpread: \(r\) => cPerSpread\(r\),/.test(src),
    'and the sorter reads the SAME two functions the cells and the filters do, not a second copy');
  assert(/<tr class="cwscan"><td colspan="16">/.test(src), 'the opened strip spans the table, and the table has gained columns since');
  // the four boxes that answer the question, and the two the owner asked for
  for (const id of ['wf_minBest', 'wf_minWorst', 'wf_maxSpread', 'wf_minPerSpread']) {
    assert(new RegExp(`id="${id}"`).test(src), `${id} is on the screen`);
  }
}

// ONE FORMAT AND ONE SET OF WORDS FOR ONE CONTROL (3.164.3, owner: "'apply each
// box as you leave it' on coins, 'auto-apply settings' on boards -- can't you
// just pick one and BE CONSISTENT for a change?!?" and "look at your filter
// field formatting on boards ... why make up a completely different format on
// coins").
//
// Boards had filters first. Coins takes its words AND its layout, rather than
// the reverse: renaming a control somebody has used for weeks is the more
// expensive of the two fixes. div.filters is the two-column grid, span.frow
// carries the buttons, and all three words are Boards'.
function theCoinsFiltersUseBoardsOwnWordsAndBoardsOwnLayout() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.html'), 'utf8');
  const fn = src.slice(src.indexOf('function cWalkFilterRow() {'), src.indexOf('\n}\n', src.indexOf('function cWalkFilterRow() {')));
  // the layout, and every class it leans on is one the stylesheet defines
  assert(/<div class="filters">/.test(fn), 'the filters are the grid Boards uses, not rows of stacked labels');
  assert(/<span class="fname">/.test(fn) && /<span class="fbox">/.test(fn), 'a name against its box, the way that grid is built');
  assert(/<span class="frow">/.test(fn), 'and the buttons cross both columns in an frow');
  for (const cls of ['filters', 'fname', 'fbox', 'frow']) {
    assert(new RegExp(`\\.${cls}\\b`).test(css), `RULE FOUR: .${cls} is defined in the stylesheet`);
  }
  assert(!/label class="f"/.test(fn), 'and none of the old caption-above-box labels is left in it');
  assert(!/style="width:/.test(fn), 'no widths typed here either: .filters .fbox input is 8rem, once, in the stylesheet');
  // the three words, and they are the ones Boards says
  for (const word of ['auto-apply settings', '>Apply settings<', '>Clear filters<']) {
    assert(src.split(word).length - 1 >= 2,
      `${JSON.stringify(word)} has to be on BOTH screens — it is on ${src.split(word).length - 1}`);
  }
  assert(!/apply each box as you leave it/.test(src), 'the second name for the tick is gone');
  assert(!/>Apply the filters</.test(src), 'and the second name for the button');
  assert(!/>Clear the filters</.test(src), 'and the second name for the clear');
  // and Help does not describe one control twice, which is silent because a
  // repeated key in an object literal just wins last
  const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
  for (const k of ['wfApply', 'wfAuto', 'wfClear', 'wfClear2']) {
    const n = (help.match(new RegExp(`^\\s*${k}:`, 'gm')) || []).length;
    assert(n === 1, `Help describes ${k} ${n} time(s) — a repeated key wins last and nothing complains`);
  }
}


// MADE MONEY AND PAID ARE NOT THE SAME THING (3.165.0, owner: "the PER TRADE
// PER SPREAD number ... i'm trying to get a fix on good numbers on as many
// windows as possible without a large spread ... is there a better metric?").
//
// per trade per spread has two faults. It reads only the two EXTREME windows,
// so everything between them is thrown away; and it ignores how many windows
// there are, so three and fifteen score alike -- the fault windows up already
// had and had fixed. Counting the windows that cleared the round trip answers
// both: it cannot be carried by one window, and it grows with the evidence.
//
// THE BOUNDARY IS THE WHOLE POINT. A window that made back exactly what it
// cost to trade paid nothing. Counting it says otherwise, and that is the
// mistake this guards -- on both sides of the wire, because the engine counts
// it for the early/late reading and the screen counts it for the walk table,
// and two counters that disagree is worse than one that is wrong.
function aWindowCountsAsPaidOnlyIfItCLEARSTheRoundTripAndBothSidesAgree() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  // the two figures are the SAME figure, or the two tables disagree about what
  // paid means while both using the word
  const m = /const C_ROUND_TRIP = ([\d.]+);/.exec(src);
  assert(m, 'the screen names the round trip in one place');
  assert(Number(m[1]) === ROUND_TRIP,
    `the screen's round trip is ${m[1]} and the engine's is ${ROUND_TRIP} -- one number, or the two tables mean different things by paid`);
  assert(Math.abs(ROUND_TRIP - 0.25) < 1e-12, `and it is 0.25%, twice the fee a leg, got ${ROUND_TRIP}`);

  // THE ENGINE SIDE: strictly above, at the boundary, in both directions
  const w = (perTrade) => ({ n: 10, perTrade, thin: false });
  const got = moneyOver([w(0.2499), w(0.25), w(0.2501), w(1), w(0), w(-9)], 0, 6);
  assert(got.windowsPaid === 2, `only the two windows ABOVE the round trip paid, got ${got.windowsPaid}`);
  assert(got.windowsUp === 4, `four of them made money, which is the other column, got ${got.windowsUp}`);
  assert(got.worst === -9, `and the worst of them is the worst of them, got ${got.worst}`);
  // a thin window is not paid, not up, and not the worst
  const thin = moneyOver([{ n: 4, perTrade: 99, thin: true }, { n: 4, perTrade: -99, thin: true }, w(1)], 0, 3);
  assert(thin.windowsPaid === 1 && thin.windows === 1 && thin.worst === 1,
    'a window under the floor is counted nowhere, including in the worst');
  // and a different cost is honoured, so the reading and its own bar cannot drift
  assert(moneyOver([w(0.5), w(2)], 0, 2, 1).windowsPaid === 1, 'the cost the caller names is the cost that is used');

  // THE SCREEN SIDE: the same boundary, run for real out of the page
  const rt = /const C_ROUND_TRIP = [^\n]*\n/.exec(src);
  const pd = /const cPaid = \(r\) => [\s\S]*?\n[^\n]*\), 0\);\n/.exec(src);
  assert(rt && pd, 'the screen defines both, once');
  // eslint-disable-next-line no-new-func
  const cPaid = new Function(`${rt[0]}${pd[0]}\nreturn cPaid;`)();
  assert(cPaid({ scan: [w(0.2499), w(0.25), w(0.2501), w(1)] }) === 2,
    'the screen counts strictly above too, or the table and the reading disagree at the boundary');
  assert(cPaid({ scan: [{ n: 4, perTrade: 99, thin: true }] }) === 0, 'and a thin window never paid');
  assert(cPaid({ scan: [{ n: 0, perTrade: 99, thin: false }] }) === 0, 'nor an empty one');
  assert(cPaid({ scan: [{ n: 9, perTrade: null, thin: false }] }) === 0, 'nor an unreadable one');
  assert(cPaid({}) === 0, 'and a row with no strip at all reads nought rather than throwing');

  // IT IS WORKED OUT FROM THE STRIP, not stored, so a set saved before this
  // release shows the column without being walked again
  assert(/\(r\.scan \|\| \[\]\)\.reduce/.test(pd[0]),
    'the count comes off the strip every row already carries -- storing it would leave every saved walk set showing a dash');

  // ON BOTH TABLES, which is what the owner asked for
  assert(/>windows paid\$\{cWalkSortBtn\('paid', 'desc'\)\}/.test(src), 'the walk table has the column and sorts it high-first');
  assert(/<td>\$\{cPaid\(r\)\} of \$\{r\.windows\}<\/td>/.test(src), 'and draws it as a count out of the counted windows');
  assert(/>late windows paid\$\{cSortBtn\('sSorts', 'ssort', 'latePaid', 'desc'\)\}/.test(src),
    'choose early, read late has it on its late windows');
  assert(/<td>\$\{p\.lateWindowsPaid\} of \$\{p\.lateWindows\}<\/td>/.test(src), 'and draws it the same way');
  // AND THE OTHER HALF OF THE SENTENCE beside it on both: no bad windows
  assert(/id="wf_minWorst"/.test(src) && /id="wf_minPaid"/.test(src),
    'the walk table can be filtered on both halves at once: as many paying windows as possible, and no bad ones');
  assert(/>worst late window\$\{cSortBtn\('sSorts', 'ssort', 'lateWorst', 'desc'\)\}/.test(src),
    'and the late reading shows its worst window, which it never did');
  assert(/<td class="\$\{cls\(p\.lateWorst\)\}">\$\{pc\(p\.lateWorst\)\}<\/td>/.test(src), 'drawn in money, coloured like money');
  // the new box is in the same grid and the same words as the ones beside it
  assert(/<span class="fname">least windows paid, %<\/span><span class="fbox"><input id="wf_minPaid" type="number" step="any" value="\$\{v\('minPaid'\)\}">/.test(src),
    'the filter box uses the layout every other filter box on this screen uses');
  const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
  assert(/wf_minPaid: '/.test(help), 'and Help says what it does');
}

// THE LATE READING CARRIES BOTH FIGURES, and they are ITS OWN -- the pick's
// late windows, not the pack's and not the whole history's. Hand-built so the
// two rows disagree about everything: if the wrong row's figures were reported
// or the early half leaked in, every number below comes out different.
function theLateReadingCarriesWhatItPaidAndItsWorstWindow() {
  const win = (perTrade, n = 50) => ({ n, perTrade, thin: false });
  const rows = [
    // best on the early windows; afterwards it pays on two of four and has one bad one
    { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: 'own', band: 100,
      scan: [win(9), win(9), win(9), win(9), win(3), win(3), win(0.25), win(-2)] },
    // worse early, better late -- it must not be the one reported
    { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: '336', band: 200,
      scan: [win(1), win(1), win(1), win(1), win(8), win(8), win(8), win(8)] },
  ];
  const p = chooseThenRead(rows, { minTrades: 10 }).pairs[0];
  assert(p.lookback === 'own', `the early winner is the row reported, got ${p.lookback}`);
  assert(p.lateWindows === 4, `four late windows, got ${p.lateWindows}`);
  assert(p.lateWindowsUp === 3, `three of them made money, got ${p.lateWindowsUp}`);
  assert(p.lateWindowsPaid === 2, `but only two CLEARED the round trip -- the 0.25% one made back exactly what it cost and paid nothing, got ${p.lateWindowsPaid}`);
  assert(p.lateWorst === -2, `and the worst late window is its own, got ${p.lateWorst}`);
  // the other row's figures must be nowhere in the answer
  assert(p.lateWorst !== 8 && p.lateWindowsPaid !== 4, 'the better late row is not the one being reported');
  // A LATE HALF THAT MADE MONEY AND STILL PAID NOTHING is the case the whole
  // column exists for: nought paid is a real answer, not a missing one, and
  // the worst window is still reported beside it.
  const thin = chooseThenRead([
    { coin: 'BBBUSDT', geometry: 'daily-1d', lookback: 'own', band: 100, scan: [win(5), win(5), win(0.1), win(-0.5)] },
    { coin: 'BBBUSDT', geometry: 'daily-1d', lookback: '48', band: 200, scan: [win(1), win(1), win(4), win(4)] },
  ], { minTrades: 10 }).pairs[0];
  assert(thin.lookback === 'own', 'the early winner again');
  assert(thin.lateWindowsUp === 1, `one late window made money, got ${thin.lateWindowsUp}`);
  assert(thin.lateWindowsPaid === 0, `and none of them cleared the round trip, got ${thin.lateWindowsPaid}`);
  assert(thin.lateWorst === -0.5, `the worst late window is still reported, got ${thin.lateWorst}`);
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
  aSlidCopyKeepsEveryOutcomeBesideTheOnesItHappenedBeside,
  aPlantedRelationshipBeatsItsSlidCopiesToo,
  theDealtCopiesAreUnfairOnADriftingCoinAndTheSlidOnesAreNot,
  bothCopyCountsAreOnTheTableSideBySide,
  anEmptyFilterBoxHidesNothingAtAll,
  theSpreadAndWhatARowPaysForItAreOnTheTableAndCannotBeGamedByOneWindow,
  aWindowCountsAsPaidOnlyIfItCLEARSTheRoundTripAndBothSidesAgree,
  theLateReadingCarriesWhatItPaidAndItsWorstWindow,
  theCoinsFiltersUseBoardsOwnWordsAndBoardsOwnLayout,
  everyTickOnCoinsBottomAlignsToItsFieldsAndNoButtonSharesTheirRow,
  theWalkTableHeadingsSitOverTheirOwnFigures,
  theTwoShapesThatCollapseREALLYAreTheSameTrade,
  aFixedLookBackWalksOneShapePerForwardTimeAndOwnWalksThemAll,
  theWholeHistoryTuningRidesBesideTheConfirmation,
  theEarlyHalfChoosesAndOnlyTheLateHalfIsRead,
  aChoiceThatCarriesNothingLandsAtThePackAverage,
  aChoiceThatCarriesSomethingRisesAboveIt,
  theChooseEarlyPanelIsOnScreenWithItsDoorAndItsWords,
};
