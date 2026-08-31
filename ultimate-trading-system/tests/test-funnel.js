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
};
