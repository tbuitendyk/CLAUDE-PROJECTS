// HOW A COMMITTEE'S VOTES BECOME ONE CALL — the rules, and the measurement
// of how many INDEPENDENT voices a committee really holds.
//
// Written in the owner's loop of 2026-08-28, when the plain count stopped
// being the only rule. The count itself is held bit-identical to the old one
// on purpose: results from before the change must stay comparable to results
// after it, and a test — not a comment — is what holds that.
const { assert } = require('./helpers');
const a = require('../lib/agreement');
const { quorumCall } = require('../lib/bracketwork');

// three real opinions, and two of them duplicated — the exact shape the
// owner found in their own tables at Daily 1-day
const DOUBLED = [
  [1, 1, -1, 0, 1],
  [1, 1, -1, 0, 1],
  [-1, 1, 1, 0, -1],
  [-1, 1, 1, 0, -1],
  [0, -1, 1, 1, 0],
];
const P = (d, n, u) => [d, n, u];

module.exports = {
  // The old rule, exactly. Every rung, every moment.
  theCountIsBitIdenticalToTheRuleItReplaces() {
    const calls = [[1, 1, 0, -1, 1], [1, 0, 0, -1, -1], [1, 1, -1, -1, 0], [-1, 1, -1, 0, 1]];
    for (let k = 1; k <= calls.length; k++) {
      const mine = a.agreementStream({ calls }, 'count', k);
      const old = calls[0].map((_, i) => quorumCall(calls, i, k));
      assert.deepStrictEqual(mine, old, `rung ${k} must match the rule this replaces, moment for moment`);
    }
  },

  // Members that call the same way almost always are ONE voice, however
  // differently they were built. This is the measurement that makes a wider
  // committee honest.
  independentVoicesSeeThroughNearCopies() {
    const v = a.voiceGroups(DOUBLED, 5);
    assert.strictEqual(v.voices, 3, 'five members, three real opinions');
    assert.deepStrictEqual(v.weights, [0.5, 0.5, 0.5, 0.5, 1], 'a doubled pair shares one vote between them');
    // a committee of genuinely different members keeps all its voices
    const distinct = [[1, 1, 1, 1, 1], [1, -1, 1, -1, 1], [0, 0, 1, -1, -1]];
    assert.strictEqual(a.voiceGroups(distinct, 5).voices, 3);
    // and the threshold is what "almost always" means — loosen it and more
    // members fold together
    const nearly = [[1, 1, 1, 1, 1], [1, 1, 1, 1, -1]];
    assert.strictEqual(a.voiceGroups(nearly, 5, 0.98).voices, 2, 'four in five is not almost always');
    assert.strictEqual(a.voiceGroups(nearly, 5, 0.8).voices, 1, 'at four in five it is');
  },

  // THE POINT OF THE VOICES RULE: on the doubled committee above, a plain
  // count of 4 is reachable by two opinions agreeing with their own copies.
  // The voices rule refuses to be fooled by that.
  theVoicesRuleCannotBeStuffedWithCopies() {
    const w = a.voiceGroups(DOUBLED, 5).weights;
    // Moment 1 is the whole argument. Four of the five members say up, which
    // a plain count reads as a strong majority — but those four are two
    // opinions and their copies. Two real voices, not four.
    assert.deepStrictEqual(a.sides(DOUBLED, 1), { up: 4, down: 1, winner: 1 });
    assert.strictEqual(a.agreementStream({ calls: DOUBLED }, 'count', 4)[1], 1,
      'the plain count is satisfied by four members');
    assert.strictEqual(a.agreementStream({ calls: DOUBLED, weights: w }, 'voices', 4)[1], 0,
      'but four members holding two opinions are not four voices');
    assert.strictEqual(a.agreementStream({ calls: DOUBLED, weights: w }, 'voices', 2)[1], 1,
      'two voices is what is really there, and the rule says so');
    // and where the members ARE independent the two rules agree
    const distinct = [[1, 1, 1], [1, -1, 1], [1, 1, -1]];
    const dv = a.voiceGroups(distinct, 3);
    assert.strictEqual(dv.voices, 3, 'these three really are three opinions');
    assert.deepStrictEqual(a.agreementStream({ calls: distinct, weights: dv.weights }, 'voices', 3),
      a.agreementStream({ calls: distinct }, 'count', 3),
      'with no near-copies the voices rule IS the count — it only ever removes what was double-counted');
  },

  // Conviction reads how strongly the members lean, not merely which way.
  convictionSeparatesCertainFromBarely() {
    const calls = [[1], [1]];
    const barely = { calls, probs: [[P(0.30, 0.35, 0.35)], [P(0.30, 0.35, 0.35)]] };
    const certain = { calls, probs: [[P(0.02, 0.08, 0.90)], [P(0.02, 0.08, 0.90)]] };
    assert.strictEqual(a.agreementStream(barely, 'conviction', 1)[0], 0, 'a whisper is not a whole vote');
    assert.strictEqual(a.agreementStream(certain, 'conviction', 1)[0], 1);
    assert.strictEqual(a.agreementStream(certain, 'conviction', 2)[0], 0, 'two members cannot muster 2.0 between them here');
    // and the leaning must back the majority, never contradict it
    const contrary = { calls: [[1], [1], [-1]], probs: [[P(0.4, 0.3, 0.3)], [P(0.4, 0.3, 0.3)], [P(0.9, 0.05, 0.05)]] };
    assert.strictEqual(a.agreementStream(contrary, 'conviction', 1)[0], 0);
  },

  // Families asks for different KINDS of evidence, not a number of members.
  familiesNeedsDifferentKindsOfEvidence() {
    const calls = [[1], [1], [1], [-1]];
    const families = ['prices', 'prices', 'prices', 'volume'];
    assert.strictEqual(a.agreementStream({ calls, families }, 'families', 1)[0], 1);
    assert.strictEqual(a.agreementStream({ calls, families }, 'families', 2)[0], 0,
      'three members of one family are still one kind of evidence');
    const spread = ['prices', 'volume', 'pricevol', 'full'];
    assert.strictEqual(a.agreementStream({ calls, families: spread }, 'families', 3)[0], 1);
  },

  // Unusual is a strictness dial like every other: higher admits less.
  unusualIsStrictestAtTheTop() {
    const calls = [[1, 1, 1, 1], [1, 1, 0, -1], [1, 0, 0, -1], [1, 1, 1, 0]];
    const strict = a.percentileCutoff(calls, 4, 100);
    const loose = a.percentileCutoff(calls, 4, 10);
    assert.ok(strict > loose, 'a higher share must demand more agreement, not less');
    const hard = a.agreementStream({ calls, cutoff: strict }, 'unusual', 100).filter(Boolean).length;
    const easy = a.agreementStream({ calls, cutoff: loose }, 'unusual', 10).filter(Boolean).length;
    assert.ok(hard < easy, `strict must trade less often than loose (${hard} vs ${easy})`);
  },

  // The two modifiers.
  bothKindsAndHoldDoWhatTheySay() {
    const calls = [[1, 1, 1], [1, 1, 1]];
    const oneKind = ['logreg', 'logreg'];
    const twoKinds = ['logreg', 'boost'];
    assert.deepStrictEqual(a.agreementStream({ calls, models: oneKind }, 'count', 2, { bothModels: true }), [0, 0, 0],
      'one kind of member can never satisfy both kinds');
    assert.deepStrictEqual(a.agreementStream({ calls, models: twoKinds }, 'count', 2, { bothModels: true }), [1, 1, 1]);
    // a hold needs the call to have stood already, so the first moments cannot qualify
    assert.deepStrictEqual(a.agreementStream({ calls }, 'count', 2, { persist: 1 }), [0, 1, 1]);
    assert.deepStrictEqual(a.agreementStream({ calls }, 'count', 2, { persist: 2 }), [0, 0, 1]);
    // and a call that flips resets the hold
    const flip = [[1, -1, -1], [1, -1, -1]];
    assert.deepStrictEqual(a.agreementStream({ calls: flip }, 'count', 2, { persist: 1 }), [0, 0, -1]);
  },

  // Every rule stands aside on a tie, exactly as the plain count always has —
  // a committee that cannot make up its mind must not be read as agreeing.
  everyRuleStandsAsideOnATie() {
    const tied = [[1], [-1]];
    const ctx = {
      calls: tied, models: ['logreg', 'boost'], families: ['prices', 'volume'],
      probs: [[P(0.1, 0.1, 0.8)], [P(0.8, 0.1, 0.1)]], weights: [1, 1], cutoff: 1,
    };
    for (const rule of a.AGREE_RULES) {
      assert.strictEqual(a.agreementStream(ctx, rule, 1)[0], 0, `${rule} must stand aside on a tie`);
    }
  },

  // A wrong shape must crash, not quietly abstain: the null replay once
  // passed member objects here and every committee stood aside in silence.
  aWrongShapeCrashesRatherThanAbstaining() {
    assert.throws(() => a.agreementStream({ calls: [[{ up: 1 }]] }, 'count', 1), /non-vote/);
    assert.throws(() => a.agreementStream({ calls: [[1]] }, 'nope', 1), /not an agreement rule/);
  },

  // The plain argmax used by the voices measurement must break ties the same
  // way the engine's own vote does, or the measurement describes a different
  // committee from the one that trades.
  theArgmaxTieRuleMatchesTheEngine() {
    assert.strictEqual(a.argmaxCall([0.5, 0.5, 0]), -1, 'a tie keeps the earlier class, as the engine does');
    assert.strictEqual(a.argmaxCall([0.2, 0.3, 0.5]), 1);
    assert.strictEqual(a.argmaxCall([0.5, 0.3, 0.2]), -1);
    assert.strictEqual(a.argmaxCall({ d: 0.1, n: 0.8, u: 0.1 }), 0);
  },
};
