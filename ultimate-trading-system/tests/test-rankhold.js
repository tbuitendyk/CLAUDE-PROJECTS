// DOES THE RANKING HOLD? (3.102.0, SELECTION-DESIGN.md Part 4.)
//
// The funnel is one way of choosing: put the settings in order by what they
// made, keep the best of them, apply floors. Nothing on the screen ever asked
// whether that ORDER survives being moved to a part of the test window it was
// not chosen on -- and it was the reserve that answered, once, too late.
//
// Every test here is arithmetic on a table typed into the test, because that is
// what lib/rankhold.js is: no file, no set, and nothing from the held-back
// window or the reserve. Each test name is the assertion a mutation guard aims
// at.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const RH = require('../lib/rankhold');
const stages = require('../lib/stages');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// n settings, each carrying what it made in the three parts of the test window
const rows = (n, f) => Array.from({ length: n }, (_, i) => ({ pnlThirds: f(i) }));
const holds = (r) => r.readings.map((x) => x.hold);

module.exports = {
  // THE PRESS IS PRESSED, NOT SCANNED (3.103.1, owner report on the deployed
  // 3.103.0: "FAILED -- this record set has no settings on its board, so there
  // is nothing to work out"). It had read `ensureTally` into the variable it
  // handed the board -- and on a healthy set ensureTally answers `{ ready:
  // true }`, which carries no settings, so EVERY press on EVERY set refused.
  //
  // Nothing caught it because the test that guards this press reads the source
  // for `funnelBoard(String(id), t, 'all')` and finds it. That is word for word
  // the fault written into that test's own comment at 3.57.1 -- "two
  // source-scanning tests covered this step and neither pressed it" -- so this
  // one presses it, on a real set on disk, and reads what comes back.
  async theWorkOutPressIsHandedTheTallyAndNotAnAnswerAboutIt() {
    const rowstore = require('../lib/rowstore');
    const SETS_DIR = path.join(ROOT, 'data', 'stagesets');
    const id = `s3-test-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}-wh`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999971, name: 'S3 #wh', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 4 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      const mk = (si, tHours) => ({
        si, label: `q2/6 x t${tHours}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'breakout', gate: 'directional', dMult: 1.5, tHours, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: 10 + si, trades: 3,
        holdout: { pnl: si, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 3, pairs: 9, lead: 1.5, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      for (let si = 0; si < 4; si++) w.push(mk(si, 17 + si * 24));
      w.close();
      await stages.buildTally(doc);

      // ENSURE ANSWERS WHETHER, AND ITS ANSWER CARRIES NO SETTINGS. This is the
      // object the press was handing to the board.
      assert.deepStrictEqual(stages.ensureTally(id), { ready: true },
        'the readiness answer has changed shape; the press reads it, and this is what must never reach a board');
      const t = stages.readTally(id);
      assert.strictEqual((t.ranked || []).length, 4, 'the fixture has no settings, so pressing it would prove nothing');

      // AND NOW PRESS IT FOR REAL.
      const started = stages.funnelRichStart(id);
      assert.ok(started && !started.error, `the press refused before it began: ${started && started.error}`);
      for (let i = 0; i < 400 && stages.funnelRichStatus(id).running; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 25));
      }
      const done = stages.funnelRichStatus(id);
      assert.ok(!done.running, 'the press never finished');
      // It may still fail further in -- a fixture has no price files to price
      // from -- but it must never fail because the board it was handed was
      // empty, which is what happens when it is given the readiness answer.
      assert.ok(!/no settings on its board/.test(String(done.error || '')),
        `the press was handed something that is not the tally: ${done.error}`);
      assert.ok(!/tables of this record set cannot be read/.test(String(done.error || '')),
        `the press could not read the tally it asked for: ${done.error}`);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(stages.funnelRichFile(id), { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // THE SAME ORDER ON BOTH PARTS IS 1, REVERSED IS -1, AND EVERY SETTING ON THE
  // SAME MONEY IS UNKNOWN. The third is the one that matters: no order to hold
  // is the ABSENCE of information, and returning agreement there would read as
  // proof.
  async theRankingIsOneWhenTheOrderSurvivesAndMinusOneWhenItInverts() {
    const same = RH.holdOfUnit(rows(40, (i) => [i, i, i]));
    assert.deepStrictEqual(holds(same), [1, 1, 1, 1], 'an order that survives every boundary does not read as 1');
    // the first part still ranks the second correctly here; only the third flips
    const flip = RH.holdOfUnit(rows(40, (i) => [i, i, -i]));
    assert.strictEqual(holds(flip)[0], 1, 'the boundary the flip does not cross moved');
    assert.deepStrictEqual(holds(flip).slice(1), [-1, -1, -1], 'an order that comes out backwards does not read as -1');
    const flat = RH.holdOfUnit(rows(40, () => [1, 1, 1]));
    assert.deepStrictEqual(holds(flat), [null, null, null, null], 'every setting on the same money reads as an answer rather than as no answer');
    // AND TIES DECIDE NOTHING: the ranks are averaged, so the order the rows
    // happen to sit in the file cannot move the number.
    assert.deepStrictEqual(RH.ranksOf([5, 5, 9]), [1.5, 1.5, 3], 'two settings on the same money do not share their rank');
    const a = rows(40, (i) => [i % 7, i % 5, i % 3]);
    const b = a.slice().reverse();
    assert.deepStrictEqual(holds(RH.holdOfUnit(a)), holds(RH.holdOfUnit(b)), 'the same table read in the other direction gives a different answer');
    // AND RANKS, NOT MONEY: one enormous figure must not carry the answer. On
    // this table thirty-nine settings hold their order across the boundary and
    // one does not, with a figure a billion times the rest. Comparing the money
    // itself, that single row drags the answer to nearly -1; comparing the
    // order, it is one row out of forty and the reading stays strongly positive.
    const table = rows(40, (i) => (i === 39 ? [1e9, -1e9, -1e9] : [i, i, i]));
    const big = RH.holdOfUnit(table);
    assert.ok(holds(big)[0] < 1, 'a single enormous figure left the order unchanged, so the fixture proves nothing');
    assert.ok(holds(big)[0] > 0.5, `one setting out of forty moved the reading to ${holds(big)[0]} — money is being compared, not order`);
    const pearson = (a, b) => {
      const m = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
      const ma = m(a); const mb = m(b);
      let t = 0; let sa = 0; let sb = 0;
      for (let i = 0; i < a.length; i++) { t += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
      return t / Math.sqrt(sa * sb);
    };
    const onMoney = pearson(table.map((r) => r.pnlThirds[0]), table.map((r) => r.pnlThirds[1]));
    assert.ok(onMoney < -0.9, `the fixture does not separate money from order — comparing the money gives ${onMoney}`);
  },

  // TWO POINTS ALWAYS AGREE PERFECTLY, so a reading off fewer than three
  // settings is not a reading at all.
  async fewerThanThreeSettingsIsNoReading() {
    assert.strictEqual(RH.rankHold([1, 2], [9, 4]), null, 'two settings produced a number, and two points always correlate perfectly');
    assert.strictEqual(RH.rankHold([], []), null, 'an empty board produced a number');
    assert.ok(RH.rankHold([1, 2, 3], [1, 2, 3]) === 1, 'three settings in the same order is not 1');
  },

  // A SETTING WITHOUT ALL THREE PARTS IS COUNTED AND LEFT OUT, never guessed
  // at. A missing part read as zero would put every un-priced setting at the
  // bottom of the order and hold the ranking up by itself.
  async aSettingMissingAPartIsCountedAndLeftOut() {
    const mixed = [...rows(30, (i) => [i, i, i]), { pnlThirds: [1, 2] }, { pnlThirds: null }, { pnlThirds: [1, null, 3] }, {}];
    const r = RH.holdOfUnit(mixed);
    assert.strictEqual(r.of, 34, 'the total is not what was handed in');
    assert.strictEqual(r.usable, 30, 'a setting missing a part was read anyway');
    assert.strictEqual(r.noThirds, 4, 'the settings left out are not counted, so a thin board reads as a full one');
    assert.deepStrictEqual(holds(r), [1, 1, 1, 1], 'leaving the incomplete settings out changed the answer');
  },

  // THE BAR IS THE OWNER'S, IN ONE PLACE, AND MOVING IT RE-READS NOTHING
  // (RULE FIVE). Three numbers: how much must hold, on how many of the four,
  // and how few settings is too few to put a number on at all.
  async theBarIsTheOwnersAndReAppliesWithoutReReading() {
    const strong = { unit: 'A', name: 'A', ...RH.holdOfUnit(rows(40, (i) => [i, i, i]), 116) };
    const flipped = { unit: 'B', name: 'B', ...RH.holdOfUnit(rows(40, (i) => [i, i, -i]), 116) };
    const thin = { unit: 'C', name: 'C', ...RH.holdOfUnit(rows(5, (i) => [i, i, i]), 116) };
    const list = [strong, flipped, thin];
    const at = (bar) => RH.withBar(list, bar).units.map((u) => u.bar.pass);
    assert.deepStrictEqual(at({ atLeast: 0.5, onHowMany: 4 }), [true, false, null], 'the bar on all four boundaries does not sort the three apart');
    assert.deepStrictEqual(at({ atLeast: 0.5, onHowMany: 1 }), [true, true, null], 'one boundary cleared is not enough on a bar of one');
    // NO BAR SET IS NOT A BAR OF ZERO. A blank box must not quietly mean "any
    // order at all counts" -- which is what Number('') is.
    assert.deepStrictEqual(at({ onHowMany: 4 }), [null, null, null], 'a bar nobody set passes or fails rows');
    assert.deepStrictEqual(at({ atLeast: '', onHowMany: '4' }), [null, null, null], 'a blank arriving as an empty string reads as a bar of zero');
    assert.deepStrictEqual(at({ atLeast: 0, onHowMany: 4 }), [true, false, null], 'a bar the owner really set to zero stopped being a bar');
    // THE THIN ROW IS UNREADABLE, NOT FAILING, and says why in its own words
    const c = RH.withBar(list, { atLeast: 0.5, onHowMany: 4 }).units[2];
    assert.strictEqual(c.bar.pass, null, 'a coin and shape with too few settings reads as failing rather than as unread');
    assert.ok(/only 5 setting\(s\) here carry all three parts, fewer than the 30 you asked for/.test(c.bar.why), c.bar.why);
    assert.deepStrictEqual(holds(c), [null, null, null, null], 'a number is drawn for a board too thin to read');
    // and lowering that number lets it be read, without anything being re-read
    const low = RH.withBar(list, { atLeast: 0.5, onHowMany: 4, fewestRanked: 4 }).units[2];
    assert.strictEqual(low.bar.pass, true, 'lowering the fewest-settings-ranked number did not let the row be read');
    assert.deepStrictEqual(holds(low), [1, 1, 1, 1], 'the readings were not there to be shown, so they must have been re-read');
    // A BOUNDARY THAT COULD NOT BE READ IS NOT ONE THAT PASSED
    const oneBad = { unit: 'D', name: 'D', ...RH.holdOfUnit(rows(40, (i) => [i, 1, i]), 116) };
    const got = RH.withBar([oneBad], { atLeast: 0.5, onHowMany: 4 }).units[0];
    assert.ok(got.known < 4, 'the fixture has all four boundaries readable, so it proves nothing');
    assert.strictEqual(got.bar.pass, false, 'a bar counting four boundaries was cleared with fewer than four readable');
    assert.ok(/only \d of the four boundaries could be read/.test(got.bar.why), got.bar.why);
    // the counts across the table
    const t = RH.withBar(list, { atLeast: 0.5, onHowMany: 4 });
    assert.strictEqual(t.passing, 1);
    assert.strictEqual(t.failing, 1);
    assert.strictEqual(t.unreadable, 1);
    assert.strictEqual(t.of, 3, 'the table does not say how many rows it holds');
    // and the two counts are clamped to what exists, so a bar of five on four
    // is not a bar nothing can clear
    assert.strictEqual(RH.withBar(list, { atLeast: 0.5, onHowMany: 9 }).bar.onHowMany, 4);
    assert.strictEqual(RH.withBar(list, { atLeast: 0.5, onHowMany: 0 }).bar.onHowMany, 1);
  },

  // TWO KINDS OF THIN, AND NEITHER GUARDS THE OTHER (owner, 2026-09-10:
  // "settings MEANS SOMETHING, AND IT'S NOT THE NUMBER OF TRADABLE PERIODS
  // WITHIN A PART"). One floor counts SETTINGS -- one combination of entry,
  // gate, d, t, trail and arm -- and the other counts CHUNKS of history behind
  // each figure. A coin and shape can be fat on one and starved on the other,
  // which is exactly the weekly case: nine hundred settings, sixteen chunks a
  // part.
  async theHistoryFloorIsSeparateFromTheSettingsFloor() {
    const daily = { unit: 'A', name: 'A daily', ...RH.holdOfUnit(rows(900, (i) => [i, i, i]), 116) };
    const weekly = { unit: 'B', name: 'B weekly', ...RH.holdOfUnit(rows(900, (i) => [i, i, i]), 16) };
    const unrecorded = { unit: 'C', name: 'C no window', ...RH.holdOfUnit(rows(900, (i) => [i, i, i]), null) };
    const list = [daily, weekly, unrecorded];
    const bar = { atLeast: 0.5, onHowMany: 4, fewestRanked: 30, fewestChunks: 40 };
    const t = RH.withBar(list, bar);
    assert.deepStrictEqual(t.units.map((u) => u.bar.pass), [true, null, null],
      'a coin and shape with plenty of settings and almost no history reads the same as one with both');
    assert.ok(/each part of this test window holds 16 chunk\(s\), fewer than the 40 you asked for/.test(t.units[1].bar.why), t.units[1].bar.why);
    assert.deepStrictEqual(holds(t.units[1]), [null, null, null, null], 'a number is drawn for a window too short to read');
    // A RUN THAT RECORDED NO WINDOW IS NOT ASSUMED TO BE LONG ENOUGH
    assert.ok(/did not record how long its test window was/.test(t.units[2].bar.why), t.units[2].bar.why);
    // ZERO TURNS THE HISTORY FLOOR OFF, and turns nothing else off
    const off = RH.withBar(list, { ...bar, fewestChunks: 0 });
    assert.deepStrictEqual(off.units.map((u) => u.bar.pass), [true, true, true], 'zero does not turn the history floor off');
    // and the settings floor still bites with the history floor off
    const few = { unit: 'D', name: 'D', ...RH.holdOfUnit(rows(5, (i) => [i, i, i]), 116) };
    assert.strictEqual(RH.withBar([few], { ...bar, fewestChunks: 0 }).units[0].bar.pass, null,
      'turning the history floor off turned the settings floor off with it');
    // both floors travel back with the answer, so the screen never has to guess
    assert.deepStrictEqual(t.bar, { atLeast: 0.5, onHowMany: 4, fewestRanked: 30, fewestChunks: 40 });
    // and they are separate numbers in the reading itself
    assert.strictEqual(weekly.chunksAPart, 16, 'the reading does not carry how much history was behind it');
    assert.strictEqual(daily.usable, 900);
    // AND THE NUMBER HANDED IN IS A PART, NOT THE WHOLE WINDOW. Everything
    // above takes chunksAPart on trust; this is the one line that produces it,
    // and measuring a whole test window against a floor meant for one of its
    // three parts would let every short shape clear it. Read off the window
    // each run recorded, so the floor cannot be fooled by a layout change.
    const st = src('lib/stages.js');
    const read = st.slice(st.indexOf('async function funnelRankHoldRead('), st.indexOf('const holdAnswer ='));
    assert.ok(read.includes('return Number.isFinite(n) && n > 0 ? Math.floor(n / 3) : null;'),
      'the whole test window is handed to a floor meant for one of its three parts');
    assert.ok(read.includes('const n = w && w.test && Number(w.test.chunks);'),
      'the window length is not read off what the run recorded');
    assert.ok(read.includes('RH.holdOfUnit(rows, chunksAPartOf(u.key))'), 'the reading is taken without the window length beside it');
  },

  // NOTHING HERE READS THE HELD-BACK WINDOW OR THE RESERVE (Part 3). This is
  // drawn on a screen used for CHOOSING, so a figure from either stretch would
  // spend it. Checked on the source, because the harm is a call that exists.
  async theRankingReadsNothingFromTheHeldBackWindowOrTheReserve() {
    const lib = src('lib/rankhold.js');
    // it requires nothing, so there is nothing it could read; and it names no
    // field off any stretch but the test window
    assert.ok(!lib.includes('require('), 'lib/rankhold.js pulls something in — it must be arithmetic and nothing else');
    for (const field of ['heldBack', 'avgHeld', 'pnlHeld', 'sealedFrom', 'unreadFrom', 'avgUnread']) {
      assert.ok(!lib.includes(field), `lib/rankhold.js reads '${field}' — nothing here may touch the held-back window or the reserve`);
    }
    assert.ok(lib.includes('pnlThirds'), 'it does not read the parts of the test window at all');
    // and the engine's own reading of it takes its numbers off the test window
    const st = src('lib/stages.js');
    const fn = st.slice(st.indexOf('async function funnelRankHoldRead('), st.indexOf('const holdAnswer ='));
    assert.ok(fn.includes('const rich = readFunnelRich(String(id));'), 'the reading does not come from the numbers kept beside the set');
    assert.ok(fn.includes('withFunnelRich(await loadUnitBoard(String(id), t, u.key), rich)'), 'it reads something other than each board with those numbers laid on');
    assert.ok(!/heldBack|sealed|unread/.test(fn), 'the reading touches the held-back window or the unread stretch');
    // a set with no numbers beside it must SAY so rather than read as unrelated
    assert.ok(/press work out the missing numbers first/.test(fn), 'a set whose settings carry no parts is read as an answer instead of a refusal');
  },

  // THE READING IS TAKEN ONCE AND THE BAR MOVES ON IT (3.102.0). One board is
  // seconds off disk; the three numbers are arithmetic. A bar that re-read
  // every board would make the control unusable and the walk slower for it.
  async theBarNeverCausesABoardToBeReadAgain() {
    const st = src('lib/stages.js');
    const start = st.slice(st.indexOf('function funnelRankHoldStart(id, bar = {}) {'), st.indexOf('function funnelRankHoldForget('));
    assert.ok(start.includes('if (holdRun && holdRun.result && holdRun.id === String(id)) return holdAnswer(holdRun, bar);'),
      'a set already read is read again when the bar moves');
    assert.ok(st.includes('result: run.result ? { ...RH.withBar(run.result, bar), setId: run.id } : null,'),
      'the bar is not laid onto the reading in hand, so the two cannot be separate steps');
    // and the run holds the reading BEFORE the bar, or there is nothing to re-bar
    const read = st.slice(st.indexOf('async function funnelRankHoldRead('), st.indexOf('const holdAnswer ='));
    assert.ok(read.includes('RH.holdOfUnit(rows, chunksAPartOf(u.key))') && !read.includes('withBar'), 'the reading is stored with a bar already on it');
    // THE PAGE NEVER WORKS OUT A PASS FOR ITSELF: one place decides it
    const page = src('public/construct.js');
    const panel = page.slice(page.indexOf('const F_HOLD_SHOW = ['), page.indexOf('function fStep6(d, st, r) {'));
    assert.ok(!/>=\s*bar\.atLeast|hold >= need &&|\.cleared >=|usable <|chunksAPart <\s*bar\.fewestChunks\s*\?/.test(panel),
      'the screen decides for itself whether a row clears the bar, so two places can disagree about a pass');
    assert.ok(panel.includes('u.bar.pass === true'), 'the screen does not read the pass the service worked out');
    assert.ok(panel.includes('${esc(String(u.bar.why || \'nothing could be read\'))}'), 'the screen writes its own reason instead of printing the one it was given');
  },

  // A READING WAS READ FROM THE NUMBERS BESIDE THE SET, so it goes when those
  // numbers are worked out again -- otherwise the table is drawn from figures
  // it never saw.
  async aReadingIsDroppedWhenTheNumbersBesideTheSetAreWorkedOutAgain() {
    const st = src('lib/stages.js');
    assert.ok(st.includes('function funnelRankHoldForget(id) { if (holdRun && holdRun.id === String(id)) holdRun = null; }'),
      'there is no way to drop a reading that has gone stale');
    const rich = st.slice(st.indexOf('function funnelRichStart(id, state = {}) {'), st.indexOf('function funnelRichStatus(id) {'));
    assert.ok(rich.includes('funnelRankHoldForget(doc.id);'), 'working the numbers out again leaves the old reading in place');
    // and nothing else on the box reads the same boards at the same time
    assert.ok(st.includes("const holdBusy = () => (holdRun && !holdRun.result && !holdRun.error\n  ? `the ranking of ${holdRun.id} is being read` : null);"),
      'the reading is not named, so every other refusal built on the busy guards reads the box as idle while it runs');
    assert.ok((st.match(/holdBusy\(\)/g) || []).length >= 8,
      'the reading is named in fewer places than the other board readings, so something can start on top of it');
  },

  // IT SITS ABOVE STEP 1 AND CHANGES NOTHING (owner order 2026-09-10: "at the
  // top before the step one of the funnel"). Read before anything is narrowed,
  // or it is a report on a choice already made.
  async theRankingIsDrawnAboveTheStepsAndPicksNothing() {
    const page = src('public/construct.js');
    // 3.107.0: the section is drawn under a predicate rather than unconditionally
    // (FUNNEL-DESIGN.md §20.6), so the slice starts at the predicate.
    const draw = page.slice(page.indexOf("  const away = fAway(st.set);\n  const open = fIsOpen(st);"), page.indexOf('  fWire(st, d);\n  fWatchWalkStart(st);\n}'));
    const atHold = draw.indexOf('fHoldPanel(d, st)');
    const atStep = draw.indexOf('Step ${d.step}');
    assert.ok(atHold > 0, 'the ranking is not drawn on the Funnel at all');
    assert.ok(atHold < atStep, 'the ranking is drawn below the step it is supposed to be read before');
    // FIRST PANEL OF ALL (owner order, 2026-09-10: "put it at the very top
    // before the header area ... the point is largely to confirm that given
    // units are worth even funneling"). Above the coin picker, because walking
    // a row IS the picking: read the table, then choose.
    assert.ok(atHold < draw.indexOf('fTitle(d, st, open ? F_NEW_NAME : F_HOME_NAME, away, open)'), 'the ranking is drawn below the picker it is supposed to be read before');
    assert.ok(atHold < draw.indexOf('fHead(d)'), 'the ranking is drawn below the set heading rather than first');
    // THE TABLE SHOWS WHAT THE OWNER ASKED FOR AND HIDES NOTHING ELSE, and it
    // says how many rows it is not showing (RULE ZERO: a curated list takes the
    // decision away invisibly).
    const panel = page.slice(page.indexOf('function fHoldRows(t, bar) {'), page.indexOf('function fHoldPanel(d, st) {'));
    assert.ok(panel.includes("bar.show === 'pass' ? rows.filter((u) => u.bar.pass === true)"), 'the table cannot be narrowed to the rows that clear the bar');
    assert.ok(panel.includes("bar.show === 'fail' ? rows.filter((u) => u.bar.pass === false)"), 'the table cannot be narrowed to the rows that do not');
    assert.ok(/\$\{Number\(all\.length\)\.toLocaleString\(\)\} of \$\{Number\(t\.of\)\.toLocaleString\(\)\} row\(s\) match what <b>show<\/b> is set to/.test(panel),
      'a narrowed table does not say how many rows it holds, so a short list reads as the whole set');
    // and each row hands the walk over through the SAME door every other choice
    // of coin and shape goes through
    const wire = page.slice(page.indexOf('function fWireHold(st, d) {'), page.indexOf('function fWatchWalkStart(st) {'));
    // 3.108.4: through fOpenBoard, the one door the four boxes above also use
    assert.ok(wire.includes('b.onclick = () => fOpenBoard(st.set, b.dataset.fhold);'),
      'walking a row does not choose the coin and shape the way the picker does');
    assert.ok(wire.includes("document.querySelectorAll('[data-fhold]').forEach"),
      'the rows are not wired by walking the table just drawn — a listener on the whole page fires once per redraw since load');
    // the three numbers are kept for the SET, not for one coin and shape's walk
    assert.ok(wire.includes('fRememberForSet(st.set, { hold:'), 'the four numbers are forgotten when another coin and shape is walked');
    // A SET CAN HOLD THREE HUNDRED COINS AND SHAPES, so the table has a page --
    // the SAME bar Boards draws, which is the one that states the true total.
    assert.ok(panel.includes("${bPager(all.length, from, F_HOLD_PER, 'WH')}"), 'the table draws every row it has, however many that is');
    assert.ok(wire.includes("document.querySelectorAll('[data-bpage]')") && wire.includes("document.querySelectorAll('[data-bpageto]')"),
      'the paging bar is drawn and nothing listens to it');
    // and changing what is shown goes back to page one, or a page past the end
    // of a narrowed table reads as "nothing clears the bar"
    assert.ok(wire.includes("const back = ['atLeast', 'onHowMany', 'fewestRanked', 'fewestChunks', 'show', 'sort'].some((k) => k in fields);"),
      'moving a bar leaves the table on a page that may no longer exist');
  },

  // THE HEADING SAYS WHAT IT IS FOR, AND NEVER THAT IT CONFIRMS ANYTHING
  // (owner, 2026-09-10). A pass here is the absence of a red flag, so a heading
  // with "confirm" in it would make a pass read as proof -- the exact thing
  // this part was written to prevent.
  async theHeadingAsksAQuestionAndNeverClaimsAConfirmation() {
    const page = src('public/construct.js');
    const panel = page.slice(page.indexOf('function fRebuildPress(d, named) {'), page.indexOf('function fStep6(d, st, r) {'));
    assert.ok(panel.includes('<h3 style="margin-top:0">Worth walking?</h3>'), 'the block is not headed with the question it answers');
    assert.ok(!/[Cc]onfirm/.test(panel), 'the block claims to confirm something; it can only fail to rule something out');
    assert.ok(/has not been shown\s+to work; it has only failed to be ruled out/.test(panel),
      'the block does not say that clearing the bar is not evidence');
    // THE PRESS SAYS WHAT IT WORKS OUT (owner order, 2026-09-10). It is pressed
    // on every stage 3 set that is not ready, so its name has to survive being
    // read cold.
    assert.ok(panel.includes('>Work out the test history numbers</button>'), 'the press does not say what it works out');
    assert.ok(!/work out the missing numbers/.test(panel), 'the press still calls them missing numbers');
    // and every place on this screen that names it names the same thing
    const funnel = page.slice(page.indexOf('function fLadder('), page.indexOf('function fStep7('));
    assert.ok(!/work out the missing numbers/.test(funnel), 'somewhere on the walk still names the press by the name it no longer has');
  },
};
