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
    for (const g of ['active', 'always']) {
      rows.push({
        si: rows.length, label: `t${t} ${g}`, tHours: t, gate: g,
        bandMode: t === 41 ? 'auto' : 5, maxDrawdown: t * 2, avgTest: t / 10,
      });
    }
  }
  return rows;
}

const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

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
    assert.ok(/params \|\| \{\}\)\.carry/.test(fn),
      "and with the set's OWN stored carry, or it resolves a different set of units");
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
    doc.rule = { ...rule, allowed: { gate: ['active', 'always'] } };
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
    assert.deepStrictEqual(kept.map((r) => r.label), ['t113 active', 't113 always', 't89 active'],
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
    assert.ok(/const closed = S4\.ruleWithClosing\(t\.ranked \|\| \[\], state\.rule, state\.closing, doc\.target\);/.test(body),
      'the closing must be folded into the rule through the one function that folds it');
    // the folded rule is what gets written AND what the survivors come from --
    // writing one rule and filtering by another is the same defect wearing a
    // different shape
    const foldAt = body.indexOf('const closed = S4.ruleWithClosing');
    const ruleAt = body.indexOf('doc.rule = closed.rule;');
    const applyAt = body.indexOf('S4.applyRule(t.ranked || [], doc.rule)');
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
    assert.ok(body.includes("const check = keptN ? { k: keptN } : { seed };"), 'the check is a count and a reader, never an array of copies');
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
      rows.push({ label: `t${t} k${k}`, tHours: t, gate: k % 2 ? 'active' : 'always',
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
    assert.deepStrictEqual(rec.recommend, { min: 65, max: 89, values: 2 });
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
    for (const t of [41, 65, 89, 113, 137]) for (const g of ['active', 'always']) {
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
    assert.ok(body.includes("out.check = { kind, k: keptN };"), 'the read names the check');
    assert.ok(body.includes("out.conditions.checkIsHalves = kind === 'halves';"));
    assert.ok(body.includes('r1.beating = beating;') && body.includes('r1.counts = counts;'), 'step 1: how many values beat the check, per dial');
    assert.ok(body.includes('r2.rec = F.recommendRange(rows, dial, check, { seed });'), 'step 2: the recommendation');
    assert.ok(body.includes('F.recommendBlock(g, checkGrids, kind)'), 'step 3: the block');
    assert.ok(body.includes("check: { kind, positive: checkReads.map((x) => x.positive)"), 'step 4: the check count');
    assert.ok(body.includes('S4.regionRule(out.reading, { ordered, categorical: F.CATEGORICAL_DIALS })'), 'step 5: the region as a rule');
    assert.ok(body.includes("maxDrawdown: F.ladderFor(rows, 'maxDrawdown', 'max')"), 'step 6: the ladders');
    assert.ok(body.includes('const all = withFunnelRich(t.ranked || [], rich);'), 'the rebuilt numbers are laid on before the rule');
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
    for (const g of ['active', 'always', 'directional']) for (let k = 0; k < 8; k++) {
      const real = g === 'always' ? 8 : (g === 'active' ? -2 : -15);
      const copy = g === 'always' ? 8 : (g === 'active' ? 1 : -6);
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
    for (let k = 0; k < 8; k++) rows.push({ label: `s${k}`, gate: k % 2 ? 'always' : 'active', avgTest: (k % 2 ? 22.78 : 3) + 1e-13, noiseTest: [k % 2 ? 22.78 : 3, k % 2 ? 22.78 : 3] });
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
};
