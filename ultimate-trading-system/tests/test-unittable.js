// TABLE 3.C: EVERY UNIT (3.230.0, owner order 2026-09-22: "we need a new
// table/view (with stored filters) called 'Table 3.C: Every unit' ... the
// filter needs to be stored (not just in the browser) and then the funnel
// selections including the worth walking section and the new rule section
// need to be filtered by what that current filter on 3.C has set").
//
// Two halves. The arithmetic of one coin and shape's row is typed in and read
// out, no file and no set (lib/unittable.js). Then a stage 3 set on disk is
// given a unit table, a stored filter, and the Funnel is read under it: the
// coin and shape box, the blend of all units together, and a walk left on a
// coin and shape the filter no longer keeps.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const UT = require('../lib/unittable');
const RH = require('../lib/rankhold');
const stages = require('../lib/stages');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');

// ONE COIN AND SHAPE'S BOARD, typed: four settings, priced under a gate, with
// the rebuilt numbers laid on. active t41 made 10, active t65 10.5, directional
// t41 0, directional t65 0.5; every record placed 6 trades at size 1 for 4
// less than its sized money, and had 2 calls blocked that lost 2 at size 1.
const gateTotals = (pnl) => ({ pnl, trades: 6, size: 6, at1: pnl - 4, blockedAt1: -2, blockedN: 2, placed: 6, blockedSign: 2, blockedMin: 0, silent: 0, readSum: 360, readN: 6 });
function typedBoard() {
  const rows = [];
  const spec = [
    ['active', 41, 10, [4, 3, 3], 100, 3],
    ['active', 65, 10.5, [4, 4, 2.5], 150, 4],
    ['directional', 41, 0, [0, -1, 1], 50, 2],
    ['directional', 65, 0.5, [1, -0.5, 0], 75, 1],
  ];
  for (const [gate, t, pnl, thirds, streak, wins] of spec) {
    rows.push({
      label: `q1 ${gate} t${t} · argmax auto 24/7`, gate, tHours: t, weekdaysOnly: false,
      avgTest: pnl, testTrades: 6,
      noiseTest: Array.from({ length: 10 }, (_, d) => (gate === 'active' ? pnl - 1 - d * 0.1 : pnl)),
      field: gateTotals(pnl),
      pnlThirds: thirds, maxDrawdown: streak, wins,
    });
  }
  return rows;
}
const CONTROLS = { 'all|41': { alwaysLong: 3, alwaysShort: -3, buyHold: 4, shortHold: -4 }, 'all|65': { alwaysLong: 20, alwaysShort: -20, buyHold: 25, shortHold: -25 } };

// A STAGE 3 SET ON DISK: three coins and shapes, four settings each, the first
// priced under a gate, the first two with the rebuilt numbers beside the set.
async function unitFixture() {
  const rowstore = require('../lib/rowstore');
  const id = `s3-test-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}-u3c`;
  fs.mkdirSync(SETS_DIR, { recursive: true });
  const units = [
    { u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d' },
    { u: 1, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-2d' },
    { u: 2, trade: 'BBB', ctx1: 'AAA', ctx2: null, size: 2, geometry: 'daily-1d' },
  ];
  const keys = units.map((u) => stages.unitKeyOf(u));
  const doc = {
    id, stage: 3, seq: 999969, name: 'S3 #u3c', status: 'done', createdAt: new Date().toISOString(),
    plan: { units: 3, settings: 4 }, params: { engineVersion: require('../package.json').version, nullN: 10, keepN: 10 },
    boardNull: { captured: true, kept: 10 },
    windows: { units: { [keys[0]]: { test: { chunks: 120 } }, [keys[1]]: { test: { chunks: 60 } } } },
  };
  fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify(doc));
  const gate = { read: 'certainty', agreeMin: 40, certMin: 70, rule: 'both', signOnly: false, rungs: '70:0.75,80:1', silent: 1 };
  const lift = (t) => (t === 65 ? 0.5 : 0);
  const money = (u, g, t) => (u.u === 0 ? (g === 'active' ? 10 : 0) : u.u === 1 ? (g === 'active' ? 2 : -1) : (g === 'active' ? -4 : 7)) + lift(t);
  const copies = (u, g, t) => Array.from({ length: 10 }, (_, d) => (u.u === 0 ? (g === 'active' ? 9 - d * 0.1 : 0) : u.u === 1 ? (g === 'active' ? (d < 5 ? 3 : 1) : -1) : (g === 'active' ? -3 : 7)) + lift(t));
  const w = rowstore.writer(id, 'records');
  let si = 0;
  let n = 0;
  const per = new Map();
  const thirds = { 'active|41': [4, 3, 3], 'active|65': [4, 4, 2.5], 'directional|41': [0, -1, 1], 'directional|65': [1, -0.5, 0] };
  const streaks = { 'active|41': 100, 'active|65': 150, 'directional|41': 50, 'directional|65': 75 };
  const wins = { 'active|41': 3, 'active|65': 4, 'directional|41': 2, 'directional|65': 1 };
  for (const g of ['active', 'directional']) {
    for (const t of [41, 65]) {
      const label = `q1 ${g} t${t} · argmax auto 24/7`;
      const entry = { label, units: [] };
      for (const u of units) {
        const pnl = money(u, g, t);
        w.push({ si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
          entry: 'market', gate: g, dMult: 1.5, tHours: t, trailMult: null, armMult: null,
          agreeRule: 'share', agreeBar: 0.6, agreePct: null, agreeCopy: 'plain', agreeBoth: false, agreePersist: 0,
          rung: 3, members: 8, voices: 5, pnl, trades: 6,
          holdout: { pnl: pnl / 2, trades: 4, stops: 1, vsAlwaysLong: pnl / 4 },
          beat: 6, pairs: 10, lead: 0.5,
          noiseTest: copies(u, g, t), noiseHold: copies(u, g, t).map((v) => v / 2),
          confirm: 'off',
          field: u.u === 0 ? { ...gate, test: gateTotals(pnl), hold: null } : null,
          ...u });
        if (u.u < 2) entry.units.push({ ...u, rich: { test: { maxDrawdown: streaks[`${g}|${t}`], wins: wins[`${g}|${t}`], pnlThirds: thirds[`${g}|${t}`] } } });
        if (++n % 2 === 0) w.flush();           // two units to a block
      }
      per.set(label, entry);
      si++;
    }
  }
  await w.close();
  const t = await stages.buildTally(doc);
  stages.saveFunnelRich(id, per, { [keys[0]]: CONTROLS });
  const cleanup = () => {
    for (const f of [path.join(SETS_DIR, `${id}.json`), path.join(SETS_DIR, `${id}-tally.json.gz`), path.join(SETS_DIR, `${id}-agreed.json.gz`), stages.unitsFile(id)]) {
      try { fs.rmSync(f, { force: true }); } catch (_) { /* fixture */ }
    }
    try { fs.rmSync(stages.funnelRichDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
  };
  return { id, doc, t, units, keys, cleanup };
}

module.exports = {
  // THE ROW IS THE ARITHMETIC OF THE BOARD, every column from the same four
  // settings, and none of it a nought where nothing was read.
  theUnitRowIsTheArithmeticOfItsBoard() {
    const rows = typedBoard();
    const r = UT.unitSummaryOf(rows, { chunksAPart: 40, testControls: CONTROLS });
    assert.strictEqual(r.settings, 4);
    assert.strictEqual(r.inMoneyPct, 75, 'three of the four are above zero');
    assert.strictEqual(r.avgTest, 5.25);
    assert.strictEqual(r.midTest, 5.25, 'the middle of 0, 0.5, 10 and 10.5');
    assert.strictEqual(r.bestTest, 10.5);
    // with and without the gate: every record's no-gate money is its placed
    // trades at size 1 (4 less than sized) plus its blocked calls at size 1 (-2)
    assert.strictEqual(r.avgTestNoGate, -0.75, 'avg test $ with no gate is at1 + blocked at size 1, averaged');
    assert.strictEqual(r.perTrade, 0.88, '21 over 24 placed trades');
    assert.strictEqual(r.perTradeNoGate, -0.09, '-3 over 32 calls, the blocked ones counted');
    assert.strictEqual(r.fieldBlocked, 25, '2 of every 8 calls blocked');
    // the copies: the real average 5.25 beats every one of the ten
    assert.strictEqual(r.copies, 10);
    assert.strictEqual(r.boardBeats, 10);
    assert.strictEqual(r.best30Beats, 10);
    // the three parts
    assert.strictEqual(r.thirds, 4);
    assert.deepStrictEqual([r.inMoney1, r.inMoney2, r.inMoney3], [75, 50, 75]);
    assert.strictEqual(r.allThreePct, 50);
    assert.strictEqual(r.loseAllPct, 0);
    const h = RH.holdOfUnit(rows, 40).readings;
    assert.deepStrictEqual([r.h12, r.h23, r.h13, r.h123], h.map((x) => Math.round(x.hold * 1000) / 1000), 'the four comparisons are the ranking reading\'s own');
    assert.strictEqual(r.top30Third, 1.63, 'the four ordered by the first two parts, their third averaged: (3 + 2.5 + 1 + 0) / 4');
    // the four things a rule has to beat, at each setting's own hold length
    assert.strictEqual(r.beatLongPct, 25, 'only active t41 (10) beats always long at t41 (3); at t65 always long is 20');
    assert.strictEqual(r.bestVsLong, 7);
    assert.strictEqual(r.midTrades, 6);
    assert.strictEqual(r.streakBest30, 87.5, 'the middle worst losing streak of the best four: 75 and 100');
    assert.strictEqual(r.winsBest30, 41.67, '10 wins over 24 trades');
    assert.strictEqual(r.chunksAPart, 40);
  },

  // A SET PRICED WITH NO GATE reads the same money in both columns -- its own
  // money IS every call at size 1 -- and nothing about the gate at all.
  aBoardPricedWithNoGateReadsTheSameMoneyInBothColumnsAndNoGateFigure() {
    const rows = typedBoard().map((r) => ({ ...r, field: null, pnlThirds: undefined, maxDrawdown: undefined, wins: undefined }));
    const r = UT.unitSummaryOf(rows, {});
    assert.strictEqual(r.avgTestNoGate, r.avgTest);
    assert.strictEqual(r.perTradeNoGate, r.perTrade);
    assert.strictEqual(r.perTrade, 0.88);
    assert.strictEqual(r.fieldBlocked, null, 'no gate, no blocked share');
    // and nothing rebuilt reads as nothing, never as zero
    assert.strictEqual(r.thirds, 0);
    for (const k of ['inMoney1', 'inMoney2', 'inMoney3', 'allThreePct', 'loseAllPct', 'h12', 'h23', 'h13', 'h123', 'top30Third', 'beatLongPct', 'bestVsLong', 'streakBest30', 'winsBest30', 'chunksAPart']) {
      assert.strictEqual(r[k], null, `${k} reads ${r[k]} with nothing to read it from`);
    }
    assert.strictEqual(UT.unitSummaryOf([], {}).settings, 0);
    assert.strictEqual(UT.unitSummaryOf([], {}).avgTest, null);
  },

  // THE FILTER: a floor hides the rows below it AND the rows with no figure,
  // a box the table does not offer is refused by name, and an empty box hides
  // nothing at all.
  theFilterHidesARowWithNoFigureAndRefusesABoxTheTableDoesNotOffer() {
    const rows = [
      { unit: 'a', avgTest: 5, loseAllPct: 10 },
      { unit: 'b', avgTest: -1, loseAllPct: 60 },
      { unit: 'c', avgTest: 9, loseAllPct: null },
    ];
    assert.deepStrictEqual(UT.applyFilter(rows, { minAvgTest: '0' }).map((r) => r.unit), ['a', 'c']);
    assert.deepStrictEqual(UT.applyFilter(rows, { maxLoseAll: '50' }).map((r) => r.unit), ['a'], 'a row with no figure clears a floor it never met');
    assert.deepStrictEqual(UT.applyFilter(rows, { minAvgTest: '', maxLoseAll: null }).map((r) => r.unit), ['a', 'b', 'c'], 'an empty box hides something');
    assert.throws(() => UT.applyFilter(rows, { notABox: '1' }), /is not a filter on Table 3.C/);
    assert.throws(() => UT.applyFilter(rows, { minAvgTest: 'ten' }), /needs a number/);
    // every column has exactly one box, reading that column its good way
    for (const c of UT.COLUMNS) {
      assert.deepStrictEqual(UT.FILTER_DEFS[c.filter], [c.key, c.good === 'low' ? 'max' : 'min'], `${c.key} has no box, or one that reads it the wrong way`);
    }
    assert.strictEqual(Object.keys(UT.FILTER_DEFS).length, UT.COLUMNS.length);
  },

  // THE ORDER: high first where high is good, low first where low is, A to Z
  // on the name, the set's own order with nothing picked; an empty cell goes
  // last either way and a flip turns the whole order round.
  everyColumnSortsItsGoodWayFirstAndAnEmptyCellGoesLast() {
    const rows = [
      { at: 0, name: 'BBB daily-1d', avgTest: 1, fieldBlocked: 30 },
      { at: 1, name: 'AAA daily-2d', avgTest: null, fieldBlocked: 10 },
      { at: 2, name: 'AAA daily-1d', avgTest: 7, fieldBlocked: null },
    ];
    const names = (key, flip) => rows.slice().sort(UT.orderBy(key, flip)).map((r) => r.at);
    assert.deepStrictEqual(names('set', false), [0, 1, 2]);
    assert.deepStrictEqual(names('name', false), [2, 1, 0]);
    assert.deepStrictEqual(names('avgTest', false), [2, 0, 1], 'high first, the empty one last');
    assert.deepStrictEqual(names('avgTest', true), [1, 0, 2], 'flipped, the whole order turns round');
    assert.deepStrictEqual(names('fieldBlocked', false), [1, 0, 2], 'low first where low is good, the empty one last');
    assert.ok(UT.SORTS.includes('set') && UT.SORTS.includes('name') && UT.COLUMN_KEYS.every((k) => UT.SORTS.includes(k)), 'a column cannot be sorted on');
  },

  // THE PAGE AND THE SERVICE LIST THE SAME COLUMNS, in the same order, with the
  // same boxes reading them the same way -- and the page's words are its own,
  // where the closed word list can see them.
  thePageListsTheSameColumnsAsTheService() {
    const page = src('public/construct.js');
    const at = page.indexOf('const B_UNIT_COLS = [');
    assert.ok(at > 0, 'the page has no list of Table 3.C\'s columns');
    // eslint-disable-next-line no-new-func
    const cols = new Function(`${page.slice(at, page.indexOf('\n];', at) + 3)}; return B_UNIT_COLS;`)();
    assert.deepStrictEqual(cols.map((c) => c[0]), UT.COLUMN_KEYS, 'the page draws different columns from the ones the service works out');
    for (const c of cols) {
      const own = UT.COLUMNS.find((x) => x.key === c[0]);
      assert.strictEqual(c[2], own.good, `${c[0]}: the page and the service disagree about which way is good`);
      assert.strictEqual(c[3], own.filter, `${c[0]}: the page's box is not the service's`);
      assert.ok(c[1] && c[4] && c[6], `${c[0]} has no heading, no box name or no hover`);
      assert.ok(/at least|at most/.test(c[4]), `${c[0]}'s box name does not say which way it cuts: ${c[4]}`);
      assert.ok((own.good === 'low') === /at most/.test(c[4]), `${c[0]}'s box says the wrong way: ${c[4]}`);
    }
    // the two words the service keys on are the service's own
    for (const u of [{ trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-1d' }, { trade: 'BBB', ctx1: 'AAA', ctx2: 'CCC', geometry: 'weekly-8d' }]) {
      assert.strictEqual(UT.unitKeyOf(u), stages.unitKeyOf(u));
    }
    for (const r of [{ weekdaysOnly: false, tHours: 41 }, { weekdaysOnly: true, tHours: 65 }]) {
      assert.strictEqual(UT.controlKeyOf(r), stages.controlKeyOf(r));
    }
  },

  // THE TABLE IS DRAWN UNDER TABLE 3.B, ONE LINE A ROW, sorting, filtering and
  // paging through the same helpers the two tables above it use, and its
  // filter goes on the record set -- read from the source that draws it.
  theTableIsDrawnUnderTableThreeBOnOneLineARow() {
    const page = src('public/construct.js');
    const sec = page.slice(page.indexOf('function bUnitsSection(doc, units, view) {'), page.indexOf('// ---- WHAT EVERY TABLE ON THIS SCREEN GETS'));
    assert.ok(sec.includes('<b>Table 3.C: Every unit</b>'), 'the table is not named on the screen');
    assert.ok(sec.includes("bFilterGrid('S3U', specs, units.spread)"), 'the table has no filter boxes, or not the shared ones');
    assert.ok(sec.includes('<td ${btdU0}>') && sec.includes('<td ${btdU}>'), 'the cells are not the one-line cells');
    assert.ok(page.includes('const btdU = \'style="padding:.25rem .3rem;white-space:nowrap;vertical-align:top"\';'), 'the one-line cell does not refuse to wrap');
    assert.ok(sec.includes("bSetFilters('S3U', units.unitFilter || {});"), 'the boxes are not drawn from the filter the record set holds');
    assert.ok(sec.includes("bPager(units.total || 0, units.from || 0, 100, 'S3U')"), 'the table has no paging bar');
    assert.ok(sec.includes('<tr data-bunithead'), 'the head row has no peg to hold the page still on');
    assert.ok(/colspan="\$\{1 \+ B_UNIT_COLS\.length\}"/.test(sec), 'the empty row types its colspan');
    // under Table 3.B, in the stage 3 draw
    const draw = page.slice(page.indexOf('async function bDrawStage3('));
    assert.ok(draw.includes("${bPager((coins && coins.total) || 0, coinsQ.offset || 0, 100, 'S3C')}\n    ${bUnitsSection(doc, units, view)}"), 'the table is not drawn under Table 3.B');
    assert.ok(draw.includes('apiOr(`api/stageset/${doc.id}/units?${unitsQs}`, null),'), 'the table is not asked for with the other tables');
    assert.ok(draw.includes('bWireUnitSort(mount);') && draw.includes('bWireFilters(mount, doc);'), 'the sort or the filters are not wired with the set in hand');
    // the filter saves on the record set and clears there too
    const ap = page.slice(page.indexOf('async function bApplyFilters('), page.indexOf('async function bApplyFilters(') + 1400);
    assert.ok(ap.includes("if (key === 'S3U' && doc && doc.id) {\n    if (!(await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/unitfilter`, { filters: next }))) return;"), 'applying does not save the filter on the record set');
    const wire = page.slice(page.indexOf('function bWireFilters('), page.indexOf('function bWireFilters(') + 3200);
    assert.ok(wire.includes("if (key === 'S3U' && doc && doc.id) await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/unitfilter`, { filters: {} });"), 'Clear filters leaves the filter on the record set');
    const pager = page.slice(page.indexOf('function bWirePager('), page.indexOf('function bWirePager(') + 900);
    assert.ok(pager.includes("} else if (key === 'S3U') {\n      bSaveView({ units: { ...(bView().units || {}), offset: from } });"), 'a page turn on this table is not remembered with its own view');
    // the routes the page calls
    const srv = src('server.js');
    assert.ok(srv.includes("app.get('/api/stageset/:id/units'") && srv.includes("app.post('/api/stageset/:id/unitfilter'"), 'the two doors are not on the server');
    // and the Help tab says what the table is and what the filter reaches
    const help = src('public/help-content.js');
    assert.ok(help.includes("['Table 3.C: Every unit, and the filter the Funnel reads',"), 'Boards\' help does not describe the table');
    assert.ok(help.includes("['Which coins and shapes this screen offers',"), 'the Funnel\'s help does not say the filter reaches it');
  },

  // THE FUNNEL SAYS WHAT THE FILTER KEEPS AND FOLLOWS A HIDDEN COIN AND SHAPE
  // TO THE FIRST KEPT ONE; a table or a blend being worked out is said and
  // asked again, never read as nothing -- read from the source.
  theFunnelSaysWhatTheFilterKeepsAndWaitsForATableOrABlend() {
    const page = src('public/construct.js');
    assert.ok(page.includes('if (d.totalling || d.waiting || d.building || d.blending || d.failed) {'), 'the Funnel does not wait for the unit table or the blend');
    assert.ok(page.includes("working out the unit table the filter on Table 3.C reads: ${Number(ub.done || 0).toLocaleString()} of ${Number(ub.of || 0).toLocaleString()} coins and shapes"), 'the line does not say the unit table is being worked out');
    assert.ok(page.includes("blending the coins and shapes the filter on Table 3.C keeps: ${Number(bl.building.done || 0).toLocaleString()} of ${Number(bl.building.total || 0).toLocaleString()} parts"), 'the line does not say the blend is being worked out');
    assert.ok(page.includes("if (!failed) setTimeout(() => { if (tab === 'funnel') drawFunnel(); }, 4000);"), 'a failure is asked again every four seconds, or a wait is not');
    assert.ok(page.includes("if (d.unitFilter && d.unitFilter.hidden && (d.unit || 'all') !== st.unit) {\n    fUnitChoose(st.set, d.unit || 'all');"), 'a walk left on a hidden coin and shape does not follow the reply');
    assert.ok(page.includes('the filter on Table 3.C keeps <b>${Number(d.unitFilter.kept).toLocaleString()}</b> of'), 'the line under the coin box does not say what the filter keeps');
    assert.ok(page.includes('The filter on Table 3.C keeps ${Number(t.unitFilter.kept).toLocaleString()} of ${Number(t.unitFilter.of).toLocaleString()} coins and shapes, and only those are listed.'), 'Worth walking? does not say the filter cut its rows');
  },

  // ON A SET ON DISK: the table is built in the background and kept beside the
  // set, the row for a coin and shape is its board's arithmetic, the filter is
  // stored on the set, and the Funnel's coin and shape box, its blend and a
  // walk on a hidden coin and shape all read it.
  async theUnitTableIsBuiltBesideTheSetAndTheFunnelReadsItsFilter() {
    const fx = await unitFixture();
    const { id, keys } = fx;
    try {
      // built in the background, said while it builds, then ready
      const first = stages.ensureUnitTable(id);
      assert.ok(first.building, `the first ask does not start a build: ${JSON.stringify(first)}`);
      await stages.unitTableWait();
      const ready = stages.ensureUnitTable(id);
      assert.ok(ready.ready && ready.table, `the table is not ready after the build: ${JSON.stringify(ready)}`);
      assert.ok(fs.existsSync(stages.unitsFile(id)), 'the table is not kept beside the set');
      const rows = ready.table.units;
      assert.deepStrictEqual(rows.map((r) => r.unit), keys, 'one row per coin and shape, in the set\'s order');
      const u0 = rows[0];
      const typed = UT.unitSummaryOf(typedBoard(), { chunksAPart: 40, testControls: CONTROLS });
      for (const k of UT.COLUMN_KEYS) assert.strictEqual(u0[k], typed[k], `${k}: the built row reads ${u0[k]} where the typed board reads ${typed[k]}`);
      assert.strictEqual(u0.name, 'AAA daily-1d');
      assert.strictEqual(rows[2].name, 'BBB alongside AAA daily-1d');
      // the third coin and shape was never passed over: nothing rebuilt, no gate
      assert.strictEqual(rows[2].avgTest, 1.75);
      assert.strictEqual(rows[2].avgTestNoGate, 1.75, 'a coin priced with no gate reads its own money as the no-gate money');
      assert.strictEqual(rows[2].fieldBlocked, null);
      assert.strictEqual(rows[2].h12, null);
      assert.strictEqual(rows[1].chunksAPart, 20);

      // THE TABLE AS THE SCREEN ASKS FOR IT: sorted on one column, a page
      const byMoney = stages.stage3Units(id, { sort: 'avgTest' });
      assert.deepStrictEqual(byMoney.rows.map((r) => r.unit), [keys[0], keys[2], keys[1]], 'avg test $ high first');
      const flipped = stages.stage3Units(id, { sort: 'avgTest', flip: '1' });
      assert.deepStrictEqual(flipped.rows.map((r) => r.unit), [keys[1], keys[2], keys[0]]);
      const paged = stages.stage3Units(id, { sort: 'avgTest', offset: 1, limit: 1 });
      assert.deepStrictEqual([paged.total, paged.of, paged.rows.length, paged.rows[0].unit], [3, 3, 1, keys[2]]);
      assert.ok(paged.spread && paged.spread.minAvgTest && paged.spread.minAvgTest.max === 5.25, 'the four numbers beside the box are not worked out over the rows');

      // THE FILTER IS STORED ON THE SET, refused by name when it is not a box
      assert.throws(() => stages.setUnitFilter(id, { notABox: '1' }), /is not a filter on Table 3.C/);
      stages.setUnitFilter(id, { minAvgTest: '1' });
      assert.deepStrictEqual(stages.getSet(id).unitFilter, { minAvgTest: '1' }, 'the filter is not on the record set');
      const cut = stages.stage3Units(id, {});
      assert.deepStrictEqual(cut.rows.map((r) => r.unit), [keys[0], keys[2]], 'the stored filter does not cut the table');
      assert.deepStrictEqual([cut.total, cut.of, cut.removed], [2, 3, 1]);
      const kept = stages.keptUnitKeys(id, stages.readTally(id));
      assert.deepStrictEqual([...kept.kept].sort(), [keys[0], keys[2]].sort());
      assert.strictEqual(kept.first, keys[0]);

      // THE FUNNEL OFFERS ONLY THE KEPT COINS AND SHAPES and says so
      const d0 = await stages.funnelRead(id, { unit: keys[0], step: 1, rule: { ranges: {}, allowed: {}, floors: {} } });
      assert.deepStrictEqual(d0.units.map((u) => u.key), [keys[0], keys[2]], 'the coin and shape box offers a coin and shape the filter hides');
      assert.deepStrictEqual(d0.unitFilter, { kept: 2, of: 3, hidden: null });
      // a walk left on a hidden coin and shape lands on the first kept one, named
      const d1 = await stages.funnelRead(id, { unit: keys[1], step: 1, rule: { ranges: {}, allowed: {}, floors: {} } });
      assert.strictEqual(d1.unit, keys[0], 'the walk stayed on a coin and shape the filter hides');
      assert.strictEqual(d1.unitFilter.hidden, 'AAA daily-2d', 'the reply does not name the hidden coin and shape the way the screen does');
      // ALL UNITS TOGETHER IS THE BLEND OF THE KEPT ONES: worked out in the
      // background, said while it is, then the kept coins' average
      const b0 = await stages.funnelRead(id, { unit: 'all', step: 1, rule: { ranges: {}, allowed: {}, floors: {} } });
      assert.ok(b0.blending, `the first read of the blend does not say it is being worked out: ${JSON.stringify(b0).slice(0, 200)}`);
      await stages.blendWait();
      const b1 = await stages.funnelRead(id, { unit: 'all', step: 1, rule: { ranges: {}, allowed: {}, floors: {} } });
      assert.ok(!b1.blending && b1.unit == null, 'the blend did not land');
      assert.strictEqual(b1.of, 4, 'the blend is not one row per setting');
      // the set's own blend averages per COIN: AAA's two shapes fold into one
      // cell, (10 + 2) / 2 = 6, beside BBB's -4 -- so 1
      const t = stages.readTally(id);
      const whole = t.ranked.find((r) => r.label === 'q1 active t41 · argmax auto 24/7');
      assert.strictEqual(whole.avgTest, 1, 'the set\'s own blend is not over all three coins and shapes');
      // the kept blend leaves the hidden coin and shape out: AAA is its daily-1d
      // alone (10) beside BBB (-4) -- so 3, over 2 coins
      const blendRows = (await stages.funnelBoard(id, t, 'all', kept.kept)).all;
      const keptRow = blendRows.find((r) => r.label === 'q1 active t41 · argmax auto 24/7');
      assert.strictEqual(keptRow.avgTest, 3, `the blend of the kept coins and shapes averages the hidden one in: ${keptRow.avgTest}`);
      assert.strictEqual(keptRow.coins, 2);

      // A FILTER THAT KEEPS NOTHING keeps nothing, and says so
      stages.setUnitFilter(id, { minAvgTest: '1000' });
      const none = stages.keptUnitKeys(id, t);
      assert.strictEqual(none.kept.size, 0);
      assert.strictEqual(none.first, null);
      // and clearing it puts every coin and shape back
      stages.setUnitFilter(id, {});
      assert.strictEqual(stages.getSet(id).unitFilter, null, 'an empty filter is stored rather than put away');
      assert.strictEqual(stages.keptUnitKeys(id, t).kept, null, 'with no filter set something is still cut');

      // THE TABLE FOLLOWS THE NUMBERS: a new pass beside the set makes it stale,
      // and it is built again rather than served
      stages.saveFunnelRich(id, new Map([['q1 active t41 · argmax auto 24/7', { label: 'q1 active t41 · argmax auto 24/7', units: [{ trade: 'BBB', ctx1: 'AAA', ctx2: null, geometry: 'daily-1d', rich: { test: { maxDrawdown: 9, wins: 1, pnlThirds: [1, 1, 1] } } }] }]]));
      const again = stages.ensureUnitTable(id);
      assert.ok(again.building, `a table built from numbers that have since moved is served as fresh: ${JSON.stringify(again)}`);
      await stages.unitTableWait();
      const fresh = stages.ensureUnitTable(id);
      assert.ok(fresh.ready, 'the second build did not land');
      assert.strictEqual(fresh.table.units[2].thirds, 1, 'the rebuilt table does not read the new numbers');

      // DELETING THE SET DELETES ITS TABLE
      const look = stages.deleteSet(id);
      stages.deleteSet(id, look.confirmWith);
      assert.ok(!fs.existsSync(stages.unitsFile(id)), 'the unit table outlives its set');
    } finally {
      fx.cleanup();
    }
  },
};
