// The Funnel — the step between Boards and Verify that turns half a million
// priced settings into a defensible handful (FUNNEL-DESIGN.md).
//
// These tests carry the two rails the design rests on and they are the reason
// the rails are rails rather than intentions:
//
//   * a reader must never have to notice a field is ABSENT and infer the answer
//     from that — noticing an absence is asking which era a record is from,
//     which is what RULE NINE forbids;
//   * a PARTLY sealed set is not a sealed set, because the one-touch reserve
//     grade would otherwise quietly grade fewer coins than the board holds.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const stages = require('../lib/stages');
const { newBook } = require('../lib/bracket');
const FS4 = require('../lib/funnelset');

// a small stage-3-shaped board
function s3rows() {
  const rows = [];
  for (const t of [41, 65, 89, 113]) {
    for (const g of ['active', 'directional']) {
      rows.push({
        si: rows.length, label: `t${t} ${g}`, tHours: t, gate: g,
        bandMode: t === 41 ? 'auto' : 5, maxDrawdown: t * 2, avgTest: t / 10,
      });
    }
  }
  return rows;
}

const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// A STAGE 3 SET ON DISK FOR THE PER-UNIT BOARD (§17): three units -- AAA on
// daily-1d, AAA on daily-2d, BBB alongside AAA on daily-1d -- four settings
// (gate active/always x tHours 41/65), ten kept figures on every record, the
// records written setting-major so every block holds rows of two units and a
// board that read a whole block would carry another unit's rows. Money per
// unit: unit 0's active beats every copy; unit 1's active beats five of ten;
// unit 2's active loses and beats none.
const SETS_DIR = path.join(__dirname, '..', 'data', 'stagesets');
async function unitFixture(opts = {}) {
  const rowstore = require('../lib/rowstore');
  const id = `s3-test-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}-unit`;
  fs.mkdirSync(SETS_DIR, { recursive: true });
  const doc = { id, stage: 3, seq: 999990, name: 'S3 #unit', status: 'done', createdAt: new Date().toISOString(),
    plan: { units: 3, settings: 4 }, params: { engineVersion: require('../package.json').version, nullN: 10, keepN: 10 },
    boardNull: { captured: true, kept: 10 } };
  fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify(doc));
  const units = [
    { u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d' },
    { u: 1, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-2d' },
    { u: 2, trade: 'BBB', ctx1: 'AAA', ctx2: null, size: 2, geometry: 'daily-1d' },
  ];
  const keys = units.map((u) => stages.unitKeyOf(u));
  // A PARENT STAGE 2 SET when asked for, whose table order is not the record
  // order: forecast score -- all members puts unit 1 first, then 2, then 0
  const parentId = opts.parent ? `${id}-s2` : null;
  if (parentId) {
    fs.writeFileSync(path.join(SETS_DIR, `${parentId}.json`), JSON.stringify({
      id: parentId, stage: 2, seq: 999989, name: 'S2 #unit', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 3 }, params: { universe: ['AAA', 'BBB'] },
    }));
    const pw = rowstore.writer(parentId, 'records');
    const scores = [1, 9, 5];
    units.forEach((u, i) => pw.push({ u: u.u, carriedRank: i + 1, s1rank: i + 1, trade: u.trade, ctx1: u.ctx1, ctx2: u.ctx2,
      size: u.size, geometry: u.geometry, specs: [], scoreAll: scores[i], score3: scores[i] - 1 }));
    await pw.close();
    doc.parent = { id: parentId, name: 'S2 #unit' };
    fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify(doc));
  }
  const lift = (t) => (t === 65 ? 0.5 : 0);
  const money = (u, g, t) => (u.u === 0 ? (g === 'active' ? 10 : 0) : u.u === 1 ? (g === 'active' ? 2 : -1) : (g === 'active' ? -4 : 7)) + lift(t);
  const copies = (u, g, t) => Array.from({ length: 10 }, (_, d) => {
    if (u.u === 0) return (g === 'active' ? 9 - d * 0.1 : 0) + lift(t);
    if (u.u === 1) return (g === 'active' ? (d < 5 ? 3 : 1) : -1) + lift(t);
    return (g === 'active' ? -3 : 7) + lift(t);
  });
  const w = rowstore.writer(id, 'records');
  let si = 0;
  let n = 0;
  for (const g of ['active', 'directional']) {
    for (const t of [41, 65]) {
      const label = `q1 ${g} t${t} · argmax auto 24/7`;
      for (const u of units) {
        const pnl = money(u, g, t);
        w.push({ si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
          entry: 'market', gate: g, dMult: 1.5, tHours: t, trailMult: null, armMult: null,
          agreeRule: 'share', agreeBar: 0.6, agreePct: null, agreeCopy: 'plain', agreeBoth: false, agreePersist: 0,
          rung: 3, members: 8, voices: 5, pnl, trades: 10,
          holdout: { pnl: pnl / 2, trades: 4, stops: 1, vsAlwaysLong: pnl / 4 },
          beat: 6, pairs: 10, lead: 0.5,
          noiseTest: copies(u, g, t), noiseHold: copies(u, g, t).map((v) => v / 2),
          ...u });
        if (++n % 2 === 0) w.flush();           // two units to a block
      }
      si++;
    }
  }
  await w.close();
  const t = await stages.buildTally(doc);
  const cleanup = () => {
    for (const f of [path.join(SETS_DIR, `${id}.json`), path.join(SETS_DIR, `${id}-tally.json.gz`), stages.funnelRichFile(id)]) {
      try { fs.rmSync(f, { force: true }); } catch (_) { /* fixture */ }
    }
    try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    if (parentId) {
      try { fs.rmSync(path.join(SETS_DIR, `${parentId}.json`), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(parentId), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  };
  return { id, doc, t, units, keys, parentId, cleanup };
}

module.exports = {
  // Every set says whether a board-wide noise reading was captured on it, in
  // the same words. The stamp goes on at birth, at all three stages.
  everySetIsStampedWithItsBoardNoiseStateAtBirth() {
    const s = src('lib/stages.js');
    const births = s.split('measurements: MEASUREMENTS_VERSION,').length - 1;
    assert.strictEqual(births, 3, 'three stages create sets; all three must be counted here');
    // EVERY site stamps it; they do not all stamp the SAME thing. Stage 3 now
    // stamps what the run actually kept, because a run that keeps ten and
    // stamps "none" would fill every column and still tell the Funnel there is
    // nothing to compare against. Stages 1 and 2 keep nothing and say so.
    const stamped = s.split('boardNull:').length - 1;
    assert.ok(stamped >= 3, `every set-creation site must stamp the board-noise state, found ${stamped}`);
    assert.strictEqual(s.split('boardNull: { ...BOARD_NULL_NONE },').length - 1, 2,
      'stages 1 and 2 keep nothing, so both must stamp the plain "none"');
    assert.ok(s.includes('boardNull: keepN > 0'),
      'stage 3 must stamp what its own null set money kept field asked for');
  },

  // The wording must be true of a set written today and a set written in July
  // alike. An era-flavoured reason ("predates X") is the same defect wearing a
  // sentence: it tells a reader there are two kinds of set.
  theStampSaysTheSameThingWhicheverEraTheSetIsFrom() {
    const why = String(stages.BOARD_NULL_NONE.why || '');
    assert.strictEqual(stages.BOARD_NULL_NONE.captured, false);
    assert.ok(why.length > 10, 'the stamp must say why, not just no');
    assert.ok(!/predate|before .* existed|older|legacy|old set/i.test(why),
      `the reason must not date the set: ${why}`);
  },

  // A set nobody has stamped is refused. Reading an absent field as "no" is
  // exactly the inference this design does not allow.
  anUnstampedSetIsRefusedNotGuessedAt() {
    assert.throws(() => stages.noiseTwinOf({ id: 's3-x' }), /no board-wide noise stamp/);
    const got = stages.noiseTwinOf({ id: 's3-x', boardNull: stages.BOARD_NULL_NONE });
    assert.strictEqual(got.available, false);
    assert.ok(got.why, 'an unavailable twin must say why, so the tab can print it rather than a blank');
  },

  // One unit with no sealed window means the final grade covers fewer coins
  // than the board does. That is a refusal, not a footnote.
  aPartlySealedSetIsNotASealedSet() {
    const ok = stages.sealedFromUnits('reserve61', [
      { u: 0, reserve: { chunks: 9 } }, { u: 1, reserve: { chunks: 9 } },
    ]);
    assert.strictEqual(ok.sealed, true);
    assert.strictEqual(ok.why, null);
    const short = stages.sealedFromUnits('reserve61', [
      { u: 0, reserve: { chunks: 9 } }, { u: 1, reserve: null },
    ]);
    assert.strictEqual(short.sealed, false, 'one unit short is not sealed');
    assert.ok(/1 of 2/.test(short.why), `and it must name how many: ${short.why}`);
    const none = stages.sealedFromUnits('reserve61', []);
    assert.strictEqual(none.sealed, false);
    assert.ok(none.why, 'no units is a stated reason, never a bare false');
  },

  // "No sealed window" and "this layout never seals one" are different facts.
  // Reported as the same thing, the owner would go looking for a reserve that
  // was never supposed to exist.
  aLayoutThatNeverSealsSaysSoRatherThanReportingNothingSealed() {
    const r = stages.sealedWindowOf({ id: 's3-x', params: { windowLayout: 'split70' } });
    assert.strictEqual(r.sealed, false);
    assert.ok(/split70/.test(r.why) && /reserve61/.test(r.why),
      `it must name the layout it has and the one that seals: ${r.why}`);
    const orphan = stages.sealedWindowOf({ id: 's3-x', params: { windowLayout: 'reserve61' } });
    assert.ok(/no parent/.test(orphan.why), `a set with no parent says so: ${orphan.why}`);
  },

  // THE BOUNDS ARE READ, NOT RECOMPUTED. unitChunks would give the same answer
  // arithmetically, but only while the price files have not moved — and a
  // re-derivation that silently disagrees with the units actually priced is the
  // whole class of fault this build exists to stop. Reading the parent's own
  // records through the launch's own resolver cannot drift from it.
  theSealedWindowIsReadFromTheParentsRecords() {
    const s = src('lib/stages.js');
    const fn = s.slice(s.indexOf('function sealedWindowOf'), s.indexOf('function sealedFromUnits'));
    assert.ok(/stage3UnitsFor\(parent,/.test(fn),
      'it must resolve units through the same resolver the launch used');
    assert.ok(/const choice = unitsChoiceOf\(doc\.params \|\| \{\}\);/.test(fn)
      && /stage3UnitsFor\(parent, choice\.carry, choice\.selected\)/.test(fn),
      "and with the set's OWN stored choice of records -- the exact list it selected, or its carry -- or it resolves a different set of units");
    assert.ok(/r\.reserve \|\| null/.test(fn), 'the bounds come off the parent record');
    assert.ok(!/unitChunks|0\.13/.test(fn), 'it must not recompute the seal');
  },

  // The exposure numbers must come off the SAME walk that produced the money,
  // or they are describing a different book than the one on the screen.
  drawdownAndWorstTradeComeOutOfTheSameWalk() {
    const b = newBook(9, 0);
    b.take(10, 0);    // book at +10, a new high
    b.take(-30, 4);   // book at -20 — the deepest it has been below its high
    b.take(5, 8);     // book at -15
    const r = b.done({});
    assert.strictEqual(r.pnl, -15);
    assert.strictEqual(r.trades, 3);
    assert.strictEqual(r.wins, 2);
    assert.strictEqual(r.maxDrawdown, 30, 'peak +10 to floor -20 is a drawdown of 30, not 20');
    assert.strictEqual(r.worstTrade, -30);
    assert.strictEqual(r.bestTrade, 10);

    // A book that only ever rises has no drawdown, and one that opens with a
    // loss is measured from zero — it starts flat, not at its first trade.
    const up = newBook(3, 0); up.take(5, 0); up.take(5, 1);
    assert.strictEqual(up.done({}).maxDrawdown, 0);
    const down = newBook(3, 0); down.take(-7, 0);
    assert.strictEqual(down.done({}).maxDrawdown, 7);

    // Nothing traded is not zero-everything: a worst trade that never happened
    // is absent, and absent must not read as a break-even trade.
    const none = newBook(5, 0).done({});
    assert.strictEqual(none.worstTrade, null);
    assert.strictEqual(none.bestTrade, null);
    assert.strictEqual(none.grossPerTrade, null);
    assert.strictEqual(none.maxDrawdown, 0);
  },

  // If they do not sum to the money, one of them is measuring a different book.
  pnlThirdsSumToThePnl() {
    for (const n of [0, 1, 2, 3, 7, 100]) {
      const b = newBook(n, 0);
      for (let i = 0; i < n; i++) b.take((i % 3) - 1.5, i);
      const r = b.done({});
      const sum = r.pnlThirds.reduce((a, c) => a + c, 0);
      assert.ok(Math.abs(sum - r.pnl) < 1e-9, `${n} periods: thirds ${sum} vs pnl ${r.pnl}`);
      assert.strictEqual(r.pnlThirds.length, 3);
    }
  },

  // THE THIRDS ARE CUT ON THE PERIOD, NOT THE TRADE. A window whose money all
  // arrived in its first month must read that way. Cutting by trade index would
  // put a third of the trades in each bucket however they were spread in time,
  // which turns the one reading a single-coin probe depends on into noise.
  theThirdsAreCutOnPeriodsNotTrades() {
    const b = newBook(90, 0);
    b.take(100, 0); b.take(100, 1); b.take(100, 2);   // all in the first third
    const r = b.done({});
    assert.deepStrictEqual(r.pnlThirds, [300, 0, 0],
      'three trades in the first month of ninety periods belong to the first third');
  },

  // A seventh settle site added later, accumulating on its own, would be
  // invisible: the money would still be right and every new number would be
  // quietly short. This is the guard against that.
  everyTradeSettlesThroughTheOneBook() {
    const src2 = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bracket.js'), 'utf8');
    const bookStart = src2.indexOf('function newBook');
    const bookEnd = src2.indexOf('function simMarket');
    assert.ok(bookStart > 0 && bookEnd > bookStart, 'newBook must sit above simMarket');
    const outsideBook = src2.slice(0, bookStart) + src2.slice(bookEnd);
    assert.ok(!/\bpnl \+=/.test(outsideBook), 'nothing outside the book may accumulate money');
    assert.ok(!/\btrades\+\+/.test(outsideBook), 'nothing outside the book may count a trade');
    assert.ok(!/\bwins\+\+/.test(outsideBook), 'nothing outside the book may count a win');
    // and the book is actually used at every site the walk can settle at
    const takes = (src2.match(/book\.take\(/g) || []).length;
    assert.strictEqual(takes, 7, `seven settle sites, found ${takes}`);
  },

  // A STAGE 4 SET MUST REPLAY. If re-running its recorded rule against its
  // parent gives a different answer, the record is a story about a decision
  // rather than the decision itself — and the reserve grade at the end of the
  // chain would be grading something nobody can reconstruct.
  aFunnelSetReplaysToTheSameSurvivors() {
    const rows = s3rows();
    const rule = { ranges: { tHours: { min: 65, max: 113 } }, allowed: { gate: ['active'] }, floors: { maxDrawdown: { max: 200 } } };
    const kept = FS4.applyRule(rows, rule);
    assert.deepStrictEqual(kept.map((r) => r.label), ['t65 active', 't89 active'],
      't113 active is cut by the drawdown floor, not by the range');
    const doc = FS4.newFunnelSet({ id: 's4-x-1', parent: { id: 's3-y', name: 'S3 #1' }, target: 3 });
    doc.rule = rule;
    FS4.finishFunnelSet(doc, kept, { key: 'rule' });
    const r = FS4.replay(doc, rows);
    assert.strictEqual(r.same, true, JSON.stringify(r));
    // and a rule that has drifted from its survivors is caught, not shrugged at
    doc.rule = { ...rule, allowed: { gate: ['active', 'directional'] } };
    assert.strictEqual(FS4.replay(doc, rows).same, false);
  },

  // A range on an ordered dial the run swept as text ('auto' band) cannot be
  // compared with < and >. Coerced to NaN it would silently drop every one of
  // those settings, and the owner would never know a whole arm went missing.
  aTextValueOnAnOrderedDialIsKeptOnlyWhenTheRuleSaysSo() {
    const rows = s3rows();
    const without = FS4.applyRule(rows, { ranges: { bandMode: { min: 0, max: 10 } } });
    assert.ok(!without.some((r) => r.bandMode === 'auto'), 'auto is not silently swept into a numeric range');
    assert.strictEqual(without.length, 6);
    const with2 = FS4.applyRule(rows, { ranges: { bandMode: { min: 0, max: 10, also: ['auto'] } } });
    assert.strictEqual(with2.length, 8, 'and is kept when the rule names it');
  },

  // A floor cannot pass on a number that is not there. Treating a missing
  // drawdown as zero would let exactly the rows nobody has measured through.
  aFloorRefusesAMissingNumberRatherThanTreatingItAsZero() {
    const rows = [{ si: 0, label: 'measured', maxDrawdown: 10 }, { si: 1, label: 'not measured' }];
    const kept = FS4.applyRule(rows, { floors: { maxDrawdown: { max: 100 } } });
    assert.deepStrictEqual(kept.map((r) => r.label), ['measured']);
  },

  // Going back and re-choosing is more looking. A funnel walked forward once and
  // one walked back four times have seen different amounts of the board, and the
  // reserve grade can only count what was written down.
  aFunnelSetRecordsItsStepsAndItsBackSteps() {
    const doc = FS4.newFunnelSet({ id: 's4-x-2', target: 10 });
    FS4.recordStep(doc, { n: 1, what: 'which dials move', chose: 'tHours', survivors: 800 });
    FS4.recordBackStep(doc, { from: 3, to: 2, why: 'the grid was too thin' });
    FS4.recordStep(doc, { n: 2, what: 'the shape of tHours', chose: '65 to 113', survivors: 400 });
    assert.strictEqual(doc.steps.length, 2);
    assert.strictEqual(doc.backSteps.length, 1);
    assert.strictEqual(doc.backSteps[0].why, 'the grid was too thin');
    for (const st of doc.steps) assert.ok(st.at, 'every step is timed');
  },

  // EVERY RECORDED STEP CARRIES THE COUNT THE PAGE HAD IN HAND (3.88.1). The
  // record always had a place for it and the page never filled it, so every
  // step on the owner's set carried an empty count. Each step and step back is
  // now recorded through one counted helper that reads the survivors off the
  // read the screen was drawn from; no read in hand is null, never 0.
  everyRecordedStepCarriesTheCountThePageHadInHand() {
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const wire = ui.slice(ui.indexOf('function fWire(st, d) {'), ui.indexOf('\n}\n', ui.indexOf('function fWire(st, d) {')));
    assert.ok(/const fCount = \(\) => \(d && d\.survivors != null && Number\.isFinite\(Number\(d\.survivors\)\) \? Number\(d\.survivors\) : null\);/.test(wire),
      'the count is the read\'s own survivors, and null when there is none');
    assert.ok(/const fRecord = \(step\) => st\.steps\.push\(\{ \.\.\.step, survivors: fCount\(\) \}\);/.test(wire), 'every step goes through the counted helper');
    assert.ok(/const fRecordBack = \(back\) => st\.backSteps\.push\(\{ \.\.\.back, survivors: fCount\(\) \}\);/.test(wire), 'and every step back');
    assert.strictEqual((wire.match(/st\.steps\.push\(/g) || []).length, 1, 'no step is recorded past the helper');
    assert.strictEqual((wire.match(/st\.backSteps\.push\(/g) || []).length, 1, 'no step back is recorded past the helper');
    assert.ok((wire.match(/\bfRecord\(\{ n: /g) || []).length >= 13, 'the thirteen recorded choices of the walk');
    assert.ok((wire.match(/\bfRecordBack\(\{ from: /g) || []).length >= 2, 'and both ways back');
    assert.strictEqual((ui.match(/st\.steps\.push\(/g) || []).length, 1, 'nothing outside the walk records a step either');
    // the record keeps the count on both, and an unknown stays unknown
    const doc = FS4.newFunnelSet({ id: 's4-x-4', target: 10 });
    FS4.recordStep(doc, { n: 1, what: 'which dial to narrow next', chose: 'tHours', survivors: 800 });
    FS4.recordStep(doc, { n: 2, what: 'the shape of tHours', chose: '65 to 113', survivors: null });
    FS4.recordBackStep(doc, { from: 2, to: 1, why: 'a look back', survivors: 400 });
    FS4.recordBackStep(doc, { from: 2, to: 1, why: 'no read in hand' });
    assert.deepStrictEqual(doc.steps.map((x) => x.survivors), [800, null]);
    assert.deepStrictEqual(doc.backSteps.map((x) => x.survivors), [400, null]);
    assert.ok(!doc.steps.some((x) => x.survivors === 0) && !doc.backSteps.some((x) => x.survivors === 0), 'unknown is never written as zero');
  },

  // ONE SURVIVOR BY DEPTH, NEVER BY MONEY (3.90.0). The pick is the survivor
  // nearest the middle of every range of the rule; a word dial puts everyone at
  // the middle; ties go to the smallest mean and then to the set's own order;
  // and the money on the rows never enters it.
  theDepthPickIsTheSurvivorNearestTheMiddleOfEveryRangeAndNeverReadsMoney() {
    const rule = { ranges: { tHours: { min: 41, max: 89 }, dMult: { min: 1, max: 2 } }, allowed: { gate: ['active'] }, floors: { maxDrawdown: { max: 50 } } };
    const rows = [
      { si: 0, label: 'edge', tHours: 41, dMult: 1, gate: 'active', avgHold: 999, avgTest: 999 },
      { si: 1, label: 'middle', tHours: 65, dMult: 1.5, gate: 'active', avgHold: -50, avgTest: -50 },
      { si: 2, label: 'half', tHours: 77, dMult: 1.5, gate: 'active', avgHold: 5, avgTest: 5 },
    ];
    const d0 = FS4.depthOf(rows[0], rule);
    assert.deepStrictEqual({ worst: d0.worst, per: d0.per }, { worst: 1, per: { tHours: 1, dMult: 1, gate: 0 } }, 'the edge is 1 away; the word dial is at the middle; the floor is not a choice');
    assert.deepStrictEqual(FS4.depthOf(rows[2], rule).per, { tHours: 0.5, dMult: 0, gate: 0 });
    const pick = FS4.pickByDepth(rows, rule);
    assert.strictEqual(pick.label, 'middle', 'the poorest survivor is the pick, because money never enters it');
    assert.deepStrictEqual({ index: pick.index, si: pick.si, worst: pick.worst, mean: pick.mean }, { index: 1, si: 1, worst: 0, mean: 0 });
    // ties: the smallest mean, then the set's own order
    const tie = [{ si: 0, label: 'a', tHours: 53, dMult: 1.5 }, { si: 1, label: 'b', tHours: 53, dMult: 1.25 }, { si: 2, label: 'c', tHours: 77, dMult: 1.5 }];
    assert.strictEqual(FS4.pickByDepth(tie, rule).label, 'a', 'a and c tie on the worst distance and a is first; b is worse');
    const same = [{ si: 0, label: 'p', tHours: 65, dMult: 1.5 }, { si: 1, label: 'q', tHours: 65, dMult: 1.5 }];
    assert.strictEqual(FS4.pickByDepth(same, rule).label, 'p', 'equal in every way: the first in the set\'s own order');
    // a range of no width, and a word kept beside a range, sit at the middle; a value that is neither is at the edge
    const flat = { ranges: { tHours: { min: 65, max: 65 }, bandMode: { min: 1, max: 3, also: ['auto'] } } };
    assert.strictEqual(FS4.depthOf({ tHours: 65, bandMode: 'auto' }, flat).worst, 0);
    assert.strictEqual(FS4.depthOf({ tHours: 65, bandMode: 'weird' }, flat).worst, 1);
    assert.strictEqual(FS4.pickByDepth([], rule), null, 'no survivors, no pick');
  },

  // All three ways of closing the gap are offered and the shopping one says so
  // in those words. Withholding it would remove the owner's choice invisibly,
  // which is the fault RULE ZERO and RULE FIVE exist to prevent.
  allThreeWaysToReachTheTargetAreOfferedAndTheCostliestSaysSo() {
    assert.deepStrictEqual(Object.keys(FS4.CLOSINGS).sort(), ['rule', 'tighten', 'top']);
    assert.ok(/shopping/.test(FS4.CLOSINGS.top.cost), 'the top-N option must name itself as shopping');
    assert.ok(/interior|middle|both ends/.test(FS4.CLOSINGS.tighten.cost));
    const doc = FS4.newFunnelSet({ id: 's4-x-3', target: 2 });
    FS4.finishFunnelSet(doc, s3rows().slice(0, 2), { key: 'top', detail: 'top 2 by avgTest' });
    assert.strictEqual(doc.closing.key, 'top', 'and which one was used is on the set');
    assert.strictEqual(doc.closing.detail, 'top 2 by avgTest');
  },

  // NO RESTRICTIONS (owner ruling 6). An empty result is a fact about the rule,
  // and a refusal would take the decision away.
  anEmptyOrSingleResultIsWrittenWithAWarningNeverRefused() {
    const empty = FS4.newFunnelSet({ id: 's4-x-4', target: 5 });
    empty.rule = { ranges: { tHours: { min: 9999 } } };
    FS4.finishFunnelSet(empty, [], { key: 'rule' });
    assert.strictEqual(empty.counts.survivors, 0);
    assert.ok(/keeps nothing/.test(empty.warnings[0]), empty.warnings[0]);
    assert.ok(empty.ruleSentence, 'and the rule that emptied it can be read back');

    const one = FS4.newFunnelSet({ id: 's4-x-5', target: 5 });
    FS4.finishFunnelSet(one, s3rows().slice(0, 1), { key: 'rule' });
    assert.strictEqual(one.counts.survivors, 1);
    assert.ok(/one setting/.test(one.warnings[0]), one.warnings[0]);

    // and overshooting the target is a warning too, not a silent trim
    const over = FS4.newFunnelSet({ id: 's4-x-6', target: 2 });
    FS4.finishFunnelSet(over, s3rows(), { key: 'rule' });
    assert.strictEqual(over.counts.survivors, 8, 'nothing is trimmed on its own');
    assert.ok(over.warnings.some((w) => /past the target/.test(w)), JSON.stringify(over.warnings));
  },

  // The set says which release read the board and which release priced it. A
  // rebuilt number and a stored one can come from different engines, and the
  // set has to be able to say so.
  aFunnelSetNamesBothReleases() {
    const doc = FS4.newFunnelSet({
      id: 's4-x-7', release: '3.31.0',
      parent: { id: 's3-y', name: 'S3 #1', params: { engineVersion: '3.26.1' } },
    });
    assert.strictEqual(doc.release, '3.31.0');
    assert.strictEqual(doc.parent.release, '3.26.1');
    assert.strictEqual(doc.stage, 4);
  },

  // THE REBUILD PROVES ITSELF OR SAYS IT DID NOT. A rebuilt number sitting
  // beside a stored one is only safe while both came from the same world.
  theRebuildProvesItselfAgainstWhatStageThreeStored() {
    const per = new Map([
      ['t65 active', { label: 't65 active', avgTest: 10 }],
      ['t89 active', { label: 't89 active', avgTest: 20 }],
    ]);
    const ok = stages.proveRebuild(per, { 't65 active': 10, 't89 active': 20 });
    assert.strictEqual(ok.ran, true);
    assert.strictEqual(ok.matched, 2);
    assert.strictEqual(ok.mismatches.length, 0);

    const drift = stages.proveRebuild(per, { 't65 active': 10, 't89 active': 20.5 });
    assert.strictEqual(drift.matched, 1);
    assert.strictEqual(drift.differed, 1, 'the true count of disagreements travels, not just the list');
    assert.strictEqual(drift.mismatches[0].label, 't89 active', 'and it names which setting disagreed');
    assert.strictEqual(drift.mismatches[0].stored, 20.5);
    assert.strictEqual(drift.mismatches[0].rebuilt, 20);

    // AN UNPROVED REBUILD IS ALLOWED AND MUST NEVER LOOK PROVED.
    const none = stages.proveRebuild(per, null);
    assert.strictEqual(none.ran, false);
    assert.ok(none.why, 'and it says why there is no proof');
  },

  // si comes back per BLOCK -- the worker numbers what it was handed from zero
  // -- so a proof keyed by si would line setting 0 of the rebuild up with
  // setting 0 of the whole board. Every one would "match" and not one of them
  // would be the same setting. This is the shape of that mistake, caught.
  theProofIsKeyedByLabelBecauseSettingIndexIsPerBlock() {
    const per = new Map([
      ['t65 active', { label: 't65 active', avgTest: 10 }],
      ['t89 active', { label: 't89 active', avgTest: 20 }],
    ]);
    const wrong = stages.proveRebuild(per, { 0: 10, 1: 20 });
    assert.strictEqual(wrong.checked, 0, 'an index-keyed expectation checks nothing');
    assert.strictEqual(wrong.matched, 0, 'and above all it must not report a pass');
    assert.strictEqual(wrong.unmatched, 2);
    assert.ok(/nothing to check against/.test(wrong.why), wrong.why);
  },

  // The FIRST digit is the one that says records stop being comparable
  // (RULE ONE-C). A rebuild across it produces numbers from a different engine
  // sitting beside numbers from this one, and nothing downstream could tell.
  async aRebuildAcrossAFirstDigitReleaseChangeRefuses() {
    assert.strictEqual(stages.firstDigitOf('3.31.0'), '3');
    assert.strictEqual(stages.firstDigitOf('4.0.0'), '4');
    assert.strictEqual(stages.firstDigitOf(null), null);
    let threw = null;
    try {
      await stages.rebuildRichFor({ id: 's3-x', params: { engineVersion: '1.0.0' } }, ['some setting']);
    } catch (err) { threw = err.message; }
    assert.ok(threw && /different engine/.test(threw), `must refuse across the first digit: ${threw}`);
    // and asking for nothing is refused before any unit is rebuilt
    let empty = null;
    try { await stages.rebuildRichFor({ id: 's3-x', params: {} }, []); } catch (err) { empty = err.message; }
    assert.ok(empty && /nothing was asked for/.test(empty), empty);
  },

  // A CONTROL CHARACTER IN SOURCE IS INVISIBLE AND IT BREAKS THE READERS.
  //
  // Two NUL bytes reached lib/funnel.js as the separator in a grid-square key.
  // The code WORKED -- the same character wrote the key and read it back -- and
  // every test passed. What it broke was everything that reads the source as
  // text: grep reported the file as binary, and the word list generator and
  // every source-scanning guard in this suite read source. A file they cannot
  // read is a file whose controls silently stop being checked, which under
  // RULE ONE-A means words could reach the owner that no list authorises.
  //
  // Escapes are the same fault wearing a different coat: a backslash-u written
  // into source reads back as the escape rather than the character, and that
  // has leaked into SCREEN-WORDS.md twice.
  noSourceFileCarriesAControlCharacter() {
    const root = path.join(__dirname, '..');
    const dirs = ['lib', 'public', 'tests', 'service-control'];
    const files = ['server.js', 'live-mirror.js', 'live-produce.js', 'pilot-refresh.js'];
    const walk = (d) => {
      let got = [];
      let entries = [];
      try { entries = fs.readdirSync(path.join(root, d), { withFileTypes: true }); } catch (_) { return got; }
      for (const e of entries) {
        const rel = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') got = got.concat(walk(rel)); continue; }
        if (/\.(js|json|md|html|css)$/.test(e.name)) got.push(rel);
      }
      return got;
    };
    const all = files.concat(...dirs.map(walk));
    assert.ok(all.length > 50, `only ${all.length} source files found — the walk is not reaching them`);
    const bad = [];
    for (const rel of all) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      for (let i = 0; i < src.length; i++) {
        const c = src.charCodeAt(i);
        // tab, newline and carriage return are the only ones that belong
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
          bad.push(`${rel} carries U+${c.toString(16).padStart(4, '0')} at ${i}`);
          break;
        }
      }
    }
    assert.deepStrictEqual(bad, [], `control characters in source:\n  ${bad.join('\n  ')}`);
  },

  // A RESOLUTION HELD IN A LOCAL IS NOT A RECORD OF WHAT IS OPEN.
  //
  // Boards works out which set to show and, on a first visit, falls back to the
  // newest one. That answer used to live only in three local variables: the
  // saved view got a set id ONLY when the owner CHANGED a picker. With one
  // stage 3 set on the box the picker already shows it, so changing it is
  // impossible and the saved view stayed empty forever.
  //
  // Boards looked right, because it read its own local. Everything else asking
  // "which set is open" got nothing -- and the Funnel told the owner to open a
  // set on Boards when they already had one open, with no way to comply.
  theSetBoardsSettlesOnIsWrittenDownNotJustComputed() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const at = src.indexOf('first visit: the newest set of the deepest stage present');
    assert.ok(at > 0, 'the first-visit fallback is gone - this test is aimed at nothing');
    // the branch runs to the end of the enclosing block; take a generous window
    // to the line that closes the branch, never a character count
    const end = src.indexOf('const selOf = {', at);
    assert.ok(end > at, 'the end of the first-visit branch cannot be found');
    const branch = src.slice(at, end);
    assert.ok(branch.includes('bSaveView({ s1: s1sel, s2: s2sel, s3: s3sel })'),
      'the set Boards settles on must be SAVED, or nothing else can know which one is open');

    // and the Funnel must read that one record rather than keeping its own
    const fn = src.slice(src.indexOf('function pickedSet3'), src.indexOf('function pickedSet3') + 700);
    assert.ok(fn.includes('bView().s3'), 'the Funnel reads the set Boards recorded');
    assert.ok(!fn.includes('localStorage.getItem'), 'and does not keep a second key of its own');
  },

  // A section that cannot read its data must SAY SO. Returning without writing
  // leaves the previous section's numbers under this section's heading, or on a
  // first load leaves nothing at all -- and both read as "there is nothing
  // here", which is a lie when the truth is "I could not ask".
  // THE CLOSING HAS TO REACH THE ARITHMETIC. It was written on the record and
  // dropped on the way to applyRule, so 'take the top N by a column' produced
  // exactly what 'accept what the rule gives' produced -- and the set then said
  // the owner had shopped when nothing had been shopped, which is the worst of
  // both: the cost is recorded and the narrowing never happened.
  theClosingChangesWhatTheRuleKeepsNotJustWhatTheRecordSays() {
    const rows = s3rows();                       // 8 rows, avgTest 4.1 .. 11.3
    const plain = FS4.ruleWithClosing(rows, {}, { key: 'rule' }, 3);
    assert.strictEqual(FS4.applyRule(rows, plain.rule).length, 8, 'accepting the rule trims nothing');

    const top = FS4.ruleWithClosing(rows, {}, { key: 'top', column: 'avgTest', n: 3 }, 3);
    const kept = FS4.applyRule(rows, top.rule);
    assert.strictEqual(kept.length, 3, 'the top N must actually be taken');
    assert.deepStrictEqual(kept.map((r) => r.label), ['t113 active', 't113 directional', 't89 active'],
      'best first, and the tie broken by name so a scrambled copy breaks it the same way');
    assert.strictEqual(top.detail, 'top 3 by avg test $');

    // and it is IN THE RULE, so it replays and a scrambled copy performs it too
    const doc = FS4.newFunnelSet({ id: 's4-c-1', target: 3 });
    doc.rule = top.rule;
    FS4.finishFunnelSet(doc, kept, { key: top.key, detail: top.detail });
    assert.strictEqual(FS4.replay(doc, rows).same, true, 'a cut that does not replay is not a rule');
  },

  // AND THE WRITE PATH FOLDS IT IN. The function above can be perfect and the
  // cut still never happen: what reaches applyRule is whatever cutFunnelSet
  // hands it. The mutation harness found this hole -- deleting the fold left
  // the whole suite green, because every test here exercised the function and
  // none of them the wiring.
  theCutFoldsTheClosingIntoTheRuleItWrites() {
    const s = src('lib/stages.js');
    const at = s.indexOf('function cutFunnelSet(');
    assert.ok(at > 0, 'cutFunnelSet is gone');
    const body = s.slice(at, s.indexOf('\nfunction listFunnelSets(', at));
    // THE CUT IS MADE ON THE BOARD THE WALK WAS ON (§17): a unit's records or
    // the blend, resolved by the same function the read resolves it through,
    // with the rebuilt numbers laid on -- and the closing is folded into the
    // rule on those rows
    assert.ok(body.includes('const board = await funnelBoard(parentId, t, state.unit);')
      && body.includes('const ranked = withFunnelRich(board.all, readFunnelRich(parentId));'),
      'the cut must be made on the board the walk was on, with the rebuilt numbers laid on');
    assert.ok(/const closed = S4\.ruleWithClosing\(ranked, state\.rule, state\.closing, doc\.target\);/.test(body),
      'the closing must be folded into the rule through the one function that folds it');
    // the folded rule is what gets written AND what the survivors come from --
    // writing one rule and filtering by another is the same defect wearing a
    // different shape
    const foldAt = body.indexOf('const closed = S4.ruleWithClosing');
    const ruleAt = body.indexOf('doc.rule = closed.rule;');
    const applyAt = body.indexOf('S4.applyRuleSlowly(ranked, doc.rule');
    assert.ok(foldAt > 0 && ruleAt > foldAt && applyAt > ruleAt,
      'the fold must come first, then the rule it produced, then the survivors from that rule');
    assert.ok(!/doc\.rule = S4\.normaliseRule\(state\.rule\);/.test(body),
      'writing the raw rule is the defect: the closing never reaches the arithmetic');
    // and the closing recorded on the set is the one that was actually applied
    assert.ok(/S4\.finishFunnelSet\(doc, survivors, \{ key: closed\.key, detail: closed\.detail \}\);/.test(body),
      'the set must record the closing that ran, with what it did');
  },

  // A half-made choice is not a cut. Picking the shopping option and typing no
  // count must keep everything and SAY it kept everything -- silently treating
  // it as done would write a set whose record claims a narrowing that is not in
  // its rule.
  aTopNWithNoColumnOrCountTakesNothingAndSaysSo() {
    const rows = s3rows();
    for (const c of [{ key: 'top' }, { key: 'top', column: 'avgTest' }, { key: 'top', n: 3 },
      { key: 'top', column: 'maxDrawdown', n: 3 }]) {
      const got = FS4.ruleWithClosing(rows, {}, c, 3);
      assert.strictEqual(got.rule.cut, null, `${JSON.stringify(c)} must not become a cut`);
      assert.strictEqual(FS4.applyRule(rows, got.rule).length, 8);
      assert.ok(/nothing was taken off the top/.test(got.detail), got.detail);
    }
  },

  // THE SENTENCE IS THE RECORD THE OWNER READS. A rule that states its ranges
  // and stays quiet about the top N reads as the whole decision while hiding
  // the sharpest part of it.
  theRuleSentenceStatesTheCut() {
    const bare = FS4.ruleSentence({ ranges: { tHours: { min: 65, max: 113 } } });
    assert.ok(!/top/.test(bare), bare);
    const withCut = FS4.ruleSentence({ ranges: { tHours: { min: 65, max: 113 } }, cut: { kind: 'top', column: 'avgTest', n: 40 } });
    assert.ok(/tHours 65 to 113/.test(withCut) && /then the top 40 by avg test \$/.test(withCut), withCut);
    // and on a rule with no other clause it does not read as 'no choices made'
    const only = FS4.ruleSentence({ cut: { kind: 'top', column: 'avgTest', n: 40 } });
    assert.ok(!/no choices made/.test(only) && /top 40/.test(only), only);
  },

  // ONLY A COLUMN A SCRAMBLED COPY HAS. A scrambled copy is the real table with
  // its money swapped; every other column on it is still the real one, so
  // taking the top N by one of those sorts the copy by REAL numbers and hands
  // back the same rows -- a comparison that looks like one and is not.
  theTopNIsOnlyOfferedByAColumnAScrambledCopyHas() {
    assert.deepStrictEqual(FS4.topColumnNames(), ['avgTest']);
    const offered = require('../lib/vocabulary').vocabulary().funnelTopColumn;
    assert.deepStrictEqual(offered.map((o) => o.value), FS4.topColumnNames(),
      'the list on the screen is read from the engine, never typed beside it');
    assert.deepStrictEqual(offered.map((o) => o.label), Object.values(FS4.TOP_COLUMNS));
    // held-back money is deliberately absent: sorting by it at the cut is
    // opening the sealed window to decide what to keep
    assert.ok(!FS4.topColumnNames().includes('avgHold'));
  },

  // THE COMPARISON THE WHOLE SCREEN RESTS ON. A scrambled copy must pick its
  // OWN rows under the rule. Building it from the rows the real money already
  // kept -- what the read used to do -- hands it the real table's picks, so a
  // rule that takes the top N compares your best N against the very same N and
  // the answer is guaranteed to look like a win.
  aScrambledCopyPicksItsOwnRowsUnderTheSameRule() {
    // real money and the scramble disagree completely: the real best is the
    // scramble's worst
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push({ si: i, label: `s${i}`, tHours: 40 + i, avgTest: i, noiseTest: [7 - i] });
    const rule = { cut: { kind: 'top', column: 'avgTest', n: 3 } };
    assert.deepStrictEqual(FS4.applyRule(rows, rule).map((r) => r.label), ['s7', 's6', 's5']);
    assert.deepStrictEqual(FS4.nullCopy(rows, rule, 0).map((r) => r.label), ['s0', 's1', 's2'],
      'the scrambled copy takes its own top 3, which here is the opposite end');
    // the swap is the money only -- every other column stays real
    assert.strictEqual(FS4.nullCopy(rows, rule, 0)[0].tHours, 40);
    // and the ranges still apply to the copy, so it is the SAME rule
    const ranged = { ranges: { tHours: { min: 44 } }, cut: { kind: 'top', column: 'avgTest', n: 2 } };
    assert.deepStrictEqual(FS4.nullCopy(rows, ranged, 0).map((r) => r.label), ['s4', 's5']);
    // a row with no scramble stored is not silently ranked as if it had one
    const missing = FS4.nullCopy([{ si: 0, label: 'none', avgTest: 9 }], { cut: { kind: 'top', column: 'avgTest', n: 1 } }, 0);
    assert.strictEqual(missing[0].avgTest, null);
  },

  // AND THE READ USES IT. A function that exists and is not called is the same
  // defect wearing a test that passes.
  theFunnelReadBuildsItsScrambledCopiesFromEverySettingNotTheSurvivors() {
    const s = src('lib/stages.js');
    const at = s.indexOf('function funnelRead(');
    assert.ok(at > 0, 'funnelRead is gone');
    const body = s.slice(at, s.indexOf('\nfunction sliceRowsFor(', at));
    // NO COPY OF THE BOARD IS EVER BUILT. Ten copies of 524,832 rows at once
    // killed the service twice the first time the tab was opened on the filled
    // set (2026-09-02). The read hands every reading a money reader instead.
    assert.ok(body.includes("const check = keptN ? { k: keptN, barPct: F.barPctOf(state), bar } : { seed };"), 'the check is a count, a bar and a reader, never an array of copies');
    assert.ok(!/copies = Array\.from|swapMoney\(rows|S4\.nullCopy\(all, rule, d\)/.test(body),
      'the read must not build a copy of the board to read the check');
    assert.ok(body.includes('F.moneyAt(d)'), 'the check reads kept scramble d off the rows by position');
    // and reading by position IS the swapped copy, proved: the same means
    const F = require('../lib/funnel');
    const all = s3rows().map((r, i) => ({ ...r, noiseTest: [100 - i, i] }));
    const rule = { ranges: { tHours: { min: 65 } }, allowed: { gate: ['active'] } };
    const rows = FS4.applyRule(all, rule);
    for (const d of [0, 1]) {
      const byPosition = F.movement(rows, 'tHours', F.moneyAt(d));
      const byCopy = F.movement(FS4.swapMoney(rows, d), 'tHours');
      assert.deepStrictEqual(byPosition.groups, byCopy.groups, `reading by position must equal the swapped copy (d=${d})`);
    }
    // a rule WITH a cut is the one case a copy would differ, and the walk never
    // draws a reading under a cut: the cut is folded in at step 7 alone
    assert.ok(body.includes('const closed = step === 7'), 'the cut is folded in at step 7 only');
  },

  // TIGHTENING PRODUCES A RULE, NOT A SHORTER LIST, so it replays and a
  // scrambled copy narrows itself the same way. It narrows from BOTH ends,
  // which is the whole difference between it and shopping: moving one end walks
  // the range toward whichever value looks best.
  tighteningNarrowsFromBothEndsAndIsStillARule() {
    const rows = [];
    for (let t = 1; t <= 20; t++) for (let k = 0; k < 3; k++) rows.push({ si: rows.length, label: `t${t}k${k}`, tHours: t, avgTest: t });
    const rule = { ranges: { tHours: { min: 1, max: 20 } } };
    assert.strictEqual(FS4.applyRule(rows, rule).length, 60);
    const one = FS4.tightenRule(rows, rule, 55);
    assert.strictEqual(one.rule.ranges.tHours.min, 2, 'the bottom end gives up a value');
    assert.strictEqual(one.rule.ranges.tHours.max, 19, 'and the top end gives up one too');
    assert.strictEqual(FS4.applyRule(rows, one.rule).length, 54);
    // it keeps going until the target is met, and it may land under it -- the
    // step it gives up is a whole swept value, so the count moves in jumps
    const got = FS4.tightenRule(rows, rule, 40);
    assert.deepStrictEqual(got.rule.ranges.tHours, { min: 5, max: 16 });
    assert.strictEqual(FS4.applyRule(rows, got.rule).length, 36);
    // identical every time, or a replay would wobble
    assert.deepStrictEqual(FS4.tightenRule(rows, rule, 40).rule, got.rule);
    // it stops honestly rather than collapsing the range to reach an impossible target
    const hard = FS4.tightenRule(rows, rule, 1);
    assert.ok(FS4.applyRule(rows, hard.rule).length >= 2, 'a range is never narrowed away to nothing');
    assert.ok(/stopped at/.test(hard.why), hard.why);
    // and it reaches the arithmetic through the closing, like the other two
    const closed = FS4.ruleWithClosing(rows, rule, { key: 'tighten' }, 40);
    assert.deepStrictEqual(closed.rule, got.rule);
    assert.strictEqual(closed.detail, got.why);
  },

  // A COLUMN'S DESCRIPTION HAS TO DESCRIBE THE COLUMN IT IS ON. The dial
  // heading said every dial was listed "including the ones this run only swept
  // a single value of" -- and a dial swept at one value is the exact set the
  // table leaves out, because movement() gives it no number and step1 sends it
  // to the not-measurable line. The owner found it: the three dials named
  // underneath were missing from the column that claimed to list them.
  //
  // The sentence was not invented, which is what made it survive: it is true of
  // the dial DROPDOWN on the next step, which really is built from every dial.
  // It was written once and hung on both.
  theDialColumnsDescriptionMatchesWhatTheColumnHolds() {
    const s = src('public/construct.js');
    const at = s.indexOf('  fDialName:');
    assert.ok(at > 0, 'the dial heading has no description');
    const line = s.slice(at, s.indexOf('\n', at));
    assert.ok(!/Every dial on the record is listed/.test(line),
      'the heading must not claim to list dials the table is built to leave out');
    assert.ok(/only the dials this run swept\s+more than one value of/.test(line.replace(/\s+/g, ' ')),
      'it must say the table holds the dials with more than one value');
    // and it must point at the line that DOES carry the rest, by its rendered
    // wording -- a description that says "elsewhere" sends the owner hunting
    assert.ok(line.includes('Not measurable here'),
      'it must name the line the left-out dials appear on, in that line\'s own words');
    assert.ok(s.includes('Not measurable here:'), 'and that line must still be the one the page prints');
    // the same fact, stated the same way, on the values column beside it
    const vAt = s.indexOf('  fValues:');
    assert.ok(s.slice(vAt, s.indexOf('\n', vAt)).includes('listed separately'),
      'the values column already says a one-value dial is listed separately; the two must not disagree');
  },

  // A DIAL IS PRINTED WITH THE NAME THE OWNER CAN POINT AT (owner order,
  // 2026-09-01). The first step listed dials as dMult, agreePct, weekdaysOnly
  // -- the keys the engine holds them under, and names that appear on no
  // screen. Each now carries the Sweep control's own label in brackets.
  //
  // CHECKED BOTH WAYS, which is the only thing that makes the map worth having.
  // From the engine: every dial the Funnel can print must have an entry, so a
  // dial added tomorrow fails here rather than showing up bare. From the page:
  // every label must be the text of a control drawSweep() actually renders, so
  // a rename on Sweep breaks the suite instead of leaving the Funnel pointing
  // at a box that is gone.
  theDialNamesCarryTheirSweepLabel() {
    const s = src('public/construct.js');
    const at = s.indexOf('const DIAL_ON_SWEEP = {');
    assert.ok(at > 0, 'the map is gone');
    const map = {};
    for (const m of s.slice(at, s.indexOf('};', at)).matchAll(/^\s{2}([A-Za-z]+): '(.+)',$/gm)) map[m[1]] = m[2];

    // ---- from the engine towards the page -----------------------------------
    const F = require('../lib/funnel');
    assert.deepStrictEqual(Object.keys(map).sort(), [...F.ALL_DIALS].sort(),
      'every dial the Funnel can print needs a Sweep label, and the map may name no dial that is not one');

    // ---- from the page back towards the map ---------------------------------
    const swAt = s.indexOf('async function drawSweep()');
    assert.ok(swAt > 0, 'drawSweep is gone');
    const sweep = s.slice(swAt, s.indexOf('\nasync function ', swAt + 10));
    for (const [dial, label] of Object.entries(map)) {
      const esc2 = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.ok(new RegExp(`>\\s*${esc2}\\s*<`).test(sweep),
        `${dial} is labelled "${label}", which is not the text of any control on Sweep`);
    }

    // ---- and the first step actually uses it --------------------------------
    const f1 = s.slice(s.indexOf('function fStep1('), s.indexOf('\nfunction fStep2('));
    assert.ok(!/<td>\$\{esc\(x\.dial\)\}<\/td>/.test(f1), 'the table must not print the bare key');
    for (const place of ['esc(fDialLabel(x.dial))', 'r.lopsided.map(fDialLabel)',
      '(sh.a || []).map(fDialLabel)', '(sh.b || []).map(fDialLabel)']) {
      assert.ok(f1.includes(place), `a dial name on the first step is still bare: ${place}`);
    }
    // the brackets belong to the screen name, so the reason a dial cannot be
    // measured must not be bracketed too -- two pairs in a row reads as one
    assert.ok(/\$\{esc\(fDialLabel\(x\.dial\)\)\} - \$\{esc\(x\.why\)\}/.test(f1),
      'the not-measurable reason must follow a dash, not a second pair of brackets');

    // ---- AND EVERY OTHER PLACE THE FUNNEL SHOWS A DIAL (3.52.0, owner order:
    // "ALL OF THE DROP DOWNS AND INTERFACES IN THE FUNNEL") ----------------
    // the dial boxes on steps 2 and 3 draw the engine's list, each named
    assert.ok(s.includes("<select id=\"fDial\">${fDialOptions(st.dial || '')}</select>"), 'the step 2 dial box names its dials bare');
    assert.ok(s.includes("<select id=\"fA\">${fDialOptions(a0)}</select>") && s.includes("<select id=\"fB\">${fDialOptions(b0)}</select>"),
      'the step 3 dial boxes name their dials bare');
    const funnel = s.slice(s.indexOf('function fStep1('), s.indexOf('function drawFunnel('));
    assert.ok(!/vocabOptions\('funnelDial'/.test(funnel), 'a dial box still draws the bare keys');
    const opts = s.slice(s.indexOf('function fDialOptions('), s.indexOf('function fRuleWords('));
    assert.ok(opts.includes('VOCAB.funnelDial') && opts.includes('esc(fDialLabel(o.value))'), 'the dial boxes must read the engine\'s list and name each entry');
    // the rule sentence names its dials before it is shown, both places
    assert.strictEqual(s.split('esc(fRuleWords(d.ruleSentence))').length - 1, 2, 'the rule sentence is shown with bare keys somewhere');
    assert.ok(!/esc\(d\.ruleSentence\)/.test(s), 'the rule sentence is still shown bare somewhere');
    // and the notes the walk keeps
    for (const place of ["chose: fDialLabel(st.dial) }", 'what: `the values of ${fDialLabel(st.dial)}`', 'what: `the shape of ${fDialLabel(st.dial)}`',
      'what: `a block on ${fDialLabel(st.dialA)} x ${fDialLabel(st.dialB)}`', "mark('interact', 3, `${fDialLabel(st.dialA || '')} x ${fDialLabel(st.dialB || '')}`)"]) {
      assert.ok(s.includes(place), `a dial name in the walk's notes is still bare: ${place}`);
    }
    // a key that IS its Sweep label is written once
    assert.ok(s.includes("const fDialLabel = (d) => (DIAL_ON_SWEEP[d] && DIAL_ON_SWEEP[d] !== d ? `${d} (${DIAL_ON_SWEEP[d]})` : String(d));"),
      'gate would be written "gate (gate)"');
    // and the sentence reader names the dial at the front of each part only
    const words = s.slice(s.indexOf('function fRuleWords('), s.indexOf('function fRuleWords(') + 400);
    assert.ok(words.includes("split('; ')") && words.includes('/^([A-Za-z]+)(?= )/'), 'the sentence reader must name the dial that opens each part, and nothing else in it');
  },

  // ---- §16: the check and what it recommends --------------------------------

  // A VALUE COUNTS ON SIGN ALONE. Above the scrambled copy on every kept copy,
  // or above the half's own average on both halves. No margin, no multiple.
  aValueCountsWhenItBeatsEveryCopyOrBothHalves() {
    const F = require('../lib/funnel');
    // t 41..113 with money rising in t; two scrambled copies where t113's
    // scrambled money is high on copy 1 only
    const rows = [];
    for (const t of [41, 65, 89, 113]) for (let k = 0; k < 6; k++) {
      rows.push({ label: `t${t} k${k}`, tHours: t, gate: k % 2 ? 'active' : 'directional',
        avgTest: t / 10 + (k % 3) * 0.1, noiseTest: [5, t === 113 ? 20 : 5] });
    }
    // the check is READ off the rows by position, never built as a copy
    const c = F.countsFor(rows, 'tHours', { k: 2 });
    assert.strictEqual(c.kind, 'scrambles'); assert.strictEqual(c.k, 2);
    const by = Object.fromEntries(c.values.map((v) => [v.value, v.counts]));
    assert.deepStrictEqual(by, { 41: false, 65: true, 89: true, 113: false },
      't41 sits below the copies and t113 loses on copy 1, so neither counts');
    // and the recommendation is the widest run of counting neighbours
    const rec = F.recommendRange(rows, 'tHours', { k: 2 });
    assert.deepStrictEqual(rec.recommend, { min: 65, max: 89, n: 2 }, 'a range recommendation carries its count as n');
    // halves: above each half's own average on BOTH halves. Under seed 'x' the
    // odd-k settings land in one half and the even-k in the other (worked out
    // with splitHalf, not assumed), so t89 is made rich on the odd side only:
    // it beats one half's average and not the other's, and must not count.
    const split = rows.map((r) => ({ ...r, avgTest: r.tHours === 89 ? (Number(r.label.slice(-1)) % 2 ? 40 : 0) : r.tHours / 10 }));
    const [ha, hb] = F.splitHalf(split, 'x');
    assert.ok(ha.filter((r) => r.tHours === 89).every((r) => r.avgTest === 40) && hb.filter((r) => r.tHours === 89).every((r) => r.avgTest === 0),
      'the fixture must put the rich t89 settings all in one half');
    const h = F.countsFor(split, 'tHours', { seed: 'x' });
    assert.strictEqual(h.kind, 'halves'); assert.strictEqual(h.k, 0);
    const hby = Object.fromEntries(h.values.map((v) => [v.value, v.counts]));
    assert.strictEqual(hby[89], false, 't89 beats one half only, so it does not count');
    // and rich on BOTH sides it does -- the same value, the same split, only
    // the other half's money changed, which is exactly the AND
    const both = split.map((r) => ({ ...r, avgTest: r.tHours === 89 ? 40 : r.avgTest }));
    const hb2 = Object.fromEntries(F.countsFor(both, 'tHours', { seed: 'x' }).values.map((v) => [v.value, v.counts]));
    assert.strictEqual(hb2[89], true, 't89 above both halves\' averages counts');
    // a word-valued dial recommends a list of values, never a range
    const g = F.recommendRange(rows, 'gate', { k: 2 });
    assert.strictEqual(g.ordered, false);
    assert.ok(g.recommend == null || Array.isArray(g.recommend.values));
  },

  // The block is the largest rectangle of squares that count and are not
  // thin. Thin squares never count, whatever their money says.
  theBlockIsTheLargestRectangleThatBeatsTheCheck() {
    const F = require('../lib/funnel');
    const rows = [];
    for (const t of [41, 65, 89]) for (const d of [0.5, 1, 1.5]) for (let k = 0; k < 4; k++) {
      // good money in the middle t at every d, and at t89 d1.5 only
      const good = (t === 65) || (t === 89 && d === 1.5);
      rows.push({ label: `t${t} d${d} k${k}`, tHours: t, dMult: d, avgTest: good ? 10 : 1, noiseTest: [3] });
    }
    const real = F.step3(rows, 'tHours', 'dMult', { floor: 2 });
    const checks = [F.step3(rows, 'tHours', 'dMult', { floor: 2, moneyOf: F.moneyAt(0) })];
    const b = F.recommendBlock(real, checks, 'scrambles');
    assert.ok(b.block, 'there is a block');
    assert.deepStrictEqual(b.block.a, { from: '65', to: '65' });
    assert.deepStrictEqual(b.block.b, { from: '0.5', to: '1.5' });
    assert.strictEqual(b.block.squares, 3);
    // a thin square cannot join a block even when its money is best
    const thin = F.step3(rows.filter((r) => !(r.tHours === 65 && r.dMult === 1 && r.label.endsWith('k0'))), 'tHours', 'dMult', { floor: 4 });
    const b2 = F.recommendBlock(thin, [F.step3(rows, 'tHours', 'dMult', { floor: 4, moneyOf: F.moneyAt(0) })], 'scrambles');
    assert.ok(!b2.counting.includes('65|1'), 'the square with three settings under a floor of four is thin and does not count');
  },

  // The ladder reads its rungs off the survivors, so every rung is a value the
  // owner can actually choose, and says what each keeps.
  theLadderSaysWhatEachLimitWouldKeep() {
    const F = require('../lib/funnel');
    const rows = [10, 20, 30, 40, 50].map((v, i) => ({ label: `s${i}`, maxDrawdown: v }));
    const l = F.ladderFor(rows, 'maxDrawdown', 'max');
    assert.strictEqual(l.measured, 5);
    assert.deepStrictEqual(l.rungs.map((r) => [r.at, r.keeps]), [[10, 1], [20, 2], [30, 3], [40, 4], [50, 5]]);
    const m = F.ladderFor(rows, 'avgTrades', 'min');
    assert.strictEqual(m.measured, 0, 'a number no row carries measures nothing and says so');
  },

  // THE REGION IS A RULE. Its edges on every ordered dial and its value on
  // every word-valued one; never its centre alone.
  theWidestRegionBecomesARuleNotAPoint() {
    const P = require('../lib/plateau');
    const rows = [];
    for (const t of [41, 65, 89, 113, 137]) for (const g of ['active', 'directional']) {
      rows.push({ label: `t${t} ${g}`, tHours: t, gate: g, pnl: (g === 'active' && t >= 65 && t <= 113) ? 5 : -1, trades: 3 });
    }
    const r = P.widestRegion(rows, { minTrades: 0, orderedAxes: ['tHours'], categoricalAxes: ['gate'] });
    assert.strictEqual(r.size, 3);
    assert.deepStrictEqual(r.bounds, { tHours: { min: 65, max: 113 } });
    assert.deepStrictEqual(r.values, { gate: 'active' });
    const rule = FS4.regionRule(r, { ordered: ['tHours'], categorical: ['gate'] });
    assert.deepStrictEqual(rule, { ranges: { tHours: { min: 65, max: 113 } }, allowed: { gate: ['active'] } });
    assert.strictEqual(FS4.applyRule(rows, rule).length, 3, 'and applying it keeps exactly the region');
    // the fields the region always had are untouched
    assert.strictEqual(r.centre.tHours, 89);
    assert.deepStrictEqual(FS4.regionRule({ size: 0 }), { ranges: {}, allowed: {} });
  },

  // A mark is never cleared and never doubled.
  marksAreRecordedOnceAndRideOnTheSet() {
    const doc = FS4.newFunnelSet({ id: 's4-m-1', target: 5 });
    assert.deepStrictEqual(doc.marks, []);
    FS4.recordMark(doc, { key: 'halvesDisagree', step: 1 });
    FS4.recordMark(doc, { key: 'halvesDisagree', step: 1 });
    FS4.recordMark(doc, { key: 'slices', step: 4, detail: 'accepted 4 of 6; the check managed 3 of 6' });
    FS4.recordMark(doc, { key: 'notAMark', step: 9 });
    assert.strictEqual(doc.marks.length, 2);
    assert.strictEqual(doc.marks[0].what, FS4.MARKS.halvesDisagree);
    assert.ok(doc.marks.every((m) => m.at));
    FS4.finishFunnelSet(doc, s3rows().slice(0, 2), { key: 'rule' });
    assert.strictEqual(doc.marks.length, 2, 'finishing the set keeps the marks');
  },

  // THE REBUILT NUMBERS ARE KEPT AND LAID BACK ON. Before this they left with
  // the reply and nothing held them, so a limit on the worst losing streak
  // refused every row -- no row carried one.
  theRebuiltNumbersAreKeptBesideTheSetAndLaidOntoTheRows() {
    const fs2 = require('fs');
    const id = 's3-test-funnelrich';
    const per = new Map([
      ['a', { label: 'a', units: [{ rich: { test: { maxDrawdown: 100, worstTrade: -5, wins: 3, pnlThirds: [1, 2, 3] } } },
        { rich: { test: { maxDrawdown: 300, worstTrade: -7, wins: 5, pnlThirds: [3, 2, 1] } } }] }],
      ['b', { label: 'b', units: [{ rich: null }] }],
    ]);
    try {
      const got = stages.saveFunnelRich(id, per);
      assert.strictEqual(got.settings, 2);
      const rich = stages.readFunnelRich(id);
      assert.strictEqual(rich.settings.a.maxDrawdown, 200, 'one number per setting is the average across its units');
      assert.deepStrictEqual(rich.settings.a.pnlThirds, [2, 2, 2]);
      assert.deepStrictEqual(rich.settings.b, {}, 'a setting with no rebuilt numbers carries none, never zeros');
      const rows = stages.withFunnelRich([{ label: 'a', avgTrades: 9, maxDrawdown: 50 }, { label: 'b' }, { label: 'c' }], rich);
      assert.strictEqual(rows[0].maxDrawdown, 50, 'a number the row already carries is kept; the sidecar fills gaps only');
      assert.strictEqual(rows[0].worstTrade, -6, 'and a gap is filled from the sidecar');
      assert.strictEqual(rows[0].avgTrades, 9);
      assert.strictEqual(rows[2].maxDrawdown, undefined);
      // and now a limit can pass
      assert.strictEqual(FS4.applyRule(rows, { floors: { maxDrawdown: { max: 60 } } }).length, 1);
    } finally {
      try { fs2.unlinkSync(stages.funnelRichFile(id)); } catch (_) { /* never written */ }
    }
  },

  // ---- §16: the screen ----------------------------------------------------------

  // EVERY STEP HAS ITS CONTROL AND ITS CHECK DRAWN. The old page claimed a
  // comparison was "drawn beside" on steps 1-3 and drew nothing; steps 3, 4
  // and 5 had nothing to press. Read out of the renderers, one per step.
  everyStepHasItsControlAndItsCheckDrawn() {
    const s = src('public/construct.js');
    const fn = (name, next) => s.slice(s.indexOf(`function ${name}(`), s.indexOf(`\nfunction ${next}(`));
    const s1 = fn('fStep1', 'fStep2');
    assert.ok(s1.includes("cth('check', 'fCheck')"), 'step 1 draws the check column');
    assert.ok(s1.includes('data-fnarrow='), 'step 1 rows open step 2 with the dial chosen');
    assert.ok(s1.includes("(r.counts || {})[x.dial] === false ? 'dim' : ((r.counts || {})[x.dial] ? 'cnt' : '')"),
      'a dial that does not beat every copy is greyed, and one that does is bold across the whole row');
    assert.ok(s1.includes('<td>${fFix(x.m, 3)}</td>'), 'movement prints three decimals');
    assert.ok(s1.includes('return b ? `${b.n} of ${b.of} values` : \'-\';'), 'the check column counts the values that beat the check');
    assert.ok(src('public/construct.html').includes('tr.cnt td { font-weight:600; }'), 'the whole row has a bold style');
    const s2 = fn('fStep2', 'fStep3');
    assert.ok(s2.includes("cth('check', 'fCheck')"), 'step 2 draws the check column');
    assert.ok(s2.includes('id="fKeepValues"') && s2.includes('data-fval='), 'a word-valued dial gets a box per value');
    assert.ok(s2.includes('id="fKeepCount"'), 'the count line follows the boxes');
    // pre-filled from the rule, else from the recommendation -- and blank when
    // the rule keeps none ALONE, which is not a range at all (3.62.0)
    assert.ok(/const lo = noneAlone \? '' : \(have\.min != null \? have\.min : \(rr\.min != null \? rr\.min : ''\)\);/.test(s2),
      'the boxes are pre-filled from the rule, else from the recommendation');
    const s3 = fn('fStep3', 'fStep4');
    assert.ok(s3.includes('<select id="fA">') && s3.includes('<select id="fB">'), 'the two dials are pickers, not typed names');
    assert.ok(s3.includes('data-fcell=') && s3.includes('id="fKeepBlock"'), 'the grid has corners to press and a block to keep');
    assert.ok(s3.includes("kind === 'halves' ? 'The check - each half"), 'the check grid is drawn underneath');
    const s4 = fn('fStep4', 'fStep5');
    assert.ok(s4.includes('id="fAccept4"'), 'step 4 has an accept');
    assert.ok(s4.includes('The check managed'), 'and prints what the check managed beside the real count');
    const s5 = fn('fStep5', 'fLadder');
    assert.ok(s5.includes('id="fKeepRegion"'), 'step 5 has no press that keeps the auto-plateau region');
    assert.ok(!s5.includes('JSON.stringify'), 'and never prints its answer as raw JSON');
    const s6 = fn('fStep6', 'fStep7');
    assert.ok(s6.includes("fLadder('worst losing streak'") && s6.includes("fLadder('trades'"), 'step 6 shows what each limit would keep');
    // and every new control has help
    const h = src('public/help-content.js');
    for (const id of ['fKeepValues', 'fKeepBlock', 'fAccept4', 'fKeepRegion']) assert.ok(h.includes(`      ${id}: {`), `${id} has no help entry`);
  },

  // A SIZE ON ITS OWN CANNOT BE READ, AND TWO PRESSES THAT LOOK IDENTICAL ARE
  // NOT (3.106.0, owner questions 2026-09-10, three faults on one step).
  //
  //   - the money bar's box said "makes at least" and the code required MORE
  //     than it, so a setting that broke even to the cent was silently left out.
  //   - the check line ended "Anything short of all of them is a size a shuffle
  //     reaches too" -- a second bar of 100% on a step whose own first line says
  //     the bar is the owner's, 75% here, which the reading cleared comfortably.
  //   - `keep the widest region` and `keep my own rule and go on` both ended on
  //     the same count and neither said so, so there was no way to see that the
  //     choice was between two RULES.
  async theStepFiveReadingsSayWhatTheyMeasureAndWhatTheyCost() {
    const page = src('public/construct.js');
    const five = page.slice(page.indexOf('function fStep5(r, d, st) {'), page.indexOf('// WHAT EACH LIMIT WOULD KEEP'));

    // THE LABEL AGREES WITH THE COMPARISON THE CODE MAKES
    const P = require('../lib/plateau');
    const src5 = src('lib/plateau.js');
    assert.ok(/row\.pnl > Number\(atLeast\)/.test(src5), 'the region no longer requires a setting to beat the bar');
    assert.ok(five.includes('count a setting in if it makes more than'), 'the box still says at least, which is not what the code does');
    assert.ok(/a setting has to beat this number, not match it/.test(five), 'the line beside the box does not say a break-even setting is left out');
    // and it really is left out, run rather than read
    const o = { minTrades: 0, atLeast: 0, across: [], orderedAxes: ['tHours', 'agreePct'], categoricalAxes: ['decision'] };
    const flat = [{ tHours: 24, agreePct: 50, decision: 'argmax', pnl: 0, avgTrades: 5 },
      { tHours: 48, agreePct: 50, decision: 'argmax', pnl: 0, avgTrades: 5 },
      { tHours: 72, agreePct: 50, decision: 'argmax', pnl: 0, avgTrades: 5 }];
    assert.strictEqual(P.widestRegion(flat, o).size, 0, 'settings that broke even exactly are counted in at a bar of 0');

    // THE REGION SAYS WHAT ITS OWN MEMBERS MADE
    const paid = [{ tHours: 24, agreePct: 50, decision: 'argmax', pnl: 10, avgTrades: 5 },
      { tHours: 48, agreePct: 50, decision: 'argmax', pnl: 20, avgTrades: 5 }];
    assert.strictEqual(P.widestRegion(paid, o).avgPnl, 15, 'the region does not report what its members made');
    assert.strictEqual(P.widestRegion([], o).avgPnl, null, 'no region reads as a break-even rather than as nothing');

    // BOTH COUNTS AND BOTH RULES, ON THE TWO PRESSES
    assert.ok(/Keep my own rule and go on<\/button>\s*<span class="note">leaves every range and value you chose exactly as it is and moves to step 6 - keeps/.test(five),
      'the press that keeps your own rule does not say what it keeps');
    assert.ok(five.includes('${Number(keep.mineKeeps || 0).toLocaleString()}'), 'it does not read the count the service worked out');
    assert.ok(/your rule: \$\{esc\(keep\.mineSentence\)\}/.test(five) && /the region's rule: \$\{esc\(keep\.sentence\)\}/.test(five),
      'the two rules are not printed, so a choice between two rules reads as a choice between two counts');
    assert.ok(/The two presses above write the SAME rule/.test(five) && /The two rules are NOT the same/.test(five),
      'the screen never says whether the choice changes anything');
    // AND THE BOX ROUND A REGION IS BIGGER THAN THE REGION, said where it bites
    assert.ok(/keeps the smallest\s+box that CONTAINS the region/.test(five),
      'the press keeps more settings than the region and the screen does not say why');

    // the service works all four out
    const lib = src('lib/stages.js');
    const keep = lib.slice(lib.indexOf('    out.reading.keep = {\n      ...keep,'), lib.indexOf('out.conditions.regionPapered'));
    assert.ok(keep.includes('mineKeeps: rows.length,') && keep.includes('mineSentence: S4.ruleSentence(rule),'), 'the reading does not carry the owner\'s own rule');
    assert.ok(keep.includes('sentence: out.reading.size ? S4.ruleSentence(keepRule) : null,'), 'the reading does not carry the region\'s rule');
    assert.ok(lib.includes("const sameRule = JSON.stringify(S4.normaliseRule(keepRule)) === JSON.stringify(S4.normaliseRule(rule));"),
      'the two rules are compared as the rows they pick rather than as rules');
    // and every copy carries what it made
    assert.ok(lib.includes("each.push({ size: r && r.size != null ? r.size : null, avg: r ? r.avgPnl : null });"),
      'a scrambled copy reports how wide its region was and not what it made');
    assert.ok(lib.includes('matched: mine == null ? null : each.filter((v) => v.size != null && v.size >= mine).length,'),
      'how many copies reached the size is left to be worked out from a subtraction');
    assert.ok(lib.includes('barPct: check.barPct == null ? null : check.barPct,'), 'the owner\'s own bar does not travel to the line that would otherwise invent one');
  },

  // THE PAGE NEVER CLAIMS A DRAWING THAT IS NOT THERE. The one sentence that
  // did is gone, and the line that replaces it names what is on the screen.
  thePageNeverClaimsAComparisonItDoesNotDraw() {
    const s = src('public/construct.js');
    assert.ok(!s.includes('is drawn beside. '), 'the false claim is gone');
    const nl = s.slice(s.indexOf('function fNoiseLine('), s.indexOf('\n}\n', s.indexOf('function fNoiseLine(')));
    // 3.106.0: the sizes moved into a box that carries what each region MADE
    // beside how wide it was, because a size on its own cannot be read.
    assert.ok(nl.includes("if (!n || !Array.isArray(n.copies) || !n.copies.length) return '';"),
      'the line prints something when there is no comparison to print');
    assert.ok(/reached a region as wide as yours/.test(nl), 'the line does not say how many copies reached the size');
    assert.ok(!/Anything short of all of them/.test(nl),
      'the line sets a second bar of 100% on a step whose own first line says the bar is the owner\'s');
    assert.ok(/Your bar on this step is/.test(nl), 'the line does not say what the owner\'s own bar was');
    assert.ok(/A size counts settings, never dollars/.test(nl), 'the box does not say that a wider region is not a better one');
    assert.ok(nl.includes("cth('$ a setting', 'fNoiseAvg')"), 'the box does not carry what each region made');
    const cl = s.slice(s.indexOf('function fCheckLine('), s.indexOf('\n}\n', s.indexOf('function fCheckLine(')));
    assert.ok(cl.includes('drawn beside the same reading on each of this') && cl.includes('two halves of the settings'),
      'the check line names which check was used, and both name something the step draws');
  },

  // THE WORD IS GONE FROM EVERYTHING THE OWNER CAN READ (owner order,
  // 2026-09-02: "we don't use the word LUCK. burn that into your behavior").
  theBannedWordIsOnNoScreen() {
    for (const f of ['public/construct.js', 'public/help-content.js', 'public/construct.html', 'public/setup.html', 'public/trade.html']) {
      const s = src(f);
      const hits = s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /luck/i.test(l));
      assert.deepStrictEqual(hits.map(([n]) => n), [], `${f} still carries the word at line(s) ${hits.map(([n]) => n).join(', ')}`);
    }
  },

  // MARKS TRAVEL: recorded on the page, sent with the cut, written on the set
  // in the record's own words, listed with the set.
  marksTravelFromThePageToTheSetAndBack() {
    const s = src('public/construct.js');
    assert.ok(s.includes('marks: st.marks || [],'), 'the cut sends the marks');
    assert.ok(s.includes("else if (n > st.step) markStep(st.step);"), 'moving past a step records its marks');
    const words = s.slice(s.indexOf('const F_MARK_WORDS = {'), s.indexOf('};', s.indexOf('const F_MARK_WORDS = {')));
    for (const [k, v] of Object.entries(FS4.MARKS)) assert.ok(words.includes(`  ${k}: '${v}',`), `the page's words for ${k} differ from the record's`);
    const st = src('lib/stages.js');
    assert.ok(st.includes("for (const m of (state.marks || [])) S4.recordMark(doc,"), 'the cut writes them through recordMark');
    const sv = src('server.js');
    // the cut's own reply is built where the cut is started (3.67.0), the set
    // list's in the door that serves it
    assert.ok(st.includes('marks: doc.marks || [],'), 'the cut reply does not carry them');
    assert.ok(sv.includes('marks: d.marks || [],'), 'the set list does not carry them');
  },

  // The read hands every step what §16 says it shows, and says which check it
  // used. Read out of funnelRead rather than run, because a tally on disk is
  // not something a unit test should make.
  theReadServesEveryStepItsCheckAndRecommendation() {
    const s = src('lib/stages.js');
    const body = s.slice(s.indexOf('function funnelRead('), s.indexOf('\nfunction sliceRowsFor('));
    assert.ok(body.includes("out.check = { kind, k: keptN, barPct: F.barPctOf(state), bar, chance: kind === 'scrambles' ? F.chanceOf(bar, keptN) : null };"), 'the read names the check, the share asked, the count it came to, and what that clears by chance');
    assert.ok(body.includes("out.conditions.checkIsHalves = kind === 'halves';"));
    assert.ok(body.includes('r1.beating = beating;') && body.includes('r1.counts = counts;'), 'step 1: how many values beat the check, per dial');
    assert.ok(body.includes('r2.rec = F.recommendRange(rows, dial, check, { seed });'), 'step 2: the recommendation');
    assert.ok(body.includes('F.recommendBlock(g, checkGrids, kind, { barPct: F.barPctOf(state) })'), 'step 3: the block, under the walk\'s bar');
    assert.ok(body.includes("check: { kind, positive: checkReads.map((x) => x.positive)"), 'step 4: the check count');
    assert.ok(body.includes('S4.regionRule(out.reading, { ordered, categorical: F.CATEGORICAL_DIALS })'), 'step 5: the region as a rule');
    assert.ok(body.includes("maxDrawdown: F.ladderFor(rows, 'maxDrawdown', 'max')"), 'step 6: the ladders');
    assert.ok(body.includes('const board = await funnelBoard(id, t, state.unit);'), 'the read is on the board the walk chose (§17)');
    assert.ok(body.includes('const all = withFunnelRich(board.all, rich);'), 'the rebuilt numbers are laid on before the rule');
  },

  // A POLL REDRAW LEAVES THE OWNER'S PLACE ALONE (owner, 2026-09-02: "when i
  // scroll down on the Boards tab the page keeps resetting"). While the tables
  // total, Boards redraws every four seconds; restoring a remembered position
  // on each one is what put the owner back at the top.
  aPollRedrawLeavesThePlaceOnThePageAlone() {
    const s = src('public/construct.js');
    const fn = s.slice(s.indexOf('function bPollRedraw('), s.indexOf('\n}\n', s.indexOf('function bPollRedraw(')));
    assert.ok(!fn.includes('restoreScroll'), 'a poll redraw must not move the page');
    assert.ok(fn.includes('holdScrollMemory()'), 'and must not let the redraw overwrite the remembered place either');
    assert.ok(s.includes('This page asks again every few seconds and leaves your place on it alone.'), 'the totalling line says so');
    // the accept sentence on step 4 is built once, outside the template -- a
    // template nested inside an interpolation showed the owner a bare r.positive
    const s4 = s.slice(s.indexOf('function fStep4('), s.indexOf('\nfunction fStep5('));
    assert.ok(s4.includes('const said = r.why ?'), 'the sentence is built first');
    assert.ok(!/\$\{[^}]*`accepted/.test(s4), 'no template literal nested inside an interpolation');
  },

  // STEP 1 MAY NOT POINT AT A DIAL THAT MOVES THE MONEY THE WRONG WAY (owner,
  // 2026-09-02: "why would you attract a view to a set-up that varies from
  // the null set IN THE WRONG DIRECTION? don't justify failure"). Movement has
  // no direction: a forecast that makes every value LOSE more than a shuffle
  // moves the piles apart just as well. The bold on step 1 is therefore step
  // 2's test rolled up -- at least one value beats the check -- and a dial
  // whose every value is beaten by the shuffle is greyed however far apart
  // its piles sit.
  stepOneBoldsOnlyADialWithAValueThatBeatsTheCheck() {
    const F = require('../lib/funnel');
    // the forecast spreads the gates apart by making two of them lose more
    // than the shuffle does; the third ignores it and matches its copies
    const rows = [];
    // 'idle' is a pile the forecast does not touch -- a name for the fixture,
    // not a gate the engine has
    for (const g of ['active', 'idle', 'directional']) for (let k = 0; k < 8; k++) {
      const real = g === 'idle' ? 8 : (g === 'active' ? -2 : -15);
      const copy = g === 'idle' ? 8 : (g === 'active' ? 1 : -6);
      // the same small spread inside every pile on every copy: a copy with no
      // spread at all would read as infinite movement and hide the trap
      rows.push({ label: `${g} ${k}`, gate: g, avgTest: real + (k % 2) * 0.1, noiseTest: [copy + (k % 2) * 0.1, copy + (k % 2) * 0.1] });
    }
    const real = F.movement(rows, 'gate');
    const copies = [0, 1].map((d) => F.movement(rows, 'gate', F.moneyAt(d)).m);
    assert.ok(copies.every((m) => real.m > m), 'the fixture is the trap: the real movement beats every copy');
    const c = F.countsFor(rows, 'gate', { k: 2 });
    assert.strictEqual(c.values.filter((v) => v.counts).length, 0, 'and yet no value beats the check, so the dial must not count');
    // and the read rolls exactly that up, never the movement
    const s = src('lib/stages.js');
    const body = s.slice(s.indexOf('if (step === 1) {', s.indexOf('function funnelRead(')), s.indexOf('} else if (step === 2) {'));
    assert.ok(body.includes('const c = F.countsFor(rows, x.dial, check, { seed });'), 'step 1 asks step 2\'s question of every dial');
    assert.ok(body.includes('counts[x.dial] = n > 0;'), 'and a dial counts only when a value of it beats the check');
    assert.ok(!/F\.movement\([^)]*moneyAt/.test(body), 'movement on a scrambled copy is not what decides the bold any more');
  },

  // EQUAL IS NOT A WIN. `always` settings carry scrambled copies equal to
  // their own money to the cent, and they read as beating all ten or none of
  // them on a hundred-trillionth of a dollar. The comparison is made in cents.
  aValueEqualToItsCopiesToTheCentDoesNotBeatThem() {
    const F = require('../lib/funnel');
    assert.strictEqual(F.beats(8.09, 8.09), false);
    assert.strictEqual(F.beats(8.09 + 1e-13, 8.09), false, 'a hundred-trillionth is not a win');
    assert.strictEqual(F.beats(8.094, 8.09), false, 'under half a cent rounds to the same cent');
    assert.strictEqual(F.beats(8.10, 8.09), true, 'a cent is');
    assert.strictEqual(F.beats(null, 8.09), false);
    // through the reading: a dial whose copies equal its money to the cent
    const rows = [];
    for (let k = 0; k < 8; k++) rows.push({ label: `s${k}`, gate: k % 2 ? 'idle' : 'active', avgTest: (k % 2 ? 22.78 : 3) + 1e-13, noiseTest: [k % 2 ? 22.78 : 3, k % 2 ? 22.78 : 3] });
    const c = F.countsFor(rows, 'gate', { k: 2 });
    assert.ok(c.values.every((v) => v.counts === false), 'neither value beats copies equal to it');
    const real = F.step3(rows, 'gate', 'gate', { floor: 0 });
    const blk = F.recommendBlock(real, [F.step3(rows, 'gate', 'gate', { floor: 0, moneyOf: F.moneyAt(0) })], 'scrambles');
    assert.strictEqual(blk.block, null, 'and no square does either');
  },

  aFunnelReadThatFailsSaysSoRatherThanLeavingTheScreenAsItWas() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const at = src.indexOf('async function drawFunnel');
    assert.ok(at > 0, 'drawFunnel is gone');
    // to the next top-level function, never a character count
    const end = src.indexOf('\nfunction fHead(', at);
    assert.ok(end > at, 'the end of drawFunnel cannot be found');
    const body = src.slice(at, end);
    assert.ok(!body.includes('if (!d) return;'),
      'a bare early return on a failed read is the defect: it writes nothing at all');
    const branchAt = body.indexOf('if (!d) {');
    assert.ok(branchAt > 0, 'there must be a failed-read branch at all');
    assert.ok(body.slice(branchAt, branchAt + 600).includes('innerHTML'),
      'the failed-read branch must write something to the view');
    assert.ok(body.includes('could not read'), 'and it must say that it could not read, not show an empty panel');
  },

  // ---- ONE RULE PER COIN-AND-SHAPE UNIT (§17, owner order 2026-09-02:
  // "IT'S ONE RULE PER COIN+SHAPE -- 10 RULES, NOT 5") ------------------------

  aUnitIsNamedTheWayTheSetWasLaunchedAndKeyedTheWayTheEngineKeysIt() {
    assert.strictEqual(stages.unitNameOf({ trade: 'DOGEUSDT', ctx1: null, ctx2: null, geometry: 'daily-1d' }), 'DOGEUSDT daily-1d');
    assert.strictEqual(stages.unitNameOf({ trade: 'BTCUSDT', ctx1: 'ETHUSDT', ctx2: null, geometry: 'daily-2d' }), 'BTCUSDT alongside ETHUSDT daily-2d');
    assert.strictEqual(stages.unitNameOf({ trade: 'BTCUSDT', ctx1: 'ETHUSDT', ctx2: 'XRPUSDT', geometry: 'daily-2d' }), 'BTCUSDT alongside ETHUSDT and XRPUSDT daily-2d');
    assert.strictEqual(stages.unitKeyOf({ trade: 'DOGEUSDT', ctx1: null, ctx2: null, geometry: 'daily-1d' }), 'DOGEUSDT|||daily-1d');
    assert.strictEqual(stages.unitKeyOf({ trade: 'BTCUSDT', ctx1: 'ETHUSDT', ctx2: 'XRPUSDT', geometry: 'daily-2d' }), 'BTCUSDT|ETHUSDT|XRPUSDT|daily-2d');
    // the per-coin table's rows fold to one unit each, their blocks unioned,
    // in the order the set was launched -- and once per tally in hand
    const t = { coins: [
      { cellLabel: 'a', trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-1d', b: [3, 1] },
      { cellLabel: 'b', trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-1d', b: [2, 3] },
      { cellLabel: 'a', trade: 'BBB', ctx1: 'AAA', ctx2: null, geometry: 'daily-1d', b: [4] },
    ] };
    const units = stages.unitsOfSet(t);
    assert.deepStrictEqual(units.map((u) => u.key), ['AAA|||daily-1d', 'BBB|AAA||daily-1d']);
    assert.deepStrictEqual(units[0].blocks, [1, 2, 3], 'blocks are the union, sorted');
    assert.strictEqual(units[1].name, 'BBB alongside AAA daily-1d');
    assert.strictEqual(stages.unitsOfSet(t), units, 'worked out once per tally object');
    assert.notStrictEqual(stages.unitsOfSet({ coins: t.coins }), units, 'and again for another');
    assert.deepStrictEqual(stages.unitsOfSet({}), [], 'a tally with no per-coin table offers no units');
  },

  // A RECORD AS A BOARD ROW: every dial, and every measure the blended row
  // carries, read from the one record so a column means the same on both
  // boards. The kept figures ride through untouched -- the readings take
  // them by position.
  aUnitBoardRowCarriesEveryDialAndTheBlendedRowsMeasuresFromTheOneRecord() {
    const F = require('../lib/funnel');
    const rec = { si: 7, label: 'q1 x · argmax auto 24/7', decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
      entry: 'market', gate: 'active', dMult: 1.5, tHours: 65, trailMult: null, armMult: null,
      agreeRule: 'share', agreeBar: 0.6, agreePct: null, agreeCopy: 'plain', agreeBoth: false, agreePersist: 0,
      rung: 3, members: 8, voices: 5, pnl: 12.5, trades: 40,
      holdout: { pnl: 3.25, trades: 12, stops: 2, vsAlwaysLong: 1.1 }, beat: 60, pairs: 100, lead: 0.4,
      noiseTest: [1, 2, 3], noiseHold: [4, 5, 6], u: 3, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-1d' };
    const row = stages.boardRowOf(rec, 'AAA|||daily-1d');
    for (const d of F.ALL_DIALS) assert.ok(d in row, `the board row must carry the dial ${d}`);
    assert.strictEqual(row.unit, 'AAA|||daily-1d');
    assert.strictEqual(row.si, 7);
    assert.strictEqual(row.label, rec.label);
    assert.strictEqual(F.money(row), 12.5, 'the test money is the record\'s own');
    assert.strictEqual(row.avgHold, 3.25);
    assert.strictEqual(row.avgTrades, 12);
    assert.strictEqual(row.avgVsLong, 1.1);
    assert.strictEqual(row.avgLead, 0.4);
    assert.strictEqual(row.avgRung, 3);
    assert.strictEqual(row.avgVoices, 5);
    assert.strictEqual(row.coins, 1);
    assert.strictEqual(row.coinsInMoney, 1);
    assert.strictEqual(row.beat, 60);
    assert.strictEqual(row.pairs, 100);
    assert.strictEqual(row.noiseTest, rec.noiseTest, 'the kept figures are the record\'s own array, not a copy');
    assert.strictEqual(F.moneyAt(1)(row), 2);
    assert.strictEqual(row.noiseHold, rec.noiseHold);
    // a record with no held-back result and nothing kept says so with nulls
    const bare = stages.boardRowOf({ si: 1, label: 'x', pnl: -2 }, 'k');
    assert.strictEqual(bare.avgHold, null);
    assert.strictEqual(bare.avgTrades, null);
    assert.strictEqual(bare.avgVsLong, null);
    assert.strictEqual(bare.coinsInMoney, 0);
    assert.strictEqual(bare.noiseTest, null);
    assert.strictEqual(bare.gate, null, 'null, never undefined');
  },

  // A stage 3 set on disk with three units across shared blocks, so the
  // per-unit board can be read, walked, read across, cut and replayed.
  async aUnitsBoardIsItsOwnRecordsAndNobodyElses() {
    const fx = await unitFixture();
    try {
      const { id, t, keys } = fx;
      const b0 = await stages.funnelBoard(id, t, keys[0]);
      assert.strictEqual(b0.unit, keys[0]);
      assert.strictEqual(b0.name, 'AAA daily-1d');
      assert.strictEqual(b0.all.length, 4, 'one row per setting on the unit, and no other unit\'s rows -- the blocks hold two units each');
      assert.ok(b0.all.every((r) => r.unit === keys[0] && r.coins === 1), 'every row is the unit\'s own');
      assert.deepStrictEqual(b0.all.map((r) => r.avgTest).sort((a, b) => a - b), [0, 0.5, 10, 10.5], 'the unit\'s own money, not an average');
      assert.ok(b0.all.every((r) => Array.isArray(r.noiseTest) && r.noiseTest.length === 10), 'the unit\'s own ten kept figures');
      const b2 = await stages.funnelBoard(id, t, keys[2]);
      assert.strictEqual(b2.all.length, 4);
      assert.ok(b2.all.every((r) => r.unit === keys[2]));
      // one board in hand at a time: asking again is free, asking for another lets it go
      const again = await stages.funnelBoard(id, t, keys[2]);
      assert.strictEqual(again.all, b2.all, 'the board in hand is handed back');
      const b0again = await stages.funnelBoard(id, t, keys[0]);
      assert.notStrictEqual(b0again.all, b0.all, 'the first board was let go when the second was read');
      assert.deepStrictEqual(b0again.all.map((r) => r.label), b0.all.map((r) => r.label), 'and reads the same again');
    } finally { fx.cleanup(); }
  },

  // THE UNITS IN THE STAGE 2 TABLE'S ORDER (owner decision, 2026-09-02):
  // the parent's table as Boards shows it, so the first unit of a set is
  // that table's top row, and a sort saved on the table is followed.
  async theUnitsAreListedInTheStageTwoTablesOrder() {
    const fx = await unitFixture({ parent: true });
    try {
      const { id, t, keys } = fx;
      assert.deepStrictEqual(stages.unitsOfSet(t, id).map((u) => u.key), [keys[1], keys[2], keys[0]],
        'the stage 2 table\'s order -- forecast score, all members, best first -- not the order the units finished');
      const r1 = await stages.funnelRead(id, { step: 1, rule: {} });
      assert.deepStrictEqual(r1.units.map((u) => u.key), [keys[1], keys[2], keys[0]]);
      assert.strictEqual(r1.unit, keys[1], 'nothing chosen is the top row of the stage 2 table');
      // a sort saved on the parent's table is followed on the next read
      stages.setSetSort(fx.parentId, [{ key: 'trade', dir: 'asc' }]);
      assert.deepStrictEqual(stages.unitsOfSet(t, id).map((u) => u.key), [keys[0], keys[1], keys[2]], 'coin A to Z, ties by carry order');
      // and without a parent on the box the units are listed as found
      assert.deepStrictEqual(stages.unitsOfSet(t, 'no-such-set').map((u) => u.key), keys);
    } finally { fx.cleanup(); }
  },

  async theBlendIsChosenByNameAndNothingChosenIsTheFirstUnit() {
    const fx = await unitFixture();
    try {
      const { id, t, keys } = fx;
      const first = await stages.funnelBoard(id, t, null);
      assert.strictEqual(first.unit, keys[0], 'nothing chosen is the set\'s first unit');
      assert.strictEqual((await stages.funnelBoard(id, t, '')).unit, keys[0]);
      const blend = await stages.funnelBoard(id, t, 'all');
      assert.strictEqual(blend.unit, null, 'the blend is chosen by name');
      assert.strictEqual(blend.name, null);
      assert.strictEqual(blend.all, t.ranked, 'and is the blended table itself, never a copy');
      await assert.rejects(() => stages.funnelBoard(id, t, 'ZZZ|||daily-9d'), /holds no unit called/);
      // a tally with no per-coin table has only the blend
      assert.strictEqual((await stages.funnelBoard(id, { ranked: t.ranked }, null)).unit, null);
    } finally { fx.cleanup(); }
  },

  async theReadIsOnTheChosenUnitAndStepFourWaitsToBePressed() {
    const fx = await unitFixture();
    try {
      const { id, keys } = fx;
      const r1 = await stages.funnelRead(id, { step: 1, rule: {}, unit: keys[0] });
      assert.strictEqual(r1.unit, keys[0]);
      assert.strictEqual(r1.unitName, 'AAA daily-1d');
      assert.deepStrictEqual(r1.units.map((u) => u.key), keys, 'every board the set offers -- as found, since this fixture has no parent on the box');
      assert.strictEqual(r1.units[2].name, 'BBB alongside AAA daily-1d');
      assert.strictEqual(r1.of, 4, 'the board is the unit\'s four settings');
      assert.strictEqual(r1.set.keptScrambles, 10, 'the check is the unit\'s own ten kept figures');
      assert.strictEqual(r1.check.kind, 'scrambles');
      assert.ok(r1.reading && Array.isArray(r1.reading.dials), 'step 1 reads on the unit\'s rows');
      // the gate moves this unit: active makes 10, always makes 0, and active
      // beats every one of its copies -- bold on step 1
      assert.ok(r1.reading.dials.some((x) => x.dial === 'gate'), 'gate is among the dials this unit swept');
      assert.strictEqual(r1.reading.counts.gate, true, 'gate has a value beating the check on this unit');
      assert.deepStrictEqual(r1.reading.beating.gate, { n: 1, of: 2 }, 'active beats every copy on this unit; directional beats none');
      assert.strictEqual(r1.holdsAxis.axis, 'units');
      assert.strictEqual(r1.holdsAxis.others, 2);
      const r4 = await stages.funnelRead(id, { step: 4, rule: { allowed: { gate: ['active'] } }, unit: keys[0] });
      assert.strictEqual(r4.reading.pressed, true, 'on a unit\'s board step 4 is read by pressing');
      assert.strictEqual(r4.reading.others, 2);
      assert.strictEqual(r4.survivors, 2);
      // nothing chosen is the first unit; the blend by name reads the blended table
      assert.strictEqual((await stages.funnelRead(id, { step: 1, rule: {} })).unit, keys[0]);
      const blend = await stages.funnelRead(id, { step: 4, rule: {}, unit: 'all' });
      assert.strictEqual(blend.unit, null);
      assert.strictEqual(blend.unitName, null);
      assert.ok(!blend.reading.pressed, 'the blend reads across what it can offer, as before');
      assert.notStrictEqual(blend.holdsAxis.axis, 'units');
      await assert.rejects(() => stages.funnelRead(id, { step: 1, rule: {}, unit: 'ZZZ|||daily-9d' }), /holds no unit called/);
    } finally { fx.cleanup(); }
  },

  async readingTheOtherUnitsAppliesTheRuleToEachOfThem() {
    const fx = await unitFixture();
    try {
      const { id, keys } = fx;
      const rule = { allowed: { gate: ['active'] } };
      const a = await stages.funnelAcross(id, { rule, unit: keys[0] });
      assert.strictEqual(a.unit, keys[0]);
      assert.deepStrictEqual(a.units.map((u) => u.unit), [keys[1], keys[2]], 'the other units, never the walked one');
      assert.strictEqual(a.units[0].name, 'AAA daily-2d');
      const u1 = a.units[0];
      assert.strictEqual(u1.survivors, 2);
      assert.strictEqual(u1.of, 4);
      assert.ok(Math.abs(u1.avgTest - 2.25) < 1e-12, `unit 1's active settings average 2.25, got ${u1.avgTest}`);
      assert.strictEqual(u1.positive, true);
      assert.strictEqual(u1.k, 10);
      assert.strictEqual(u1.check.length, 10, 'the same rule on each of the unit\'s own copies');
      assert.strictEqual(u1.beats, 5, 'beats the five copies below it and not the five above');
      const u2 = a.units[1];
      assert.ok(Math.abs(u2.avgTest + 3.75) < 1e-12);
      assert.strictEqual(u2.positive, false);
      assert.strictEqual(u2.beats, 0);
      assert.strictEqual(a.positive, 1);
      assert.strictEqual(a.of, 2);
      assert.strictEqual(a.clearBar, 0, 'nobody clears eight of ten');
      assert.strictEqual(a.barPct, 80, 'the default share');
      assert.strictEqual(a.bar, 8, 'which on ten copies is eight of them');
      // walked on the blend, every unit is "other"; unit 0's active beats all ten
      const b = await stages.funnelAcross(id, { rule, unit: 'all' });
      assert.strictEqual(b.unit, null);
      assert.deepStrictEqual(b.units.map((u) => u.unit), keys);
      assert.strictEqual(b.units[0].beats, 10);
      assert.strictEqual(b.positive, 2);
      assert.strictEqual(b.of, 3);
      assert.strictEqual(b.clearBar, 1, 'unit 0 beats all ten, which clears any bar');
      // nothing chosen is the first unit, as everywhere
      assert.strictEqual((await stages.funnelAcross(id, { rule })).unit, keys[0]);
      // a rule keeping nothing on a unit says so with nulls rather than zeros
      const none = await stages.funnelAcross(id, { rule: { allowed: { gate: ['never'] } }, unit: keys[0] });
      assert.ok(none.units.every((u) => u.survivors === 0 && u.avgTest === null && u.positive === false && u.k === 0));
      assert.strictEqual(none.of, 0, 'a unit with no survivors is not counted as read');
      // THE REBUILT NUMBERS ARE LAID ON PER UNIT before the rule is applied
      // (decision 72): a limit on the worst losing streak reads each unit's
      // own number. Without the laying the limit finds no number and keeps
      // nothing anywhere; with the average across units it keeps the wrong
      // ones. Unit 1's t41 is under the limit and its t65 is over; unit 2's
      // both are under; the average of every unit is under for both.
      const per = new Map();
      for (const label of ['q1 active t41 · argmax auto 24/7', 'q1 active t65 · argmax auto 24/7']) {
        const own = (u) => (u.u === 1 ? (label.includes('t41') ? 10 : 30) : 5);
        per.set(label, { label, units: fx.units.map((u) => ({ ...u, rich: { test: { maxDrawdown: own(u) } } })) });
      }
      stages.saveFunnelRich(id, per);
      const limited = await stages.funnelAcross(id, { rule: { allowed: { gate: ['active'] }, floors: { maxDrawdown: { max: 20 } } }, unit: keys[0] });
      const l1 = limited.units.find((u) => u.unit === keys[1]);
      const l2 = limited.units.find((u) => u.unit === keys[2]);
      assert.strictEqual(l1.survivors, 1, 'unit 1 keeps the one active setting whose own worst streak is under the limit');
      assert.ok(Math.abs(l1.avgTest - 2) < 1e-12, 'and it is the t41 setting, read by the unit\'s own number');
      assert.strictEqual(l2.survivors, 2, 'unit 2 keeps both: its own numbers are under the limit');
    } finally { fx.cleanup(); }
  },

  // STARTED AND POLLED, never one request: nine boards is about a minute and
  // the web server in front allows a request sixty seconds (decision 73).
  async readingTheOtherUnitsRunsInTheBackgroundAndIsPolled() {
    const fx = await unitFixture();
    try {
      const { id, keys } = fx;
      const rule = { allowed: { gate: ['active'] } };
      const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      const settled = async () => { for (let i = 0; i < 200; i++) { const st = stages.funnelAcrossStatus(id); if (!st.running) return st; await sleep(25); } throw new Error('the reading never finished'); };
      const s0 = stages.funnelAcrossStart(id, { rule, unit: keys[0] });
      assert.strictEqual(s0.running, true, 'started, not answered');
      assert.strictEqual(s0.result, null);
      assert.strictEqual(s0.of, 2, 'it says how many boards it will read before it reads one');
      assert.ok(s0.token, 'and names the reading, so a page can tell its own from another\'s');
      // one at a time: another rule is refused while this one reads; the same rule is the same reading
      assert.throws(() => stages.funnelAcrossStart(id, { rule: { allowed: { gate: ['directional'] } }, unit: keys[0] }), /still being read/);
      assert.strictEqual(stages.funnelAcrossStart(id, { rule, unit: keys[0] }).token, s0.token, 'the same rule asked again is the same reading');
      assert.strictEqual(stages.funnelAcrossStatus('some-other-set').none, true);
      const done = await settled();
      assert.strictEqual(done.error, null);
      assert.strictEqual(done.token, s0.token);
      assert.strictEqual(done.done, 2);
      assert.strictEqual(done.of, 2);
      const direct = await stages.funnelAcross(id, { rule, unit: keys[0] });
      assert.deepStrictEqual(done.result, direct, 'the polled result is the worker\'s result');
      // finished, the same rule is answered from the result without reading a block
      const again = stages.funnelAcrossStart(id, { rule, unit: keys[0] });
      assert.strictEqual(again.running, false);
      assert.strictEqual(again.token, s0.token);
      assert.deepStrictEqual(again.result, direct);
      // and another rule, now that nothing is reading, is a new reading
      const s1 = stages.funnelAcrossStart(id, { rule: { allowed: { gate: ['directional'] } }, unit: keys[0] });
      assert.notStrictEqual(s1.token, s0.token);
      const d1 = await settled();
      assert.strictEqual(d1.result.units[0].survivors, 2);
      assert.ok(d1.result.units.every((u) => u.avgTest !== direct.units.find((x) => x.unit === u.unit).avgTest), 'a different rule, a different reading');
      // a reading that fails says so, and does not hold the box for ever
      stages.funnelAcrossStart('no-such-set', { rule, unit: keys[0] });
      const dead = await (async () => { for (let i = 0; i < 200; i++) { const st = stages.funnelAcrossStatus('no-such-set'); if (!st.running) return st; await sleep(25); } return null; })();
      assert.ok(dead && /unknown record set/.test(dead.error), 'the error is reported on the status');
      const retry = stages.funnelAcrossStart('no-such-set', { rule, unit: keys[0] });
      assert.notStrictEqual(retry.token, dead.token, 'pressing again after a failure tries again, rather than reading the failure back');
      await (async () => { for (let i = 0; i < 200; i++) { if (!stages.funnelAcrossStatus('no-such-set').running) return; await sleep(25); } })();
      assert.strictEqual(stages.funnelAcrossStart(id, { rule, unit: keys[0] }).running, true, 'and a dead reading does not block the next');
      await settled();
    } finally { fx.cleanup(); }
  },

  async theCutIsMadeOnTheUnitAndTheSetSaysWhichUnit() {
    const fx = await unitFixture();
    let s4 = null;
    try {
      const { id, keys } = fx;
      const doc = await stages.cutFunnelSet(id, { rule: { allowed: { gate: ['active'] } }, closing: { key: 'rule' }, unit: keys[0], steps: [], backSteps: [], marks: [] });
      s4 = doc.id;
      assert.strictEqual(doc.unit, keys[0], 'the set records the unit it was cut on');
      assert.strictEqual(doc.unitName, 'AAA daily-1d', 'by the name the screen prints');
      assert.ok(/^S4 #\d+ - AAA daily-1d$/.test(doc.name), `named for its unit unless the owner names it, got ${doc.name}`);
      assert.strictEqual(doc.counts.survivors, 2, 'the unit\'s two active settings, not the blend\'s');
      assert.strictEqual(doc.replayChecked.same, true, 'the rule reproduces its own survivors on the unit\'s board');
      assert.ok(doc.survivors.every((s) => s.label.includes('active')));
      const listed = stages.listFunnelSets(id).find((d) => d.id === s4);
      assert.ok(listed && listed.unit === keys[0] && listed.unitName === 'AAA daily-1d');
      // a name typed by the owner wins
      fs.rmSync(stages.setFileFor ? stages.setFileFor(s4) : path.join(__dirname, '..', 'data', 'stagesets', `${s4}.json`), { force: true });
      const named = await stages.cutFunnelSet(id, { name: 'mine', rule: { allowed: { gate: ['active'] } }, closing: { key: 'rule' }, unit: keys[0] });
      s4 = named.id;
      assert.strictEqual(named.name, 'mine');
      // and the blend, by name, cuts the blended table with no unit on it
      fs.rmSync(path.join(__dirname, '..', 'data', 'stagesets', `${s4}.json`), { force: true });
      const blend = await stages.cutFunnelSet(id, { rule: { allowed: { gate: ['active'] } }, closing: { key: 'rule' }, unit: 'all' });
      s4 = blend.id;
      assert.strictEqual(blend.unit, null);
      assert.strictEqual(blend.unitName, null);
      assert.ok(/^S4 #\d+$/.test(blend.name));
      assert.strictEqual(blend.counts.survivors, 2, 'two active settings on the blended table too');
    } finally {
      if (s4) { try { fs.rmSync(path.join(__dirname, '..', 'data', 'stagesets', `${s4}.json`), { force: true }); } catch (_) { /* fixture */ } }
      fx.cleanup();
    }
  },

  // THE REBUILT NUMBERS ARE KEPT PER UNIT (§17.3a): a unit's row takes its
  // own, the blend takes the average, and a file of the older shape reads as
  // absent so the rebuild is offered again (RULE NINE: derived, so rebuilt,
  // never translated).
  aUnitBoardRowTakesTheUnitsOwnRebuiltNumbers() {
    const id = `s3-test-${Date.now().toString(36)}-rich`;
    const file = stages.funnelRichFile(id);
    try {
      const unitA = { trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-1d' };
      const unitB = { trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-2d' };
      const perSetting = new Map([['q1', { label: 'q1', units: [
        { ...unitA, rich: { test: { maxDrawdown: 10, worstTrade: -3, pnlThirds: [1, 2, 3] } } },
        { ...unitB, rich: { test: { maxDrawdown: 20, worstTrade: -5, pnlThirds: [3, 4, 5] } } },
      ] }]]);
      stages.saveFunnelRich(id, perSetting);
      const rich = stages.readFunnelRich(id);
      assert.strictEqual(rich.v, stages.FUNNEL_RICH_V);
      // 3 (3.107.0): the file also carries the four things a rule has to beat,
      // read on the TEST window, per unit
      assert.strictEqual(rich.v, 3, 'the shape that carries the test-window comparisons is the third');
      const q1 = rich.settings.q1;
      assert.strictEqual(q1.maxDrawdown, 15, 'the blend\'s number is the average across units');
      assert.deepStrictEqual(q1.pnlThirds, [2, 3, 4]);
      assert.strictEqual(q1.units[stages.unitKeyOf(unitA)].maxDrawdown, 10, 'and each unit\'s own is kept beside it');
      assert.deepStrictEqual(q1.units[stages.unitKeyOf(unitB)].pnlThirds, [3, 4, 5]);
      const laid = stages.withFunnelRich([
        { label: 'q1', unit: stages.unitKeyOf(unitA) },
        { label: 'q1', unit: stages.unitKeyOf(unitB) },
        { label: 'q1' },
        { label: 'q1', unit: 'CCC|||daily-1d' },
      ], rich);
      assert.strictEqual(laid[0].maxDrawdown, 10, 'a unit\'s row reads the unit\'s own');
      assert.strictEqual(laid[1].maxDrawdown, 20);
      assert.strictEqual(laid[2].maxDrawdown, 15, 'a blend row reads the average');
      assert.strictEqual(laid[3].maxDrawdown, 15, 'a unit the rebuild did not cover reads the average -- there is no unit number to read');
      assert.ok(!('units' in laid[0]), 'the per-unit table is not laid onto a row');
      // a file of the older shape reads as absent, never translated
      fs.writeFileSync(file, JSON.stringify({ v: 1, settings: { q1: { maxDrawdown: 15 } } }));
      assert.strictEqual(stages.readFunnelRich(id), null, 'an older shape reads as absent, so the screen offers the rebuild again');
    } finally { try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ } }
  },

  // THE SCREEN: the unit it is walking on goes with the read, the across and
  // the cut; the first visit keeps the unit the reply named; the picker
  // offers the blend by its one literal value and every unit the set listed.
  theScreenSendsTheUnitItIsWalkingOnToTheReadTheAcrossAndTheCut() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const body = src.slice(src.indexOf('async function drawFunnel'), src.indexOf('\nfunction fHead('));
    assert.ok(/\/read`, \{[\s\S]*?unit: st\.unit,/.test(body), 'the read carries the unit');
    assert.ok(body.includes("fUnitChoose(st.set, d.unit || 'all');") && body.includes('return drawFunnel();'),
      'the first visit keeps the unit the reply named and reads again under it');
    // kept in the page as well as in storage, so a window whose storage
    // throws settles on a unit instead of asking for ever
    assert.ok(src.includes('fUnitMemory[set] = unit;') && src.includes('catch (_) { return fUnitMemory[set] || null; }'),
      'the chosen unit is remembered in the page too');
    const wire = src.slice(src.indexOf('function fWire('));
    assert.ok(/\/across`, \{ rule: st\.rule, unit: st\.unit, barPct: st\.barPct \}/.test(wire), 'the across carries the unit');
    const cutAt = wire.indexOf('/cut`');
    assert.ok(cutAt > 0 && /unit: st\.unit,\n\s*barPct: st\.barPct,\n\s*\}, WHERE_FUNNEL\);/.test(wire.slice(cutAt, cutAt + 700)), 'the cut carries the unit');
    assert.ok(src.includes('<select id="fUnit"><option value="all"'), 'the picker offers the blend as all');
    // 3.80.0: the boxes are one per part, so their options are coins, alongside
    // coins and chunk shapes rather than joined-up unit keys. What has to stay
    // true is that every option comes from the reply's own list and that what
    // is SENT is still a key the reply named -- fUnitResolve returns one of
    // d.units' keys or nothing, and theCoinAndShapeBoxIsOneBoxPerPart runs it.
    assert.ok(/const fUnitOf = \(d, key\) =>[\s\S]{0,60}\.units \|\| \[\]\)\.find\(\(u\) => u\.key === key\)/.test(src),
      'the picker no longer looks the board it is on up in the reply\'s own list, by key');
    assert.ok(/function fUnitResolve\(d, want\) \{[\s\S]{0,120}\.units \|\| \[\]\)\.filter\(\(u\) => u\.trade === want\.trade\)/.test(src),
      'and what it sends is no longer resolved against that same list');
    // a walk is saved per unit, and never under no unit
    assert.ok(src.includes('if (!fState || !fState.unit) return;'), 'no walk is saved under no unit');
    assert.ok(src.includes("const fWalkKeyFor = (set, unit) => `cx-funnel-${set}-${unit || 'all'}`;"), 'one walk per set and unit');
  },

  onAUnitsBoardStepFourIsReadByPressingAndTheAcceptRecordsThatRead() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const s4 = src.slice(src.indexOf('function fStep4('), src.indexOf('\nfunction fStep5('));
    assert.ok(s4.includes('if (r.pressed) {'), 'step 4 on a unit\'s board is its own drawing');
    assert.ok(s4.includes('<button id="fAcross" class="pri" ${asked ? \'disabled\' : \'\'}>Read the other units</button>'), 'read by pressing');
    assert.ok(s4.includes("${r.others} boards, read one at a time"), 'the count of other boards is the set\'s, never typed');
    assert.ok(!/nine/.test(s4), 'no typed nine');
    assert.ok(s4.includes("const a = st.across && st.across.ruleKey === fAcrossKey(st) ? st.across : null;"),
      'what was read is shown only for the rule and the bar it was read for');
    const draw = src.slice(src.indexOf('async function drawFunnel'), src.indexOf('\nfunction fHead('));
    assert.ok(draw.includes('accept: d.step === 4 && r.pressed')
      && draw.includes('(a4 ? { positive: a4.positive, of: a4.of, check: null, clearBar: a4.clearBar } : null)'),
      'the accept on a pressed step 4 records the across read for this rule');
    const wire = src.slice(src.indexOf('function fWire('));
    assert.ok(wire.includes('? `accepted ${a4.positive} of ${a4.of} other units positive; ${a4.clearBar} clear the bar`'),
      'the mark says what was accepted in the units\' terms');
    // STARTED AND FOLLOWED (decision 73): the press starts the reading and
    // remembers which; the follower polls, counts the boards read on the
    // line, and keeps the result under the rule it was read for -- never a
    // result the box holds for some other reading
    assert.ok(wire.includes("st.acrossAsked = { ruleKey, token: started.token, at: new Date().toISOString() };"), 'the press remembers the reading it started');
    const follow = src.slice(src.indexOf('async function fAcrossFollow('), src.indexOf('\nfunction fWire('));
    assert.ok(follow.includes("s = await api(`api/funnel/${encodeURIComponent(st.set)}/across`);"), 'the follower polls the reading');
    assert.ok(follow.includes('if (!s || s.none || s.token !== asked.token) {'), 'a reading that is not the one this page started is left alone');
    assert.ok(follow.includes('st.across = { ...s.result, ruleKey: asked.ruleKey, at: new Date().toISOString() };'), 'the result is kept under the rule it was read for');
    assert.ok(follow.includes('m.textContent = `read ${s.done} of ${s.of}`;'), 'the line counts the boards read');
    assert.ok(follow.includes('if (fState !== st) return;'), 'a follower whose walk has left the screen stops');
    assert.ok(wire.includes('if (ax && ax.disabled && st.acrossAsked && !(st.across && st.across.ruleKey === st.acrossAsked.ruleKey)) fAcrossFollow(st, null);'),
      'a reading started before the page was left is followed again, not asked for twice');
    assert.ok(s4.includes("<button id=\"fAcross\" class=\"pri\" ${asked ? 'disabled' : ''}>Read the other units</button>"), 'the button is held while its reading runs');
  },

  // ---- THE BAR (§18, owner order 2026-09-02: "that bar should be down at
  // the range of 5 to 7") -------------------------------------------------

  aValueCountsWhenItBeatsAtLeastTheBarOfTheCopies() {
    const F = require('../lib/funnel');
    // A SHARE, NOT A COUNT (owner order, 2026-09-04: "make the box a
    // percentage of the null tables beat"): eight of ten was a count written
    // for ten copies and silently meant eight of twenty on a set that kept
    // twenty. The share resolves to a count per set, rounded up.
    assert.strictEqual(F.DEFAULT_BAR_PCT, 80);
    assert.strictEqual(F.barPctOf({}), 80, 'nothing asked is 80%');
    assert.strictEqual(F.barPctOf({ barPct: 50 }), 50);
    assert.strictEqual(F.barPctOf({ barPct: 140 }), 100, 'a hundred is the ceiling');
    assert.strictEqual(F.barPctOf({ barPct: 0 }), 1, 'and one is the floor');
    assert.strictEqual(F.barOf({ k: 10 }), 8, 'nothing asked is eight of ten');
    assert.strictEqual(F.barOf({ k: 20 }), 16, 'and sixteen of twenty: the share is what is kept, not the count');
    assert.strictEqual(F.barOf({ k: 19 }), 16, 'rounded up: at least 80% of 19 is 16, not 15');
    assert.strictEqual(F.barOf({ k: 3 }), 3, 'a set that kept three copies bars at three');
    assert.strictEqual(F.barOf({ k: 10, barPct: 50 }), 5);
    assert.strictEqual(F.barOf({ k: 10, barPct: 1 }), 1, 'one is the floor');
    assert.strictEqual(F.barOf({ k: 10, barPct: 100 }), 10, 'K is the ceiling');
    assert.strictEqual(F.barOf({ k: 10, bar: 5 }), 8, 'a count under the old name is ignored, never read as a share');
    assert.strictEqual(F.barOf({ k: 0 }), 0);
    // what a bar buys: the real figure is one more draw among K + 1
    assert.ok(Math.abs(F.chanceOf(10, 10) - 1 / 11) < 1e-12);
    assert.ok(Math.abs(F.chanceOf(8, 10) - 3 / 11) < 1e-12);
    assert.ok(Math.abs(F.chanceOf(5, 10) - 6 / 11) < 1e-12);
    assert.strictEqual(F.chanceOf(11, 10), null);
    // how far ahead: against the copies' average, in units of their spread
    assert.ok(Math.abs(F.leadOf(5, [1, 2, 3]) - 3) < 1e-12, '(5 - 2) / 1');
    assert.strictEqual(F.leadOf(5, [2, 2, 2]), null, 'no spread, no lead');
    assert.strictEqual(F.leadOf(5, [2]), null, 'one copy is no spread');
    assert.strictEqual(F.leadOf(null, [1, 2, 3]), null);
    // a value beating 7 of 10 counts under a bar of 7 and not under 8
    const rows = [];
    for (let k = 0; k < 10; k++) {
      // gate a: real 5, copies 0..9 -> beats copies 0..4 (five); gate b: real 8 -> beats 0..7 (eight)
      rows.push({ label: `a${k}`, gate: 'a', avgTest: 5, noiseTest: Array.from({ length: 10 }, (_, d) => d) });
      rows.push({ label: `b${k}`, gate: 'b', avgTest: 8, noiseTest: Array.from({ length: 10 }, (_, d) => d) });
    }
    // ten copies, so a count of N is a share of N * 10 percent
    const at = (bar) => Object.fromEntries(F.countsFor(rows, 'gate', { k: 10, barPct: bar * 10 }).values.map((v) => [v.value, v]));
    assert.strictEqual(at(10).a.beaten, 5);
    assert.strictEqual(at(10).b.beaten, 8);
    assert.deepStrictEqual([at(10).a.counts, at(10).b.counts], [false, false], 'all ten: neither');
    assert.deepStrictEqual([at(8).a.counts, at(8).b.counts], [false, true], 'eight: b');
    assert.deepStrictEqual([at(5).a.counts, at(5).b.counts], [true, true], 'five: both');
    assert.strictEqual(at(8).b.lead != null && at(8).b.lead > 0, true, 'and the lead says how far ahead');
    assert.strictEqual(F.countsFor(rows, 'gate', { k: 10, barPct: 50 }).bar, 5, 'the reading says which bar it used');
    // the halves are both, whatever bar is asked
    const h = F.countsFor(rows, 'gate', { seed: 's', barPct: 10 });
    assert.strictEqual(h.bar, 2);
    assert.ok(h.values.every((v) => v.beaten >= 0 && v.beaten <= 2 && v.lead === null));
    // a square on step 3 counts on the same terms
    const g = F.step3(rows, 'gate', 'gate', { floor: 0 });
    const grids = Array.from({ length: 10 }, (_, d) => F.step3(rows, 'gate', 'gate', { floor: 0, moneyOf: F.moneyAt(d) }));
    assert.strictEqual(F.recommendBlock(g, grids, 'scrambles', { barPct: 100 }).block, null, 'no square beats all ten');
    assert.ok(F.recommendBlock(g, grids, 'scrambles', { barPct: 80 }).block, 'b beats eight');
  },

  async theWalkCarriesItsBarAndTheSetSaysWhatItWasCutUnder() {
    const fx = await unitFixture();
    let s4 = null;
    try {
      const { id, keys } = fx;
      // unit 1's active beats five of ten: not bold at eight, bold at five
      const r8 = await stages.funnelRead(id, { step: 1, rule: {}, unit: keys[1] });
      assert.deepStrictEqual(r8.check, { kind: 'scrambles', k: 10, barPct: 80, bar: 8, chance: 3 / 11 });
      assert.strictEqual(r8.reading.counts.gate, false, 'five of ten does not clear eight');
      assert.ok(r8.reading.honesty && r8.reading.honesty.of > 0, 'the board says how many values clear the bar');
      assert.ok(Math.abs(r8.reading.honesty.byChance - r8.reading.honesty.of * (3 / 11)) < 1e-9, 'and how many would by chance');
      const r5 = await stages.funnelRead(id, { step: 1, rule: {}, unit: keys[1], barPct: 50 });
      assert.deepStrictEqual(r5.check, { kind: 'scrambles', k: 10, barPct: 50, bar: 5, chance: 6 / 11 });
      const rOld = await stages.funnelRead(id, { step: 1, rule: {}, unit: keys[1], bar: 5 });
      assert.deepStrictEqual(rOld.check, { kind: 'scrambles', k: 10, barPct: 80, bar: 8, chance: 3 / 11 }, 'a count under the old name is not a share');
      assert.strictEqual(r5.reading.counts.gate, true, 'five of ten clears five');
      assert.strictEqual(r5.reading.beating.gate.n, 1);
      const r2 = await stages.funnelRead(id, { step: 2, rule: {}, unit: keys[1], dial: 'gate', barPct: 50 });
      const active = r2.reading.rec.values.find((v) => v.value === 'active');
      assert.strictEqual(active.beaten, 5);
      assert.strictEqual(active.counts, true);
      assert.deepStrictEqual(r2.reading.rec.recommend, { values: ['active'] }, 'recommended under five');
      assert.strictEqual(r2.reading.rec.bar, 5);
      // the across clears the bar per unit, under the walk's bar
      const a = await stages.funnelAcross(id, { rule: { allowed: { gate: ['active'] } }, unit: keys[0], barPct: 50 });
      assert.strictEqual(a.barPct, 50);
      assert.strictEqual(a.bar, 5);
      assert.strictEqual(a.units.find((u) => u.unit === keys[1]).clears, true, 'unit 1 beats five of ten');
      assert.strictEqual(a.clearBar, 1);
      // the cut writes the check it was read under
      const doc = await stages.cutFunnelSet(id, { rule: { allowed: { gate: ['active'] } }, closing: { key: 'rule' }, unit: keys[1], barPct: 50 });
      s4 = doc.id;
      assert.deepStrictEqual(doc.check, { kind: 'scrambles', k: 10, barPct: 50, bar: 5, chance: 6 / 11 }, 'the set says the share it was cut under and the count that came to');
    } finally {
      if (s4) { try { fs.rmSync(path.join(__dirname, '..', 'data', 'stagesets', `${s4}.json`), { force: true }); } catch (_) { /* fixture */ } }
      fx.cleanup();
    }
  },

  // THE SAME RULE UNDER ANOTHER SHARE IS ANOTHER READING. The across was kept
  // per rule only, so a rule asked again under a different bar was answered
  // from the old reading -- on the box, where one reading is kept at a time,
  // and on the page, which keeps the last result under the rule it was for.
  theAcrossIsKeyedOnTheBarAsWellAsTheRule() {
    const s = src('lib/stages.js');
    assert.ok(s.includes("return JSON.stringify([id, state.unit == null ? '' : String(state.unit), S4.normaliseRule(state.rule), require('./funnel').barPctOf(state)]);"),
      'the box keys the reading of the other units on the rule alone');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(ui.includes("const fAcrossKey = (st) => JSON.stringify([st.rule, st.barPct == null ? null : st.barPct]);"), 'the page has no key that carries the bar');
    assert.ok(ui.includes("const a4 = st.across && st.across.ruleKey === fAcrossKey(st) ? st.across : null;"), 'the kept reading is shown under a bar it was not read for');
    // AND STEP 4 LOOKS UNDER THE SAME KEY (3.55.0): it looked under the rule
    // alone, never found the reading, and read the other units read as dead
    assert.ok(ui.includes("    const a = st.across && st.across.ruleKey === fAcrossKey(st) ? st.across : null;"), 'step 4 looks for the reading under a key the press never filed it under');
    assert.ok(ui.includes("    const asked = !a && st.acrossAsked && st.acrossAsked.ruleKey === fAcrossKey(st);"), 'step 4 forgets a reading is in flight the moment the page redraws');
    assert.ok(!/ruleKey === JSON\.stringify\(st\.rule\)/.test(ui), 'somewhere the reading is still looked for under the rule alone');
    assert.ok(ui.includes("    const ruleKey = fAcrossKey(st);"), 'the press does not remember the bar it asked under');
  },

  // THE BAR AND THE TARGET STAY WHERE THEY ARE LEFT (owner order, 2026-09-04:
  // "i put it on 75% and every single selection you set it back to 80%").
  // A walk is saved per unit, so switching coin and shape loaded a walk that
  // had never seen the bar and fell back to the default, and the owner read
  // every unit twice. Both are remembered once per set now.
  theBarAndTheTargetStayWhereTheyAreLeftForTheWholeSet() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(src.includes('const fSetKeyFor = (set) => `cx-funnel-set-${set}`;'), 'the set has no memory of its own');
    const load = src.slice(src.indexOf('function fLoad('), src.indexOf('\nfunction fSave('));
    assert.ok(load.includes('if (shared.barPct !== undefined) fState.barPct = shared.barPct;'), 'a unit\'s walk does not take the set\'s bar');
    assert.ok(load.includes('if (shared.target !== undefined) fState.target = shared.target;'), 'a unit\'s walk does not take the set\'s target');
    const wire = src.slice(src.indexOf('function fWire('));
    assert.ok(wire.includes('fRememberForSet(st.set, { barPct: v }); fSave(); drawFunnel();'), 'changing the bar does not remember it for the set');
    assert.ok(wire.includes('fRememberForSet(st.set, { target: st.target }); fSave(); drawFunnel();'), 'changing the target does not remember it for the set');
  },

  // THE SEALED WINDOW RIDES ON STAGE 2 RECORDS (3.51.0, owner order 2026-09-04:
  // "fix and deploy the no sealed window deficiency"). Stage 2 used to carry
  // the bounds into each unit's stores and not onto the record the Funnel
  // reads, so every stage 3 set said "5 of 5 units carry no sealed window".
  theStageTwoRecordCarriesTheSealedWindowTheFunnelReads() {
    const rowstore = require('../lib/rowstore');
    const s = src('lib/stages.js');
    // the sealed bounds and, since 3.85.0, the date ranges sit between the
    // carried fields and the members on the stage 2 record
    assert.ok(/          reserve: rec\.reserve \|\| null,\n(?:.*\n){0,8}?          specs: merged\.members\.map\(/.test(s), 'the stage 2 record does not carry the sealed bounds');
    const stamp = Date.now().toString(36);
    const ids = { s1: `s1-test-${stamp}-sw`, s2: `s2-test-${stamp}-sw`, s3: `s3-test-${stamp}-sw` };
    const SETS = path.join(__dirname, '..', 'data', 'stagesets');
    const units = [['AAAUSDT', 'daily-2d'], ['BBBUSDT', 'weekly-8d'], ['CCCUSDT', 'daily-1d']];
    const mk = (id, over) => fs.writeFileSync(path.join(SETS, `${id}.json`), JSON.stringify({ id, seq: 999970, status: 'done', createdAt: new Date().toISOString(), plan: { units: 3 }, ...over }));
    try {
      fs.mkdirSync(SETS, { recursive: true });
      mk(ids.s1, { stage: 1, name: 'S1 #sw', params: { windowLayout: 'reserve61' } });
      mk(ids.s2, { stage: 2, name: 'S2 #sw', parent: { id: ids.s1, name: 'S1 #sw' }, params: { windowLayout: 'reserve61' } });
      mk(ids.s3, { stage: 3, name: 'S3 #sw', parent: { id: ids.s2, name: 'S2 #sw' }, params: { windowLayout: 'reserve61', carry: 0, selected: null } });
      const w2 = rowstore.writer(ids.s2, 'records');
      units.forEach(([trade, geometry], u) => w2.push({ u, s1u: u, s1rank: u + 1, carriedRank: u + 1, trade, ctx1: null, ctx2: null, size: 1, geometry, bandPct: 2, reserve: { chunks: 45, fromTs: 1759104000000 + u }, specs: [], scoreAll: 1, blocks: { votes: [u, u] } }));
      w2.close();
      assert.strictEqual(stages.sealedWindowOf(stages.getSet(ids.s3)).sealed, true, 'the stage 3 set reads sealed off its parent records');
      // and a stage 2 record without them is a stated refusal, in the words the
      // owner saw -- never a quiet nothing, and never something to be repaired
      ids.s2n = `s2-test-${stamp}-swn`; ids.s3n = `s3-test-${stamp}-swn`;
      mk(ids.s2n, { stage: 2, name: 'S2 #old', parent: { id: ids.s1, name: 'S1 #sw' }, params: { windowLayout: 'reserve61' } });
      mk(ids.s3n, { stage: 3, name: 'S3 #old', parent: { id: ids.s2n, name: 'S2 #old' }, params: { windowLayout: 'reserve61', carry: 0, selected: null } });
      const w2b = rowstore.writer(ids.s2n, 'records');
      units.forEach(([trade, geometry], u) => w2b.push({ u, s1u: u, s1rank: u + 1, carriedRank: u + 1, trade, ctx1: null, ctx2: null, size: 1, geometry, bandPct: 2, specs: [], scoreAll: 1, blocks: {} }));
      w2b.close();
      assert.strictEqual(stages.sealedWindowOf(stages.getSet(ids.s3n)).why, '3 of 3 units carry no sealed window', 'the words the owner saw');
    } finally {
      for (const id of Object.values(ids)) {
        try { fs.rmSync(path.join(SETS, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      }
    }
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(ui.includes("${d.totalling ? 'the tables for this set are being worked out - ' : ''}<b>${esc(said)}</b>"), 'the page calls every wait a totalling');
  },

  // TWO FAULTS THE OWNER MET ON STEP 2 (2026-09-04: "it's like the interface
  // is broken and was never tested"). After keeping gate = directional, step 2
  // answered with a reason and the page drew the reason ALONE, so the dial box
  // that picks the next dial was gone. Then `narrow this one` on t did nothing:
  // the recommendation for a range carried its count under `values`, the page
  // took it for a list, the draw threw before it painted, and the page stayed
  // on step 1 with nothing said. Both are pinned here; tests/ui-funnel.js
  // presses the buttons for real in a browser against the box's own answer.
  theStepTwoScreenKeepsItsDialBoxAndSurvivesARecommendedRange() {
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(ui.includes("${r.why && d.step !== 2 ? `<p class=\"note neg\">${esc(r.why)}</p>`"), 'a reason on step 2 replaces the whole step, dial box included');
    const s2 = ui.slice(ui.indexOf('function fStep2('), ui.indexOf('\nfunction fStep3('));
    assert.ok(s2.includes("const chosen = new Set((Array.isArray(kept) ? kept : (Array.isArray(rr.values) ? rr.values : [])).map(String));"), 'step 2 takes whatever rides under values for a list');
    assert.ok(s2.includes("Array.isArray(rr.values) && rr.values.length ? `keep ${esc(rr.values.join(', '))}"), 'the recommended line takes whatever rides under values for a list');
    assert.ok(s2.includes('<p class="note${r.why ? \' neg\' : \'\'}">${esc(r.why || \'pick a dial to read its shape\')}</p>'), 'step 2 with a reason does not draw the dial box beside it');
    const F = require('../lib/funnel');
    const rows = [];
    for (let k = 0; k < 10; k++) for (const t of [17, 41, 65]) rows.push({ label: `r${k}${t}`, tHours: t, avgTest: t === 41 ? 9 : 1, noiseTest: Array.from({ length: 10 }, () => 0) });
    const rec = F.recommendRange(rows, 'tHours', { k: 10, barPct: 80 });
    assert.ok(rec.recommend && !('values' in rec.recommend) && rec.recommend.n >= 1, `a range recommendation names its count n, never values: ${JSON.stringify(rec.recommend)}`);
    // the box's own answer for t on XRP, as the page received it, is a range with a count
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'funnel-step2-thours.json'), 'utf8'));
    assert.strictEqual(typeof real.reading.rec.recommend.values, 'number', 'the fixture is the answer that broke the page');
    const one = F.movement([{ label: 'a', gate: 'directional', avgTest: 1, noiseTest: [] }], 'gate');
    assert.strictEqual(one.why, 'only one value of this dial is left on this board, so there is no shape to read - pick another dial', 'a dial with one value left says so and says what to do');
  },

  theScreenOffersTheBarAndSendsItWithEveryRead() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const head = src.slice(src.indexOf('function fHead('), src.indexOf('\nfunction fRail('));
    assert.ok(head.includes('bold when a value beats at least<input id="fBar" type="number" min="1" max="100"'), 'the bar box is a percentage');
    assert.ok(head.includes('value="${c.barPct}"'), 'and holds the share, not the count');
    assert.ok(head.includes('% of the <b>${c.k}</b> copies - that is <b>${c.bar}</b> of them - by chance about <b>${fPct(c.chance)}</b> of values would'), 'the count it comes to and what that buys, beside it');
    const draw = src.slice(src.indexOf('async function drawFunnel'), src.indexOf('\nfunction fHead('));
    assert.ok(/\/read`, \{[\s\S]*?barPct: st\.barPct,/.test(draw), 'the read carries the share');
    assert.ok(src.includes("if (saved && 'bar' in saved) delete saved.bar;"), 'a walk saved under the old count drops it rather than reading it as a percent');
    assert.ok(!/\bst\.bar\b/.test(src), 'nothing on the page still carries the bar as a count');
    const wire = src.slice(src.indexOf('function fWire('));
    assert.ok(wire.includes("{ rule: st.rule, unit: st.unit, barPct: st.barPct }"), 'the across carries the share');
    assert.ok(/unit: st\.unit,\n\s*barPct: st\.barPct,\n\s*\}, WHERE_FUNNEL\);/.test(wire), 'the cut carries the share');
    assert.ok(wire.includes("Math.max(1, Math.min(100, Math.floor(Number(bb.value) || 0)))") && wire.includes("st.barPct = v; fRememberForSet(st.set, { barPct: v }); fSave(); drawFunnel();"),
      'the box is held to 1..100 and changing it re-reads');
    const s1 = src.slice(src.indexOf('function fStep1('), src.indexOf('\nfunction fStep2('));
    assert.ok(s1.includes('values clear the bar on this board; by chance about'), 'the honesty line on step 1');
    const s2 = src.slice(src.indexOf('function fStep2('), src.indexOf('\nfunction fStep3('));
    assert.ok(s2.includes('- beats ${v.beaten == null ? \'-\' : v.beaten} of ${c.length}'), 'step 2 says how many copies each value beats');
    assert.ok(s2.includes('- lead ${Number(v.lead).toFixed(1)}'), 'and how far ahead');
    assert.ok(!/beatsAll|beat every copy/.test(src), 'nothing on the page still asks for every copy');
  },
  // THE COUNT FOLLOWS THE TICKS (3.52.0, owner 2026-09-04: "why when i
  // uncheck the 'true' checkbox on the weekdaysOnly dial does the record
  // count not change?"). The range boxes' count line has followed their
  // edits since the walk was built; the tick boxes' line was drawn once and
  // never moved. Both read the table on screen, the same way.
  async theKeepsCountBesideTheTickBoxesFollowsTheTicks() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const wire = page.slice(page.indexOf('const countRange = () => {'), page.indexOf('const readGrid = () => {'));
    assert.ok(wire.includes("document.querySelectorAll('[data-fval]').forEach((box) => {") && wire.includes('box.onchange = () => {'),
      'the tick boxes have no change handler, so the count line beside keep these values never moves');
    assert.ok(wire.includes("for (const [val, n] of ((st.read || {}).groups || [])) { total += n; if (on.has(String(val))) kept += n; }"),
      'the tick count does not read the table on screen the way the range count does');
    assert.strictEqual(wire.split("if (kc) kc.textContent = `keeps ${kept.toLocaleString()} of ${total.toLocaleString()}").length - 1, 2,
      'the two count lines are not written the same way');
    const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
    assert.ok(/The count beside it follows the ticks as you change them/.test(help), 'the help for keep these values does not say the count follows the ticks');
  },

  // STEP 3 SAYS HOW TO WALK IT, ON THE SCREEN (3.52.1, owner order 2026-09-04:
  // "you need to have plain steps to walk this step 3 ... MAKE THE USER
  // SELECTED BLOCK SHADED LIGHT GREEN ... make the text area 'Your block: ...'
  // BOLD DARK GREEN"). Every control the steps name is a control the step
  // draws, and the owner's own block is drawn in its own colour.
  async theThirdStepSaysHowToWalkItAndShowsTheOwnersBlockInGreen() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const step = page.slice(page.indexOf('function fStep3('), page.indexOf('\nfunction ', page.indexOf('function fStep3(') + 10));
    const how = step.slice(step.indexOf('<ol class="note fhow">'), step.indexOf('</ol>'));
    assert.ok(how.length > 0, 'step 3 carries no numbered steps');
    assert.strictEqual(how.split('<li>').length - 1, 7, 'the walk is seven steps, the ones the owner wrote');
    for (const control of ['<b>first dial</b>', '<b>second dial</b>', '<b>thin below</b>', '<b>Read the grid</b>', '<b>Keep this block</b>']) {
      assert.ok(how.includes(control), `the steps do not name ${control}`);
    }
    // every control the steps name is one this step draws, with that label
    for (const label of ['first dial', 'second dial', 'thin below', 'Read the grid', 'Keep this block']) {
      assert.ok(step.includes(`>${label}<`) || step.includes(`${label}<input`) || step.includes(`${label}<select`), `the steps name "${label}", which step 3 does not draw`);
    }
    assert.ok(how.includes('greyed out, shows its count in brackets, and can never be bold or part of a block'), 'thin below is not explained in plain words');
    assert.ok(how.includes('Changing a dial box reads the grid again by itself; a new thin below number needs the button'), 'what read the grid is for is not said');
    // the steps are on the screen before the grid is read and after
    assert.strictEqual(step.split('${howTo}${pickers}').length - 1, 2, 'the steps are not shown both before and after the grid is read');
    // and it is true: the dial boxes re-read by themselves, the floor does not
    const wire = page.slice(page.indexOf('const readGrid = () => {'), page.indexOf('const readGrid = () => {') + 600);
    assert.ok(wire.includes("for (const id of ['fA', 'fB']) { const el = $(`#${id}`); if (el) el.onchange = readGrid; }"), 'changing a dial box does not read the grid again, so the step lies');
    assert.ok(!/fFloor.*onchange|fFloor.*oninput/.test(wire), 'thin below reads the grid by itself now, so the step lies the other way');
    // the owner's block is green, and its line is bold dark green
    assert.ok(step.includes('<b class="fpick">Your block: '), 'the owner\'s block line is not drawn in its own colour');
    assert.ok(step.includes('<b class="fpick">One corner chosen - press the other.</b>'), 'the half-chosen block line is not drawn in its own colour');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.html'), 'utf8');
    assert.ok(/td\.pick \{ background:var\(--pickbg\); \}/.test(css), 'the chosen boxes are not shaded in the block colour');
    assert.ok(/\.fpick \{ color:var\(--pickfg\); font-weight:700; \}/.test(css), 'the block line is not bold in the block colour');
    assert.ok(/--pickbg:#d6f5e2; --pickfg:#0a5d3a;/.test(css), 'the light theme does not shade light green with dark green text');
    assert.ok(/--pickbg:#1c3a2a; --pickfg:#7ee0b0;/.test(css), 'the dark theme has no block colours of its own');
    const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
    assert.ok(/Changing a dial box reads the grid again by itself; a new thin below number needs this button/.test(help), 'the help for read the grid does not say what the button is for');
  },

  // A DIAL SOME SETTINGS HAVE NO VALUE FOR CAN BE KEPT WITH THEM (3.53.0,
  // owner 2026-09-04: "with step 2 - the shape of a dial with dMult selected,
  // how can the range 0.5-none be selected (i.e., everything except 0.25)?").
  // The rule could always say "or none" (lib/funnelset.js inRange); the
  // screen had no box for it, so a range on d silently dropped every market
  // setting. RULE FIVE.
  async aRangeCanKeepTheSettingsThatHaveNoValueForTheDial() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const step = page.slice(page.indexOf('function fStep2('), page.indexOf('\nfunction fStep3('));
    assert.ok(step.includes("const hasNone = r.groups.some((g) => String(g.value) === 'none');"), 'step 2 does not notice a none row');
    assert.ok(step.includes("const alsoNone = noneAlone || (Array.isArray(have.also) && have.also.map(String).includes('none'));"),
      'the tick does not read what the rule already holds - a range with "or none" on it, or none kept on its own');
    assert.ok(step.includes('${hasNone ? `<label class="c"><input type="checkbox" id="fAlsoNone" ${alsoNone ? \'checked\' : \'\'}> also keep none</label>` : \'\'}'),
      'the also keep none tick is not drawn beside the range boxes when the table has a none row');
    assert.ok(step.includes("if (!Number.isFinite(n)) return String(val) === 'none' && alsoNone;"), 'the count line does not count the none row when it is kept');
    const wire = page.slice(page.indexOf("const ar = $('#fAddRange');"), page.indexOf('const readGrid = () => {'));
    assert.ok(wire.includes("const alsoNone = !!($('#fAlsoNone') && $('#fAlsoNone').checked);"), 'pressing add this range does not read the tick');
    assert.ok(wire.includes("...(alsoNone ? { also: ['none'] } : {}) };"), 'the tick is not written into the rule as "or none"');
    assert.ok(wire.includes("chose: `${lo} to ${hi}${alsoNone ? ' or none' : ''}`"), 'the walk\'s note does not say none was kept');
    assert.ok(wire.includes("if (Number.isFinite(v) ? (!onlyNone && (lo === '' || v >= Number(lo)) && (hi === '' || v <= Number(hi))) : (String(val) === 'none' && none)) kept += n;"),
      'the live count does not follow the tick, or it still counts every number when both boxes are clear (3.62.0)');
    assert.ok(wire.includes("const an = $('#fAlsoNone');\n  if (an) an.onchange = countRange;"), 'ticking the box does not move the count');
    // and the rule underneath really keeps them
    const S4 = require('../lib/funnelset');
    const rows = [{ dMult: 0.25, label: 'a' }, { dMult: 0.5, label: 'b' }, { dMult: 2, label: 'c' }, { dMult: null, label: 'd' }];
    assert.deepStrictEqual(S4.applyRule(rows, { ranges: { dMult: { min: 0.5, max: null } }, allowed: {}, floors: {} }).map((r) => r.label), ['b', 'c'], 'a range alone drops the none row');
    assert.deepStrictEqual(S4.applyRule(rows, { ranges: { dMult: { min: 0.5, max: null, also: ['none'] } }, allowed: {}, floors: {} }).map((r) => r.label), ['b', 'c', 'd'], 'or none keeps it');
    assert.strictEqual(S4.ruleSentence({ ranges: { dMult: { min: 0.5, max: null, also: ['none'] } }, allowed: {}, floors: {} }), 'dMult 0.5 or more or none');
    const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
    assert.ok(/fAlsoNone: \{/.test(help) && /Without it a range drops them, because "none" is not a number/.test(help), 'the tick has no help, or the help does not say why it exists');
  },

  // THE SECOND CHECK GRID (3.54.0, owner order 2026-09-04: "a second check
  // box, after the highest scrambled average check box. exact same formatting
  // but it should show 'average scrambled average'"). Same squares, same
  // table, the average of the copies' averages in each.
  async theThirdStepShowsTheAverageScrambledAverageBesideTheHighest() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const step = page.slice(page.indexOf('function fStep3('), page.indexOf('\nfunction ', page.indexOf('function fStep3(') + 10));
    const hi = step.indexOf("'The check - the highest scrambled average in each square'");
    const avg = step.indexOf("table('The check - the average scrambled average in each square', (a, b) => `<td>${esc(checkAvgAt(a, b))}</td>`)");
    assert.ok(hi > 0 && avg > hi, 'the average grid is not drawn after the highest grid, through the same table helper');
    const fn = step.slice(step.indexOf('const checkAvgAt = (a, b) => {'), step.indexOf('};', step.indexOf('const checkAvgAt = (a, b) => {')));
    assert.ok(fn.includes('return fFix(fin.reduce((s, x) => s + x, 0) / fin.length);'), 'the second grid does not average the copies');
    assert.ok(fn.includes("(r.checkGrids || []).map((g) => (g.grid || []).find((x) => x.a === a && x.b === b))"), 'the second grid does not read the same squares as the first');
    assert.ok(step.includes("${kind === 'halves' ? '' : table('The check - the average scrambled average in each square'"), 'with no copies there is nothing to average, and the grid must not pretend otherwise');
  },

  // EVERY CLAUSE OF THE RULE CAN BE REMOVED (3.55.0, owner order 2026-09-04:
  // "fix the rule so that the irrelevant bit about false on 24/5 is entirely
  // removed"). A clause on a dial with one value on this unit had no control
  // that could take it out.
  async everyClauseOfTheRuleHasItsOwnRemove() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(page.includes('<div class="panel">${fRuleBox(d, st)}</div>'), 'the rule box is drawn without the walk, so it cannot list the clauses');
    const box = page.slice(page.indexOf('function fRuleClauses('), page.indexOf('\n// FOLLOWING A READING OF THE OTHER UNITS'));
    assert.ok(box.includes("out.push({ kind: 'ranges', key: dial, text: `${fDialLabel(dial)} ${span}${also}` });"), 'a range clause is not listed with its dial named');
    assert.ok(box.includes("out.push({ kind: 'allowed', key: dial, text: `${fDialLabel(dial)} is ${vals.join(' or ')}` });"), 'a word clause is not listed');
    assert.ok(box.includes("out.push({ kind: 'floors', key: field, text: `${field} at least ${spec.min}` });"), 'a floor is not listed');
    assert.ok(box.includes('<button data-frm="${esc(`${c.kind}|${c.key}`)}">Remove</button>'), 'a clause has no remove of its own');
    const wire = page.slice(page.indexOf("document.querySelectorAll('[data-frm]').forEach((b) => {"), page.indexOf("const cl = $('#fClear');"));
    assert.ok(wire.includes('delete st.rule[kind][key];'), 'remove does not drop the clause');
    assert.ok(wire.includes("fRecord({ n: st.step, what: `removed from the rule: ${gone}`, chose: 'removed' });"), 'a removal is not recorded in the walk\'s notes');
    assert.ok(wire.includes('fSave(); drawFunnel();'), 'a removal is not saved and redrawn');
  },

  // THE THREE TABLES ON STEP 3 LINE UP (3.55.0, owner order 2026-09-04: "line
  // up those two check tables and draw the cell boundaries").
  async theGridAndItsTwoCheckTablesLineUpWithCellBoundaries() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const step = page.slice(page.indexOf('function fStep3('), page.indexOf('\nfunction ', page.indexOf('function fStep3(') + 10));
    assert.ok(step.includes('<table class="fgrid"><thead>'), 'the grid tables carry no class to line them up by');
    for (const call of ["table('The grid - bold squares beat the check", "table(kind === 'halves' ? 'The check - each half", "table('The check - the average scrambled average in each square'"]) {
      assert.ok(step.includes(call), `not drawn through the one table helper: ${call}`);
    }
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.html'), 'utf8');
    assert.ok(/table\.fgrid \{ table-layout:fixed; \}/.test(css), 'the columns are not fixed, so they cannot line up across tables');
    assert.ok(/table\.fgrid th, table\.fgrid td \{ border:1px solid var\(--line\); \}/.test(css), 'the cell boundaries are not drawn');
    assert.ok(/  table \{ width:100%;/.test(css), 'the tables are not the same width, so fixed columns would still differ');
  },

  // A TIE BETWEEN TWO BLOCKS IS BROKEN BY THE CHECK, AND WHAT A BLOCK IS
  // WORTH IS PRINTED BESIDE IT (3.56.0, owner order 2026-09-04). Two
  // rectangles of the same size were settled by whichever the loops met
  // first. Money still decides nothing: it is shown, not obeyed.
  async aTieBetweenBlocksIsBrokenByTheCheckAndTheMoneyIsOnlyShown() {
    const F = require('../lib/funnel');
    // TWO one-square blocks, kept apart by a middle square that does not beat
    // its copies, so neither can grow and the tie is a real one. Both beat
    // both copies; the second sits further ahead of them, so it wins.
    const grid = (vals) => ({ aVals: ['x'], bVals: ['p', 'm', 'q'],
      grid: [{ a: 'x', b: 'p', mean: vals[0], n: 10, thin: false }, { a: 'x', b: 'm', mean: vals[1], n: 10, thin: false }, { a: 'x', b: 'q', mean: vals[2], n: 10, thin: false }] });
    const real = grid([10, 0, 4]);
    const copies = [grid([9.5, 5, 1]), grid([9.4, 5, 1.2])];
    const out = F.recommendBlock(real, copies, 'scrambles', { barPct: 100 });
    assert.deepStrictEqual([out.block.b.from, out.block.b.to], ['q', 'q'],
      'the tie went to the square found first, not to the one further ahead of its copies');
    assert.ok(out.block.lead > 0, 'the block does not carry the lead it was chosen by');
    // and money is not what chose it: q makes 4 where p makes 10
    const cell = (g, b) => g.grid.find((x) => x.b === b).mean;
    assert.ok(cell(real, 'p') > cell(real, 'q'), 'the fixture must have the richer square lose the tie, or it proves nothing');
    // how many copies each square beats travels with the answer
    assert.deepStrictEqual(out.beaten['x|p'], { won: 2, of: 2 });
    assert.deepStrictEqual(out.beaten['x|q'], { won: 2, of: 2 });
    assert.deepStrictEqual(out.beaten['x|m'], { won: 0, of: 2 }, 'the square that keeps the two blocks apart beats nothing');
    assert.deepStrictEqual(out.counting.sort(), ['x|p', 'x|q'], 'only the two squares that beat their copies count');
    // a bigger rectangle still wins whatever the leads say
    const wide = { aVals: ['x'], bVals: ['p', 'q'], grid: [{ a: 'x', b: 'p', mean: 10, n: 10, thin: false }, { a: 'x', b: 'q', mean: 9, n: 10, thin: false }] };
    const low = [{ aVals: ['x'], bVals: ['p', 'q'], grid: [{ a: 'x', b: 'p', mean: 1, n: 10, thin: false }, { a: 'x', b: 'q', mean: 1, n: 10, thin: false }] },
      { aVals: ['x'], bVals: ['p', 'q'], grid: [{ a: 'x', b: 'p', mean: 1.2, n: 10, thin: false }, { a: 'x', b: 'q', mean: 2, n: 10, thin: false }] }];
    const two = F.recommendBlock(wide, low, 'scrambles', { barPct: 100 });
    assert.strictEqual(two.block.squares, 2, 'a bigger rectangle must still win — the lead only breaks ties');
    // the page prints what each block is worth, and never chooses by it
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const step = page.slice(page.indexOf('function fStep3('), page.indexOf('\nfunction ', page.indexOf('function fStep3(') + 10));
    assert.ok(step.includes('const worthOf = (a0, a1, b0, b1) => {') && step.includes('avg test ${fFix(sum / n)} over ${n.toLocaleString()} settings'),
      'the page does not say what a block is worth');
    assert.ok(step.includes('${blk.squares} square(s).${worthOf(blk.a.from, blk.a.to, blk.b.from, blk.b.to)}'), 'the outlined block does not carry its money');
    assert.ok(step.includes('${esc(pk.b1)}.</b>${worthOf(pk.a0, pk.a1, pk.b0, pk.b1)}'), 'the owner\'s own block does not carry its money');
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'funnel.js'), 'utf8');
    const fn = lib.slice(lib.indexOf('function recommendBlock('), lib.indexOf('\nfunction ladderFor('));
    assert.ok(!/moneyOf|avgTest|\bmoney\b/.test(fn), 'the recommendation reads money — it must come from the check alone');
    // every square carries how many copies it beats, in step 2's words
    assert.ok(step.includes('beats ${bt.won} of ${bt.of}'), 'a square does not say how many copies it beats');
    const s2 = page.slice(page.indexOf('function fStep2('), page.indexOf('\nfunction fStep3('));
    assert.ok(/- beats \$\{v\.beaten == null \? '-' : v\.beaten\} of \$\{c\.length\}/.test(s2), 'step 2 no longer says it that way, so the two screens have drifted');
  },

  // STEP 6 SAYS WHAT ITS TWO LIMITS ARE LIMITS ON (3.57.0, owner order
  // 2026-09-04: "how much are we trading per trade? how much can be on the
  // table at once maximum? that's a context for size of loss that would be
  // acceptable ... fewest trades? over what time period? ... i'm ok with 20
  // trades in a year. or 5 in three months. but not 5 in a year").
  //
  // A dollar limit means nothing without the stake, and a trade count means
  // nothing without the window it was counted over. Both are read off the
  // engine and the set -- never typed onto the page.
  async theSixthStepSaysWhatItsLimitsAreLimitsOn() {
    const stages = require('../lib/stages');
    const { NOTIONAL } = require('../lib/paper');
    const day = 86400000;
    const from = Date.UTC(2025, 0, 6);
    // A UNIT'S TEST WINDOW, worked out from the sealed bounds its record
    // carries and the split the run used: the sealed part is the last 13% of
    // the whole, the held-back part the last 15% of what is left, and the
    // test window the 15% before that.
    const weekly = stages.testWindowOfUnit({ geometry: 'weekly-8d', reserve: { chunks: 20, fromTs: from, toTs: from + 20 * 7 * day } });
    assert.ok(weekly, 'a unit with sealed bounds has no test window worked out');
    assert.strictEqual(weekly.chunks, 20, '20 sealed chunks of 13% means 134 work chunks, and 15% of those is 20');
    assert.strictEqual(Math.round(weekly.days), 140, 'twenty weekly chunks is 140 days');
    assert.strictEqual(weekly.toTs, from - 20 * 7 * day, 'the window ends where the held-back part begins, which is 20 chunks before the sealed part');
    assert.ok(weekly.perYearFactor > 2.5 && weekly.perYearFactor < 2.7, `140 days is about 2.6 of them in a year, not ${weekly.perYearFactor}`);
    // a daily unit steps a day, not a week, so the same chunk count is a
    // shorter window -- the step is the unit's own
    const daily = stages.testWindowOfUnit({ geometry: 'daily-4d', reserve: { chunks: 60, fromTs: from, toTs: from + 60 * day } });
    assert.strictEqual(Math.round(daily.days), 60, 'sixty daily chunks is 60 days');
    // AND A REAL RECORD CARRIES NO END TIMESTAMP (owner, 2026-09-04: "'The
    // window the trades were counted over cannot be worked out' ... i don't
    // believe you"). The stored bounds are { chunks, fromTs } and nothing
    // else, and demanding a toTs made every set on the box say it could not
    // be worked out. The step comes from the shape; the anchor is where the
    // sealed window begins.
    const real = stages.testWindowOfUnit({ geometry: 'weekly-8d', reserve: { chunks: 46, fromTs: 1758499200000 } });
    assert.ok(real, 'a record with chunks and fromTs and no toTs must still give a window — that is the shape every record on the box has');
    assert.strictEqual(new Date(real.fromTs).toISOString().slice(0, 10), '2023-12-18');
    assert.strictEqual(new Date(real.toTs).toISOString().slice(0, 10), '2024-11-04');
    assert.strictEqual(Math.round(real.days), 322, '46 weekly chunks is 322 days');
    // a set with no sealed bounds says so rather than inventing a window
    assert.strictEqual(stages.testWindowOfUnit({ geometry: 'daily-1d', reserve: null }), null);
    assert.strictEqual(stages.testWindowOfUnit({ geometry: 'daily-1d', reserve: { chunks: 10 } }), null, 'no anchor, no window');
    // THE EXPOSURE over the units a reading covers
    const ex = stages.exposureOf({ params: { windowLayout: 'reserve61' } }, [
      { trade: 'XRPUSDT', geometry: 'weekly-8d', reserve: { chunks: 20, fromTs: from, toTs: from + 20 * 7 * day } },
      { trade: 'BTCUSDT', geometry: 'daily-4d', reserve: { chunks: 60, fromTs: from, toTs: from + 60 * day } },
    ]);
    assert.strictEqual(ex.stake, NOTIONAL, 'the stake is the engine\'s, never a number typed on the page');
    assert.strictEqual(ex.stake, 100);
    assert.strictEqual(ex.coins, 2, 'two coins');
    // ON THE TABLE AT ONCE IS NOT ONE PER COIN (owner, 2026-09-04: "which is
    // of course not true. in the case of the weekly shape it's true"). With a
    // 137-hour hold the weekly unit (a start every 168 hours) holds one, and
    // the daily one (a start every 24) holds six.
    assert.strictEqual(ex.holdHours, null, 'with no hold named nothing about overlap can be claimed');
    const held = stages.exposureOf({ params: { windowLayout: 'reserve61' } }, [
      { trade: 'XRPUSDT', geometry: 'weekly-8d', reserve: { chunks: 20, fromTs: from, toTs: from + 20 * 7 * day } },
      { trade: 'BTCUSDT', geometry: 'daily-4d', reserve: { chunks: 60, fromTs: from, toTs: from + 60 * day } },
    ], { holdHours: 137 });
    assert.deepStrictEqual(held.perUnit.map((u) => [u.stepHours, u.atOnce, u.mostAtOnce]), [[168, 1, 100], [24, 6, 600]],
      'a weekly unit holds one at a time at a 137-hour hold; a daily one holds six');
    assert.strictEqual(held.mostAtOnce, 700, 'the most on the table is every unit\'s own overlap added up, not one stake per coin');
    const short = stages.exposureOf({ params: { windowLayout: 'reserve61' } },
      [{ trade: 'BTCUSDT', geometry: 'daily-4d', reserve: { chunks: 60, fromTs: from, toTs: from + 60 * day } }], { holdHours: 17 });
    assert.strictEqual(short.perUnit[0].atOnce, 1, 'a 17-hour hold on a daily start holds one at a time');
    assert.strictEqual(short.mostAtOnce, 100);
    assert.strictEqual(Math.round(ex.window.days), 140, 'the window spans the longest of the units\' own');
    assert.strictEqual(Math.round(20 * ex.window.perYearFactor), 52, '20 trades over 140 days is about 52 a year');
    // the same coin twice under two shapes is ONE coin on the table
    const twice = stages.exposureOf({ params: { windowLayout: 'reserve61' } }, [
      { trade: 'XRPUSDT', geometry: 'weekly-8d', reserve: { chunks: 20, fromTs: from, toTs: from + 20 * 7 * day } },
      { trade: 'XRPUSDT', geometry: 'daily-4d', reserve: { chunks: 60, fromTs: from, toTs: from + 60 * day } },
    ]);
    assert.strictEqual(twice.coins, 1, 'one coin under two shapes is one coin');
    // ...but two shapes of it can both be in a trade, so what is on the table
    // is both of them, not one
    const twiceHeld = stages.exposureOf({ params: { windowLayout: 'reserve61' } }, [
      { trade: 'XRPUSDT', geometry: 'weekly-8d', reserve: { chunks: 20, fromTs: from, toTs: from + 20 * 7 * day } },
      { trade: 'XRPUSDT', geometry: 'daily-4d', reserve: { chunks: 60, fromTs: from, toTs: from + 60 * day } },
    ], { holdHours: 65 });
    assert.deepStrictEqual(twiceHeld.perUnit.map((u) => u.atOnce), [1, 3], 'a 65-hour hold is one weekly start and three daily ones');
    assert.strictEqual(twiceHeld.mostAtOnce, 400, 'one coin under two shapes can still have four stakes on the table');
    // and a set the window cannot be worked out for says why
    const none = stages.exposureOf({ params: { windowLayout: 'split70' } }, [{ trade: 'X', geometry: 'daily-1d', reserve: null }]);
    assert.strictEqual(none.window, null);
    assert.ok(/only reserve61 records the bounds/.test(none.why), `it must say why: ${none.why}`);
    // ---- and the step prints it ----
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const step = page.slice(page.indexOf('function fStep6('), page.indexOf('\nfunction ', page.indexOf('function fStep6(') + 10));
    assert.ok(step.includes('Every trade stakes\n      <b>$${Number(ex.stake).toLocaleString()}</b>'), 'the step does not say what a trade stakes');
    assert.ok(!/holds one position at a time/.test(step), 'the step says a coin holds one position at a time, which is false whenever the hold outruns the gap between starts');
    assert.ok(step.includes('so a coin can hold more than one at a time\n      whenever the hold runs longer than the gap between starts'),
      'the step does not say that positions overlap');
    // ONE LINE, NEVER ONE CLAUSE PER UNIT (3.107.0, owner order: "having 300 of
    // these is useless"). The total across every unit, and the single heaviest
    // one named. Neither grows with the number of units, and the reading is
    // checked for the shape it used to have so it cannot come back.
    assert.ok(!/perUnit\.map\(/.test(step), 'the step prints a clause for every coin and shape again');
    assert.ok(/can be on the table at once,\s*\n\s*if every one of them is in a trade/.test(step),
      'the step does not say how much can be on the table at once across the reading');
    assert.ok(step.includes('The heaviest single one is <b>${esc(worst.name)}</b>'), 'the step does not name the heaviest single coin and shape');
    assert.ok(step.includes("perUnit.reduce((a, b) => ((Number(b.mostAtOnce) || 0) > (Number(a.mostAtOnce) || 0) ? b : a))"),
      'the heaviest one is picked by something other than how much it can hold at once');
    assert.ok(/across the <b>\$\{Number\(perUnit\.length\)\.toLocaleString\(\)\}<\/b> coin and shape\(s\)/.test(step),
      'the step does not say how many coin and shapes the number covers');
    assert.ok(step.includes('up to <b>$${Number(ex.mostAtOnce).toLocaleString()}</b> can be on the table at once'),
      'the step does not say what can be on the table across the reading');
    // and when it is not known it says so rather than printing nothing
    assert.ok(step.includes("'how much can be on the table at once is not known.'"),
      'a reading with no total prints silence, which reads as nothing being on the table');
    assert.ok(step.includes('With the longest hold your rule still allows, <b>${Number(ex.holdHours).toLocaleString()} hours</b>'),
      'the step does not say which hold the overlap was worked out at');
    assert.ok(step.includes('The trades are counted over ${fDay(w.fromTs)} to ${fDay(w.toTs)}'), 'the step does not name the window the trades were counted over');
    assert.ok(step.includes('${Math.round(w.weeks)} weeks, or ${Math.round(w.days)} days'), 'the step does not say how long that window is');
    assert.ok(/is\s+about <b>\$\{w\.perYearFactor \? Math\.round\(\(Number\(tr\.min\) \|\| 20\) \* w\.perYearFactor\)/.test(step),
      'the step does not put a trade count on a yearly footing');
    assert.ok(step.includes('The window the trades were counted over cannot be worked out'), 'a set with no bounds is not told that it has none');
    // the numbered steps, and the first of them says press rebuild FIRST
    const how = step.slice(step.indexOf('<ol class="note fhow">'), step.indexOf('</ol>'));
    assert.strictEqual(how.split('<li>').length - 1, 5, 'step 6 does not carry its five numbered steps');
    // 3.102.0: the press moved above the steps and preps the whole record set,
    // so step 6 points AT it rather than holding it. Both halves are checked:
    // the step names the press, and it says the numbers are not this step's.
    assert.ok(/These numbers come from <b>Work out the test history numbers<\/b>, at the top of this screen/.test(how),
      'the steps do not point at the press that works the numbers out');
    assert.ok(!/<button id="fRebuild"/.test(step), 'the press is on step 6 again — it preps the whole record set and belongs above the steps');
    assert.ok(how.includes('It changes no rule and no record'), 'the steps do not say that pressing it is safe');
    assert.ok(how.includes('in dollars, per coin'), 'the steps do not say what the losing streak is measured in');
    assert.ok(how.includes('counted over the window named above'), 'the steps do not say what the trade count is counted over');
    for (const control of ['<b>Work out the test history numbers</b>', '<b>worst losing streak allowed</b>', '<b>fewest trades</b>', '<b>Add these limits to the rule</b>']) {
      assert.ok(how.includes(control), `the steps do not name ${control}`);
    }
    for (const label of ['worst losing streak allowed', 'fewest trades', 'Add these limits to the rule']) {
      assert.ok(step.includes(`>${label}<`) || step.includes(`${label}<input`), `the steps name "${label}", which step 6 does not draw`);
    }
    // 3.102.0: the press it names is above the steps, so that is where the
    // label and the line beside it are checked.
    // 3.108.5: the press moved into fRebuildPress so a refusal on this step
    // can carry a copy of it; the slice starts there.
    const panel6 = page.slice(page.indexOf('function fRebuildPress(d, named) {'), page.indexOf('function fStep6(d, st, r) {'));
    assert.ok(panel6.includes('>Work out the test history numbers</button>'), 'the steps name a press that is drawn nowhere on this screen');
    // 3.81.0: the line beside the button is no longer one fixed sentence -- it
    // says how many settings already carry the numbers, the progress while it
    // works, and the cpu load with it. One wording, drawn through fRichLine, so
    // the first draw and every poll say the same thing.
    assert.ok(panel6.includes('${esc(fRichLine(d))}'), 'the line beside the button no longer says what the press would do');
    // the trades ladder is put on a yearly footing and the dollar one is not
    assert.ok(step.includes("fLadder('trades', (r.ladders || {}).avgTrades, 'at least', ex, d)"), 'the trades ladder is not given the window');
    // AND BOTH LADDERS ARE HANDED THE READ (3.108.5), because a ladder that
    // refuses for want of the numbers now carries the press that works them
    // out, and the press has to know whether it is already going.
    const lad6 = page.slice(page.indexOf('function fLadder(name, l, word, ex, d) {'), page.indexOf('const fPerYear = (n, ex) =>'));
    assert.ok(lad6.includes('${fRebuildPress(d, false)}'),
      'the refusal names a press and does not carry one, so there is no way to act on it from this step');
    assert.ok(!/press Work out the test history numbers first/.test(lad6),
      'the refusal still sends the owner to a press that is not on the screen while a walk is being used');
    // BOTH COPIES SAY THE SAME THING while it runs, because they are one press
    // drawn twice. One of them reading the old line is the drift a shared
    // control exists to stop.
    assert.ok(page.includes("const fRebuildSay = (text) => document.querySelectorAll('[data-frebuildmsg]')"),
      'the two copies of the press do not say the same thing, so one sits on a stale line while the other works');
    assert.ok(page.includes("const rbs = [...document.querySelectorAll('[data-frebuild]')];")
      && page.includes('rbs.forEach((b) => { b.disabled = true; });'),
    'the two copies of the press are not wired together, so one stays live while the other works');
    assert.ok(step.includes("fLadder('worst losing streak', (r.ladders || {}).maxDrawdown, 'at most', null, d)"), 'the dollar ladder must not be read as a rate');
    const lad = page.slice(page.indexOf('function fLadder('), page.indexOf('const F_HOLD_SHOW = ['));
    assert.ok(lad.includes('${ex ? fPerYear(x.at, ex) : \'\'}'), 'a rung does not say what it comes to a year');
    // 3.108.5: it no longer SAYS what to press, it carries the press. The
    // section that holds the other copy is not on the screen while a walk is
    // being used, so naming it from here named something unreachable.
    assert.ok(lad.includes('${fRebuildPress(d, false)}'), 'the empty ladder gives no way to work the numbers out');
    // the answer carries it, for the units the reading covers
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    assert.ok(lib.includes('exposure: exposureOf(doc, mineOnly.length ? mineOnly : (sealed.units || []),'), 'step 6\'s answer does not carry the exposure');
    assert.ok(lib.includes("{ holdHours: rows.reduce((a, r) => (Number.isFinite(Number(r.tHours)) && Number(r.tHours) > a ? Number(r.tHours) : a), 0) })"),
      'the overlap is not worked out at the longest hold the SURVIVORS still carry, so it stands at the block\'s widest whatever the rule says');
    assert.ok(lib.includes("const { NOTIONAL } = require('./paper');"), 'the stake is not read from the engine');
    const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
    assert.ok(/Press it FIRST, before anything below/.test(help), 'the help for the button does not say to press it first');
    assert.ok(/in dollars, per coin - the deepest the running total ever sat below its own best point/.test(help), 'the help for the losing streak does not say what it measures');
    assert.ok(/counted over the window named at the top of this step - not over a year/.test(help), 'the help for the trade count does not say what it is counted over');
  },

  // THE PRESS NAMES THE RULE (3.57.1, owner report 2026-09-04: pressing "work
  // out the missing numbers" answered "FAILED -- nothing changed. nothing was
  // asked for"). The page sent `{ labels: [] }` -- an empty list -- and the
  // service refuses an empty ask, so the button had never once worked. Two
  // source-scanning tests covered this step and neither pressed it.
  async pressingWorkOutTheMissingNumbersPrepsTheWholeRecordSet() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const press = page.slice(page.indexOf("const rbs = [...document.querySelectorAll('[data-frebuild]')];"),
      page.indexOf("const rbs = [...document.querySelectorAll('[data-frebuild]')];") + 1400);
    assert.ok(!/labels: \[\]/.test(press), 'the press asks for an empty list of settings again, which the service refuses');
    // 3.102.0: the whole board is prepped, so the press has nothing to pick and
    // nothing to name. A rule sent here would be a rule that decides what gets
    // priced, which is the behaviour this release took out.
    assert.ok(/\/rebuild`, \{\}, WHERE_FUNNEL\)/.test(press),
      'the press names a rule, a unit or a bar again — the press preps the whole record set and has nothing to choose');
    // 3.81.0: the press starts a run and the watcher reads the answer, so the
    // tables-not-built reply is handled where the answer arrives
    const watch = page.slice(page.indexOf('async function fRichWatch(st) {'), page.indexOf('async function fHoldPoll(st) {'));
    assert.ok(watch.includes('if (out.totalling || out.waiting) {'), 'a set whose tables are not built yet is reported as a failure rather than as work in flight');
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    // AND THE HELPER THAT PICKED THE SURVIVORS IS GONE, not left standing with
    // nothing calling it (owner order 2026-09-10: "get rid of that call").
    assert.ok(!lib.includes('survivorLabelsOf'), 'the helper that worked out the rule\'s survivors is still in the engine with nothing calling it');
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(/app\.post\('\/api\/funnel\/:id\/rebuild', \(req, res\) => \{\s*try \{ return res\.json\(stages\.funnelRichStart\(/.test(srv),
      'the door does something other than start the run and hand back how far it is');
    const route = lib.slice(lib.indexOf('function funnelRichStart(id, state = {}) {'), lib.indexOf('function funnelRichStatus(id) {'));
    // THE WHOLE BOARD (3.102.0). Part 4 asks whether ranking the settings on one
    // part of the test window still picks winners on another, and a ranking over
    // the survivors of a rule already made by ranking is no test of anything.
    assert.ok(route.includes("const board = await funnelBoard(String(id), t, 'all');"),
      'the press reads something other than the whole board, so the numbers beside a set cover whatever a rule happened to keep');
    assert.ok(route.includes('const labels = (board.all || []).map((r) => String(r.label));'), 'it prices something other than every setting on that board');
    assert.ok(/this record set has no settings on its board/.test(route),
      'a set with nothing on its board must say so in those words, not "nothing was asked for"');
    assert.ok(/\.catch\(\(err\) => \{ run\.error = String\(\(err && err\.message\) \|\| err\); \}\);/.test(route),
      'a refusal must land on the run as an error — a run that neither finished nor failed holds the slot for ever');
    // AND THE REBUILD CHECKS ITSELF AGAINST THE SWEEP (3.57.2, owner question
    // 2026-09-04 about "NOT checked against the sweep (the caller supplied
    // nothing to check against)"). The check only ran when the CALLER supplied
    // the stored figures and the page has none, so it never ran. The board it
    // just read carries them, so the check always has something to check --
    // over every setting now, which is a stronger check than the one it replaced.
    assert.ok(route.includes('if (r.avgTest != null && Number.isFinite(Number(r.avgTest))) expect[String(r.label)] = Number(r.avgTest);'),
      'the board is read without the money the sweep stored, so nothing can be checked against it');
    assert.ok(route.includes('const proof = proveRebuild(got.perSetting, expect);'), 'the proof is handed something other than what was just read');
    // a reading of the ranking was read FROM these numbers, so it goes when they move
    assert.ok(route.includes('funnelRankHoldForget(doc.id);'),
      'a ranking already read is served beside numbers it never saw');
    // and the proof itself still refuses to claim a check it did not make
    const prove = lib.slice(lib.indexOf('function proveRebuild('), lib.indexOf('function proveRebuild(') + 700);
    assert.ok(prove.includes("why: 'the caller supplied nothing to check against'") && prove.includes('ran: false'),
      'a rebuild with nothing to check against must still say it was not checked');
    // AND THE PRESS IS DEAD ON WHAT IT ACTUALLY DID: counted over the whole
    // board, not the survivors, or it reads as done the moment a rule happens
    // to keep only settings an earlier walk priced.
    assert.ok(lib.includes('const richOn = { have: all.filter(richHas).length, need: all.length, run: funnelRichStatus(id) };'),
      'how much of the press\'s work is done is counted over the rule\'s survivors again');
    assert.ok(/const fRichOf = \(d\) => \(d && d\.richOn\) \|\| \{ have: 0, need: Number\(\(d && d\.of\) \|\| 0\), run: null \};/.test(page),
      'a reply carrying no count falls back to the survivor count, so the press ghosts on a board it has never touched');
  },

  // THE PROOF COMPARES LIKE WITH LIKE, AND COUNTS WHAT IT FOUND (3.57.3,
  // owner report 2026-09-04: "20 setting(s) came back different from what the
  // sweep stored - this is not the same run"). It was the same run. On a
  // unit's board the stored money is THAT UNIT'S; the rebuild's own figure is
  // the average over every unit of the set. Measured on the box, 120,291 of
  // 137,760 settings differ between the two, so the check could only disagree.
  async theProofComparesTheFigureTheBoardActuallyHolds() {
    // one setting, two units: this unit made 4, the other made 40, so the
    // average over both is 22 and none of the three is the same number
    const per = new Map([['t65 active', { label: 't65 active', avgTest: 22,
      units: [{ trade: 'XRPUSDT', ctx1: null, ctx2: null, geometry: 'weekly-8d', pnl: 4 },
        { trade: 'ZECUSDT', ctx1: null, ctx2: null, geometry: 'daily-2d', pnl: 40 }] }]]);
    const stored = { 't65 active': 4 };                 // what THIS unit's board holds
    // read on the unit: it matches, because it is the same figure
    const onUnit = stages.proveRebuild(per, stored, undefined, 'XRPUSDT|||weekly-8d');
    assert.strictEqual(onUnit.ran, true);
    assert.strictEqual(onUnit.matched, 1, 'a unit board\'s stored money must be checked against that unit\'s rebuilt money');
    assert.strictEqual(onUnit.differed, 0);
    assert.strictEqual(onUnit.onUnit, 'XRPUSDT|||weekly-8d', 'the answer says which board it was checked on');
    // read on all units together: the average is the right figure there
    const blended = stages.proveRebuild(per, { 't65 active': 22 });
    assert.strictEqual(blended.matched, 1, 'all units together is checked against the average');
    assert.strictEqual(blended.onUnit, null);
    // and the old way -- one unit's stored money against the average -- is the
    // false alarm this fixes
    const wrong = stages.proveRebuild(per, stored);
    assert.strictEqual(wrong.differed, 1, 'the fixture must reproduce the false alarm, or it proves nothing');
    // a setting the rebuild priced on other units but not this one is not a
    // disagreement: it is counted and said
    const missing = stages.proveRebuild(per, stored, undefined, 'AAAUSDT|||daily-1d');
    assert.strictEqual(missing.checked, 0);
    assert.strictEqual(missing.differed, 0, 'no figure for this unit is not a disagreement');
    assert.strictEqual(missing.noFigure, 1);
    assert.ok(/carry no money for this unit/.test(missing.why), missing.why);
    // THE COUNT IS THE COUNT, NOT THE LENGTH OF A CAPPED LIST
    const many = new Map();
    const expect = {};
    for (let i = 0; i < 30; i++) { many.set(`s${i}`, { label: `s${i}`, avgTest: i }); expect[`s${i}`] = i + 5; }
    const capped = stages.proveRebuild(many, expect);
    assert.strictEqual(capped.differed, 30, 'the true number of disagreements must travel');
    assert.strictEqual(capped.mismatches.length, 20, 'and the list stays capped for the screen');
    assert.strictEqual(capped.matched, 0);
    // the press names the board, and the page prints the count rather than the
    // list. 3.81.0 moved the press out of the route and into funnelRichStart;
    // the board it names has to travel with it.
    const lib2 = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    // 3.102.0: the press reads the WHOLE board, so the money it checks against
    // is the blend's own -- the same figure the rebuild works out, averaged over
    // every unit. There is no single board left to name, and naming one would be
    // the false alarm this test was written about, pointing the other way.
    assert.ok(lib2.includes('const proof = proveRebuild(got.perSetting, expect);'), 'the press hands the proof something other than what it just read');
    assert.ok(!lib2.includes("const onUnit = state.unit && String(state.unit) !== 'all' ? String(state.unit) : null;"),
      'the press still resolves a board to check on, which it no longer reads');
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(page.includes('const off = pr.differed == null ? (pr.mismatches || []).length : pr.differed;')
      && page.includes('`${off} of ${pr.checked} setting(s) came back different from what the sweep stored'),
      'the page still reports the length of a capped list as the count');
  },

  // ---- THE STAGE 4 RECORD SETS ON THE FUNNEL (3.58.0) ----------------------
  //
  // Owner order, 2026-09-04: a coin and shape with Stage 4 record sets cut from
  // it opens on one of them, through a drop-down that replaces the rule-building
  // heading; `new rule` puts the seven steps back.
  async theFunnelOffersTheStageFourSetsCutFromTheCoinAndShape() {
    const f = await unitFixture();
    try {
      const rule = { ranges: {}, allowed: { gate: ['active'] }, floors: {} };
      const cut = await stages.cutFunnelSet(f.id, { unit: f.keys[0], rule, target: 2 });
      try {
        // on the board it was cut from, it is offered
        const on = await stages.funnelRead(f.id, { step: 1, unit: f.keys[0], rule: { ranges: {}, allowed: {}, floors: {} } });
        assert.ok(Array.isArray(on.cuts), 'the read does not carry the Stage 4 sets of the board on screen');
        assert.ok(on.cuts.some((c) => c.id === cut.id), 'the set cut from this coin and shape is not offered on it');
        assert.ok(on.cuts.find((c) => c.id === cut.id).mine === true, 'the set does not know it belongs to the board it was cut from');
        // ON ANOTHER COIN AND SHAPE OF THE SAME STAGE 3 SET IT IS STILL OFFERED
        // (3.104.1, owner order): a list narrowed to the four boxes above it can
        // only be used by somebody who already knows what is in it. It is
        // offered, and it says it is not this board's, which is what lets the
        // screen name the coin and shape it really belongs to.
        const other = await stages.funnelRead(f.id, { step: 1, unit: f.keys[1], rule: { ranges: {}, allowed: {}, floors: {} } });
        const seen = (other.cuts || []).find((c) => c.id === cut.id);
        assert.ok(seen, 'a set cut from this stage 3 record set is unreachable unless the four boxes are set back to what they were');
        assert.strictEqual(seen.mine, false, 'a set from another coin and shape is not marked as such, so the screen cannot say whose it is');
        assert.strictEqual(seen.unit, f.keys[0], 'the set does not carry the coin and shape it was cut on');
        // the blended board is a board of its own: the set is still REACHABLE
        // from it, and still says it is not the blend's
        const blend = await stages.funnelRead(f.id, { step: 1, unit: 'all', rule: { ranges: {}, allowed: {}, floors: {} } });
        const onBlend = (blend.cuts || []).find((c) => c.id === cut.id);
        assert.ok(onBlend, 'the blended board cannot reach a set cut from its own stage 3 record set');
        assert.strictEqual(onBlend.mine, false, 'a unit set reads as the blended board\'s own');
        // showing a set reads NO step: the grid and the region are minutes of
        // work for a screen that is not drawn
        const asCut = await stages.funnelRead(f.id, { step: 3, unit: f.keys[0], dialA: 'tHours', dialB: 'gate', view: 'cut', rule: { ranges: {}, allowed: {}, floors: {} } });
        assert.equal(asCut.reading, null, 'the Stage 4 view still pays for a step reading nothing draws');
        assert.ok(asCut.check && asCut.units && Array.isArray(asCut.cuts), 'the Stage 4 view is not given the check, the boards or the sets');
      } finally {
        try { fs.rmSync(path.join(SETS_DIR, `${cut.id}.json`), { force: true }); } catch (_) { /* fixture */ }
      }
    } finally { f.cleanup(); }
  },

  // THE ROWS ARE WHAT THE SET WROTE DOWN. A set is a decision; re-deriving its
  // membership from its rule would show today's answer under yesterday's name.
  // The rule is re-applied once and the disagreement REPORTED, never acted on.
  async aStageFourSetsRowsAreTheSettingsItWroteDownNotWhatItsRuleFindsToday() {
    const f = await unitFixture();
    try {
      const rule = { ranges: {}, allowed: { gate: ['active'] }, floors: {} };
      const cut = await stages.cutFunnelSet(f.id, { unit: f.keys[0], rule, target: 2 });
      const file = path.join(SETS_DIR, `${cut.id}.json`);
      try {
        const first = await stages.funnelSetRows(cut.id, {});
        assert.equal(first.total, cut.counts.survivors, 'the table holds a different number of settings from the count the set recorded');
        assert.ok(first.rows.every((r) => cut.ruleSentence != null && typeof r.label === 'string'), 'rows come back without their setting names');
        assert.ok(first.record.same, 'a set just cut does not reproduce itself');
        assert.ok(first.rows.every((r) => r.avgTest != null), 'the rows carry no money, so the board was never read for them');
        // now take one survivor OFF the record: the table must follow the
        // record, and must say the rule no longer gives this list
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        const dropped = doc.survivors.pop();
        doc.counts.survivors = doc.survivors.length;
        fs.writeFileSync(file, JSON.stringify(doc));
        const after = await stages.funnelSetRows(cut.id, {});
        assert.equal(after.total, doc.survivors.length, 'the table shows what the rule finds today rather than what the set kept');
        assert.ok(!after.rows.some((r) => r.label === dropped.label), 'a setting the set does not name is in its table');
        assert.ok(!after.record.same, 'the set no longer reproduces itself and the screen is not told');
        assert.equal(after.record.now, first.total, 'the count the rule gives today is not reported');
        assert.equal(after.record.had, doc.survivors.length, 'the count the set wrote down is not reported');
        // a survivor whose setting has left the board is shown, marked, never dropped
        doc.survivors.push({ si: 999, label: 'a setting that is not on this board' });
        doc.counts.survivors = doc.survivors.length;
        fs.writeFileSync(file, JSON.stringify(doc));
        const gone = await stages.funnelSetRows(cut.id, {});
        assert.equal(gone.record.gone, 1, 'a survivor no longer on the board is not counted');
        assert.ok(gone.rows.some((r) => r.gone), 'a survivor no longer on the board is dropped from the table instead of shown as missing');
      } finally { try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ } }
    } finally { f.cleanup(); }
  },

  // Sorting orders the WHOLE set before the page is cut, so page one really is
  // the top of everything; and it never changes who is in it.
  async theStageFourTableSortsTheWholeSetAndSendsEveryRowOfIt() {
    const f = await unitFixture();
    try {
      const rule = { ranges: {}, allowed: {}, floors: {} };
      const cut = await stages.cutFunnelSet(f.id, { unit: f.keys[0], rule });
      const file = path.join(SETS_DIR, `${cut.id}.json`);
      try {
        const all = await stages.funnelSetRows(cut.id, { n: 500 });
        assert.ok(all.total >= 4, `the fixture should keep every setting, got ${all.total}`);
        const down = await stages.funnelSetRows(cut.id, { n: 500, sort: 'avgTest', dir: 'desc' });
        const up = await stages.funnelSetRows(cut.id, { n: 500, sort: 'avgTest', dir: 'asc' });
        const m = (x) => x.rows.map((r) => r.avgTest);
        assert.deepEqual(m(down), [...m(down)].sort((a, b) => b - a), 'high to low does not order the rows high to low');
        assert.deepEqual(m(up), [...m(up)].sort((a, b) => a - b), 'low to high does not order the rows low to high');
        assert.deepEqual([...down.rows.map((r) => r.label)].sort(), [...up.rows.map((r) => r.label)].sort(),
          'flipping the order changes WHO is in the table, which a sort must never do');
        // EVERY ROW COMES BACK (3.61.0, owner order: a page selector under a box
        // that scrolls is a waste of space). Nothing the caller says can cut it
        // into pages any more, and nothing was clipped.
        assert.equal(all.rows.length, all.total, 'the reply holds fewer rows than the set does, so the box cannot scroll to them');
        assert.equal(all.clipped, 0, 'a set this size reports rows it did not send');
        const asked = await stages.funnelSetRows(cut.id, { n: 2, from: 2, sort: 'avgTest', dir: 'desc' });
        assert.equal(asked.rows.length, asked.total, 'asking for a page of two still cuts the set into pages');
        assert.deepEqual(asked.rows.map((r) => r.label), down.rows.map((r) => r.label), 'and it is the same sorted whole');
        // a column nothing can be sorted by falls back rather than throwing
        const junk = await stages.funnelSetRows(cut.id, { n: 500, sort: 'notAColumn' });
        assert.equal(junk.sort, 'avgTest', 'an unknown column is not refused for the default one');
      } finally { try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ } }
    } finally { f.cleanup(); }
  },

  // A dial the rule pinned is the same on every row: said once above the table,
  // never repeated down a column of one repeated value.
  async aDialTheRuleFixedIsSaidOnceAboveTheStageFourTable() {
    const f = await unitFixture();
    try {
      const rule = { ranges: {}, allowed: { gate: ['active'] }, floors: {} };
      const cut = await stages.cutFunnelSet(f.id, { unit: f.keys[0], rule });
      const file = path.join(SETS_DIR, `${cut.id}.json`);
      try {
        const out = await stages.funnelSetRows(cut.id, { n: 500 });
        assert.ok(!out.varying.includes('gate'), 'a dial the rule pinned still gets a column of one repeated value');
        assert.equal(out.fixed.gate, 'active', 'the pinned dial is not named with the value every row carries');
        assert.ok(out.varying.includes('tHours'), 'a dial that still varies among the survivors has no column');
        assert.ok(!('tHours' in out.fixed), 'a dial that varies is also reported as fixed, so the line above the table would lie');
        // and what the table can show at all is read off the rows, never assumed
        assert.ok(out.has.avgTest && out.has.avgHold, 'the money columns are not reported as available');
        assert.ok(!out.has.maxDrawdown, 'a set with nothing rebuilt reports the rebuilt columns as available, so the table draws dashes');
      } finally { try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ } }
    } finally { f.cleanup(); }
  },

  // The heading of a Stage 4 record set is DISPLAY ONLY except for the rename:
  // no step buttons, no rule box, nothing that writes.
  theStageFourScreenIsDisplayOnlyExceptForTheRename() {
    const page = src('public/construct.js');
    const cut = page.slice(page.indexOf('function fCutPickBox('), page.indexOf('function fWireCut('));
    assert.ok(!/data-fstep/.test(cut), 'the Stage 4 view still draws the seven step buttons');
    assert.ok(!/The rule so far/.test(cut), 'the Stage 4 view still draws the rule-building box');
    // `fSetRebuild` is taken out first: it is the SECOND control this screen is
    // allowed (3.68.0, owner order), and it changes no rule -- it works out the
    // numbers the rule READS and keeps them on the set.
    const noSetRebuild = cut.split('fSetRebuild').join('');
    assert.ok(!/fClear|fAddRange|fKeepValues|fCutBtn|fRebuild/.test(noSetRebuild), 'the Stage 4 view carries a control that changes the rule');
    assert.ok(/id="fCutName"/.test(cut) && /id="fCutRename"/.test(cut), 'the Stage 4 view has no rename control, and the owner asked for exactly that one');
    assert.ok(/id="fSetRebuild"/.test(cut), 'a set whose numbers were taken away has no way to get them back');
    // the drop-down offers every set cut from this board plus the way back
    assert.ok(/id="fCutPick"/.test(cut), 'there is no Stage 4 record set drop-down');
    // AND IT IS NOT THE CUT BUTTON'S OWN ID. `fCut` is the button on step 7 that
    // writes a Stage 4 set; two controls under one name is one help entry short
    // and one description wrong (found by the help tests, 2026-09-04).
    assert.ok(!/id="fCut"/.test(cut), 'the drop-down has taken the id of the button that writes a Stage 4 set');
    assert.ok(/<option value="new"/.test(cut), 'the drop-down offers no way back to the seven steps');
    // AND IT IS ON THE WALK'S HEADING TOO. On the Stage 4 heading alone it made
    // the walk a one-way door: `new rule` chosen, and no control left on screen
    // to get back to a set already cut.
    const head = page.slice(page.indexOf('function fHead(d) {'), page.indexOf('function fNoiseLine('));
    assert.ok(!head.includes('fUnitPicker(d)') && !head.includes('fCutPickBox('),
      'the walk\'s own heading still draws a picker; both belong to the title section above it (3.59.0)');
    // THE HEADING READS TOP TO BOTTOM AS ONE PROGRESSION (3.61.0, owner order:
    // "all of the little bits and scraps of information ... in a logical and
    // meaningful progressive order, so it doesn't look like random notes spread
    // around the box"). Every line the owner drew is on it, in this order.
    const hd = page.slice(page.indexOf('function fCutHead('), page.indexOf('// the sort button on a column'));
    const order = ['id="fCutRename"', 'The rules below were built on test money', 'User Rule:', 'Final Rule:',
      'Rule build settings:', 'How every step of this walk was checked.', 'The sealed window is intact on',
      'Step 7 - ', 'Written with warnings:'];
    let last = -1;
    for (const line of order) {
      const at = hd.indexOf(line);
      assert.ok(at >= 0, `the heading is missing the line "${line}"`);
      assert.ok(at > last, `the heading draws "${line}" out of order - it reads as notes scattered round a box`);
      last = at;
    }
    assert.ok(hd.includes('The rules below'), 'the frame still speaks of one rule when the heading now carries two');
    assert.ok(!/The rule below were|The rule below was/.test(hd), 'the frame still speaks of one rule');
    // and both of those two lines are about THIS set, not boilerplate
    assert.ok(/\$\{esc\(unitName\)\}<\/b>'s own table was scrambled <b>\$\{c\.k\}<\/b> times/.test(hd),
      'the scrambled-copies line does not name this unit and its own count');
    assert.ok(/The sealed window is intact on <b>\$\{esc\(unitName\)\}<\/b>/.test(hd),
      'the sealed line does not name the unit it is about');
    // the name of the set is shown after the header, and it is the set's own
    const table = page.slice(page.indexOf('function fCutTable('), page.indexOf('function fWireCut('));
    // the name is in the title section at the top now (3.59.0), not above the table
    const title = page.slice(page.indexOf('function fTitle('), page.indexOf('const F_NEW_NAME'));
    assert.ok(/<h3 id="fTitleName"[^>]*>\$\{esc\(name\)\}<\/h3>/.test(title),
      'the Stage 4 record set\'s name is not the bold name in the title section');
    // ONE write on the whole screen
    const wire = page.slice(page.indexOf('function fWireCut('), page.indexOf('function fRuleBox('));
    // the two controls that are the way OUT of a set that will not open are
    // wired before anything that needs the set to have opened
    assert.ok(wire.indexOf('if (!cd) return;') < wire.indexOf("$('#fCutRename')"),
      'the rename is wired before the guard that says the set opened, so it reaches for a set that is not there');
    assert.ok(wire.indexOf('fWireUnit(st);') < wire.indexOf('if (!cd) return;')
      && wire.indexOf('fWireCutPick(st);') < wire.indexOf('if (!cd) return;'),
      'the two ways out of a set that will not open are wired after the guard that returns early');
    // EVERY WRITE ON THIS SCREEN IS NAMED, AND THERE ARE THREE CONTROLS. The
    // rename; (3.68.0) working out the numbers this set's rule reads; and
    // (3.74.0) deleting the set outright. None of them changes the rule or the
    // settings the set wrote down, which is what "display only" has always
    // meant here — a fourth that edited either would be the fault this guard
    // exists for.
    //
    // The delete earned its place the hard way: a stage 4 set had no delete
    // control anywhere, and a record set another set was cut from refuses to
    // be deleted while that set is still here — so one stage 4 set left behind
    // made its stage 3, stage 2 and stage 1 parents undeletable too (owner,
    // 2026-09-06: "s1/2/3 wont delete cause 4 exists"). It counts TWO writes
    // because it asks the service what it is about to remove before it removes
    // it, which is the same two steps the stage 1, 2 and 3 deletes take.
    const posts = wire.match(/tryPost\(/g) || [];
    assert.equal(posts.length, 4, `the Stage 4 view makes ${posts.length} writes; it may make exactly four — the rename, working out its numbers, and the delete's preview and confirm`);
    assert.ok(/api\/stageset\/\$\{encodeURIComponent\(cd\.set\.id\)\}\/name/.test(wire), 'the rename is not one of them');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(cd\.set\.id\)\}\/rebuild/.test(wire), 'working out this set\'s own numbers is not one of them');
    assert.strictEqual((wire.match(/api\/stageset\/\$\{encodeURIComponent\(id\)\}\/delete/g) || []).length, 2,
      'the delete must be the preview and the confirm, and nothing else');
    // and it still changes NOTHING about the rule or the rows
    assert.ok(!/\/rows|\/step|userRule|ruleSentence/.test(wire.slice(wire.indexOf("const dl = $('#fCutDelete');"), wire.indexOf('if (!cd) return;'))),
      'the delete reaches for the rule or the rows — it may only remove the set');
    assert.ok(wire.includes('api/stageset/${encodeURIComponent(cd.set.id)}/name'), 'the rename does not use the record sets\' own name door');
    // and the money warning is on it: this screen shows the one look
    assert.ok(/avg held-back \$/.test(table), 'the held-back money is not on the table the next sections read');
    assert.ok(/is shopping the held-back window/.test(page.slice(page.indexOf('function fCutHead('), page.indexOf('function fcSort('))),
      'the screen shows the one held-back look and does not say what sorting by it costs');
  },

  // A set that will not open must still draw the picker, or the owner is shut
  // inside it with no control on screen to leave by.
  aStageFourSetThatWillNotOpenStillDrawsThePicker() {
    const page = src('public/construct.js');
    const draw = page.slice(page.indexOf('async function fDrawCut('), page.indexOf('function fCutPick('));
    assert.ok(/if \(bad\) \{[\s\S]*?fTitle\(d, st, named\)/.test(draw), 'a Stage 4 set that will not read leaves the owner with no way out of it');
    assert.ok(/if \(cd\.totalling \|\| cd\.waiting\) \{[\s\S]*?fTitle\(d, st, named\)/.test(draw), 'a set whose parent is being totalled leaves the owner with no way out of it');
    assert.ok(draw.includes('fWireCut(d, st, null)'), 'the way out is drawn and not wired');
    // and the branch that chooses between the two screens cannot loop
    const pick = page.slice(page.indexOf('function fCutChosen('), page.indexOf('async function fDrawCut('));
    // 3.104.1: the list holds every set of the stage 3 record set, so falling
    // through to the walk is decided on THIS board's sets -- none of its own,
    // and none chosen, lands on the steps rather than on another coin's set.
    assert.ok(pick.includes('const mine = cuts.filter((c) => c.mine);') && pick.includes('return mine.length ? mine[0].id : null;'),
      'a board with no Stage 4 sets of its own does not fall through to the walk');
    assert.ok(pick.includes('return mine.length ? mine[0].id : null;'), 'a board with sets of its own does not open on the newest of them');
    const br = page.slice(page.indexOf('const cutId = fCutChosen(st, d);'), page.indexOf('const r = d.reading || {};'));
    assert.ok(br.includes("if (cutId !== st.cut) { st.cut = cutId; fSave(); }"),
      'the chosen set is redrawn without being remembered, so every read asks again');
    // and showing a set asks for no step reading: the grid and the region are
    // minutes of work for a screen that is not drawn
    const read = page.slice(page.indexOf('d = await tryPost(`api/funnel/'), page.indexOf('} finally { waitEnd(); }'));
    assert.ok(read.includes("view: ((st.cut && st.cut !== F_NEW) || !fIsOpen(st)) ? 'cut' : null,"),
      'a screen that draws no step still pays for a step reading — a Stage 4 record set showing, or Home');
  },

  // ---- THE OWNER'S FOUR FORMATTING ORDERS (3.59.0, 2026-09-04) -------------
  //
  // "the coin and shape and stage 4 record set and the bold name are always at
  // the top in a title/selector section, regardless of stage 4 data present or
  // not ... when the selection of either (a) a record set or (b) new rule is
  // made then the header section below the title/selector section is what
  // changes".
  theTitleAndTheTwoSelectorsAreAlwaysAtTheTop() {
    const page = src('public/construct.js');
    const title = page.slice(page.indexOf('function fTitle('), page.indexOf('const F_NEW_NAME'));
    assert.ok(title.includes('${fUnitPicker(d)}') && title.includes('${fCutPickBox(d, st)}'),
      'the title section does not carry both selectors');
    assert.ok(/<h3 id="fTitleName"/.test(title), 'the title section has no bold name, so a rename has nothing to change');
    // and the drop-down is drawn whether or not anything has been cut
    const box = page.slice(page.indexOf('function fCutPickBox('), page.indexOf('function fTitle('));
    assert.ok(!/return '';/.test(box), 'a coin and shape with nothing cut from it loses the Stage 4 record set box');
    assert.ok(/<option value="new"/.test(box), 'the box does not offer new rule');
    // Every screen the Funnel draws carries it, and exactly ONE section is
    // allowed above it: the ranking, which is read to decide whether this coin
    // and shape is worth walking at all, so it comes before the picker that
    // chooses one (3.102.0, owner order). 3.107.0: that section is drawn on the
    // Stage 4 record set view too, under the same predicate, so the two views
    // no longer disagree about what is at the top.
    for (const [what, frag] of [['a set showing',
      '`${fHoldShown(st, away, true) ? `<div class="panel" id="fHoldWrap">${fHoldPanel(d, st)}</div>` : \'\'}\n    <div class="panel">${fTitle(d, st, cd.set.name, away, true)}</div>'],
    ['the walk',
      '`${fHoldShown(st, away, open) ? `<div class="panel" id="fHoldWrap">${fHoldPanel(d, st)}</div>` : \'\'}\n  <div class="panel">${fTitle(d, st, open ? F_NEW_NAME : F_HOME_NAME, away, open)}</div>'],
    ['a set that will not open', '`<div class="panel">${fTitle(d, st, named)}</div>']]) {
      assert.ok(page.includes(frag), `${what} does not draw the ranking and then the title and selector section, in that order and with nothing between`);
    }
    // ...and nothing else draws a second copy of either selector
    assert.equal((page.match(/id="fUnit"/g) || []).length, 1, 'the coin and shape box is drawn in more than one place');
    assert.equal((page.match(/id="fCutPick"/g) || []).length, 1, 'the Stage 4 record set box is drawn in more than one place');
  },

  // THE PRESS THAT PUTS THE OPEN SECTION AWAY SITS HARD RIGHT (RULE FOUR).
  // `Go to Funnel home` used to sit beyond it; it is gone (3.109.0, owner
  // order 2026-09-11) and Put away is the last thing in the row now.
  thePutAwayPressSitsHardRightInTheSelectorHeader() {
    const page = src('public/construct.js');
    const title = page.slice(page.indexOf('function fTitle(d, st, name, away, open)'), page.indexOf('const F_NEW_NAME'));
    assert.ok(title.includes("const gap = 'style=\"margin-left:auto\"';"), 'the gap that pushes the press over is gone');
    assert.ok(/putAwayBtn\([^)]*`\$\{gap\}\$\{dead\}`\)/s.test(title), 'the press does not carry the gap, so it sits against the delete press');
    const row = title.slice(title.indexOf('<div class="row" style="align-items:flex-end">'), title.indexOf('</div>'));
    assert.ok(row.includes('id="fCutDelete"') && row.includes('putAwayBtn'),
      'the two presses are in different rows, so they cannot line up');
    assert.ok(row.indexOf('putAwayBtn') > row.indexOf('id="fCutDelete"'), 'the press is not last in the row');
    // AND NOTHING ELSE IS IN THE ROW WITH THEM (3.104.1, owner report: it did
    // not line up). `.row` wraps, and a long note between two presses is
    // enough to push one onto a second line. The note sits under the row.
    assert.ok(!/<span class="note">/.test(row), 'the row carries a note again, and a wrapped row puts the presses on different lines');
    const after = title.slice(title.indexOf('</div>'));
    assert.ok(/<p class="note" style="margin:\.35rem 0 0">\$\{\(d\.cuts \|\| \[\]\)\.filter\(\(c\) => c\.mine\)\.length\} Stage 4 record set\(s\)/.test(after),
      'the count of Stage 4 record sets went with the row instead of moving under it');
    // AND THE PRESS THE OWNER HAD REMOVED IS NOT BACK (3.109.0)
    assert.ok(!/>Go to Funnel home</.test(page), 'Go to Funnel home is on the screen again');
    assert.ok(!/fCutHome|fGoFunnelHome/.test(page), 'the press is gone from the screen and its code is still here');
    const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
    assert.ok(!/fCutHome|Go to Funnel home/.test(help), 'the Help tab still describes a press that is not on any screen');
  },

  // ---- PUT AWAY, THE CONTROL BOARDS ALREADY HAS (3.107.0, owner order
  // 2026-09-10: "Back at the main Funnel view there should be a 'put away'
  // just like by the Stage 1/2/3 areas on Boards which collapses any open
  // funnel and just leaves the 'Worth walking?' and unit selector areas open
  // on the page").
  //
  // ONE control, not a second convention beside Boards' (RULE FOUR). Both
  // screens draw the same button, with the same two words and the same
  // sentence left where the panels were.
  thePutAwayPressIsTheOneBoardsDrawsAndItLeavesTheTopTwoSectionsUp() {
    const page = src('public/construct.js');
    // the words are in ONE place, so the two screens cannot come to disagree
    assert.equal((page.match(/'Put away' : 'Open'/g) || []).length, 1,
      'the two words are written in more than one place, so one screen can be renamed without the other');
    assert.equal((page.match(/put away — press open to bring it back/g) || []).length, 1,
      'the sentence left where the panels were is written in more than one place');
    assert.ok(/const putAwayBtn = \(attr, value, open, what, extra\) =>/.test(page), 'the shared press is gone');
    // Boards draws through it rather than keeping its own copy
    assert.ok(page.includes("const foldBtn = (stage) => putAwayBtn('bfold', stage, fold[stage], \"this stage's table\");"),
      'Boards keeps its own copy of the press, which is the drift this shares one to stop');
    assert.ok(page.includes('if (!fold[stage]) { mount.innerHTML = putAwayNote; continue; }'),
      'Boards keeps its own copy of the sentence');
    // ...and the Funnel draws the same press, on the selector row, on the
    // delete press's baseline
    const title = page.slice(page.indexOf('function fTitle(d, st, name, away, open)'), page.indexOf('const F_NEW_NAME'));
    const row = title.slice(title.indexOf('<div class="row" style="align-items:flex-end">'), title.indexOf('</div>'));
    assert.ok(/putAwayBtn\('ffold', 1, !away,/.test(title), 'the Funnel press is not in the selector header');
    assert.ok(row.includes('putAwayBtn'), 'the Funnel press is not in the row with the others, so it cannot line up with them');
    assert.ok(row.includes("const dead = open ? '' : ' disabled';") || title.includes("const dead = open ? '' : ' disabled';"),
      'nothing ghosts the two presses, so both are live at Home with nothing to act on');
    // WHAT IS LEFT UP is what the owner asked to be left up, on both views:
    // the ranking section and the row of boxes that chooses what is walked.
    for (const [what, frag] of [['the walk', ": away ? `<div class=\"panel\">${putAwayNote}</div>` : `<div id=\"fWalkBody\">"],
      ['an open Stage 4 record set', "${away ? `<div class=\"panel\">${putAwayNote}</div>` : `<div class=\"panel\">${fCutHead(cd, st)}</div>"]]) {
      assert.ok(page.includes(frag), `put away does not collapse ${what}`);
    }
    // AND HOME BEATS IT (3.108.0): with nothing under this row there is
    // nothing to put away, so Home is what is drawn and the press is dead.
    assert.ok(page.includes('${!open ? `<div class="panel">${fHomeNote()}</div>`'),
      'Home draws the put away line, or draws nothing at all where it should say it is Home');
    // and it is REMEMBERED FOR THE SET, not for one walk: it says what the
    // owner wants to look at, not where any one walk has got to, so it holds
    // while the coin and shape box is moved (as the bar and the target do)
    assert.ok(page.includes('const fAway = (set) => fSetMemory(set).away === true;'), 'put away is not remembered against the set');
    assert.ok(page.includes("btn.onclick = () => { fRememberForSet(st.set, { away: !fAway(st.set) }); drawFunnel(); };"),
      'the press does not flip what it remembers, or does not redraw');
    // wired with the rest of that row, which is drawn on both views -- one
    // handler for one control is what keeps the two views agreeing
    const wire = page.slice(page.indexOf('function fWireCutPick(st, d) {'), page.indexOf('const fWalkWasAlreadyCut'));
    assert.ok(wire.includes("document.querySelectorAll('[data-ffold]')"), 'the press is wired somewhere other than with the row it is on, or not at all');
    // EVERY CONTROL THE SECTION DRAWS IS WIRED WITH THE SECTION (3.107.0). It
    // is drawn above an open Stage 4 record set now, where the seven steps'
    // own controls are not drawn at all -- so a press wired beside those would
    // be on screen and dead.
    const hold = page.slice(page.indexOf('function fWireHold(st, d) {'), page.indexOf('function fWatchWalkStart'));
    assert.ok(hold.includes("const rbs = [...document.querySelectorAll('[data-frebuild]')];") && hold.includes('if (fRichGoing(d)) fRichWatch(st);'),
      'the press that fills the section is wired outside the section, so it is dead on the Stage 4 record set view');
    assert.ok(page.includes('  fWireHold(st, d);\n  fWatchCutBox();'), 'the Stage 4 record set view does not wire the section it now draws');
  },

  // ---- THE SCREEN HAS TWO STATES AND ONLY TWO (3.108.0, owner order
  // 2026-09-11).
  //
  // "Go to Funnel home bizarrely leaves 'new rule' selected ... on step 7.
  // Declare and cut when used. it's like it remembers things that aren't
  // actually saved. the whole point of the button is to drop a rule before
  // finished and revert the screen to the Worth walking? section included ...
  // so weird Frankenstein half-finished unnamed limbo state"
  //
  // ...and: "that button is active on the unit selector section when the Worth
  // walking? is already displayed, when the point of making that button was to
  // display the Worth walking? section."
  //
  //   HOME  the header section and the unit selector, nothing under them.
  //   OPEN  something under the unit selector: a walk, or a Stage 4 record set.
  theFunnelIsEitherHomeOrOpenAndThePressThatGoesHomeDropsTheWalk() {
    const page = src('public/construct.js');
    const lift = (head, end) => {
      const at = page.indexOf(head);
      assert.ok(at > 0, `${head} is gone`);
      return page.slice(at, page.indexOf(end, at) + end.length);
    };
    // ONE predicate says which state the screen is in, and a Stage 4 record
    // set showing is Open whatever else is true — it IS the thing under the row
    // eslint-disable-next-line no-eval
    const { fIsOpen, fWalkHasWork } = eval(`(() => {
      let MEM = {};
      const F_NEW = 'new';
      const fSetMemory = () => MEM;
      ${lift('const fOpenOf = (set) =>', '\n')}
      ${lift('const fIsOpen = (st) =>', '\n')}
      ${lift('const fWalkHasWork = (st) =>', ');\n')}
      return { fIsOpen: (st, mem) => { MEM = mem || {}; return fIsOpen(st); }, fWalkHasWork };
    })()`);
    assert.strictEqual(fIsOpen({ set: 's', cut: 'new' }, {}), false, 'a screen with nothing under the unit selector does not read as Home');
    assert.strictEqual(fIsOpen({ set: 's', cut: 'new' }, { open: true }), true, 'a walk opened on purpose does not read as Open');
    assert.strictEqual(fIsOpen({ set: 's', cut: 's4-1' }, {}), true, 'a Stage 4 record set showing does not read as Open');

    // WHAT COUNTS AS WORK, because warning about an untouched walk teaches
    // the owner to click through warnings
    assert.strictEqual(fWalkHasWork({ step: 1, rule: {}, steps: [] }), false, 'an untouched walk asks before it is dropped');
    assert.strictEqual(fWalkHasWork({ step: 7, rule: {}, steps: [] }), true, 'a walk seven steps in is dropped without asking');
    assert.strictEqual(fWalkHasWork({ step: 1, rule: { allowed: { gate: ['active'] } }, steps: [] }), true, 'a walk with a clause on it is dropped without asking');
    assert.strictEqual(fWalkHasWork({ step: 1, rule: {}, steps: [{ n: 1 }] }), true, 'a walk that recorded a step is dropped without asking');
    assert.strictEqual(fWalkHasWork({ step: 1, rule: {}, steps: [], walking: true }), true, 'a walk whose controls have been used is dropped without asking');

    // AND HOME IS WHAT THE SCREEN DRAWS THERE, in words, rather than a blank
    // space that reads as a screen which failed
    assert.ok(/function fHomeNote\(\) \{\n  return `<p class="note">Nothing is open\. Press <b>Walk this one<\/b>/.test(page),
      'Home says nothing, so an empty screen reads as a broken one');
    // A FUNCTION, so the word list generator can follow it. Behind a plain
    // string constant the sentence is on the screen and on no list.
    assert.ok(!/const F_HOME_NOTE/.test(page), 'the sentence Home prints is hidden from the word list behind a constant');
    assert.ok(/const F_HOME_NAME = 'Funnel home';/.test(page),
      'the bold name at Home still says new rule, naming something that is not on the screen');

    // THE THREE THINGS THAT OPEN ONE, each of them the owner choosing a board
    // 3.108.4: the four boxes and `Walk this one` go through ONE door, so
    // neither can drift from the other.
    const board = page.slice(page.indexOf('function fOpenBoard(set, key) {'), page.indexOf('function fWireUnit(st, d) {'));
    assert.ok(board.includes('fMarkOpen(set, true);'), 'choosing a board leaves the screen at Home');
    assert.ok(board.includes('const next = fLoad();') && board.includes('next.cut = F_NEW;'),
      'choosing a board lands on a Stage 4 record set instead of on the steps for the board just chosen');
    const unit = page.slice(page.indexOf('function fWireUnit(st, d) {'), page.indexOf('function fWireCut(d, st, cd) {'));
    assert.ok(unit.includes('const go = (key) => fOpenBoard(st.set, key);'), 'the coin and shape boxes take their own route onto a board');
    const hold = page.slice(page.indexOf('function fWireHold(st, d) {'), page.indexOf('function fWatchWalkStart'));
    assert.ok(hold.includes('b.onclick = () => fOpenBoard(st.set, b.dataset.fhold);'),
      'Walk this one takes its own route onto a board, so it can land on a Stage 4 record set while the boxes do not');
    const opener = page.slice(page.indexOf('function fOpenNewRule(st, d) {'), page.indexOf('function fFreshWalk(st) {'));
    assert.ok(opener.includes('fMarkOpen(st.set, true);'), 'choosing new rule leaves the screen at Home');

    // PUT AWAY IS DEAD AT HOME
    const title = page.slice(page.indexOf('function fTitle(d, st, name, away, open)'), page.indexOf('const F_NEW_NAME'));
    assert.ok(title.includes("const dead = open ? '' : ' disabled';"), 'nothing ghosts the press at Home');
    assert.ok(/putAwayBtn\([^)]*\$\{dead\}`\)/s.test(title), 'Put away is live at Home with nothing to put away');

    // AND HOME PAYS FOR NO STEP READING, because it draws no step
    assert.ok(page.includes("view: ((st.cut && st.cut !== F_NEW) || !fIsOpen(st)) ? 'cut' : null,"),
      'Home reads a step nothing draws, so landing there costs seconds a draw');
  },

  // ---- WHEN `Worth walking?` HIDES: ONE PREDICATE, EVERY VIEW (3.107.0,
  // owner orders 2026-09-10).
  //
  // "the display of the 'Worth walking?' section at the top of the funnel page
  // is inconsistent depending on whether or not the steps are being walked etc.
  // or if a new rule is picked or an existing one is opened ... that should be
  // made consistent: once we've started a new funnel rule or re-opened an
  // existing *AND WE'VE BEGUN WALKING ANY OF THE CONTROLS ON ANY OF THE SEVEN
  // STEPS* then the 'Worth walking?' section at the top including any open
  // table in it should just be hidden"
  //
  // ...refined by the seventh: "the 'worth walking?' section should not hide
  // until actual use of walk controls as it may be worthwhile to view the
  // initial step 1 table of a series by just using the 'walk this one' buttons
  // and scrolling up and down without commencing the walk".
  theRankingSectionHidesOnUsingAWalkControlAndOnNothingElse() {
    const page = src('public/construct.js');
    // ONE predicate decides it, and every place that draws the section asks it
    assert.equal((page.match(/const fHoldShown = /g) || []).length, 1, 'there is more than one predicate, so the two views can drift apart again');
    assert.equal((page.match(/\$\{fHoldPanel\(d, st\)\}/g) || []).length, 2, 'the section is drawn somewhere that does not ask the predicate');
    assert.equal((page.match(/fHoldShown\(st, away, (?:open|true)\) \? `<div class="panel" id="fHoldWrap">\$\{fHoldPanel\(d, st\)\}<\/div>` : ''/g) || []).length, 2,
      'a view draws the section without asking the predicate, or asks it and draws something else');
    const lift = (head, end) => {
      const at = page.indexOf(head);
      assert.ok(at > 0, `${head} is gone`);
      return page.slice(at, page.indexOf(end, at) + end.length);
    };
    // eslint-disable-next-line no-eval
    const fHoldShown = eval(`(() => { ${lift('const fHoldShown = ', '\n')}\nreturn fHoldShown; })()`);
    assert.strictEqual(fHoldShown({ walking: false }, false, true), true, 'a walk nothing has been pressed on hides the section');
    assert.strictEqual(fHoldShown({ walking: true }, false, true), false, 'a walk being used does not hide the section');
    // put away brings it back whatever the walk has done, because that is what
    // the owner asked put away to leave on screen
    assert.strictEqual(fHoldShown({ walking: true }, true, true), true, 'put away does not bring the section back');
    assert.strictEqual(fHoldShown({}, false, true), true, 'a walk saved before this was written hides the section it never began');
    // AND AT HOME IT IS ALWAYS UP (3.108.0). Hiding it with nothing under the
    // unit selector would leave that row alone on the screen.
    assert.strictEqual(fHoldShown({ walking: true }, false, false), true, 'the section is hidden at Home, which leaves the screen as one row of boxes');

    // WHAT SETS IT: a control on the rail, on the step, or on the rule so far,
    // read from ONE listener over the panels that hold them -- so a control
    // added to a step tomorrow is covered without anybody coming back here.
    const watch = page.slice(page.indexOf('function fWatchWalkStart(st) {'), page.indexOf('function fWire(st, d) {'));
    assert.ok(watch.includes("const body = $('#fWalkBody');"), 'the listener is not over the walk panels');
    assert.ok(watch.includes("for (const ev of ['click', 'change']) body.addEventListener(ev, begun, true);"),
      'the listener does not run before the control it is watching, so a control that redraws is missed');
    // A CONTROL, NOT A CLICK. Reading a step is reading; only using something
    // counts, and step 3's grid squares are a control even though they are td.
    assert.ok(watch.includes("const F_WALK_CONTROLS = 'button, input, select, textarea, label, [data-fcell]';")
      || page.includes("const F_WALK_CONTROLS = 'button, input, select, textarea, label, [data-fcell]';"),
    'the list of what counts as a control is gone');
    assert.ok(watch.includes('if (!on) return;'), 'a click on a heading or on the white space begins the walk');
    // hidden ON THE SPOT, because some of these controls answer without a
    // redraw -- ticking a value box only moves the count line beside it
    assert.ok(watch.includes("const hold = $('#fHoldWrap');") && watch.includes('if (hold) hold.remove();'),
      'the section waits for a redraw, so a control that does not redraw leaves it up');

    // AND `walk this one` IS OUTSIDE IT -- the whole point of the seventh
    // order. It is drawn by the section itself, which is not in #fWalkBody.
    const draw = page.slice(page.indexOf('  const away = fAway(st.set);\n  const open = fIsOpen(st);'), page.indexOf('  fWire(st, d);\n  fWatchWalkStart(st);'));
    assert.ok(draw.indexOf('id="fWalkBody"') > draw.indexOf('fHoldPanel(d, st)'),
      'the ranking section is inside the walk panels, so pressing walk this one would hide it');
    assert.ok(!/data-fhold/.test(draw.slice(draw.indexOf('id="fWalkBody"'))), 'walk this one is drawn inside the walk panels');
    // the heading's own two boxes are the SET's standing line above every
    // unit's walk, not a step's control -- but they are inside #fWalkBody, so
    // this records the decision rather than pretending they are outside it
    assert.ok(draw.includes('<div id="fWalkBody">\n  <div class="panel">${fHead(d)}${fRail(d, st)}</div>'),
      'the rail is no longer inside the walk panels, so moving between steps no longer counts as walking');

    // the flag lives on the walk, so ten units in flight each answer for
    // themselves, and it starts false and clears with a fresh walk
    assert.ok(page.includes('across: null, barPct: null,\n      walking: false };'), 'a new walk does not start not-yet-begun');
    const fresh = page.slice(page.indexOf('function fFreshWalk(st) {'), page.indexOf('function fWireUnit(st, d) {'));
    assert.ok(/st\.walking = false;/.test(fresh), 'a walk started again from step 1 still counts as begun');
  },

  // "when the rename button is used the new name must be reflected immediately
  // in the title/selector section bold name."
  renamingAStageFourSetChangesTheBoldNameOnTheSpot() {
    const page = src('public/construct.js');
    const wire = page.slice(page.indexOf('function fWireCut('), page.indexOf('function fRuleBox('));
    const rn = wire.slice(wire.indexOf("$('#fCutRename')"), wire.indexOf("const sr = $('#fSetRebuild');"));
    assert.ok(rn.includes("const title = $('#fTitleName');") && rn.includes('title.textContent = out.name'),
      'the rename does not change the bold name at the top');
    assert.ok(rn.includes("if (o.value === cd.set.id) o.textContent = out.name"),
      'the rename leaves the old name in the Stage 4 record set box');
    assert.ok(!/drawFunnel\(\)/.test(rn),
      'the rename waits for a whole redraw, so the old name stays on screen for as long as the board takes to read');
  },

  // "when new rule is selected for the first time it always starts at step 1 --
  // don't go back to step 7 the previous finished rule if a record set already
  // exists." The walk is recognised by its own rule sentence.
  async aNewRuleStartsAtStepOneWhenTheWalkHasAlreadyBeenCut() {
    const f = await unitFixture();
    try {
      const rule = { ranges: {}, allowed: { gate: ['active'] }, floors: {} };
      const cut = await stages.cutFunnelSet(f.id, { unit: f.keys[0], rule, target: 2 });
      const file = path.join(SETS_DIR, `${cut.id}.json`);
      try {
        // the set carries the sentence, and the walk that made it says the same
        const same = await stages.funnelRead(f.id, { step: 7, unit: f.keys[0], rule });
        const mine = (same.cuts || []).find((c) => c.id === cut.id);
        assert.ok(mine && mine.ruleSentence, 'a cut set travels without the rule it wrote, so nothing can recognise it');
        assert.equal(mine.ruleSentence, same.ruleSentence,
          'the sentence a set carries and the sentence its own walk says are not the same words, so the walk cannot be recognised');
        // a DIFFERENT rule on the same board is not that walk
        const other = await stages.funnelRead(f.id, { step: 7, unit: f.keys[0], rule: { ranges: {}, allowed: { gate: ['directional'] }, floors: {} } });
        assert.notEqual((other.cuts || []).find((c) => c.id === cut.id).ruleSentence, other.ruleSentence,
          'an unfinished walk is mistaken for the one that was cut, so choosing new rule would throw it away');
      } finally { try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ } }
    } finally { f.cleanup(); }
    // and the page acts on it
    const page = src('public/construct.js');
    // 3.108.0: `new rule` OPENS a walk and has its own path. The reset lives
    // there, so the box cannot skip it; the press beside the box drops a walk
    // instead and is a different act entirely.
    const pick = page.slice(page.indexOf('function fWireCutPick('), page.indexOf('function fWireUnit('));
    assert.ok(pick.includes('if (cs.value === F_NEW) { fOpenNewRule(st, d); return; }'),
      'choosing new rule takes its own route rather than the path that opens a walk');
    // 3.108.3: unconditional. It reset only a walk already cut, which is why
    // any OTHER saved walk came back at the step it had reached.
    const home = page.slice(page.indexOf('function fOpenNewRule(st, d) {'), page.indexOf('function fFreshWalk(st) {'));
    assert.ok(/\n  fCloseCut\(st\);\n  fFreshWalk\(st\);\n/.test(home),
      'choosing new rule drops back into a walk at whatever step it stopped on');
    assert.ok(!/if \(fWalkWasAlreadyCut\(d\)\) fFreshWalk\(st\);/.test(home),
      'the fresh start is still conditional, so new rule sometimes gives you the old one');
    // ...AND IT ASKS BEFORE CLEARING A PART-BUILT WALK, naming the step. This
    // is the only thing left that can throw a walk away, since the press that
    // used to went out in 3.109.0.
    assert.ok(home.includes('if (fWalkHasWork(st) && !fWalkWasAlreadyCut(d)) {')
      && home.includes('if (!confirm(`Start a new rule?') && /has a walk part way through, on step/.test(home),
    'a part-built walk is cleared with no warning, or the warning does not say which step it was on');
    assert.ok(/drawFunnel\(\);                                       \/\/ the box snapped to new rule; put it back/.test(home),
      'saying no leaves the box reading new rule over a Stage 4 record set it did not open');
    // AND ONLY AGAINST THIS BOARD'S SETS (3.105.0). The box offers every Stage
    // 4 set of the stage 3 record set now, and the same rule written on another
    // coin has the same sentence -- so without `mine` a walk in hand would be
    // mistaken for the walk that wrote somebody else's set and thrown away.
    const already = page.slice(page.indexOf('const fWalkWasAlreadyCut = (d) =>'), page.indexOf('function fFreshWalk(st) {'));
    assert.ok(/\(d\.cuts \|\| \[\]\)\.some\(\(c\) => c\.mine && c\.ruleSentence/.test(already),
      'the walk in hand is matched against sets from every coin and shape, so going back to the steps can throw it away');
    assert.ok(pick.includes('c.ruleSentence && c.ruleSentence === d.ruleSentence'),
      'the finished walk is recognised by something other than the rule it wrote');
    const fresh = page.slice(page.indexOf('function fFreshWalk('), page.indexOf('function fWireUnit('));
    for (const bit of ['st.step = 1;', "st.rule = { ranges: {}, allowed: {}, floors: {} };", 'st.steps = []', 'st.marks = []']) {
      assert.ok(fresh.includes(bit), `a fresh walk does not clear ${bit}`);
    }
  },

  // "the point is no horizontal scroll bar is allowed ... main column names
  // must be frozen so scrolling down does not lose the context."
  theStageFourTableIsThreeRowsPerSettingAndCannotScrollSideways() {
    const page = src('public/construct.js');
    const table = page.slice(page.indexOf('function fCutTable('), page.indexOf('function fSizeCutBox('));
    assert.ok(!/overflow-x:auto|overflow-x: auto/.test(table), 'the table is back inside a sideways scroller');
    assert.ok(!/white-space:nowrap/.test(table), 'the cells refuse to wrap, which is what pushes the table sideways');
    assert.ok(/<table class="s4">/.test(table), 'the table does not use the fixed layout that keeps it inside the panel');
    // three rows per setting: what it is, then test, then hold
    assert.ok(/<td class="s4what" colspan="\$\{cols\}"/.test(table), 'what a setting IS does not span the table on its own row');
    assert.ok(/<td class="s4tag">test<\/td>/.test(table) && /<td class="s4tag">hold<\/td>/.test(table),
      'the two stacked rows are not named on the row itself, so a reader halfway down cannot tell them apart');
    assert.ok(table.indexOf('<td class="s4tag">test</td>') < table.indexOf('<td class="s4tag">hold</td>'),
      'the held-back row is drawn above the test row; the owner asked for test first');
    // every heading carries both names, lined up with the two rows under it
    for (const pair of [['avg test $', 'avg held-back $'], ['worst losing streak $', 'trades'],
      ['biggest single loss $', 'vs always long $'], ['best single trade $', 'beat its own null set'],
      ['trades won', 'null copies'], ['stopped out', 'lead']]) {
      const [t, h] = pair;
      assert.ok(table.includes(`<span class="t">${t}`), `the heading is missing the test name "${t}"`);
      assert.ok(table.includes(`<span class="h">${h}`), `the heading is missing the held-back name "${h}"`);
    }
    // the one column that cannot be sorted must not offer a sorter that does nothing
    assert.ok(!/money by third\$\{fcSort/.test(table), 'money by third offers a sort the engine ignores');
    // and the heading is frozen by the stylesheet, not by hope
    const css = src('public/construct.html');
    assert.ok(/table\.s4 thead th \{[^}]*position:sticky[^}]*top:0/.test(css), 'the heading is not frozen, so scrolling loses it');
    assert.ok(/table\.s4 \{ table-layout:fixed/.test(css), 'the table can still be pushed wider than the panel by one long cell');
  },

  // "that stage 4 table needs to be in its own box with its own scrollbar so
  // that an appropriate number of records are displayed (based on the vertical
  // screen real estate available that the browser should be able to probe) and
  // the headings must always be at the top" (owner order, 2026-09-04).
  theStageFourRowsHaveTheirOwnBoxSizedToTheScreen() {
    const page = src('public/construct.js');
    const table = page.slice(page.indexOf('function fCutTable('), page.indexOf('function fSizeCutBox('));
    assert.ok(table.includes('<div class="s4box" id="fCutRows">'), 'the rows are not in a box of their own');
    assert.ok(table.includes('</table></div>'), 'the box is opened and never closed');
    // NO PAGE SELECTOR AT ALL (3.61.0, owner order): under a box that scrolls it
    // is a waste of the space the rows need.
    assert.ok(!/bPager\(|data-bpage/.test(table), 'the page selector is back under a box that scrolls');
    assert.ok(/All <b>\$\{Number\(cd\.total\)\.toLocaleString\(\)\}<\/b> of them are in the box below/.test(table),
      'the screen does not say that every setting is in the box');
    assert.ok(table.includes('${cd.clipped ?'), 'a set too big to draw whole is clipped without saying so');
    // the height is MEASURED off the window, not a number somebody picked
    const sizer = page.slice(page.indexOf('function fSizeCutBox('), page.indexOf('let fCutBoxWatched'));
    assert.ok(sizer.includes('const below = window.innerHeight - b.top - under - 8;')
      && sizer.includes('const scrolled = window.innerHeight - under - 24;'),
      'the box height is guessed rather than measured against the window');
    assert.ok(sizer.includes('const room = below >= share ? below : Math.min(scrolled, share);'),
      'a tall heading leaves the box a sliver, and a sliver is not an appropriate number of records');
    assert.ok(sizer.includes("panel.getBoundingClientRect().bottom - b.bottom"),
      'the box does not leave room for what is drawn under it, so the last paging bar falls off the window');
    assert.ok(sizer.includes("getComputedStyle(panel).marginBottom"),
      'the panel\'s own bottom margin is not counted, so the box overhangs the window by exactly that much');
    assert.ok(sizer.includes('if (!box) return;'), 'the sizer reaches for a box that is not on screen');
    assert.ok(/Math\.max\(200,/.test(sizer), 'a short window can squeeze the box down to nothing');
    // and the share is the one that fits about eight settings, not four
    // (0.72 since 3.66.0 -- 0.8 was nine and stood past the bottom of the window)
    assert.ok(/window\.innerHeight \* 0\.72\)/.test(sizer),
      'the box is back to a share that fits four settings, and the owner asked for about eight');
    // re-measured on a resize, and ONE listener for the life of the page
    const watch = page.slice(page.indexOf('function fWatchCutBox('), page.indexOf('function fWireCutPick('));
    assert.ok(watch.includes("window.addEventListener('resize', fSizeCutBox);"), 'the box is not re-measured when the window changes size');
    assert.ok(watch.includes('if (fCutBoxWatched) return;'), 'a resize listener is added on every draw, so they pile up');
    assert.ok(page.includes('  fWatchCutBox();'), 'nothing sizes the box after the screen is drawn');
    // and the box scrolls, with the heading stuck to ITS top
    const css = src('public/construct.html');
    assert.ok(/div\.s4box \{[^}]*overflow-y:auto/.test(css), 'the box has no scroll bar of its own');
    assert.ok(/div\.s4box \{[^}]*overflow-x:hidden/.test(css), 'the box can still scroll sideways');
    assert.ok(/table\.s4 thead th \{[^}]*position:sticky[^}]*top:0/.test(css), 'the heading does not stay at the top of the box');
    assert.ok(/table\.s4 thead th \{[^}]*box-shadow:inset 0 -1px 0/.test(css),
      'the line under the heading is a collapsed border, which scrolls away from a sticky cell');
  },

  // ---- THE RULE THE OWNER BUILT (3.61.0) -----------------------------------
  //
  // Owner order, 2026-09-04: "The user created rule and the number of records
  // included which feeds into '5. a plateau or a knife edge' needs to be
  // retained so that the cutting down of the ranges that happens at step 5 does
  // not forever hide the 'user ranges' that were chosen."
  theRuleTheOwnerBuiltIsKeptWhenStepFiveReplacesIt() {
    // the walk keeps it at the moment the button throws it away, and it rides
    // to the cut and onto the set
    const page = src('public/construct.js');
    const keep = page.slice(page.indexOf("const kr = $('#fKeepRegion');"), page.indexOf("const af = $('#fAddFloors');"));
    assert.ok(keep.includes('st.userRule = {'), 'keep the widest region still throws away what the owner chose with no copy of it');
    assert.ok(keep.indexOf('st.userRule = {') < keep.indexOf('st.rule.ranges = ranges;'),
      'the copy is taken after the rule has already been replaced, so it copies the replacement');
    assert.ok(page.includes('userRule: st.userRule || null,'), 'the cut does not carry the rule the owner built');
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    assert.ok(lib.includes('doc.userRule = state.userRule ? S4.normaliseRule(state.userRule) : null;'),
      'the set is written without the rule the owner built');
    // and a set cut before that has it replayed from its own recorded steps
    // and STAMPED on, so nothing reads it twice
    assert.ok(lib.includes('if (userRule) { doc.userRule = userRule; saveSet(doc); userStamped = true; }'),
      'a set cut before this was written never gets the rule stamped onto it, so every read replays it again');
  },

  // The replay itself, against the shapes the walk really records -- these are
  // the twenty-one steps of the one Stage 4 set on the box, verbatim.
  theOwnersRuleIsReplayedFromTheStepsTheWalkRecorded() {
    const steps = [
      { n: 1, what: 'which dial to narrow next', chose: 'gate' },
      { n: 2, what: 'the values of gate', chose: 'directional' },
      { n: 2, what: 'the shape of tHours', chose: '65 to 137' },
      { n: 1, what: 'which dial to narrow next', chose: 'weekdaysOnly' },
      { n: 2, what: 'the values of weekdaysOnly', chose: 'false' },
      { n: 1, what: 'which dial to narrow next', chose: 'agreePersist' },
      { n: 2, what: 'the shape of agreePersist', chose: '0 to 0' },
      { n: 2, what: 'the values of decision', chose: 'directional' },
      { n: 3, what: 'a block on agreeBar x agreePct', chose: 'all..own x 10..30' },
      { n: 1, what: 'which dial to narrow next', chose: 'entry' },
      { n: 2, what: 'the values of entry', chose: 'breakout, market' },
      { n: 1, what: 'which dial to narrow next', chose: 'dMult (d)' },
      { n: 2, what: 'the shape of dMult (d)', chose: '0.5 to 1.5 or none' },
      { n: 3, what: 'removed from the rule: entry is breakout or market', chose: 'removed' },
      { n: 3, what: 'removed from the rule: weekdaysOnly (24/5) is false', chose: 'removed' },
      { n: 4, what: 'does it hold elsewhere', chose: 'accepted 1 of 4 other units positive; 0 clear the bar' },
      { n: 5, what: 'the widest region', chose: 'kept as the rule (13 dial(s))' },
      { n: 6, what: 'exposure', chose: 'worst streak 40, fewest trades 20' },
    ];
    const got = FS4.userRuleFromSteps(steps, { agreeBar: ['all', 'own'] });
    assert.deepStrictEqual(got.ranges, {
      tHours: { min: 65, max: 137 },
      agreePersist: { min: 0, max: 0 },
      agreePct: { min: 10, max: 30 },
      dMult: { min: 0.5, max: 1.5, also: ['none'] },
    }, 'the ranges the owner chose are not replayed back');
    assert.deepStrictEqual(got.allowed, {
      gate: ['directional'], decision: ['directional'], agreeBar: ['all', 'own'],
    }, 'the values the owner chose are not replayed back');
    // what the owner REMOVED stays removed, and step 6's limits are not part of
    // the rule that fed step 5
    assert.ok(!('entry' in got.allowed) && !('weekdaysOnly' in got.allowed), 'a clause the owner removed is replayed back in');
    assert.deepStrictEqual(got.floors, {}, 'step 6 came after step 5, so its limits are not part of the rule that fed it');
    // a word-valued block with no list of that dial's values claims its two ends
    // and nothing between them, rather than inventing what sat there
    const bare = FS4.userRuleFromSteps(steps, {});
    assert.deepStrictEqual(bare.allowed.agreeBar, ['all', 'own'], 'a block with no value list invents what sat between its ends');
    // a walk that never kept the region has no separate rule of the owner's
    assert.equal(FS4.userRuleFromSteps(steps.filter((s) => s.n !== 5), { agreeBar: ['all', 'own'] }), null,
      'a walk that never pressed keep the widest region reports a rule that was never replaced');
    assert.equal(FS4.userRuleFromSteps(null), null, 'a set with no steps at all throws instead of answering');
  },

  // and the whole way through: cut a set, and the screen gets both rules with a
  // count each, read off the same board
  async aStageFourSetCarriesBothRulesAndACountForEach() {
    const f = await unitFixture();
    try {
      const rule = { ranges: {}, allowed: { gate: ['active'] }, floors: {} };
      const userRule = { ranges: { tHours: { min: 41, max: 65 } }, allowed: {} };
      const cut = await stages.cutFunnelSet(f.id, { unit: f.keys[0], rule, userRule, target: 2 });
      const file = path.join(SETS_DIR, `${cut.id}.json`);
      try {
        assert.deepStrictEqual(cut.userRule.ranges, { tHours: { min: 41, max: 65 } }, 'the set was written without the rule the owner built');
        const out = await stages.funnelSetRows(cut.id, {});
        assert.ok(out.set.userSentence && /tHours/.test(out.set.userSentence), 'the screen is not given the owner\'s rule in words');
        assert.ok(Number.isFinite(out.set.userSurvivors), 'the screen is not given how many settings the owner\'s rule kept');
        assert.ok(out.set.userSurvivors >= out.set.survivors,
          'the rule that fed step 5 kept FEWER settings than the rule step 5 wrote, which is the wrong way round for a narrowing');
        assert.equal(out.set.userStamped, false, 'a set written with the rule on it is reported as recovered');
      } finally { try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ } }
      // AND A SET CUT BEFORE ANY OF THIS gets it replayed from its own recorded
      // steps and STAMPED ON -- once. The second read finds it on the record.
      const old = await stages.cutFunnelSet(f.id, { unit: f.keys[0], rule, target: 2,
        steps: [{ n: 2, what: 'the shape of tHours', chose: '41 to 65' }, { n: 5, what: 'the widest region', chose: 'kept as the rule (1 dial(s))' }] });
      const oldFile = path.join(SETS_DIR, `${old.id}.json`);
      try {
        assert.equal(old.userRule, null, 'the fixture was meant to stand in for a set cut before the rule was kept');
        const first = await stages.funnelSetRows(old.id, {});
        assert.equal(first.set.userStamped, true, 'a set with no rule of the owner\'s on it is not recovered from its own steps');
        assert.deepStrictEqual(first.set.userRule.ranges, { tHours: { min: 41, max: 65 } }, 'the recovered rule is not what the steps recorded');
        const onDisk = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
        assert.deepStrictEqual(onDisk.userRule.ranges, { tHours: { min: 41, max: 65 } }, 'the recovered rule was not written onto the record');
        const second = await stages.funnelSetRows(old.id, {});
        assert.equal(second.set.userStamped, false, 'the record is replayed again on every read instead of being read back');
      } finally { try { fs.rmSync(oldFile, { force: true }); } catch (_) { /* fixture */ } }
    } finally { f.cleanup(); }
  },

  // "as a principle when a none or other word-based setting is allowed also
  // with a range it should be allowed as the sole choice in step 2 selections"
  // (owner order, 2026-09-04).
  noneCanBeKeptOnItsOwnOnStepTwo() {
    const page = src('public/construct.js');
    const press = page.slice(page.indexOf("const ar = $('#fAddRange');"), page.indexOf('const countRange ='));
    assert.ok(press.includes("if (lo === '' && hi === '' && alsoNone) {"), 'clearing both boxes with the tick on still deletes the whole clause');
    assert.ok(press.includes("st.rule.allowed[st.dial] = ['none'];"), 'none alone is not kept as a value, which is what it is');
    assert.ok(press.includes("fRecord({ n: 2, what: `the values of ${fDialLabel(st.dial)}`, chose: 'none' });"),
      'the walk records it as a shape rather than as the value it kept, so the replay of the steps would rebuild a range');
    // A RANGE MUST CLEAR IT. Both clauses applying at once keeps nothing at all,
    // and that fault could not exist until this release made the second clause.
    const rangeArm = press.slice(press.indexOf('} else {'));
    assert.ok(rangeArm.includes('delete st.rule.allowed[st.dial];'),
      'writing a range leaves a none-only clause on the same dial in place, and the two together keep nothing');
    // the screen shows what the rule holds, not the recommendation it does not
    const step2 = page.slice(page.indexOf('const have = (st.rule.ranges || {})[st.dial] || {};'), page.indexOf('function fStep3('));
    assert.ok(step2.includes("const noneAlone = ((st.rule.allowed || {})[st.dial] || []).map(String).join(',') === 'none';"),
      'nothing notices that the rule keeps none alone');
    assert.ok(step2.includes("const lo = noneAlone ? '' :") && step2.includes("const hi = noneAlone ? '' :"),
      'the boxes offer back a range the rule does not hold');
    assert.ok(step2.includes("const onlyNone = hasNone && alsoNone && lo === '' && hi === '';"), 'the count drawn with the table does not follow the new meaning');
    assert.ok(step2.includes('To keep none and nothing else:'), 'the screen never says how to keep none on its own');
    // and the count line beside the button follows it as the boxes are edited
    const live = page.slice(page.indexOf('const countRange ='), page.indexOf("for (const id of ['fMin', 'fMax'])"));
    assert.ok(live.includes("const onlyNone = none && lo === '' && hi === '';"), 'the live count still says a cleared pair of boxes keeps everything');
    // THE ENGINE ALREADY KNEW THE NAME. Settings with no value for a dial answer
    // to `none` everywhere, so keeping it needed no new shape in the rule.
    const rows = [{ label: 'a', dMult: 0.5 }, { label: 'b', dMult: 1 }, { label: 'c', dMult: null }, { label: 'd' }];
    const kept = FS4.applyRule(rows, { ranges: {}, allowed: { dMult: ['none'] }, floors: {} });
    assert.deepStrictEqual(kept.map((r) => r.label), ['c', 'd'], 'is none does not keep exactly the settings with no value for the dial');
    assert.equal(FS4.ruleSentence(FS4.normaliseRule({ ranges: {}, allowed: { dMult: ['none'] }, floors: {} })), 'dMult is none',
      'the rule does not read back as "is none"');
  },

  // ---- WHICH CROSSES ARE WORTH READING (3.63.0, FUNNEL-DESIGN.md §18) ------
  //
  // A board where one dial is flat, one pair genuinely interacts, and the rest
  // do not: gate pays only at x, and only while entry is 1. decision does
  // nothing at all.
  async theListOffersOnlyTheCrossesThatSaySomething() {
    const F = require('../lib/funnel');
    const rows = [];
    let si = 0;
    for (const gate of ['x', 'y']) {
      for (const entry of ['1', '2']) {
        for (const decision of ['p', 'q']) {
          for (let i = 0; i < 20; i++) {
            rows.push({ si: si++, label: `${gate}${entry}${decision}#${i}`, gate, entry, decision,
              avgTest: (gate === 'x' && entry === '1') ? 10 : 0, noiseTest: Array.from({ length: 6 }, () => 0) });
          }
        }
      }
    }
    const out = await F.crossesWorthReading(rows, { floor: 0, barPct: 80 });
    assert.deepStrictEqual(out.dials.slice().sort(), ['decision', 'entry', 'gate'], 'a dial with two values among the survivors is not eligible');
    assert.equal(out.pairs, 3, 'the pairs are not every combination of the eligible dials');
    assert.equal(out.read, 3, 'not every pair was read');
    // ONLY THE ONE THAT SAYS SOMETHING. A block spanning one axis whole says
    // nothing a single-dial range at step 2 does not.
    assert.equal(out.crosses.length, 1, `only the genuine interaction is listed: ${JSON.stringify(out.crosses.map((x) => `${x.a}x${x.b}`))}`);
    const one = out.crosses[0];
    assert.deepStrictEqual([one.a, one.b], ['entry', 'gate'], 'the pair listed is not the one that interacts');
    assert.deepStrictEqual(one.block, { a: { from: '1', to: '1' }, b: { from: 'x', to: 'x' } }, 'the block is not the corner the money actually sits in');
    assert.ok(one.squares === 1 && one.ofSquares === 4, 'the row does not say how much of the grid the block covers');
    assert.ok(one.won === one.of && one.of > 0, 'the row does not count the copies the block beat');
    // and a dial the rule has pinned to one value is not eligible at all
    const pinned = rows.map((r) => ({ ...r, decision: 'p' }));
    const out2 = await F.crossesWorthReading(pinned, { floor: 0, barPct: 80 });
    assert.ok(!out2.dials.includes('decision'), 'a dial with one value on the board is still offered as a grid axis');
    assert.equal(out2.pairs, 1, 'pinning a dial does not shorten the list of pairs');
  },

  // The strict test is the point of the list, and it is NOT the looser one the
  // step 3 mark uses. Both are kept, named apart, and this holds them apart.
  theListNeedsABlockBoundedOnBOTHAxesNotJustOne() {
    const F = require('../lib/funnel');
    const g = { aVals: ['1', '2', '3'], bVals: ['x', 'y'] };
    const whole = F.blockSpans({ a: { from: '1', to: '3' }, b: { from: 'x', to: 'y' } }, g);
    assert.ok(!whole.interact && !whole.joint, 'a block covering the whole grid reads as saying something');
    const strip = F.blockSpans({ a: { from: '1', to: '3' }, b: { from: 'x', to: 'x' } }, g);
    assert.ok(strip.interact, 'the step 3 mark stops firing on a block that does not cover the grid');
    assert.ok(!strip.joint, 'a block spanning one whole axis is offered as a cross worth reading, and it says only what a single range says');
    const box = F.blockSpans({ a: { from: '2', to: '3' }, b: { from: 'x', to: 'x' } }, g);
    assert.ok(box.interact && box.joint, 'a block bounded on both axes is not recognised as the interaction it is');
  },

  // It must stay answerable while it runs, and it must never rank by money.
  theCrossReadingYieldsBetweenPairsAndNeverRanksByMoney() {
    const lib = src('lib/funnel.js');
    const fn = lib.slice(lib.indexOf('async function crossesWorthReading('), lib.indexOf('module.exports = {'));
    assert.ok(/await new Promise\(\(resolve\) => \{ setImmediate\(resolve\); \}\);/.test(fn),
      'a hundred pairs over a hundred thousand settings runs without yielding, and every other screen stops dead while it does');
    assert.ok(fn.includes('async function crossesWorthReading('), 'the reading is synchronous, so it cannot yield at all');
    // the score is the copies beaten, then size, then lead -- never the money
    assert.ok(/crosses\.sort\(\(x, y\) => \(\(y\.share \?\? -1\) - \(x\.share \?\? -1\)\)/.test(fn), 'the list is not ordered by how many copies each block beat');
    assert.ok(!/avgTest|\bmoney\(|meanOf|\.mean\b/.test(fn.slice(fn.indexOf('crosses.sort'))), 'the ordering reads money');
    assert.ok(/\|\| \(y\.squares - x\.squares\)/.test(fn) && /y\.lead \?\? -Infinity/.test(fn), 'size and lead do not break the ties');
    assert.ok(/\|\| `\$\{x\.a\}\|\$\{x\.b\}`\.localeCompare/.test(fn), 'two pairs that tie on everything can come back in either order, so the same board gives two different lists');
  },

  // The screen: always there, above the pickers, with the count line that stays
  // when nothing is found, and a reading that failed is never restarted alone.
  theCrossListIsAlwaysOnStepThreeAboveThePickers() {
    const page = src('public/construct.js');
    const step3 = page.slice(page.indexOf('function fStep3(r, st) {'), page.indexOf('function fStep4('));
    assert.equal((step3.match(/\$\{fCrosses\(r, st\)\}/g) || []).length, 2,
      'the list is not drawn on both of step 3\'s paths - before a grid is read and after');
    for (const path of step3.split('return `').slice(1)) {
      if (!path.includes('${pickers}')) continue;
      assert.ok(path.indexOf('${fCrosses(r, st)}') < path.indexOf('${pickers}'), 'the list is drawn below the pickers, and the owner asked for above');
    }
    const panel = page.slice(page.indexOf('function fCrosses(r, st) {'), page.indexOf('function fStep3(r, st) {'));
    assert.ok(panel.includes('id="fCrossOn"') && panel.includes('id="fCrosses"'), 'the switch and the button are not both always drawn');
    assert.ok(panel.indexOf('const head =') < panel.indexOf('if (going)'), 'the controls are drawn only in some states; the owner asked for always present');
    // THE COUNT LINE STAYS WHEN NOTHING IS FOUND (owner, 2026-09-04)
    assert.ok(panel.includes('none of these dials interact on this board'), 'a reading that finds nothing says nothing, which reads exactly like a reading that never ran');
    assert.ok(panel.indexOf('if (!list.length) return `${head}${counted}`;') > 0, 'an empty list drops the count line with it');
    // and it says what it will cost before it is started
    assert.ok(/pair\(s\) to read\. On this box that is about <b>\$\{fSecs\(off\.msAll\)\}<\/b>/.test(panel),
      'the screen does not say what reading every pair will cost before it is started');
    assert.ok(panel.includes('Nothing here is ranked by money'), 'the screen does not say what the list is ordered on');
    // a failed reading is shown and is NOT started again by itself
    const wire = page.slice(page.indexOf('const startCrosses = async () =>'), page.indexOf("const ax = $('#fAcross');"));
    assert.ok(wire.includes('if (cx && st.crossesOn && !crossHeld && !crossBad && !st.crossesAsked) startCrosses();'),
      'a reading that failed is started again on every single draw, or a moved rule never reads itself again');
    assert.ok(panel.includes('The last reading of these pairs failed:'), 'a failure is silent');
    // loading a cross records it as a choice the machine put in front of you
    assert.ok(wire.includes("what: 'the cross to read', chose: `${fDialLabel(ca)} x ${fDialLabel(cb)}`, fromList: true"),
      'loading a cross from the list is recorded as though it were hand-picked');
    // held under the floor as well as the rule and the bar
    assert.ok(page.includes("const fCrossKey = (st) => JSON.stringify([st.rule, st.barPct == null ? null : st.barPct, Math.max(0, Math.floor(Number(st.floor) || 0))]);"),
      'the list is not held under the thin floor, and the floor changes every block on every pair');
    const lib = src('lib/stages.js');
    assert.ok(lib.includes("require('./funnel').barPctOf(state), Math.max(0, Math.floor(Number(state.floor) || 0))]);"),
      'the service holds the reading under a different key from the one the page asks with');
  },

  // ---- STEP 5 IS TOO RESTRICTIVE (3.64.0, owner order 2026-09-04) ----------
  //
  // "yes, the current functionality and report of the widest region should be
  // kept, but ... we should also have a way of loosening the criteria such that
  // weak spots within what would be a much larger area can be 'papered-over' by
  // some threshold (and noted of course)."
  theRegionBarCanBeLoosenedSoOneWeakSettingDoesNotSplitAWideArea() {
    const P = require('../lib/plateau');
    // seven neighbouring settings, one of them a shallow loser in the middle
    const rows = [1, 2, 3, 4, 5, 6, 7].map((t) => ({ tHours: t, gate: 'x', pnl: t === 4 ? -0.5 : 5, trades: 10 }));
    const o = { orderedAxes: ['tHours'], categoricalAxes: ['gate'], minTrades: 0 };
    const strict = P.widestRegion(rows, o);
    assert.equal(strict.size, 3, 'one setting a cent under used to split seven into three, and that is still what the strict bar must do');
    assert.equal(strict.bar, 'pnl > 0 after fees', 'the strict bar no longer says what it is');
    assert.equal(strict.atLeast, 0, 'the bar is not carried on the reading, so nothing downstream can say what it was');
    const loose = P.widestRegion(rows, { ...o, atLeast: -1 });
    assert.equal(loose.size, 7, 'a bar below zero does not walk through a shallow dip');
    assert.equal(loose.bar, 'pnl > -1 after fees', 'a loosened region does not say what bar it was grown under');
    // and a dip DEEPER than the bar is still a wall
    assert.equal(P.widestRegion(rows, { ...o, atLeast: -0.2 }).size, 3, 'a dip deeper than the bar is walked through anyway');
    // THE SAME BAR GOES TO THE COPIES. A region grown loose and compared with
    // copies measured strict is not a comparison; the reading builds both
    // through one closure, so the bar cannot differ between them.
    const lib = src('lib/stages.js');
    const step5 = lib.slice(lib.indexOf('const atLeast = Number.isFinite(Number(state.regionAtLeast))'), lib.indexOf('out.conditions.regionNotWider'));
    assert.ok(step5.includes('{ minTrades: 0, atLeast, across, reach, orderedAxes: ordered, categoricalAxes: F.CATEGORICAL_DIALS },'),
      'the bar is not handed to the region reader, so it never reaches the copies');
    assert.equal((step5.match(/widestRegion\(/g) || []).length, 1, 'the region is read through more than one call, so the copies could be measured under a different bar than the real region');
  },

  // "and noted of course"
  wideningTheRegionOverLosersIsCountedAndMarked() {
    // THE COUNT IS TAKEN ON THE REGION'S OWN MEMBERS. Counted afterwards from
    // the region's edges it would be a different set of settings -- the edges
    // enclose the notches the region walked around -- and it would report
    // losers at a bar of 0, where by definition nothing was papered over.
    const P = require('../lib/plateau');
    const rows = [1, 2, 3, 4, 5, 6, 7].map((t) => ({ tHours: t, gate: 'x', pnl: t === 4 ? -0.5 : 5, trades: 10 }));
    const o = { orderedAxes: ['tHours'], categoricalAxes: ['gate'], minTrades: 0 };
    assert.deepEqual(P.widestRegion(rows, o).papered, { atLeast: 0, n: 0, of: 3, worst: null },
      'at the old bar the reading does not say that it papered over nothing');
    assert.deepEqual(P.widestRegion(rows, { ...o, atLeast: -1 }).papered, { atLeast: -1, n: 1, of: 7, worst: -0.5 },
      'a loosened region does not count and name the loser it walked through');
    assert.deepEqual(P.widestRegion([], o).papered, { atLeast: 0, n: 0, of: 0, worst: null },
      'a reading with no region at all says nothing about what it papered over');
    const lib = src('lib/stages.js');
    const step5 = lib.slice(lib.indexOf('    out.reading.keep = {\n      ...keep,'), lib.indexOf('out.conditions.regionNotWider'));
    assert.ok(step5.includes('out.conditions.regionPapered = (out.reading.papered || {}).n > 0;'), 'widening over losers leaves no mark to record');
    assert.equal((step5.match(/applyRule\(all, keepRule\)/g) || []).length, 1,
      'the losers are counted a second time off the region edges, and those enclose settings the region walked around');
    const S4 = require('../lib/funnelset');
    assert.equal(S4.MARKS.regionPapered, 'the region was widened over settings that lost money', 'the mark has no words on the set');
    const page = src('public/construct.js');
    assert.ok(page.includes("if (step === 5 && c.regionPapered) mark('regionPapered', 5);"), 'walking past step 5 does not record the mark');
    assert.ok(/F_MARK_WORDS = \{[\s\S]*?regionPapered: 'the region was widened over settings that lost money'/.test(page),
      'the page and the set do not agree on what the mark says');
    // the screen says what was papered over, and says so even at the old bar
    const step = page.slice(page.indexOf('function fStep5(r, d, st) {'), page.indexOf('// WHAT EACH LIMIT WOULD KEEP'));
    assert.ok(step.includes('At <b>0</b> nothing is papered over'), 'at the old bar the screen goes silent instead of saying nothing was papered over');
    assert.ok(step.includes('settings in this region LOST money'), 'the screen never says how many losers the region holds');
    assert.ok(step.includes('The scrambled copies are measured under the same number'), 'the screen does not say the check moves with the bar');
  },

  // OWNER, 2026-09-04: "i'm bumping up the value to crazy low settings like -50
  // and it's not increasing the REGION SIZE ... i'm wanting the REGION ITSELF to
  // increase". The money bar alone cannot: a board still free on a word-valued
  // dial is cut into pieces a region may never cross.
  aMoneyBarAloneCannotGrowARegionAcrossAWordValuedDial() {
    const P = require('../lib/plateau');
    // two settings of gate, four of t, every one of them making money: two
    // pieces of four, and no bar however low joins them
    const rows = [];
    for (const g of ['active', 'directional']) for (const t of [1, 2, 3, 4]) rows.push({ tHours: t, gate: g, pnl: 5, trades: 10 });
    const o = { orderedAxes: ['tHours'], categoricalAxes: ['gate'], minTrades: 0 };
    assert.equal(P.widestRegion(rows, o).size, 4, 'the two halves of this board were already one region, so it proves nothing');
    assert.equal(P.widestRegion(rows, { ...o, atLeast: -1000 }).size, 4,
      'the money bar is doing something it cannot do -- every setting here already made money');
    const across = P.widestRegion(rows, { ...o, across: ['gate'] });
    assert.equal(across.size, 8, 'naming the word-valued dial does not join the two pieces, which is the whole point of naming it');
    // and the rule it becomes keeps BOTH values, not the middle one's
    const S4 = require('../lib/funnelset');
    const rule = S4.regionRule(across, { ordered: ['tHours'], categorical: ['gate'] });
    assert.deepEqual([...(rule.allowed.gate || [])].sort(), ['active', 'directional'],
      'the rule keeps one value of a dial the region crossed, so it keeps a slice of the region and calls it the region');
    // what it was read under is on the reading, or a size can be read without it
    assert.deepEqual(across.axes.across, ['gate'], 'the reading does not say which dials it was allowed to cross');
    assert.deepEqual(across.axes.sliceBy, [], 'the reading does not say what still cut the board into pieces');
  },

  // the other wall that is not money: a setting simply MISSING from the board
  aRegionCanBeJoinedOverSettingsThatAreNotOnTheBoardAtAll() {
    const P = require('../lib/plateau');
    // t of 3 at d of 1 was never priced -- not a loser, absent. t of 3 exists on
    // the board at d of 2, so this really is a hole and not a value nobody swept.
    const at = (t, d) => ({ tHours: t, dMult: d, gate: 'x', pnl: 5, trades: 10 });
    const rows = [at(1, 1), at(2, 1), at(4, 1), at(5, 1), at(3, 2)];
    const o = { orderedAxes: ['tHours', 'dMult'], categoricalAxes: ['gate'], minTrades: 0 };
    assert.equal(P.widestRegion(rows, o).size, 2, 'a hole in the board no longer stops a step of one, and it must');
    assert.equal(P.widestRegion(rows, { ...o, atLeast: -1000 }).size, 2,
      'the money bar steps over a setting that has no money at all, which it cannot');
    assert.equal(P.widestRegion(rows, { ...o, reach: 2 }).size, 4, 'a step of two does not carry the region over the hole');
    assert.equal(P.widestRegion(rows, { ...o, reach: 2 }).reach, 2, 'the reading does not say how far a step was allowed to reach');
    assert.equal(P.widestRegion(rows, o).reach, 1, 'the reading does not say that a step was one notch');
  },

  // both are marked, and both are offered from the board rather than typed
  loosening_theRegionBeyondMoneyIsOfferedByTheEngineAndMarkedOnTheSet() {
    const S4 = require('../lib/funnelset');
    assert.equal(S4.MARKS.regionAcross, 'the region was joined across dials whose values are words, which have no order', 'crossing a word dial has no words on the set');
    assert.equal(S4.MARKS.regionReach, 'the region was joined over settings missing from the board', 'stepping over a hole has no words on the set');
    const lib = src('lib/stages.js');
    const step5 = lib.slice(lib.indexOf('const atLeast = Number.isFinite(Number(state.regionAtLeast))'), lib.indexOf('out.conditions.regionNotWider'));
    assert.ok(step5.includes('{ minTrades: 0, atLeast, across, reach, orderedAxes: ordered, categoricalAxes: F.CATEGORICAL_DIALS },'),
      'the two new limits do not reach the region reader, so they reach neither the real region nor its copies');
    assert.equal((step5.match(/widestRegion\(/g) || []).length, 1,
      'the region is read through more than one call, so the copies could be measured under different limits than the real region');
    assert.ok(step5.includes('out.reading.canCross = F.CATEGORICAL_DIALS'),
      'the screen is not told which word-valued dials this board still has more than one value of, so it would have to guess');
    assert.ok(step5.includes('out.conditions.regionAcross = across.length > 0;') && step5.includes('out.conditions.regionReach = reach > 1;'),
      'a region joined past what money can explain leaves no mark');
    const page = src('public/construct.js');
    const step = page.slice(page.indexOf('function fStep5(r, d, st) {'), page.indexOf('// WHAT EACH LIMIT WOULD KEEP'));
    assert.ok(step.includes('id="fRegionReach"'), 'there is no way to say how far a step may reach');
    assert.ok(step.includes('join settings up to this many apart'), 'the reach control does not say what it does');
    assert.ok(step.includes('also join across:'), 'there is no way to name a word-valued dial the region may cross');
    assert.ok(step.includes('data-facross="'), 'the dials to cross are not offered as something to press');
    assert.ok(!/data-facross="(entry|gate|decision)"/.test(step), 'the dials offered are typed into the page instead of read off the board (RULE FIVE)');
    assert.ok(step.includes('canCross.length'), 'a board with nothing left to cross is not told so');
    assert.ok(page.includes("if (step === 5 && c.regionAcross) mark('regionAcross', 5);")
      && page.includes("if (step === 5 && c.regionReach) mark('regionReach', 5);"), 'walking past step 5 does not record the two new marks');
    assert.ok(page.includes('regionReach: st.regionReach,') && page.includes('regionAcross: st.regionAcross,'),
      'the two new limits are never sent with the read');
    assert.ok(page.includes("st.regionAcross = [...document.querySelectorAll('[data-facross]')].filter((x) => x.checked).map((x) => x.dataset.facross);"),
      'which dials were ticked is never read off the screen, so ticking one could never reach the read');
  },

  // OWNER, 2026-09-05: "if those XRPUSDT funnels were just working under
  // conditions that don't make sense for building rules then better to know
  // that up front and not waste a bunch of time trying to make rules."
  aBoardSaysWhatItHasToBeatBesidesLuckBeforeAnythingIsNarrowed() {
    const S = require('../lib/stages');
    const doc = { controls: { units: { 'X|||w': {
      'all|65': { alwaysLong: -20, alwaysShort: 5, buyHold: 40, shortHold: -45 },
      'wk|137': { alwaysLong: -30, alwaysShort: 9, buyHold: 52, shortHold: -56 },
    } } } };
    // EVERY SETTING AT ITS OWN HOLD LENGTH AND ITS OWN 24/7-or-24/5. A rule
    // keeping settings at three horizons is not being read at one of them.
    const rows = [{ tHours: 65, weekdaysOnly: false, avgHold: 10 }, { tHours: 137, weekdaysOnly: true, avgHold: 20 }];
    const got = S.againstControls(doc, 'X|||w', rows);
    assert.equal(got.known, true, 'a set that kept them says it did not');
    assert.equal(got.real, 15, 'the survivors\' own money is not the plain average of what they made');
    assert.deepEqual(got.buyHold, { lo: 40, hi: 52 }, 'the span across the hold lengths in use is wrong');
    // BEATEN MEANS BEATEN AT THE WORST OF THEM, never at the kindest
    assert.equal(got.beatsBuyHold, false, '15 must not read as beating a 40-to-52 span');
    assert.equal(got.beatsShortHold, true, '15 must beat a -56-to-45 span');
    assert.equal(got.beatsAlwaysLong, true, '15 must beat a -30-to-20 span');
    // a set that kept nothing says so instead of reading as zero
    assert.equal(S.controlsOf({}, 'X|||w', ['all|65']).known, false, 'a set with nothing kept reads as though it had');
    assert.ok(/priced before/.test(S.controlsOf({}, 'X|||w', ['all|65']).why), 'and it does not say why');
    assert.equal(S.controlsOf(doc, 'OTHER', ['all|65']).known, false, 'a coin and shape it knows nothing about reads as known');
    assert.equal(S.controlsOf(doc, 'X|||w', ['all|999']).known, false, 'a hold length it kept nothing at reads as known');
    assert.equal(S.controlKeyOf({ tHours: 65, weekdaysOnly: true }), 'wk|65', 'the 24/5 settings are read against the 24/7 numbers');
  },

  // it is a mark on every step, not a note that scrolls away
  losingToBuyingTheCoinAndGoingAwayIsRecordedOnTheSet() {
    const S4 = require('../lib/funnelset');
    assert.equal(S4.MARKS.losesToBuyHold, 'the settings it keeps made less than buying the coin and going away',
      'losing to the obvious thing has no words on the set');
    assert.equal(S4.MARKS.losesToShortHold, 'the settings it keeps made less than shorting the coin and going away',
      'losing to the other obvious thing has no words on the set');
    const lib = src('lib/stages.js');
    assert.ok(lib.includes('out.conditions.losesToBuyHold = against.keeping.beatsBuyHold === false;'),
      'nothing works out whether the rule lost to buying the coin and going away');
    assert.ok(lib.includes('against,'), 'the reading never reaches the screen');
    const page = src('public/construct.js');
    assert.ok(page.includes("if (c.losesToBuyHold) mark('losesToBuyHold', step);"), 'walking past a step does not record it');
    assert.ok(!/step === \d && c\.losesToBuyHold/.test(page), 'it is recorded on one step only, and it is a fact about the rule');
    // and both readings are on the heading, before any narrowing
    const head = page.slice(page.indexOf('function fHead(d) {'), page.indexOf('function fRail('));
    assert.ok(head.includes("fAgainst((d.against || {}).board, 'every setting on this board')"),
      'the whole board is never held up to them, so a board with nothing in it is walked anyway');
    assert.ok(head.includes("fAgainst((d.against || {}).keeping, 'the settings this rule keeps')"),
      'the survivors are never held up to them');
    // 3.107.0: the sentence became a table, and it reads TEST money -- the
    // held-back reading is gone from the screen the choosing happens on.
    const tbl = page.slice(page.indexOf('function fAgainst(a, what) {'), page.indexOf('function fHead(d) {'));
    for (const word of ['buying the coin and going away', 'shorting it and going away', 'being long every period', 'being short every period']) {
      assert.ok(page.includes(word), `the screen does not name ${word}, which is one of the four it compares with`);
    }
    assert.ok(tbl.includes("cth('on the test window', 'fAgainstWhat')"), 'the four are not a table, or the table does not say which window it reads');
    assert.ok(!/held-back window/.test(tbl), 'the reading still names the held-back window on a screen used for choosing');
    assert.ok(/Nothing here is from the held-back part or the unread part/.test(tbl),
      'the table does not say that nothing on it comes from the held-back part');
    assert.ok(/best of the four/.test(tbl), 'the table does not name the hardest of the four, so a rule clearing a pair of them reads as clear');
    // all four are named through one list, so none can be dropped quietly
    assert.ok(tbl.includes('CMP_ORDER.map((k) => {') && tbl.includes('CMP_WORDS[k]'),
      'the table names the four one at a time, so one can be left out without anything noticing');
    assert.ok(page.includes('there is a simpler thing that did better'), 'the screen does not say what losing to it means');
  },

  // OWNER, 2026-09-05: "if we support multiple passes through the same stage 3
  // data, saving stage 4 data sets to look for alternate rules, and then your
  // design doesn't bother saving the stage 4 data properly, THEN THAT'S JUST
  // BAD DESIGN, AND THAT'S ON YOU." Measured on the owner's box before the fix:
  // a Stage 4 set that wrote down 116 settings had all 116 still on the board,
  // all 116 still carrying a trade count, and NONE carrying a worst losing
  // streak -- so its rule, which limits that, kept nothing at all.
  aSecondPassNeverTakesTheRebuiltNumbersOffAnEarlierSet() {
    const lib = src('lib/stages.js');
    const save = lib.slice(lib.indexOf('function saveFunnelRich(id, perSetting, testControls = null) {'), lib.indexOf('function readFunnelRich(id) {'));
    assert.ok(save.includes('const had = readFunnelRich(id);'), 'the file is written without reading what is already in it');
    assert.ok(save.includes('settings: had && had.settings ? { ...had.settings } : {},'),
      'a press writes only its own settings over the top of every setting an earlier press worked out');
    assert.ok(save.includes('kept: had && had.settings ? Object.keys(had.settings).length : 0,'),
      'the answer does not say how many were already there, so nothing can tell adding from replacing');
  },

  // and a set does not depend on a file its parent owns
  aStageFourSetKeepsItsOwnCopyOfTheNumbersItsRuleReads() {
    const S = require('../lib/stages');
    // the copy itself: only real numbers, only for rows that have them
    assert.deepEqual(S.richForSurvivors([
      { label: 'a', maxDrawdown: 12, wins: 3, pnlThirds: [1, null, 2] },
      { label: 'b', maxDrawdown: null },
      { label: 'c' },
    ]), { a: { maxDrawdown: 12, wins: 3, pnlThirds: [1, null, 2] } },
    'the set keeps rows of nothing, or drops numbers it has');
    // laying it back on fills what the parent no longer holds, and nothing else
    const rows = [{ label: 'a', maxDrawdown: null, avgTest: 5 }, { label: 'b', maxDrawdown: 99 }, { label: 'c' }];
    assert.deepEqual(S.withOwnRich(rows, { a: { maxDrawdown: 12 }, b: { maxDrawdown: 1 } }), [
      { label: 'a', maxDrawdown: 12, avgTest: 5 },
      { label: 'b', maxDrawdown: 99 },
      { label: 'c' },
    ], 'the set\'s own copy either does not fill an empty column or overwrites a number the board still has');
    assert.equal(S.withOwnRich(rows, null), rows, 'a set with no copy of its own is copied for nothing');
    // the cut writes it, and the reader lays it on
    const lib = src('lib/stages.js');
    const cut = lib.slice(lib.indexOf('async function cutFunnelSet(parentId'), lib.indexOf('function richForSurvivors(rows) {'));
    assert.ok(cut.includes('doc.rich = richForSurvivors(survivors);'), 'the cut does not keep the numbers of the settings it wrote down');
    const rd = lib.slice(lib.indexOf('async function funnelSetRows(id, opts = {}) {'), lib.indexOf('function stage3Ranked('));
    assert.ok(rd.includes('const mine = withOwnRich(all, doc.rich);'), 'the set is read without its own copy, so a lost column stays lost');
    assert.ok(rd.includes('for (const r of mine) if (want.has(r.label)) byLabel.set(r.label, r);'), 'the rows are still taken off the parent-only board');
    // AND A SET CUT BEFORE THIS IS FILLED IN AND STAMPED, ONCE (RULE NINE)
    assert.ok(rd.includes('if (!doc.rich) {') && rd.includes('saveSet(doc);'), 'a set cut before the copy existed is never given one');
  },

  // the rule is still asked of the parent's board, and the answer says why when
  // the two differ -- a set must not look broken when what is missing is a number
  aSetSaysWhichNumbersItsRuleReadsAreGoneAndOffersToWorkThemOut() {
    const lib = src('lib/stages.js');
    const rd = lib.slice(lib.indexOf('async function funnelSetRows(id, opts = {}) {'), lib.indexOf('function stage3Ranked('));
    assert.ok(rd.includes('const now = S4.applyRule(all, S4.normaliseRule(doc.rule));'),
      'the rule is asked of the set\'s own numbers, which would hide a board that really has moved');
    assert.ok(rd.includes('const nowOwn = S4.applyRule(mine, S4.normaliseRule(doc.rule));'), 'the same question is never asked of the set\'s own copy');
    assert.ok(rd.includes('.filter((f) => RICH_FIELDS.includes(f))'), 'nothing works out which of the rule\'s limits read a rebuilt number');
    assert.ok(/sameOwn, own: nowOwn\.length, stamped: richStamped,/.test(rd), 'the answer does not travel to the screen');
    // the screen says it, and offers the one thing that puts it right
    const page = src('public/construct.js');
    const nb = page.slice(page.indexOf('function fCutNumbers(rec) {'), page.indexOf('function fCutHead(cd, st) {'));
    assert.ok(nb.includes('id="fSetRebuild"'), 'there is no way to put back the numbers a later pass took away');
    assert.ok(nb.includes('>Work out the test history numbers</button>'), 'the control does not say what it does');
    // AND NOTHING ON THIS SCREEN NAMES THE PRESS BY A NAME IT NO LONGER HAS, or
    // sends the owner to a step it no longer sits on (3.103.2). Both were true
    // of this panel after the walk's press moved and was renamed.
    assert.ok(!/work out the missing numbers/.test(nb), 'the panel still calls them the missing numbers');
    assert.ok(!/at step 6|on step 6/.test(nb), 'the panel still sends the owner to step 6 for a press that is not there');
    const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
    const entry = help.slice(help.indexOf('fSetRebuild: {'), help.indexOf('fRegionAtLeast: {'));
    assert.ok(!/step 6/.test(entry), 'the help for this press still names step 6');
    assert.ok(!/work out the missing numbers/.test(entry), 'the help for this press still uses the old name');
    assert.ok(/Work out the test history numbers/.test(entry), 'the help does not name the press a walk uses, so the two read as unrelated');
    assert.ok(nb.includes("This set kept its own copy, so the rows below and their columns are complete."),
      'a set that kept its own copy is not told so, and reads as broken');
    assert.ok(nb.includes('This set has no copy of its own, so the columns below are empty and the rule cannot be re-applied.'),
      'a set with nothing to fall back on is not told so');
    assert.ok(/const F_LIMIT_WORDS = \{ maxDrawdown: 'worst losing streak', avgTrades: 'trades' \};/.test(page),
      'the two limits are named to the owner in words that are not on the screen (RULE ONE)');
    // and the door it presses is started and polled, because it prices
    const srv = src('server.js');
    assert.ok(srv.includes("app.post('/api/funnel/set/:id/rebuild'") && srv.includes("app.get('/api/funnel/set/:id/rebuild'"),
      'there is no door to work a set\'s own numbers out, or no door to ask how far it has got');
    const S = require('../lib/stages');
    assert.equal(typeof S.rebuildSetRichStart, 'function', 'nothing can start it');
    assert.equal(S.rebuildSetRichStatus('s4-nothing-here').running, false, 'asking about a set nothing is running for reads as running');
  },

  // owner, 2026-09-04: "you must not allow the page processing to freeze ...
  // items like that need to leave a few cpu cycles to service going to the
  // Setup | Compute tab for example without this kind of thing: NO ANSWER IN
  // TIME ... HTTP 504"
  async theCutStartsAndIsPolledSoNoOneRequestIsHeldOpen() {
    const S = require('../lib/stages');
    assert.equal(typeof S.cutFunnelSetStart, 'function', 'the cut cannot be started without being waited on');
    assert.equal(typeof S.cutFunnelSetStatus, 'function', 'nothing can ask how far the cut has got');
    // asking about a set nothing is being written for answers, it does not throw
    const idle = S.cutFunnelSetStatus('s3-nothing-here');
    assert.equal(idle.running, false, 'a set with no cut going reads as running');
    assert.equal(idle.result, null, 'a set with no cut going hands back a result');
    const srv = src('server.js');
    assert.ok(srv.includes("app.get('/api/funnel/:id/cut'"), 'there is no door to ask how far the cut has got');
    assert.ok(srv.includes('stages.cutFunnelSetStart(req.params.id, req.body || {})'), 'the press still waits for the whole cut on one request');
    assert.ok(!/await stages\.cutFunnelSet\(/.test(srv), 'the door still holds the request open for the whole cut');
    const page = src('public/construct.js');
    assert.ok(page.includes('async function fCutFollow(st) {'), 'the page does not follow the cut it started');
    assert.ok(/const out = started \? await fCutFollow\(st\) : null;/.test(page), 'the press does not wait on the following, so it lands on nothing');
  },

  // the passes over the whole board hand the thread back, and the check that
  // used to be quadratic is not any more
  theCutHandsTheThreadBackAndNeverComparesEveryNameAgainstEveryName() {
    const S4 = require('../lib/funnelset');
    const lib = src('lib/funnelset.js');
    const rep = lib.slice(lib.indexOf('function replay(doc, parentRows'), lib.indexOf('const APPLY_CHUNK'));
    assert.ok(!/\.includes\(l\)/.test(rep), 'the two lists are compared name against name again, which is millions of comparisons on a big rule');
    assert.ok(rep.includes('const gotSet = new Set(got);') && rep.includes('const hadSet = new Set(had);'), 'the comparison is not made through sets');
    // and it takes the survivors it was handed rather than working them out again
    assert.ok(rep.includes('(survivors || applyRule(parentRows, doc.rule))'), 'the replay reads the whole board a second time');
    const cut = src('lib/stages.js');
    const body = cut.slice(cut.indexOf('async function cutFunnelSet(parentId'), cut.indexOf('// ---- THE CUT, STARTED AND POLLED'));
    assert.ok(body.includes('await S4.applyRuleSlowly(ranked, doc.rule, note);'), 'the cut reads the whole board without ever handing the thread back');
    assert.ok(body.includes('S4.replay(doc, ranked, survivors)'), 'the cut works its survivors out twice');
    // the chunked pass gives the same answer as the one-shot one
    const rows = Array.from({ length: 250 }, (_, i) => ({ tHours: i, gate: i % 2 ? 'a' : 'b', label: `r${i}` }));
    const rule = { ranges: { tHours: { min: 10, max: 200 } }, allowed: { gate: ['a'] }, floors: {} };
    return S4.applyRuleSlowly(rows, rule).then((slow) => {
      assert.deepEqual(slow.map((r) => r.label), S4.applyRule(rows, rule).map((r) => r.label),
        'the chunked pass keeps a different set of settings from the one-shot pass');
    });
  },

  // "Notice too that this is the wrong message for hitting that button on the
  // Funnel tab."
  aPressThatTimesOutSaysWhereItsOwnAnswerWillShow() {
    const page = src('public/construct.js');
    assert.ok(page.includes('const tryPost = async (p, body, where = WHERE_SWEEP) => {'),
      'every press that times out is told to look at the same two screens, whatever was pressed');
    assert.ok(page.includes("+ e.message + '\\n\\n' + where"), 'the message does not use what the caller said');
    assert.ok(page.includes("const WHERE_FUNNEL = 'The Stage 4 record set box at the top of this screen lists what landed"),
      'there is no line for a press on this screen');
    // the two presses on this screen that can take a while use it
    const cutWire = page.slice(page.indexOf("const cut = $('#fCut');"), page.indexOf("document.querySelectorAll('[data-frm]')"));
    assert.ok(cutWire.includes('}, WHERE_FUNNEL);'), 'writing a set still points at Sweep and Boards, which know nothing about it');
    const rb = page.slice(page.indexOf("const rbs = [...document.querySelectorAll('[data-frebuild]')];"), page.indexOf("const cs = $('#fClose');"));
    // 3.81.0: the press starts a run and comes straight back, so it can no
    // longer time out -- but the start itself still can, and it points here.
    assert.ok(/\{\}, WHERE_FUNNEL\);/.test(rb),
      'working out the missing numbers still points at Sweep and Boards, which know nothing about it');
  },

  // owner, 2026-09-04: "on 'write the Stage 4 set' the behavior needs to be
  // refresh the new item into the Stage 4 record set list at the top and then
  // display that new record set"
  writingAStageFourSetLandsOnTheSetItJustWrote() {
    const page = src('public/construct.js');
    const wire = page.slice(page.indexOf("const cut = $('#fCut');"), page.indexOf("document.querySelectorAll('[data-frm]')"));
    assert.ok(wire.includes('if (out.id) { st.cut = out.id; fSave(); return drawFunnel(); }'),
      'writing a set does not land on it, so the owner is left on the walk with a line of text');
    assert.ok(!/st\.cut = F_NEW;/.test(wire), 'writing a set still forces the walk back on screen');
    // the list at the top comes off the read, so the redraw is what refreshes it
    const draw = page.slice(page.indexOf('async function drawFunnel('), page.indexOf('function fCutChosen('));
    assert.ok(/cuts/.test(draw) || page.includes('const cutId = fCutChosen(st, d);'),
      'the list at the top is not read again on a redraw, so a set just written could not appear on it');
    // and a reply with no id still says what happened rather than going silent
    assert.ok(wire.includes("$('#fCutMsg').textContent = `${out.name} written for"),
      'a write that comes back without an id says nothing at all');
    assert.ok(wire.includes("if (!out) { $('#fCutMsg').textContent = ''; return; }"), 'a failed write is not cleared');
  },

  // owner, 2026-09-04: "the name field in step 7 should be wider"
  theNameBoxOnStepSevenTakesTheRoomTheRowHasLeft() {
    const page = src('public/construct.js');
    const seven = page.slice(page.indexOf('function fStep7(d, st) {'), page.indexOf('function fRuleClauses(st) {'));
    assert.ok(seven.includes('<label class="f" style="flex:1 1 30rem;min-width:14rem">name<input id="fName" style="width:100%"'),
      'the name box is a fixed width again, and the names it holds are long enough to run out of it');
    assert.ok(!/id="fName" style="width:1[0-9]rem"/.test(seven), 'the fixed width is back on the box itself');
    // and it may never push the row's own button off: it shrinks, and the row
    // it sits in is the page's own, which wraps
    assert.ok(seven.includes('<div class="row" style="align-items:flex-end">'), 'the name box left the row that keeps the controls lined up');
  },

  // OWNER REPORT, 2026-09-04: "work out the missing numbers / done for 640
  // setting(s); all 640 match what the sweep stored / worst losing streak: no
  // survivor carries this number yet - press work out the missing numbers
  // first." Both lines on screen at once, one of them false.
  theNumbersJustWorkedOutAreOnScreenBeforeTheAnswerBesideTheButtonIs() {
    const page = src('public/construct.js');
    // 3.81.0: the press starts the run and fRichWatch reads the answer, so the
    // redraw that lays the numbers on lives there. Still one press: the owner
    // does nothing between starting it and seeing the values.
    const wire = page.slice(page.indexOf('async function fRichWatch(st) {'), page.indexOf('async function fHoldPoll(st) {'));
    assert.ok(/drawFunnel\(\);/.test(wire), 'the press works the numbers out and never reads them back, so the two limits below it go on saying nothing carries them');
    assert.ok(!/\$\('#fRebuildMsg'\)\.textContent = pr\.ran/.test(wire),
      'the proof is written straight onto the screen, so the redraw that fetches the numbers wipes it');
    assert.ok(/st\.rebuiltSaid = pr\.ran/.test(wire), 'the walk does not keep what the press said, so nothing survives the redraw');
    // and an unchecked rebuild must still never read as checked
    assert.ok(/NOT checked against the sweep/.test(wire), 'an unproved rebuild no longer says so');
    // 3.102.0: the press and what it said moved above the steps with it
    const panel = page.slice(page.indexOf('function fHoldPanel(d, st) {'), page.indexOf('function fStep6(d, st, r) {'));
    assert.ok(panel.includes('${st.rebuiltSaid ? `<p class="note">${esc(st.rebuiltSaid)}</p>` : \'\'}'),
      'the screen does not print what the press said, so a proof kept on the walk never reaches the owner');
    // a proof may never outlive the rebuild it is about: it is cleared wherever
    // the flag beside it is
    const cleared = (page.match(/st\.rebuilt = false;/g) || []).length;
    const said = (page.match(/st\.rebuiltSaid = null;/g) || []).length;
    assert.equal(said, cleared, 'a walk can start again carrying the proof of a rebuild it no longer has');
  },

  // "there should be another control that lets the entire user rule be retained
  // into step 6"
  theOwnersOwnRuleCanBeCarriedWholeIntoStepSix() {
    const page = src('public/construct.js');
    const step = page.slice(page.indexOf('function fStep5(r, d, st) {'), page.indexOf('// WHAT EACH LIMIT WOULD KEEP'));
    assert.ok(step.includes('id="fKeepMine"'), 'there is no way past step 5 that keeps the rule you built');
    assert.ok(step.includes('Keep my own rule and go on'), 'the control does not say what it does');
    // it is drawn whether or not there is a region to keep
    assert.ok(step.indexOf('${mine}') > step.indexOf('No region:'), 'the way past step 5 is only offered when there IS a region, and a walk with none is the case that needs it most');
    const wire = page.slice(page.indexOf("const km = $('#fKeepMine');"), page.indexOf("const kr = $('#fKeepRegion');"));
    assert.ok(!/st\.rule\./.test(wire), 'the way past step 5 writes into the rule, and it is supposed to leave it alone');
    assert.ok(wire.includes('st.step = 6;'), 'it does not move on to step 6');
    assert.ok(wire.includes("chose: 'not kept - my own rule carried on whole'"), 'the walk does not record that the region was refused');
    assert.ok(wire.includes('markStep(5);'), 'walking past step 5 this way drops the marks the step earned');
  },

};

// ONE BOX PER PART OF THE COIN AND SHAPE (3.80.0, owner order 2026-09-07:
// "fix the top of the Funnel to allow the coin and shape selector to have 3
// fields above coin, alongside1, alongside2 ... we need to be able to type
// those in or drop them down (even better) to select the actual coin and
// shape").
//
// It was ONE list of every joined-up unit name, so picking a coin the owner
// already had in mind meant reading hundreds of lines to find the one that
// said it. The check that matters is not that four boxes exist: it is that no
// sequence of presses can land on a board the set does not hold, and that the
// boxes to the right are not thrown away when a box on the left is changed to
// something they still fit.
module.exports.theCoinAndShapeBoxIsOneBoxPerPart = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const lift = (head, end) => {
    const at = src.indexOf(head);
    assert.ok(at > 0, `${head} is gone`);
    return src.slice(at, src.indexOf(end, at) + end.length);
  };
  const bits = [
    lift('const esc = (t) => {', '\n};\n'),
    lift('const fUnitOf = (d, key)', '\n'),
    lift('function fUnitResolve(d, want) {', '\n}\n'),
    lift("const F_UNIT_NONE = ", '\n'),
    lift('function fUnitPicker(d) {', '\n}\n'),
  ].join('\n');
  // eslint-disable-next-line no-eval
  const { fUnitPicker, fUnitResolve } = eval(`(() => { ${bits}\nreturn { fUnitPicker, fUnitResolve }; })()`);

  const U = (trade, ctx1, ctx2, geometry) => ({
    key: `${trade}|${ctx1 || ''}|${ctx2 || ''}|${geometry}`,
    name: `${trade}${ctx1 ? ` alongside ${ctx1}` : ''}${ctx2 ? ` and ${ctx2}` : ''} ${geometry}`,
    trade, ctx1: ctx1 || null, ctx2: ctx2 || null, geometry,
  });
  const units = [
    U('LTCUSDT', null, null, 'daily-1d'),
    U('LTCUSDT', null, null, 'weekly-8d'),
    U('LTCUSDT', 'BTCUSDT', null, 'daily-1d'),
    U('LTCUSDT', 'BTCUSDT', 'ETHUSDT', 'daily-1d'),
    U('SOLUSDT', null, null, 'weekly-8d'),
  ];
  const triple = U('LTCUSDT', 'BTCUSDT', 'ETHUSDT', 'daily-1d').key;
  const optionsOf = (html, id) => {
    const at = html.indexOf(`<select id="${id}"`);
    assert.ok(at > 0, `there is no ${id} box`);
    const block = html.slice(at, html.indexOf('</select>', at));
    return [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  };
  const selectedOf = (html, id) => {
    const at = html.indexOf(`<select id="${id}"`);
    const block = html.slice(at, html.indexOf('</select>', at));
    const hit = /<option value="([^"]*)" selected>/.exec(block);
    return hit ? hit[1] : null;
  };

  // FOUR BOXES, each offering only what the set holds beside the ones left of it
  const on = fUnitPicker({ units, unit: triple });
  assert.deepStrictEqual(optionsOf(on, 'fUnit'), ['all', 'LTCUSDT', 'SOLUSDT'],
    'the coin box offers the blend and every traded coin, once each');
  assert.deepStrictEqual(optionsOf(on, 'fUnitA1'), ['', 'BTCUSDT'],
    'alongside 1 offers only what this coin is read against — and on its own');
  assert.deepStrictEqual(optionsOf(on, 'fUnitA2'), ['', 'ETHUSDT'],
    'alongside 2 is narrowed by alongside 1');
  assert.deepStrictEqual(optionsOf(on, 'fUnitGeom'), ['daily-1d'],
    'and the chunk shape by all three above it — the triple was priced at one shape only');
  assert.strictEqual(selectedOf(on, 'fUnit'), 'LTCUSDT', 'the boxes show the board actually being walked');
  assert.strictEqual(selectedOf(on, 'fUnitA1'), 'BTCUSDT');
  assert.strictEqual(selectedOf(on, 'fUnitA2'), 'ETHUSDT');
  assert.strictEqual(selectedOf(on, 'fUnitGeom'), 'daily-1d');

  // the coin on its own: alongside 2 has nothing to offer but "on its own"
  const alone = fUnitPicker({ units, unit: U('LTCUSDT', null, null, 'daily-1d').key });
  assert.deepStrictEqual(optionsOf(alone, 'fUnitA2'), [''], 'a coin read against nothing has no second alongside');
  assert.deepStrictEqual(optionsOf(alone, 'fUnitGeom'), ['daily-1d', 'weekly-8d'],
    'and both shapes it was priced at are offered');

  // all units together: nothing to the right of the coin box to choose
  const blend = fUnitPicker({ units, unit: null });
  assert.strictEqual(selectedOf(blend, 'fUnit'), 'all', 'the blend is chosen by name');
  for (const id of ['fUnitA1', 'fUnitA2', 'fUnitGeom']) {
    assert.ok(new RegExp(`<select id="${id}" disabled>`).test(blend), `${id} is dead on the blend, not silently ignored`);
  }

  // NO PRESS CAN LAND ON A BOARD THAT IS NOT THERE. Every resolution is a key
  // the set listed, and what cannot be honoured is dropped left to right.
  const d = { units, unit: triple };
  assert.strictEqual(fUnitResolve(d, { trade: 'SOLUSDT', ctx1: null, ctx2: null, geometry: null }),
    U('SOLUSDT', null, null, 'weekly-8d').key, 'changing the coin lands on that coin\'s first board');
  assert.strictEqual(fUnitResolve(d, { trade: 'LTCUSDT', ctx1: '', ctx2: 'ETHUSDT', geometry: 'daily-1d' }),
    U('LTCUSDT', null, null, 'daily-1d').key,
    'an alongside 2 that cannot survive dropping alongside 1 is dropped, and the shape below it is still honoured');
  assert.strictEqual(fUnitResolve(d, { trade: 'LTCUSDT', ctx1: 'BTCUSDT', ctx2: '', geometry: 'weekly-8d' }),
    U('LTCUSDT', 'BTCUSDT', null, 'daily-1d').key,
    'a shape this pair was never priced at is dropped rather than refused');
  for (const want of [
    { trade: 'LTCUSDT', ctx1: 'BTCUSDT', ctx2: 'ETHUSDT', geometry: 'daily-1d' },
    { trade: 'SOLUSDT', ctx1: 'BTCUSDT', ctx2: 'ETHUSDT', geometry: 'daily-1d' },
    { trade: 'LTCUSDT', ctx1: '', ctx2: '', geometry: 'weekly-8d' },
  ]) {
    const got = fUnitResolve(d, want);
    assert.ok(units.some((u) => u.key === got), `resolved to ${got}, which the set does not hold`);
  }
  assert.strictEqual(fUnitResolve({ units: [], unit: null }, { trade: 'LTCUSDT' }), null,
    'a set with no units resolves to nothing rather than inventing a board');
};

// EVERY CALLER OF THE COIN-AND-SHAPE WIRING HANDS IT THE REPLY (3.80.1).
//
// 3.80.0 gave fWireUnit a second argument -- the reply, which is where the
// boxes' own lists live -- and updated ONE of its two callers. fWire's call
// was missed, so `fUnitOf(d, d.unit)` threw on every draw of the walk, and a
// throw there takes down every control wired after it: the dial box, the
// marks, the step buttons, all of it. The page was unusable.
//
// A grep for the picker's ids could not see that call, which is why this
// check reads the CALLS and not the ids.
module.exports.everyCallerOfTheCoinAndShapeWiringHandsItTheReply = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const calls = [...src.matchAll(/(?<!function )\bfWireUnit\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 2, `only ${calls.length} call(s) to fWireUnit found — the wiring has moved`);
  for (const args of calls) {
    assert.strictEqual(args.split(',').length, 2,
      `fWireUnit(${args}) is short an argument — without the reply the picker has no unit list and throws`);
  }
  assert.ok(/function fWireUnit\(st, d\) \{/.test(src), 'and the function still takes both');

  // AND IT CANNOT TAKE THE PAGE DOWN AGAIN. No reply is no board, never a throw.
  const lift = (head, end) => {
    const at = src.indexOf(head);
    assert.ok(at > 0, `${head} is gone`);
    return src.slice(at, src.indexOf(end, at) + end.length);
  };
  // eslint-disable-next-line no-eval
  const { fUnitOf, fUnitResolve } = eval(`(() => { ${
    lift('const fUnitOf = (d, key)', '\n')}\n${lift('function fUnitResolve(d, want) {', '\n}\n')
  }\nreturn { fUnitOf, fUnitResolve }; })()`);
  for (const nothing of [undefined, null, {}]) {
    assert.strictEqual(fUnitOf(nothing, 'LTCUSDT|||daily-1d'), null, 'no reply is no board');
    assert.strictEqual(fUnitResolve(nothing, { trade: 'LTCUSDT' }), null, 'and resolves to nothing');
  }
};

// STEP 6's PRESS: ONE PRESS, START TO FINISH, AND DEAD WHEN THERE IS NOTHING
// LEFT (3.81.0, owner orders 2026-09-07: "needs to not time out after 1
// minute", "needs to put on the screen beside or under the button the progress
// and the total cpu load", "during the work the button stays ghosted of course
// and other loads are not allowed", and "the interface tells the user to use
// the button again to load the values after the service is finished ... and
// then when the services are resting using the button fires the entire process
// again. absolutely horrible pathetic design").
module.exports.theStepSixPressFinishesOnItsOwnAndIsDeadWhenThereIsNothingLeft = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const svc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');

  // NOTHING IS HELD OPEN. The door starts it and reports on it; the pricing is
  // not inside the request any more, which is what the sixty-second gateway
  // was killing.
  assert.ok(/app\.post\('\/api\/funnel\/:id\/rebuild', \(req, res\) => \{\s*try \{ return res\.json\(stages\.funnelRichStart\(/.test(srv),
    'the press is no longer started-and-returned — it is doing the work inside the request again');
  assert.ok(srv.includes("app.get('/api/funnel/:id/rebuild', (req, res) => res.json(stages.funnelRichStatus(req.params.id)));"),
    'and there is no door to ask how far it has got');
  assert.ok(!/rebuild'[\s\S]{0,900}rebuildRichFor\(/.test(srv), 'the pricing is back inside the request handler');

  // AND THE PAGE NEVER ASKS FOR A SECOND PRESS.
  // scoped to step 6 and its watcher, and comment lines dropped: the comments
  // quote the fault so the record survives, and "press it again to put them
  // away" on the campaign tree is a different control doing a fair thing.
  const step6 = [src.slice(src.indexOf('function fHoldPanel(d, st) {'), src.indexOf('function fStep7(')),
    src.slice(src.indexOf('async function fRichWatch(st) {'), src.indexOf('async function fHoldPoll(st) {')),
    src.slice(src.indexOf("const rb = $('#fRebuild');"), src.indexOf('// THE CLOSING IS A CHOICE THAT CHANGES THE COUNT'))]
    .join('\n').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(step6.length > 500, 'step 6 and its watcher were not found');
  assert.ok(!/press it again/i.test(step6), 'the page still tells the owner to press it again');
  assert.ok(src.includes('async function fRichWatch(st) {') && src.includes('if (fRichGoing(d)) fRichWatch(st);'),
    'a run already going is not picked back up, so a reload loses it and the owner presses again');

  const lift = (head, end) => {
    const at = src.indexOf(head);
    assert.ok(at > 0, `${head} is gone`);
    return src.slice(at, src.indexOf(end, at) + end.length);
  };
  // eslint-disable-next-line no-eval
  const { fRichOff, fRichLine } = eval(`(() => { ${[
    lift('const fRichOf = (d)', '\n'),
    lift('const fRichGoing = (d)', '\n'),
    lift('function fRichOff(d) {', '\n}\n'),
    lift('function fCpuWords(cpu) {', '\n}\n'),
    lift('function fRichLine(d) {', '\n}\n'),
  ].join('\n')}\nreturn { fRichOff, fRichLine }; })()`);

  // GHOSTED while it works, and ghosted when there is nothing left to work out
  // -- which is the half that stopped a second press re-pricing everything.
  assert.strictEqual(fRichOff({ richOn: { have: 0, need: 640, run: { running: true } } }), true, 'ghosted while it works');
  assert.strictEqual(fRichOff({ richOn: { have: 640, need: 640, run: null } }), true, 'ghosted when every setting already carries them');
  assert.strictEqual(fRichOff({ richOn: { have: 0, need: 0, run: null } }), true, 'ghosted when the board holds no settings at all');
  assert.strictEqual(fRichOff({ richOn: { have: 100, need: 640, run: null } }), false, 'live when some are still missing');
  assert.strictEqual(fRichOff({}), true, 'and ghosted rather than throwing when the reply says nothing');
  // UNKNOWN IS LIVE, NEVER DEAD -- found by pressing the page for real, and
  // this is the assertion that was missing when it got through. A reply that
  // carries no count of its own ghosted the button with no explanation, which
  // is the exact fault this release fixes arriving by another door.
  // 3.102.0: the press preps the WHOLE record set, so the fallback is the size
  // of the board and not what today's rule keeps.
  assert.strictEqual(fRichOff({ of: 640 }), false,
    'a reply with no count of its own ghosts the press silently instead of leaving it live');
  assert.strictEqual(fRichOff({ survivors: 640, of: 0 }), true,
    'the fallback still reads the survivor count, so a rule that keeps some of an empty board leaves the press live');

  // THE PROGRESS AND THE CPU LOAD, on the line beside the button.
  const going = fRichLine({ richOn: { have: 0, need: 640, run: { running: true, done: 128, of: 640, cpu: { busy: 0.87, cores: 4 } } } });
  assert.ok(going.includes('128 of 640 settings'), `the progress is not on the line: ${going}`);
  assert.ok(going.includes('87% of 4 cores busy'), `the cpu load is not on the line: ${going}`);
  assert.ok(fRichLine({ richOn: { have: 640, need: 640, run: null } }).includes('done'), 'a finished one says so');
  assert.ok(/setting\(s\) in this record set/.test(fRichLine({ richOn: { have: 640, need: 640, run: null } })),
    'a finished one says the numbers cover the survivors rather than the record set');
  assert.ok(fRichLine({ richOn: { have: 100, need: 640, run: null } }).includes('the other 540'),
    'and a part-done one says how many are left, not how many there are');
  // a reading with nothing to difference against says nothing rather than 0%
  assert.ok(!/busy/.test(fRichLine({ richOn: { have: 0, need: 9, run: { running: true, done: 1, of: 9, cpu: { busy: null, cores: 4 } } } })),
    'an unknown cpu load prints as 0% busy, which reads as an idle box');

  // OTHER LOADS ARE NOT ALLOWED while it runs -- said once, in stageBusy, so
  // every refusal already built on it covers this without being told twice.
  assert.ok(/function stageBusy\(\)[\s\S]{0,900}const rich = richBusy\(\);\s*if \(rich\) return rich;/.test(svc),
    'stageBusy no longer names the step 6 press, so a stage launch can start on top of it');
  assert.ok(/function funnelRichStart\([\s\S]{0,900}claimOrRefuse\(\);/.test(svc),
    'and it can start on top of a sweep, a stage run or a totalling');
  for (const fn of ['funnelAcrossStart', 'funnelCrossesStart', 'cutFunnelSetStart', 'rebuildSetRichStart']) {
    assert.ok(new RegExp(`function ${fn}\\([^)]*\\) \\{\\s*//[^\\n]*\\n\\s*const richNow = richBusy\\(\\);`).test(svc),
      `${fn} does not refuse while the step 6 press is working`);
  }
};

// THE CPU READING IS THE REAL SHARE OF EVERY CORE (3.81.0), not the one-minute
// load average -- which reports the idle box at the start of a run and the
// finished run at the end of it, and is useless on a progress line.
module.exports.theCpuReadingIsTheShareOfEveryCoreSinceTheLastOne = function () {
  // THE VERY FIRST READING HAS NOTHING TO DIFFERENCE AGAINST and must say so
  // rather than print a 0% that reads as an idle box. Read out of the source:
  // by the time this test runs, something else in the suite has already taken
  // a sample, so there is no first reading left to take.
  const svc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
  assert.ok(svc.includes('if (!was || now.total <= was.total) return { busy: null, cores: now.cores };'),
    'the first reading no longer says it has nothing to compare');

  stages.cpuLoad();                                  // the baseline this one differences against
  const until = Date.now() + 200;
  while (Date.now() < until) { /* one core, busy */ }
  const got = stages.cpuLoad();
  assert.ok(got.cores >= 1, 'it does not know how many cores there are');
  assert.ok(got.busy > 0 && got.busy <= 1, `busy came back ${got.busy} — it is a share of every core, 0 to 1`);
  // one thread spinning is about one core's worth; well under half on any box
  // with two or more, and never above 1
  assert.ok(got.busy >= (0.5 / got.cores), `one core spinning read as ${(got.busy * 100).toFixed(1)}% of ${got.cores}`);
};

// THE REMAINING COUNT, CONTINUOUSLY (3.81.0, owner order 2026-09-07: "when
// putting numbers in the worst losing streak allowed and fewest trades the
// remaining settings size needs to be continuously displayed so we can try for
// our target without shooting in the dark").
module.exports.theRemainingCountIsAskedOnEveryKeystrokeAndTheLastAnswerWins = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const svc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');

  // BOTH boxes, on input -- not on change, which only fires when the box is left
  assert.ok(/for \(const id of \['fDD', 'fTrades'\]\)[\s\S]{0,220}b\.oninput = \(\) => \{ clearTimeout\(timer\); timer = setTimeout\(ask, 200\); \};/.test(src),
    'the two limit boxes no longer ask as they are typed in');
  assert.ok(/const mine = \+\+asked;[\s\S]{0,400}if \(mine !== asked\) return;/.test(src),
    'a slow answer to an older keystroke can overwrite the newer one');
  assert.ok(/const out = await askPost\(`api\/funnel\/\$\{encodeURIComponent\(st\.set\)\}\/keeps`/.test(src),
    'it asks through tryPost, which pops a dialog on every failed keystroke');

  // IT IS THE SAME ARITHMETIC THE WALK USES. The page sends a whole rule built
  // the way fAddFloors builds it; the service applies it. No second filter.
  assert.ok(/function fRuleWithFloors\(st\) \{[\s\S]{0,500}floors\.maxDrawdown = \{ max: Number\(dd\) \}[\s\S]{0,200}floors\.avgTrades = \{ min: Number\(tr\) \}/.test(src),
    'the typed limits are no longer folded into the rule the same way the press folds them');
  assert.ok(/async function funnelKeeps\(id, state = \{\}\) \{[\s\S]{0,900}S4\.applyRule\(all, rule\)\.length/.test(svc),
    'the count is no longer the same applyRule the walk uses');

  const at = src.indexOf('function fKeepsWords(keeps, of, target) {');
  assert.ok(at > 0, 'the wording is gone');
  // eslint-disable-next-line no-eval
  const fKeepsWords = eval(`(() => { ${src.slice(at, src.indexOf('\n}\n', at) + 3)}\nreturn fKeepsWords; })()`);
  assert.ok(fKeepsWords(316, 12000, null).includes('316 of 12,000'), 'the count and what it is out of');
  assert.ok(fKeepsWords(316, 12000, 300).includes('16 above the target of 300'), 'and how far from the target');
  assert.ok(fKeepsWords(280, 12000, 300).includes('20 below the target of 300'));
  assert.ok(fKeepsWords(300, 12000, 300).includes('exactly the target'));
  assert.ok(fKeepsWords(null, null, 300).includes('not known yet'), 'and an unknown count never reads as zero');

  // ONE wording: the first draw and every keystroke print through it
  assert.ok(src.includes('${esc(fKeepsWords(d.survivors, d.of, d.target))}') && src.includes('fKeepsWords(out.keeps, out.of, st.target)'),
    'the first draw and the keystrokes no longer share one wording');
};
