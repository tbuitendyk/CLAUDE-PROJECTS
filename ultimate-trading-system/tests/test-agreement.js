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
  // THE BAR TAKEN FROM WHAT THE COMMITTEE REACHES, for EVERY way of weighing
  // and not just a head count (owner order, 2026-08-29). This was 'unusual',
  // which was never a fifth way of weighing — it was a head count against this
  // bar. Now any way of weighing can meet either bar, and the dial still runs
  // the same direction: higher is stricter, always.
  theOwnHistoryBarIsStrictestAtTheTopForEveryWayOfWeighing() {
    const calls = [[1, 1, 1, 1], [1, 1, 0, -1], [1, 0, 0, -1], [1, 1, 1, 0]];
    const probs = calls.map((row) => row.map((c) => (c === 1 ? [0, 0.3, 0.7] : c === -1 ? [0.7, 0.3, 0] : [0.2, 0.6, 0.2])));
    const families = ['full', 'prices', 'volume', 'pricevol'];
    const { weights } = a.voiceGroups(calls, 4);
    const ctx = { calls, probs, families, weights };
    for (const rule of a.AGREE_RULES) {
      const strict = a.ownHistoryBar(ctx, 4, rule, 100);
      const loose = a.ownHistoryBar(ctx, 4, rule, 10);
      assert.ok(strict > loose, `${rule}: a higher share must demand more, not less (${strict} vs ${loose})`);
      const hard = a.agreementStream(ctx, rule, strict).filter(Boolean).length;
      const easy = a.agreementStream(ctx, rule, loose).filter(Boolean).length;
      assert.ok(hard < easy, `${rule}: strict must act less often than loose (${hard} vs ${easy})`);
    }
    // and the whole point of it: conviction, whose bar as a share of what
    // EXISTS is unreachable on any realistic data, becomes reachable here
    const asShareOfAll = Math.ceil(0.75 * 4);
    assert.ok(a.agreementStream(ctx, 'conviction', asShareOfAll).every((c) => !c),
      'the fixture is wrong if conviction can already clear a bar set as a share of the committee');
    assert.ok(a.agreementStream(ctx, 'conviction', a.ownHistoryBar(ctx, 4, 'conviction', 75)).some(Boolean),
      'against its own history, conviction at the same share must be able to act at all — that is the reason this bar exists');
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
  // WHAT ACTUALLY AGREED, not what was demanded (owner, 2026-08-29: "of
  // course i'm looking for the *actual* results of the agreement").
  //
  // Every rule fires at or ABOVE its bar. Until this existed, a run built on
  // one share printed that share on every row and there was no way to tell a
  // call that scraped in from a unanimous one.
  whatActuallyAgreedIsReadOffTheSameVotesTheRuleRead() {
    // four members, read down the columns: moment 0 is unanimous, moment 1 is
    // three to one, moment 2 is a tie, moment 3 is two to one with an abstainer
    const calls = [
      [1, 1, 1, 1],
      [1, 1, 1, 0],
      [1, 1, -1, -1],
      [1, -1, -1, -1],
    ];
    assert.deepStrictEqual(a.sides(calls, 0), { up: 4, down: 0, winner: 1 });
    assert.strictEqual(a.achievedAt({ calls }, 0, 'count', 1), 4, 'unanimous must report four of four');
    assert.deepStrictEqual(a.sides(calls, 1), { up: 3, down: 1, winner: 1 });
    assert.strictEqual(a.achievedAt({ calls }, 1, 'count', 1), 3, 'three to one must report three');
    assert.deepStrictEqual(a.sides(calls, 3), { up: 1, down: 2, winner: -1 });
    assert.strictEqual(a.achievedAt({ calls }, 3, 'count', -1), 2,
      'the winning side is what is counted, and an abstainer is on neither');
    // and it is never below the bar the rule cleared, which is the whole point
    for (let i = 0; i < 4; i++) {
      const winner = a.agreementStream({ calls }, 'count', 2)[i];
      if (!winner) continue;
      assert.ok(a.achievedAt({ calls }, i, 'count', winner) >= 2,
        `moment ${i} fired on a bar of 2 and reports fewer than 2 agreeing`);
    }
    // unusual weighs the same head count — its share is a percentile, not a
    // share of the committee, so only the count is comparable
    assert.strictEqual(a.achievedAt({ calls }, 0, 'unusual', 1), 4);

    // voices: copies share one vote, so four members that are two opinions
    // report two, not four
    const w = a.voiceGroups(DOUBLED, 5).weights;
    assert.deepStrictEqual(a.sides(DOUBLED, 1), { up: 4, down: 1, winner: 1 });
    assert.strictEqual(a.achievedAt({ calls: DOUBLED, weights: w }, 1, 'voices', 1), 2,
      'four members that are two opinions and their copies must report two voices agreeing');

    // families: how many KINDS of evidence lined up, not how many members
    const families = ['full', 'full', 'prices', 'volume'];
    assert.strictEqual(a.achievedAt({ calls, families }, 0, 'families', 1), 3,
      'four members drawn from three kinds of evidence report three');
    assert.strictEqual(a.achievedAt({ calls, families }, 3, 'families', -1), 2,
      'and only the kinds on the winning side count');

    // conviction: how hard the committee leaned, sign included
    const probs = [[[0, 0, 1]], [[0, 0, 1]], [[0, 0.5, 0.5]], [[1, 0, 0]]];
    const lean = a.achievedAt({ calls: [[1], [1], [1], [-1]], probs }, 0, 'conviction', 1);
    assert.ok(Math.abs(lean - 1.5) < 1e-12, `two certain up, one half up, one certain down leans 1.5; got ${lean}`);
  },

  // THE PROPERTY THE OWNER IS ACTUALLY ASKING ABOUT: a setting built on a
  // share fires at or ABOVE it, so what agreed can never come back below the
  // bar and can never exceed everything there is. Checked across every rule
  // and every rung on a pile of made-up committees, because the one thing a
  // worked example cannot prove is that there is no case where it fails.
  whatAgreedIsNeverBelowTheBarAndNeverAboveEverything() {
    // a fixed, repeatable pseudo-random stream — a test that shuffles
    // differently every run is a test that fails on somebody else's machine
    let seed = 20260829;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const vote = () => [-1, 0, 1][Math.floor(rnd() * 3)];
    for (let trial = 0; trial < 40; trial++) {
      const M = 3 + Math.floor(rnd() * 8);
      const T = 30;
      const calls = Array.from({ length: M }, () => Array.from({ length: T }, vote));
      const probs = calls.map((row) => row.map((c) => (c === 1 ? [0, 0.3, 0.7] : c === -1 ? [0.7, 0.3, 0] : [0.2, 0.6, 0.2])));
      const families = calls.map((_, m) => ['full', 'prices', 'volume', 'pricevol'][m % 4]);
      const { weights, voices } = a.voiceGroups(calls, T);
      const ctx = { calls, probs, weights, families, models: calls.map((_, m) => (m % 2 ? 'boost' : 'logreg')) };
      for (const rule of a.AGREE_RULES) {
        if (rule === 'unusual') continue;            // its bar is a percentile, checked on its own above
        const denom = rule === 'voices' ? voices : rule === 'families' ? new Set(families).size : M;
        for (let level = 1; level <= denom; level++) {
          const stream = a.agreementStream(ctx, rule, level);
          for (let i = 0; i < T; i++) {
            const c = stream[i];
            if (!c) continue;
            const got = a.achievedAt(ctx, i, rule, c);
            assert.ok(got + 1e-9 >= level,
              `${rule} fired at moment ${i} on a bar of ${level} and reports only ${got} agreeing`);
            assert.ok(got <= denom + 1e-9,
              `${rule} reports ${got} agreeing out of a possible ${denom}, which is more than exists`);
          }
        }
      }
    }
  },
};
