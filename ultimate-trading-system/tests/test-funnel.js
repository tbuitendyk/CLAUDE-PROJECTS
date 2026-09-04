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
  // the same words, whenever it was written. The stamp goes on at birth for the
  // three stages and the startup migration puts it on everything already there.
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
    assert.ok(/stampBoardNullOnEverySet/.test(src('server.js')),
      'and the sets already on disk must be brought up to date without anyone remembering to');
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
    assert.strictEqual(stages.needsBoardNullStamp({ id: 's3-x' }), true);
    assert.strictEqual(stages.needsBoardNullStamp({ id: 's3-x', boardNull: { captured: false } }), false);
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

  // Writing under a running writer is how a set document gets half a stamp.
  theStampRefusesWhileAStageJobIsGoing() {
    const s = src('lib/stages.js');
    const fn = s.slice(s.indexOf('function stampBoardNullOnEverySet'), s.indexOf('function stampBoardNullOnEverySet') + 900);
    assert.ok(/const busy = stageRunning\(\);/.test(fn), 'it must ask whether a job is going');
    assert.ok(/if \(busy\) return/.test(fn), 'and refuse rather than write beside it');
    assert.ok(/refused/.test(fn), 'and say it refused rather than reporting nothing to do');
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
    const applyAt = body.indexOf('S4.applyRule(ranked, doc.rule)');
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
    assert.ok(/const lo = have\.min != null \? have\.min : \(rr\.min != null \? rr\.min : ''\);/.test(s2),
      'the boxes are pre-filled from the rule, else from the recommendation');
    const s3 = fn('fStep3', 'fStep4');
    assert.ok(s3.includes('<select id="fA">') && s3.includes('<select id="fB">'), 'the two dials are pickers, not typed names');
    assert.ok(s3.includes('data-fcell=') && s3.includes('id="fKeepBlock"'), 'the grid has corners to press and a block to keep');
    assert.ok(s3.includes("kind === 'halves' ? 'The check - each half"), 'the check grid is drawn underneath');
    const s4 = fn('fStep4', 'fStep5');
    assert.ok(s4.includes('id="fAccept4"'), 'step 4 has an accept');
    assert.ok(s4.includes('The check managed'), 'and prints what the check managed beside the real count');
    const s5 = fn('fStep5', 'fLadder');
    assert.ok(s5.includes('id="fKeepRegion"'), 'step 5 keeps the widest region');
    assert.ok(!s5.includes('JSON.stringify'), 'and never prints its answer as raw JSON');
    const s6 = fn('fStep6', 'fStep7');
    assert.ok(s6.includes("fLadder('worst losing streak'") && s6.includes("fLadder('trades'"), 'step 6 shows what each limit would keep');
    // and every new control has help
    const h = src('public/help-content.js');
    for (const id of ['fKeepValues', 'fKeepBlock', 'fAccept4', 'fKeepRegion']) assert.ok(h.includes(`      ${id}: {`), `${id} has no help entry`);
  },

  // THE PAGE NEVER CLAIMS A DRAWING THAT IS NOT THERE. The one sentence that
  // did is gone, and the line that replaces it names what is on the screen.
  thePageNeverClaimsAComparisonItDoesNotDraw() {
    const s = src('public/construct.js');
    assert.ok(!s.includes('is drawn beside. '), 'the false claim is gone');
    const nl = s.slice(s.indexOf('function fNoiseLine('), s.indexOf('\n}\n', s.indexOf('function fNoiseLine(')));
    assert.ok(nl.includes("if (n.sizes) {") && nl.includes("return '';"), 'the line prints the region sizes or nothing at all');
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
    assert.ok(sv.includes('marks: doc.marks || [],') && sv.includes('marks: d.marks || [],'), 'the cut reply and the set list carry them');
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
      assert.strictEqual(rich.v, 2, 'per-unit numbers are the second shape of this file');
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
    assert.ok(cutAt > 0 && /unit: st\.unit,\n\s*barPct: st\.barPct,\n\s*\}\);/.test(wire.slice(cutAt, cutAt + 700)), 'the cut carries the unit');
    assert.ok(src.includes('<select id="fUnit"><option value="all"'), 'the picker offers the blend as all');
    assert.ok(src.includes('${(d.units || []).map((u) => `<option value="${esc(u.key)}"'), 'and every unit the reply listed');
    // a walk is saved per unit, and never under no unit
    assert.ok(src.includes('if (!fState || !fState.unit) return;'), 'no walk is saved under no unit');
    assert.ok(src.includes("const fWalkKeyFor = (set, unit) => `cx-funnel-${set}-${unit || 'all'}`;"), 'one walk per set and unit');
  },

  onAUnitsBoardStepFourIsReadByPressingAndTheAcceptRecordsThatRead() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const s4 = src.slice(src.indexOf('function fStep4('), src.indexOf('\nfunction fStep5('));
    assert.ok(s4.includes('if (r.pressed) {'), 'step 4 on a unit\'s board is its own drawing');
    assert.ok(s4.includes('<button id="fAcross" class="pri" ${asked ? \'disabled\' : \'\'}>read the other units</button>'), 'read by pressing');
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
    assert.ok(s4.includes("<button id=\"fAcross\" class=\"pri\" ${asked ? 'disabled' : ''}>read the other units</button>"), 'the button is held while its reading runs');
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

  // THE SEALED WINDOW RIDES ON STAGE 2 RECORDS, AND A SET WRITTEN WITHOUT IT
  // IS FILLED IN FROM ITS PARENT (3.51.0, owner order 2026-09-04: "fix and
  // deploy the no sealed window deficiency"). Stage 2 carried the bounds into
  // each unit's stores and not onto the record the Funnel reads, so every
  // stage 3 set said "5 of 5 units carry no sealed window". Now the record
  // carries them, and a stage 2 set on disk without them is filled in from
  // its stage 1 parent by unit -- beside, verified, swapped -- announced by
  // the read and run once in the background.
  async aStageTwoSetWithoutItsSealedWindowIsFilledInFromItsParent() {
    const rowstore = require('../lib/rowstore');
    const s = src('lib/stages.js');
    assert.ok(s.includes('          reserve: rec.reserve || null,\n          specs: merged.members.map('), 'the stage 2 record does not carry the sealed bounds');
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
      const w1 = rowstore.writer(ids.s1, 'records');
      units.forEach(([trade, geometry], u) => w1.push({ u, trade, ctx1: null, ctx2: null, size: 1, geometry, bandPct: 2, reserve: { chunks: 45, fromTs: 1759104000000 + u }, specs: [], blocks: {} }));
      w1.close();
      const w2 = rowstore.writer(ids.s2, 'records');
      units.forEach(([trade, geometry], u) => w2.push({ u, s1u: u, s1rank: u + 1, carriedRank: u + 1, trade, ctx1: null, ctx2: null, size: 1, geometry, bandPct: 2, specs: [], scoreAll: 1, blocks: { votes: [u, u] } }));
      w2.close();
      const s3 = stages.getSet(ids.s3);
      assert.strictEqual(stages.sealedWindowOf(s3).sealed, false);
      assert.strictEqual(stages.sealedWindowOf(s3).why, '3 of 3 units carry no sealed window', 'the words the owner saw');
      const behind = stages.sealedBehind(stages.getSet(ids.s2));
      assert.ok(behind && behind.fillable, 'a stage 2 set without the bounds, whose parent has them, is fillable');
      const waiting = stages.sealedFillWaiting(s3);
      assert.ok(/^filling in the sealed window of S2 #sw from S1 #sw: \d+ of 3 records$/.test(waiting), `the read says what it is waiting for: ${waiting}`);
      assert.ok(/filling in the sealed window/.test(stages.sealedFillWaiting(s3)), 'asked again while it goes, it says so again and starts nothing new');
      await stages.sealedFillPromise(ids.s2);
      const after = rowstore.readAll(ids.s2, 'records');
      assert.strictEqual(after.length, 3, 'same rows');
      assert.deepStrictEqual(after.map((r) => r.u), [0, 1, 2], 'same order');
      assert.deepStrictEqual(after.map((r) => r.reserve.fromTs), [1759104000000, 1759104000001, 1759104000002], 'each record carries its own unit\'s bounds from the parent');
      assert.deepStrictEqual(after[1].blocks, { votes: [1, 1] }, 'everything else on the record is untouched');
      assert.strictEqual(stages.sealedBehind(stages.getSet(ids.s2)), null, 'filled in, it is no longer behind');
      assert.strictEqual(stages.sealedFillWaiting(s3), null, 'and the read has nothing to wait for');
      assert.strictEqual(stages.sealedWindowOf(s3).sealed, true, 'the stage 3 set now reads sealed');
      const d2 = stages.getSet(ids.s2);
      assert.strictEqual(d2.status, 'done');
      assert.ok(d2.sealedFilledAt, 'the fill is stamped on the set');
      // a parent without the bounds cannot fill anything, and says so by name:
      // a second chain, whose stage 1 set was written before the bounds existed
      ids.s1n = `s1-test-${stamp}-swn`; ids.s2n = `s2-test-${stamp}-swn`; ids.s3n = `s3-test-${stamp}-swn`;
      mk(ids.s1n, { stage: 1, name: 'S1 #old', params: { windowLayout: 'reserve61' } });
      mk(ids.s2n, { stage: 2, name: 'S2 #old', parent: { id: ids.s1n, name: 'S1 #old' }, params: { windowLayout: 'reserve61' } });
      mk(ids.s3n, { stage: 3, name: 'S3 #old', parent: { id: ids.s2n, name: 'S2 #old' }, params: { windowLayout: 'reserve61', carry: 0, selected: null } });
      const w1b = rowstore.writer(ids.s1n, 'records');
      units.forEach(([trade, geometry], u) => w1b.push({ u, trade, ctx1: null, ctx2: null, size: 1, geometry, bandPct: 2, specs: [], blocks: {} }));
      w1b.close();
      const w2b = rowstore.writer(ids.s2n, 'records');
      units.forEach(([trade, geometry], u) => w2b.push({ u, s1u: u, s1rank: u + 1, carriedRank: u + 1, trade, ctx1: null, ctx2: null, size: 1, geometry, bandPct: 2, specs: [], scoreAll: 1, blocks: {} }));
      w2b.close();
      const stuck = stages.sealedBehind(stages.getSet(ids.s2n));
      assert.ok(stuck && !stuck.fillable && /S1 #old carries no sealed window for 3 of 3 units/.test(stuck.why), stuck && stuck.why);
      assert.strictEqual(stages.sealedFillWaiting(stages.getSet(ids.s3n)), null, 'nothing to wait for when nothing can be filled');
      assert.throws(() => stages.startSealedFill(ids.s2n), /carries no sealed window for 3 of 3 units/);
      assert.strictEqual(stages.sealedWindowOf(stages.getSet(ids.s3n)).why, '3 of 3 units carry no sealed window', 'and the stage 3 set still says so');
    } finally {
      for (const id of Object.values(ids)) {
        try { fs.rmSync(path.join(SETS, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      }
    }
    // and the read and the cut both go through the wait
    const read = s.slice(s.indexOf('async function funnelRead('), s.indexOf('\nfunction sliceRowsFor('));
    assert.ok(read.includes('  const sealing = sealedFillWaiting(doc);\n  if (sealing) return { waiting: sealing };'), 'the read does not wait for the fill');
    const cut = s.slice(s.indexOf('async function cutFunnelSet('), s.indexOf('async function cutFunnelSet(') + 600);
    assert.ok(cut.includes('const sealing = sealedFillWaiting(getSet(String(parentId || \'\')));') && cut.includes('if (sealing) throw new Error(`${sealing} — the cut waits for it'), 'the cut does not wait for the fill');
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
    assert.ok(/unit: st\.unit,\n\s*barPct: st\.barPct,\n\s*\}\);/.test(wire), 'the cut carries the share');
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
    for (const control of ['<b>first dial</b>', '<b>second dial</b>', '<b>thin below</b>', '<b>read the grid</b>', '<b>keep this block</b>']) {
      assert.ok(how.includes(control), `the steps do not name ${control}`);
    }
    // every control the steps name is one this step draws, with that label
    for (const label of ['first dial', 'second dial', 'thin below', 'read the grid', 'keep this block']) {
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
    assert.ok(step.includes("const alsoNone = Array.isArray(have.also) && have.also.map(String).includes('none');"), 'the tick does not read what the rule already holds');
    assert.ok(step.includes('${hasNone ? `<label class="c"><input type="checkbox" id="fAlsoNone" ${alsoNone ? \'checked\' : \'\'}> also keep none</label>` : \'\'}'),
      'the also keep none tick is not drawn beside the range boxes when the table has a none row');
    assert.ok(step.includes("if (!Number.isFinite(n)) return String(val) === 'none' && alsoNone;"), 'the count line does not count the none row when it is kept');
    const wire = page.slice(page.indexOf("const ar = $('#fAddRange');"), page.indexOf('const readGrid = () => {'));
    assert.ok(wire.includes("const alsoNone = !!($('#fAlsoNone') && $('#fAlsoNone').checked);"), 'pressing add this range does not read the tick');
    assert.ok(wire.includes("...(alsoNone ? { also: ['none'] } : {}) };"), 'the tick is not written into the rule as "or none"');
    assert.ok(wire.includes("chose: `${lo} to ${hi}${alsoNone ? ' or none' : ''}`"), 'the walk\'s note does not say none was kept');
    assert.ok(wire.includes("if (Number.isFinite(v) ? ((lo === '' || v >= Number(lo)) && (hi === '' || v <= Number(hi))) : (String(val) === 'none' && none)) kept += n;"),
      'the live count does not follow the tick');
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
    assert.ok(box.includes('<button data-frm="${esc(`${c.kind}|${c.key}`)}">remove</button>'), 'a clause has no remove of its own');
    const wire = page.slice(page.indexOf("document.querySelectorAll('[data-frm]').forEach((b) => {"), page.indexOf("const cl = $('#fClear');"));
    assert.ok(wire.includes('delete st.rule[kind][key];'), 'remove does not drop the clause');
    assert.ok(wire.includes("st.steps.push({ n: st.step, what: `removed from the rule: ${gone}`, chose: 'removed' });"), 'a removal is not recorded in the walk\'s notes');
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
    assert.ok(step.includes('starts one every ${Number(u.stepHours).toLocaleString()} hours, so up to\n          <b>${u.atOnce}</b> can be open at once'),
      'the step does not say how many can be open at once on each unit');
    assert.ok(step.includes('Across this reading that is <b>$${Number(ex.mostAtOnce).toLocaleString()}</b> on the table'),
      'the step does not say what can be on the table across the reading');
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
    assert.ok(/Press <b>work out the missing numbers<\/b> FIRST/.test(how), 'the steps do not say to press work out the missing numbers first');
    assert.ok(how.includes('It\n        changes no rule and no record'), 'the steps do not say that pressing it is safe');
    assert.ok(how.includes('in dollars, per coin'), 'the steps do not say what the losing streak is measured in');
    assert.ok(how.includes('counted over the window named above'), 'the steps do not say what the trade count is counted over');
    for (const control of ['<b>work out the missing numbers</b>', '<b>worst losing streak allowed</b>', '<b>fewest trades</b>', '<b>add these limits to the rule</b>']) {
      assert.ok(how.includes(control), `the steps do not name ${control}`);
    }
    for (const label of ['work out the missing numbers', 'worst losing streak allowed', 'fewest trades', 'add these limits to the rule']) {
      assert.ok(step.includes(`>${label}<`) || step.includes(`${label}<input`), `the steps name "${label}", which step 6 does not draw`);
    }
    assert.ok(step.includes("not done yet - press it first"), 'the line beside the button does not say to press it');
    // the trades ladder is put on a yearly footing and the dollar one is not
    assert.ok(step.includes("fLadder('trades', (r.ladders || {}).avgTrades, 'at least', ex)"), 'the trades ladder is not given the window');
    assert.ok(step.includes("fLadder('worst losing streak', (r.ladders || {}).maxDrawdown, 'at most', null)"), 'the dollar ladder must not be read as a rate');
    const lad = page.slice(page.indexOf('function fLadder('), page.indexOf('function fStep6('));
    assert.ok(lad.includes('${ex ? fPerYear(x.at, ex) : \'\'}'), 'a rung does not say what it comes to a year');
    assert.ok(lad.includes('press work out the missing numbers first'), 'the empty ladder does not say what to press');
    // the answer carries it, for the units the reading covers
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    assert.ok(lib.includes('exposure: exposureOf(doc, mineOnly.length ? mineOnly : (sealed.units || []),'), 'step 6\'s answer does not carry the exposure');
    assert.ok(lib.includes("{ holdHours: rows.reduce((a, r) => (Number.isFinite(Number(r.tHours)) && Number(r.tHours) > a ? Number(r.tHours) : a), 0) })"),
      'the overlap is not worked out at the longest hold the SURVIVORS still carry, so it stands at the block\'s widest whatever the rule says');
    assert.ok(lib.includes("const { NOTIONAL } = require('./paper');"), 'the stake is not read from the engine');
    const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
    assert.ok(/Press it FIRST on this step/.test(help), 'the help for the button does not say to press it first');
    assert.ok(/in dollars, per coin - the deepest the running total ever sat below its own best point/.test(help), 'the help for the losing streak does not say what it measures');
    assert.ok(/counted over the window named at the top of this step - not over a year/.test(help), 'the help for the trade count does not say what it is counted over');
  },

  // THE PRESS NAMES THE RULE (3.57.1, owner report 2026-09-04: pressing "work
  // out the missing numbers" answered "FAILED -- nothing changed. nothing was
  // asked for"). The page sent `{ labels: [] }` -- an empty list -- and the
  // service refuses an empty ask, so the button had never once worked. Two
  // source-scanning tests covered this step and neither pressed it.
  async pressingWorkOutTheMissingNumbersAsksForTheSurvivorsOfTheRule() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const press = page.slice(page.indexOf("const rb = $('#fRebuild');"), page.indexOf("const rb = $('#fRebuild');") + 1400);
    assert.ok(!/labels: \[\]/.test(press), 'the press asks for an empty list of settings again, which the service refuses');
    assert.ok(press.includes("/rebuild`, { rule: st.rule, unit: st.unit, barPct: st.barPct })"),
      'the press does not name the rule, the unit and the bar the way every other read does');
    assert.ok(press.includes('if (out.totalling || out.waiting) {'), 'a set whose tables are not built yet is reported as a failure rather than as work in flight');
    // the service works out the survivors through the ONE function that
    // applies a rule, so the settings rebuilt are the ones being counted
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    const fn = lib.slice(lib.indexOf('async function survivorLabelsOf('), lib.indexOf('async function rebuildRichFor('));
    assert.ok(fn.includes('S4.applyRule(all, S4.normaliseRule(state.rule))'), 'the survivors are worked out by some other arithmetic than the rule\'s own');
    assert.ok(fn.includes('const rich = readFunnelRich(id);') && fn.includes('withFunnelRich(board.all, rich)'),
      'the survivors are read off a board without the rebuilt numbers, so a second press would disagree with the first');
    assert.ok(fn.includes('if (!t) return null;'), 'a set with no tables must fall through to a totalling, not throw');
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const route = srv.slice(srv.indexOf("app.post('/api/funnel/:id/rebuild'"), srv.indexOf("app.post('/api/funnel/:id/rebuild'") + 3000);
    assert.ok(route.includes('if (!labels.length && (req.body || {}).rule) {'), 'the route does not work out the survivors from the rule it is sent');
    assert.ok(route.includes('const got = await stages.survivorLabelsOf(req.params.id, req.body || {});'), 'the route does not ask the engine who the survivors are');
    assert.ok(/the rule keeps none of this set's \$\{got\.of\.toLocaleString\(\)\} settings/.test(route),
      'a rule that keeps nothing must say so in those words, not "nothing was asked for"');
    assert.ok(route.includes('funnelRebuild = null;'), 'a refusal must free the rebuild slot, or the next press is told one is already going');
    // AND THE REBUILD CHECKS ITSELF (3.57.2, owner question 2026-09-04 about
    // "NOT checked against the sweep (the caller supplied nothing to check
    // against)"). The check only ran when the caller supplied the stored
    // figures and the page has none, so it never ran. The service reads them
    // beside the survivors.
    assert.ok(fn.includes('for (const r of rows) if (Number.isFinite(Number(r.avgTest))) stored[r.label] = Number(r.avgTest);'),
      'the survivors come back without the money the sweep stored for them, so nothing can be checked against it');
    assert.ok(fn.includes('return { labels: rows.map((r) => r.label), of: all.length, stored };'), 'the stored figures do not travel with the names');
    assert.ok(route.includes('if (!expect || !Object.keys(expect).length) expect = got.stored;'),
      'the route does not fall back to the stored figures it just read, so the check stays skipped');
    assert.ok(route.includes('const proof = stages.proveRebuild(got.perSetting, expect, undefined, onUnit);'), 'the proof is still handed only what the caller sent');
    assert.ok(!/proveRebuild\(got\.perSetting, \(req\.body \|\| \{\}\)\.expect \|\| null\)/.test(route), 'the proof reads the body again instead of what was resolved');
    // and the proof itself still refuses to claim a check it did not make
    const prove = lib.slice(lib.indexOf('function proveRebuild('), lib.indexOf('function proveRebuild(') + 700);
    assert.ok(prove.includes("why: 'the caller supplied nothing to check against'") && prove.includes('ran: false'),
      'a rebuild with nothing to check against must still say it was not checked');
    // and a list, when one IS sent, still works: the route has not lost its old door
    assert.ok(route.includes("const labels = Array.isArray((req.body || {}).labels)") || route.includes("let labels = Array.isArray((req.body || {}).labels)"),
      'the route no longer accepts a list of names at all');
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
    // the route names the board, and the page prints the count rather than the list
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(srv.includes("const onUnit = (req.body || {}).unit && String((req.body || {}).unit) !== 'all' ? String((req.body || {}).unit) : null;")
      && srv.includes('stages.proveRebuild(got.perSetting, expect, undefined, onUnit)'),
      'the route does not tell the proof which board the figures came from');
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
        // on ANOTHER coin and shape of the same stage 3 set, it is NOT
        const other = await stages.funnelRead(f.id, { step: 1, unit: f.keys[1], rule: { ranges: {}, allowed: {}, floors: {} } });
        assert.ok(!(other.cuts || []).some((c) => c.id === cut.id),
          'a set cut on one coin and shape is offered on another, which is a rule about one coin shown under the name of a different one');
        // and the blended board is a board of its own
        const blend = await stages.funnelRead(f.id, { step: 1, unit: 'all', rule: { ranges: {}, allowed: {}, floors: {} } });
        assert.ok(!(blend.cuts || []).some((c) => c.id === cut.id), 'a unit set is offered on the blended board');
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
  async theStageFourTableSortsTheWholeSetAndPagesIt() {
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
        // the page is a window on the sorted whole, and the count is the whole
        const p1 = await stages.funnelSetRows(cut.id, { n: 2, from: 0, sort: 'avgTest', dir: 'desc' });
        const p2 = await stages.funnelSetRows(cut.id, { n: 2, from: 2, sort: 'avgTest', dir: 'desc' });
        assert.equal(p1.total, all.total, 'the paging bar would say the page is the whole set');
        assert.equal(p1.rows.length, 2, 'a page of two came back a different size');
        assert.deepEqual(p1.rows.concat(p2.rows).map((r) => r.label), down.rows.slice(0, 4).map((r) => r.label),
          'the pages do not join up into the sorted whole, so a row falls between them');
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
    assert.ok(!/fClear|fAddRange|fKeepValues|fCutBtn|fRebuild/.test(cut), 'the Stage 4 view carries a control that changes the rule');
    assert.ok(/id="fCutName"/.test(cut) && /id="fCutRename"/.test(cut), 'the Stage 4 view has no rename control, and the owner asked for exactly that one');
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
    const head = page.slice(page.indexOf('function fHead(d, st) {'), page.indexOf('function fNoiseLine('));
    assert.ok(head.includes('${fCutPickBox(d, st || {})}'), 'the walk\'s heading does not carry the Stage 4 record set drop-down, so the walk is a one-way door');
    assert.ok(page.slice(page.indexOf('function fCutPickBox('), page.indexOf('function fCutPick(')).includes("if (!cuts.length) return '';"),
      'a coin and shape with nothing cut from it still gets a drop-down with only new rule in it');
    // the heading the owner drew, line by line
    for (const line of ['Rule:', 'Rule build settings:', 'settings survive', 'The sealed window is intact on',
      'This set carries', 'scrambled copies of the whole table']) {
      assert.ok(cut.includes(line), `the heading is missing the line "${line}" the owner drew`);
    }
    // the name of the set is shown after the header, and it is the set's own
    const table = page.slice(page.indexOf('function fCutTable('), page.indexOf('function fWireCut('));
    assert.ok(/<h3 style="margin-top:0">\$\{esc\(cd\.set\.name\)\}<\/h3>/.test(table),
      'the Stage 4 record set\'s name is not shown above its table');
    // ONE write on the whole screen
    const wire = page.slice(page.indexOf('function fWireCut('), page.indexOf('function fRuleBox('));
    // the two controls that are the way OUT of a set that will not open are
    // wired before anything that needs the set to have opened
    assert.ok(wire.indexOf('if (!cd) return;') < wire.indexOf("$('#fCutRename')"),
      'the rename is wired before the guard that says the set opened, so it reaches for a set that is not there');
    assert.ok(wire.indexOf('fWireUnit(st);') < wire.indexOf('if (!cd) return;')
      && wire.indexOf('fWireCutPick(st);') < wire.indexOf('if (!cd) return;'),
      'the two ways out of a set that will not open are wired after the guard that returns early');
    const posts = wire.match(/tryPost\(/g) || [];
    assert.equal(posts.length, 1, `the Stage 4 view makes ${posts.length} writes; it may make exactly one, the rename`);
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
    assert.ok(/if \(bad\) \{[\s\S]*?fCutPick\(d, st\)/.test(draw), 'a Stage 4 set that will not read leaves the owner with no way out of it');
    assert.ok(/if \(cd\.totalling \|\| cd\.waiting\) \{[\s\S]*?fCutPick\(d, st\)/.test(draw), 'a set whose parent is being totalled leaves the owner with no way out of it');
    assert.ok(draw.includes('fWireCut(d, st, null)'), 'the way out is drawn and not wired');
    // and the branch that chooses between the two screens cannot loop
    const pick = page.slice(page.indexOf('function fCutChosen('), page.indexOf('async function fDrawCut('));
    assert.ok(pick.includes('if (!cuts.length) return null;'), 'a board with no Stage 4 sets does not fall through to the walk');
    assert.ok(pick.includes('return cuts[0].id;'), 'a board with sets does not open on the newest of them');
    const br = page.slice(page.indexOf('const cutId = fCutChosen(st, d);'), page.indexOf('const r = d.reading || {};'));
    assert.ok(br.includes("if (cutId !== st.cut) { st.cut = cutId; fSave(); }"),
      'the chosen set is redrawn without being remembered, so every read asks again');
    // and showing a set asks for no step reading: the grid and the region are
    // minutes of work for a screen that is not drawn
    const read = page.slice(page.indexOf('d = await tryPost(`api/funnel/'), page.indexOf('} finally { waitEnd(); }'));
    assert.ok(read.includes("view: (st.cut && st.cut !== F_NEW) ? 'cut' : null,"),
      'showing a Stage 4 record set still pays for a step reading nothing draws');
  },

};
