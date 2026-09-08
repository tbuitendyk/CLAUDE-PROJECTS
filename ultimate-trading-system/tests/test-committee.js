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
  bothPathsReadTheOneDefinitionAndNeitherKeepsACopy() {
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const task = sw.slice(sw.indexOf('async function s3UnitTask(task) {'), sw.indexOf('\n}\n', sw.indexOf('async function s3UnitTask(task) {')));
    assert.ok(task.includes("const C = committee.committeeOn({ specs: (unit.members || []).map((m) => m.spec || {}), memberProbsTest: memberProbs.map((mp) => mp.slice(0, nTest)), taus });"), 'the pricing shapes its committee through the shared definition');
    assert.ok(task.includes('const out = committee.callsOf(probsFor(dealIdx, slice), decision, taus);'), 'its calls come from there');
    assert.ok(task.includes('const levelFor = (agr, decision) => C.levelFor(agr, decision);'), 'and what is enough');
    assert.ok(task.includes('const out = C.agreedOn(decision, agr);'), 'and what agreed');
    for (const gone of ['agreement.voiceGroups(', 'agreement.ownHistoryBar(', 'Math.ceil((agr.pct / 100) * n)']) {
      assert.ok(!task.includes(gone), `the pricing keeps a copy of its own: ${gone}`);
    }
    const live = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'stagesignal.js'), 'utf8');
    assert.ok(live.includes('const C = committee.committeeOn({ specs, memberProbsTest: members.map((m) => m.probs.slice(0, nTest)), taus });'), 'the live path shapes its committee through the same definition');
    assert.ok(live.includes('const stream = C.streamOf(decision, agr, momentProbs);'), 'and reads the stream');
    assert.ok(live.includes('const call = stream[stream.length - 1] || 0;'), 'at its last moment, the target, so +hold reads the moments before it and never after');
    assert.ok(!/ownHistoryBar|voiceGroups/.test(live), 'and keeps no copy of the arithmetic');
    // the live signal path decides by the engine the configuration speaks for
    const sig = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'signal.js'), 'utf8');
    assert.ok(sig.includes("if (cfg.engine === 'stages') {\n    return require('./stagesignal').stageCommitteeCallFor("), 'a stage-engine configuration is decided by the stage path');
    assert.strictEqual((sig.match(/await decideFor\(/g) || []).length, 3, 'the live decision, the recompute and the preview all go through the one door');
  },
};
