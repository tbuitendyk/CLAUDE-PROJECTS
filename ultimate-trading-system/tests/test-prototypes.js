// THE PROTOTYPE TABS ARE DRAWINGS, AND A DRAWING MUST NOT BE OPERABLE
// (owner order, 2026-08-26: "before writing anything into THIS-RELEASE you
// need to make a prototype page (call it 'Sweep2' for now) on a tab between
// Sweep and Boards ... ditto for a prototype on new tab 'Boards2'. mock them
// up IN DETAIL MISSING *ABSOLUTELY NOTHING* ... we will work off of that to
// make sure you get the design right before any coding").
//
// The same rule the Help tab's pictures live under: a control that can be
// pressed is one somebody will press, and a drawing that quietly asked the
// service for something would not be a drawing. So every control on both
// prototype tabs is disabled, neither page calls the service at all, and
// each page says what it is in its first line — held here so none of that
// can rot quietly while the drawing is being marked up.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { drawBody } = require('../lib/screencontrols');

const ROOT = path.join(__dirname, '..');
const src = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

module.exports = {
  // Sweep2 between Sweep and Boards, Boards2 straight after Boards — the
  // owner named the first position and the second mirrors it.
  async theTwoPrototypeTabsSitWhereTheOwnerPutThem() {
    const m = /const TABS = \[([\s\S]*?)\];/.exec(src());
    const keys = [...m[1].matchAll(/\['([^']+)'/g)].map((x) => x[1]);
    assert.strictEqual(keys[keys.indexOf('sweep') + 1], 'sweep2',
      `Sweep2 is not between Sweep and Boards: ${keys.join(', ')}`);
    assert.strictEqual(keys[keys.indexOf('boards') + 1], 'boards2',
      `Boards2 does not follow Boards: ${keys.join(', ')}`);
    assert.ok(/tab === 'sweep2' \? drawSweep2\(\)/.test(src()), 'nothing draws Sweep2');
    assert.ok(/tab === 'boards2' \? drawBoards2\(\)/.test(src()), 'nothing draws Boards2');
  },

  // Every box, tick, dropdown and button on both drawings is disabled. The
  // check reads the rendered tags themselves, so one control quietly made
  // operable fails by name.
  async everyControlOnBothPrototypesIsDead() {
    for (const fn of ['drawSweep2', 'drawBoards2']) {
      const body = drawBody(fn);
      const tags = [...body.matchAll(/<(select|input|button|textarea)\b[^>]*>/g)];
      assert.ok(tags.length > 8, `${fn} draws almost no controls — the drawing lost its subject`);
      for (const t of tags) {
        assert.ok(/\bdisabled\b/.test(t[0]) || /\$\{dead\}/.test(t[0]),
          `${fn} draws an operable control on a drawing: ${t[0].slice(0, 90)}`);
      }
    }
  },

  // Each page says what it is, in its first panel, in the same words — and
  // says its numbers are examples. A drawing that looks like a report is a
  // report that lies.
  async bothPrototypesSayTheyAreDrawings() {
    for (const fn of ['drawSweep2', 'drawBoards2']) {
      const body = drawBody(fn);
      assert.ok(body.includes('Nothing on this page works'), `${fn} no longer says it is a drawing`);
      assert.ok(body.includes('worked example'), `${fn} no longer says its numbers are worked examples`);
    }
  },

  // A drawing reads nothing and writes nothing. The moment one of these
  // calls the service it has stopped being a drawing, whatever it looks like.
  async thePrototypesAskTheServiceForNothing() {
    for (const fn of ['drawSweep2', 'drawBoards2']) {
      const body = drawBody(fn);
      for (const call of ['api(', 'apiOr(', 'tryPost(', 'fetch(', 'localStorage.setItem']) {
        assert.ok(!body.includes(call),
          `${fn} reaches outside the drawing (${call}) — a drawing reads and writes nothing`);
      }
    }
  },

  // The drawing carries the whole proposal: three stages on Sweep2, and the
  // chain plus one table per stage on Boards2. These are the bones the owner
  // is being asked to mark up, so losing one is losing the review.
  async theDrawingCarriesAllThreeStagesAndTheChain() {
    const s2 = drawBody('drawSweep2');
    for (const bone of ['Stage 1 —', 'Stage 2 —', 'Stage 3 —', 'null set size']) {
      assert.ok(s2.includes(bone), `Sweep2 lost "${bone}" — a stage of the proposal is missing from the drawing`);
    }
    const b2 = drawBody('drawBoards2');
    for (const bone of ['The record chain', 'Stage 1 —', 'Stage 2 —', 'Stage 3 —', 'records']) {
      assert.ok(b2.includes(bone), `Boards2 lost "${bone}" — a reading of the proposal is missing from the drawing`);
    }
  },
  // The owner renamed the shuffled companions: null set, never copies
  // (owner order, 2026-08-27: "Don't call those numbers copies. Call them
  // ... null set size"). One screen saying copies while the other says
  // null set is the cross-screen drift the house rules exist to stop.
  async theNullSetIsNeverCalledCopiesOnTheDrawings() {
    for (const fn of ['drawSweep2', 'drawBoards2']) {
      const body = drawBody(fn);
      assert.ok(!/copies per (unit|setting)/.test(body), `${fn} calls the null set copies again`);
      assert.ok(!/beat its own copies/.test(body), `${fn} still shows a beat its own copies label`);
    }
    assert.ok(drawBody('drawSweep2').includes('null set size'), 'the null set size box is gone from Sweep2');
  },
};
