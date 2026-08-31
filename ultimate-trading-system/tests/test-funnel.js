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

const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

module.exports = {
  // Every set says whether a board-wide noise reading was captured on it, in
  // the same words, whenever it was written. The stamp goes on at birth for the
  // three stages and the startup migration puts it on everything already there.
  everySetIsStampedWithItsBoardNoiseStateAtBirth() {
    const s = src('lib/stages.js');
    const births = s.split('measurements: MEASUREMENTS_VERSION,').length - 1;
    assert.strictEqual(births, 3, 'three stages create sets; all three must be counted here');
    const stamped = s.split('boardNull: { ...BOARD_NULL_NONE },').length - 1;
    assert.strictEqual(stamped, 3, 'every set-creation site must stamp the board-noise state');
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
};
