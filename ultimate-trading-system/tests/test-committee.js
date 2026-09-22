// THE ONE DEFINITION OF A COMMITTEE'S CALL (3.91.0, lib/committee.js), shared
// by the stage 3 pricing and the live path. Pencilled by hand here from the
// definitions in lib/agreement.js: calls from votes, the rung a share lands
// on, the committee's own bar, the stream with its two modifiers -- and the
// source holds that both paths read it from here and neither keeps a copy.
//
// Watched failing while writing it: a level read as the rung for an 'own' bar
// changes which moments speak; a stream read at its first moment instead of
// its last turns +hold into a lookahead.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const committee = require('../lib/committee');

const ROOT = path.join(__dirname, '..');
const P = (d, n, u) => [d, n, u];   // probabilities: down, neither, up
const specs = [
  { model: 'logreg', view: 'full' }, { model: 'logreg', view: 'prices' }, { model: 'logreg', view: 'volume' }, { model: 'logreg', view: 'pricevol' },
  { model: 'boost', view: 'full' }, { model: 'boost', view: 'prices' }, { model: 'boost', view: 'volume' }, { model: 'boost', view: 'pricevol' },
];
// a test slice of six moments: members mostly lean up, member 2 always down
const up = P(0.1, 0.2, 0.7);
const dn = P(0.7, 0.2, 0.1);
const flat = P(0.3, 0.4, 0.3);
const testProbs = specs.map((_, mi) => [0, 1, 2, 3, 4, 5].map((i) => (mi === 2 ? dn : (i % 3 === 0 ? flat : up))));

module.exports = {
  callsAreTheClassEachMemberLeansTo() {
    const calls = committee.callsOf([[up, dn, flat]], 'argmax', null);
    assert.deepStrictEqual(calls, [[1, -1, 0]]);
    // directional: the member's own tau decides whether its lean is enough
    const strong = committee.callsOf([[P(0.05, 0.05, 0.9)]], 'directional', [0.5]);
    const weak = committee.callsOf([[P(0.3, 0.3, 0.4)]], 'directional', [0.5]);
    assert.deepStrictEqual([strong[0][0], weak[0][0]], [1, 0]);
  },

  theRungIsTheShareOfWhatTheRuleCountsAndTheOwnBarIsReadFromTheTestSlice() {
    const C = committee.committeeOn({ specs, memberProbsTest: testProbs, taus: null });
    assert.strictEqual(C.nTest, 6);
    const count50 = { rule: 'count', bar: 'all', pct: 50, copy: 98, both: false, persist: 0 };
    assert.strictEqual(C.denomFor(count50, 'argmax'), 8, 'a count is a share of the members');
    assert.strictEqual(C.rungFor(count50, 'argmax'), 4);
    assert.strictEqual(C.levelFor(count50, 'argmax'), 4);
    assert.strictEqual(C.rungFor({ ...count50, pct: 60 }, 'argmax'), 5, 'a share lands on the rung at or above it, never below (60% of 8 is 5, not 4)');
    assert.strictEqual(C.rungFor({ ...count50, pct: 1 }, 'argmax'), 1, 'and never below one');
    const fam = { rule: 'families', bar: 'all', pct: 50, copy: 98, both: false, persist: 0 };
    assert.strictEqual(C.denomFor(fam, 'argmax'), 4, 'families are the distinct views');
    assert.strictEqual(C.rungFor(fam, 'argmax'), 2);
    const trained = { rule: 'trained', bar: null, pct: null, copy: 98, both: false, persist: 0 };
    assert.strictEqual(C.levelFor(trained, 'argmax'), null, 'a way of weighing that reads no bar has no level');
    // the committee's own bar: what it reached on the test slice at a strictness
    const own = { rule: 'count', bar: 'own', pct: 100, copy: 98, both: false, persist: 0 };
    const reached = C.levelFor(own, 'argmax');
    // on the up moments 7 of 8 agree (member 2 dissents); at strictness 100 the bar is the best reached
    assert.strictEqual(reached, 7);
    const lax = C.levelFor({ ...own, pct: 0 }, 'argmax');
    assert.ok(lax <= reached, 'a laxer strictness never raises the bar');
  },

  theStreamIsTheRulesOwnCallAtEachMomentWithItsTwoModifiers() {
    const C = committee.committeeOn({ specs, memberProbsTest: testProbs, taus: null });
    const count50 = { rule: 'count', bar: 'all', pct: 50, copy: 98, both: false, persist: 0 };
    // three moments: everyone up (7 of 8), a tie-ish flat, everyone up again
    const moments = specs.map((_, mi) => [mi === 2 ? dn : up, flat, mi === 2 ? dn : up]);
    assert.deepStrictEqual(C.streamOf('argmax', count50, moments), [1, 0, 1]);
    // +hold 1: the same call must have stood the moment before
    assert.deepStrictEqual(C.streamOf('argmax', { ...count50, persist: 1 }, moments), [0, 0, 0]);
    const held = specs.map((_, mi) => [mi === 2 ? dn : up, mi === 2 ? dn : up, mi === 2 ? dn : up]);
    assert.deepStrictEqual(C.streamOf('argmax', { ...count50, persist: 1 }, held), [0, 1, 1]);
    // +both: the winning side must hold both kinds of member
    const onlyLogreg = specs.map((_, mi) => [mi < 4 ? up : flat]);
    assert.deepStrictEqual(C.streamOf('argmax', { ...count50, both: true }, onlyLogreg), [0]);
    assert.deepStrictEqual(C.streamOf('argmax', count50, onlyLogreg), [1]);
    // what agreed on the test slice, as a share of the members
    const agreed = C.agreedOn('argmax', count50);
    assert.strictEqual(agreed.agreedN, 4, 'four of the six test moments spoke');
    assert.ok(Math.abs(agreed.agreed - 87.5) < 1e-9, '7 of 8 members, as a share');
  },

  // BOTH PATHS READ THE ONE DEFINITION, AND NEITHER KEEPS A COPY. The stage 3
  // pricing shapes its committee through committeeOn and takes its calls,
  // level and agreement from it; the live path does the same; and the closures
  // the pricing used to keep of its own are gone.
  // THE PLATEAU FOLDS TO ONE VOICE PER KIND (3.204.0): its lean is the trained
  // members' votes shared out, its call the side enough of them called, a
  // silent member is left out of both, and a member outside every plateau
  // votes as itself.
  aPlateauFoldsToOneVoicePerKindWithALeanAndACall() {
    const S = [
      { model: 'logreg', view: 'full', at: null }, { model: 'boost', view: 'full', at: null },
      { model: 'logreg', view: 'extra0', at: 0 }, { model: 'logreg', view: 'extra1', at: 1 }, { model: 'logreg', view: 'extra2', at: 2 },
      { model: 'boost', view: 'extra0', at: 0 }, { model: 'boost', view: 'extra1', at: 1 }, { model: 'boost', view: 'extra2', at: 2 },
      { model: 'logreg', view: 'extra3', at: 3 },
    ];
    const plateaus = [{ centre: 1, members: [0, 1, 2] }];
    const voters = committee.plateauVoters(S, plateaus, new Set([0, 1, 2, 3, 5, 6, 7, 8]));   // member 4 (logreg extra2) is silent
    assert.deepStrictEqual(voters.map((v) => (v.kind === 'member' ? `m${v.mi}` : `p${v.plateau}:${v.model}`)), ['m0', 'm1', 'm8', 'p0:logreg', 'p0:boost'],
      'the base members and the loose extra vote as themselves, and each plateau is one voice per kind');
    const pl = voters[3];
    assert.deepStrictEqual([pl.members, pl.speaking, pl.centre], [[2, 3, 4], [2, 3], 3], 'the fold does not know who is trained or which is the centre');
    assert.deepStrictEqual(pl.spec, { model: 'logreg', view: 'plateau0', at: null, plateau: 0 });
    // three moments: all up; two up one down; one up and the silent one down
    const probs = S.map(() => [up, up, flat]);
    probs[4] = [up, dn, dn];             // silent: must not count
    probs[3] = [up, dn, up];
    probs[2] = [up, up, flat];
    const calls = committee.callsOf(probs, 'argmax', null);
    const at50 = committee.foldPlateaus({ voters, probsPerMember: probs, callsPerMember: calls, share: 50 });
    assert.strictEqual(at50.probs.length, 5);
    assert.deepStrictEqual(at50.probs[0], probs[0], 'a member as itself keeps its own votes');
    assert.deepStrictEqual(at50.calls[0], calls[0]);
    // the plateau's lean: the two trained members' votes shared out, the silent one left out
    assert.deepStrictEqual(at50.probs[3][0].map((x) => Number(x.toFixed(6))), up.map((x) => Number(x.toFixed(6))));
    assert.deepStrictEqual(at50.probs[3][1].map((x) => Number(x.toFixed(6))), [0.4, 0.2, 0.4], 'one up and one down do not share out to a level lean');
    // the call at half: 1 of 2 is enough only when the other side is smaller
    assert.deepStrictEqual(at50.calls[3], [1, 0, 1], 'at half, both up calls, a tie sits out, one up against a flat calls up');
    const at100 = committee.foldPlateaus({ voters, probsPerMember: probs, callsPerMember: calls, share: 100 });
    assert.deepStrictEqual(at100.calls[3], [1, 0, 0], 'at every member, one up against a flat is not enough');
    const boost = at50.calls[4];
    assert.deepStrictEqual(boost, [1, 1, 0], 'the boost plateau folds its own three members');
    assert.throws(() => committee.foldPlateaus({ voters, probsPerMember: probs, callsPerMember: calls, share: 0 }), /percent above 0/);
    // a plateau with nobody trained sits out on everything
    const none = committee.plateauVoters(S, plateaus, new Set([0, 1, 8]));
    const out = committee.foldPlateaus({ voters: none, probsPerMember: probs, callsPerMember: calls, share: 50 });
    assert.deepStrictEqual(out.calls[3], [0, 0, 0]); assert.deepStrictEqual(out.probs[3][0], [0, 1, 0]);
  },

  // A COMMITTEE WITH PLATEAUS VOTES EACH PLATEAU ONCE PER KIND (3.205.0): its
  // voters are the base members and one voter per plateau per kind, the fold
  // happens at the share the setting asks for, and a committee without
  // plateaus is exactly what it was.
  aCommitteeWithPlateausVotesEachPlateauOncePerKind() {
    const S = [
      { model: 'logreg', view: 'full', at: null }, { model: 'boost', view: 'full', at: null },
      { model: 'logreg', view: 'extra0', at: 0 }, { model: 'logreg', view: 'extra1', at: 1 }, { model: 'logreg', view: 'extra2', at: 2 },
      { model: 'boost', view: 'extra0', at: 0 }, { model: 'boost', view: 'extra1', at: 1 }, { model: 'boost', view: 'extra2', at: 2 },
    ];
    const plateaus = [{ centre: 1, members: [0, 1, 2] }];
    // four moments: the base members lean up throughout; the logreg plateau's
    // members go up/up/up, up/dn/up, dn/dn/up, flat/flat/flat; the boost
    // plateau's all lean up
    const rows = (a, b, c) => [a, b, c];
    const probs = [
      [up, up, up, up], [up, up, up, up],
      [up, up, dn, flat], [up, dn, dn, flat], [up, up, up, flat],
      [up, up, up, up], [up, up, up, up], [up, up, up, up],
    ];
    const C = committee.committeeOn({ specs: S, memberProbsTest: probs, taus: null, plateaus, speaking: null });
    assert.deepStrictEqual(C.voters.map((v) => (v.kind === 'member' ? `m${v.mi}` : `p${v.plateau}:${v.model}`)), ['m0', 'm1', 'p0:logreg', 'p0:boost']);
    assert.deepStrictEqual(C.models, ['logreg', 'boost', 'logreg', 'boost']);
    assert.deepStrictEqual(C.families, ['full', 'full', 'plateau0', 'plateau0'], 'a plateau is not its own kind of evidence');
    // count at 50% of 4 voters: the logreg plateau's call decides the tie moments
    const agr = (plateau, pct = 50) => ({ rule: 'count', bar: 'all', pct, copy: 98, both: false, persist: 0, plateau });
    assert.strictEqual(C.denomFor(agr(50), 'argmax'), 4, 'a share is a share of the members, not of the voters');
    assert.strictEqual(C.rungFor(agr(50), 'argmax'), 2);
    // at plateau share 50: moment 1 is 2 of 3 up -> up; moment 2 is 2 of 3 down -> down; moment 3 flat -> sit out
    assert.deepStrictEqual(C.testCalls('argmax', 50)[2], [1, 1, -1, 0], 'the logreg plateau\'s call at half is not the side two of its three called');
    assert.deepStrictEqual(C.testCalls('argmax', 100)[2], [1, 0, 0, 0], 'at every member, a split plateau still calls');
    // the stream reads the folded voters: 3 up of 4 clears 2 whatever the plateau says;
    // conviction reads the plateau's lean, which at moment 2 is two thirds down
    assert.deepStrictEqual(C.streamOf('argmax', agr(50), probs), [1, 1, 1, 1]);
    const strict = { ...agr(50, 100) };
    assert.deepStrictEqual(C.streamOf('argmax', strict, probs), [1, 1, 0, 0], 'at 100% of the voters the down plateau and the flat one do not stop the call');
    const conv = { ...agr(50), rule: 'conviction', pct: 10 };
    assert.deepStrictEqual(C.streamOf('argmax', conv, probs).slice(0, 2), [1, 1]);
    // without plateaus nothing is folded and every member is a voter
    const plain = committee.committeeOn({ specs: S, memberProbsTest: probs, taus: null });
    assert.strictEqual(plain.voters.length, 8);
    assert.deepStrictEqual(plain.testCalls('argmax'), committee.callsOf(probs, 'argmax', null), 'a committee without plateaus no longer reads its members\' own calls');
    assert.strictEqual(plain.denomFor(agr(null), 'argmax'), 8);
    assert.deepStrictEqual(rows(1, 2, 3), [1, 2, 3]);
  },

  bothPathsReadTheOneDefinitionAndNeitherKeepsACopy() {
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const task = sw.slice(sw.indexOf('async function s3UnitTask(task) {'), sw.indexOf('\n}\n', sw.indexOf('async function s3UnitTask(task) {')));
    assert.ok(task.includes("const C = committee.committeeOn({ specs: (unit.members || []).map((m) => m.spec || {}), memberProbsTest: memberProbs.map((mp) => mp.slice(0, nTest)), taus, plateaus: unit.plateaus || [], speaking });"), 'the pricing shapes its committee through the shared definition, plateaus and all');
    assert.ok(task.includes('const out = C.foldOf(probsFor(dealIdx, slice), decision, share);'), 'its calls come from there, folded');
    assert.ok(!/committee\.callsOf\(probsFor\(dealIdx, slice\)/.test(task) && !/committee\.callsOf\(trainProbs\(\)/.test(task), 'the pricing still reads the members\' own calls past the fold');
    assert.ok(task.includes('const levelFor = (agr, decision) => C.levelFor(agr, decision);'), 'and what is enough');
    // ...except under quorum by field (3.221.0), which never read the members: there the share that agreed is a reading beside the decision
    assert.ok(task.includes("const out = agr.rule === 'field' ? agreedWithField(decision, agr) : C.agreedOn(decision, agr);"), 'and what agreed');
    for (const gone of ['agreement.voiceGroups(', 'agreement.ownHistoryBar(', 'Math.ceil((agr.pct / 100) * n)']) {
      assert.ok(!task.includes(gone), `the pricing keeps a copy of its own: ${gone}`);
    }
    const live = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'stagesignal.js'), 'utf8');
    assert.ok(live.includes('const C = committee.committeeOn({ specs, memberProbsTest: members.map((m) => m.probs.slice(0, nTest)), taus, plateaus: cfg.plateaus || [], speaking });'), 'the live path shapes its committee through the same definition, plateaus and all');
    assert.ok(live.includes('    stream = C.streamOf(decision, agr, momentProbs);'), 'and reads the stream');
    assert.ok(live.includes('const call = stream[stream.length - 1] || 0;'), 'at its last moment, the target, so +hold reads the moments before it and never after');
    assert.ok(!/ownHistoryBar|voiceGroups/.test(live), 'and keeps no copy of the arithmetic');
    // the live signal path decides through the stage path and nothing else (3.97.0: the older engine's branch is gone)
    const sig = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'signal.js'), 'utf8');
    assert.ok(sig.includes("return require('./stagesignal').stageCommitteeCallFor(cfg, target, trainChunks, chunks, maps, geo, views, freezeMs, feePerLeg);"), 'a configuration is decided by the stage path');
    assert.ok(!/committeeCallFor\(cfg, target, trainChunks, maps, geo, views, bandPct/.test(sig), 'the older engine\'s call is back in the live path');
    assert.strictEqual((sig.match(/await decideFor\(/g) || []).length, 3, 'the live decision, the recompute and the preview all go through the one door');
  },
};
