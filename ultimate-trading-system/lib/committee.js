// committee.js -- THE ONE DEFINITION OF A COMMITTEE'S CALL (3.91.0).
//
// Stage 3 prices settings from stored votes; the live path decides one moment
// from votes it has just cast. Both must reach the same call from the same
// votes under the same way of weighing, or a greenlighted rule trades as
// something the lab never measured. So the pieces that turn votes into a call
// live here, once, and both paths call them:
//
//   * a member's CALL at a moment, from its three probabilities and the
//     decision (argmax, or directional with the member's tau)
//   * the committee's own SHAPE, read from the test slice and never from any
//     later window: which members are independent voices (voiceGroups) and
//     what each way of weighing's own bar is (ownHistoryBar)
//   * WHAT IS ENOUGH: the rung a share lands on, or the committee's own bar,
//     or no bar at all for a way of weighing that reads none
//   * the STREAM of calls over a run of moments under the rule and its two
//     modifiers (+both, +hold), through lib/agreement.js
//
// Pure: nothing here reads a file, a price or a clock. The caller hands in the
// votes, sliced and dealt as it likes; the answer depends on them alone.
const agreement = require('./agreement');
const { directionalCall } = require('./paper');

const CLASSES = [-1, 0, 1];
const probsObj = (a) => ({ '-1': a[0], 0: a[1], 1: a[2] });
// a member's call at one moment: the class it leans to, or, under the
// directional decision, its lean against its own tuned tau
function callFromProbs(a, decision, tau) {
  if (decision === 'directional') return directionalCall(probsObj(a), tau);
  let best = 0;
  for (let k = 1; k < 3; k++) if (a[k] > a[best]) best = k;
  return CLASSES[best];
}
// the calls of every member over a run of moments, from their probabilities
function callsOf(probsPerMember, decision, taus) {
  return probsPerMember.map((mp, mi) => {
    const tau = decision === 'directional' ? (taus ? taus[mi] : null) : null;
    const arr = new Array(mp.length);
    for (let i = 0; i < mp.length; i++) arr[i] = callFromProbs(mp[i], decision, tau);
    return arr;
  });
}

// A committee, shaped on its test slice.
//   specs            [{ model, view }] per member
//   memberProbsTest  [per member][nTest] probabilities on the test slice
//   taus             per member, for the directional decision (null otherwise)
function committeeOn({ specs, memberProbsTest, taus = null }) {
  const nTest = memberProbsTest.length ? memberProbsTest[0].length : 0;
  const models = (specs || []).map((s) => (s || {}).model || 'logreg');
  const families = (specs || []).map((s) => (s || {}).view || 'full');
  const testCallCache = new Map();
  const testCalls = (decision) => {
    if (!testCallCache.has(decision)) testCallCache.set(decision, callsOf(memberProbsTest, decision, taus));
    return testCallCache.get(decision);
  };
  // WHAT THE COMMITTEE ACTUALLY IS, measured on the test slice and never on
  // any later window: which members are independent voices and which are
  // near-copies of each other.
  const voiceCache = new Map();
  const voicesFor = (decision, copy) => {
    const key = `${decision}|${copy}`;
    if (!voiceCache.has(key)) voiceCache.set(key, agreement.voiceGroups(testCalls(decision), nTest, copy / 100));
    return voiceCache.get(key);
  };
  // the votes and the extras a way of weighing reads, for one run of moments
  const ctxOf = (decision, agr, probsPerMember) => ({
    calls: callsOf(probsPerMember, decision, taus), models, families,
    probs: agreement.READS_LEANS.has(agr.rule) ? probsPerMember : null,
    weights: agr.rule === 'voices' ? voicesFor(decision, agr.copy).weights : null,
  });
  // THE BAR TAKEN FROM WHAT THIS COMMITTEE REACHES, from the test slice only
  const cutoffCache = new Map();
  const cutoffFor = (decision, agr) => {
    const key = `${decision}|${agr.rule}|${agr.copy}|${agr.pct}`;
    if (!cutoffCache.has(key)) cutoffCache.set(key, agreement.ownHistoryBar(ctxOf(decision, agr, memberProbsTest), nTest, agr.rule, agr.pct));
    return cutoffCache.get(key);
  };
  // WHAT A SHARE IS A SHARE OF, under this rule, for this committee
  const denomFor = (agr, decision) => (agr.rule === 'voices' ? voicesFor(decision, agr.copy).voices
    : agr.rule === 'families' ? new Set(families).size : memberProbsTest.length);
  const rungFor = (agr, decision) => {
    const n = denomFor(agr, decision);
    return Math.max(1, Math.min(n, Math.ceil((agr.pct / 100) * n)));
  };
  // WHAT IS ENOUGH: null for a way of weighing that reads no bar
  const levelFor = (agr, decision) => (agreement.READS_NO_BAR.has(agr.rule) ? null
    : (agr.bar === 'own') ? cutoffFor(decision, agr)
      : rungFor(agr, decision));
  // the committee's calls over a run of moments under the rule
  const streamOf = (decision, agr, probsPerMember) => agreement.agreementStream(
    ctxOf(decision, agr, probsPerMember), agr.rule, levelFor(agr, decision), { bothModels: agr.both, persist: agr.persist },
  );
  // HOW MUCH ACTUALLY AGREED on the test slice, as a share of what the rule counts
  const agreedOn = (decision, agr) => {
    const spoke = streamOf(decision, agr, memberProbsTest);
    const ctx = ctxOf(decision, agr, memberProbsTest);
    const denom = denomFor(agr, decision);
    let sum = 0;
    let n = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < spoke.length; i++) {
      const c = spoke[i];
      if (!c) continue;
      const got = agreement.achievedAt(ctx, i, agr.rule, c);
      sum += got; n++;
      if (got < lo) lo = got;
      if (got > hi) hi = got;
    }
    const pct = (v) => (v / denom) * 100;
    return (n && denom) ? { agreed: pct(sum / n), agreedLow: pct(lo), agreedHigh: pct(hi), agreedN: n }
      : { agreed: null, agreedLow: null, agreedHigh: null, agreedN: 0 };
  };
  return { nTest, models, families, testCalls, voicesFor, ctxOf, cutoffFor, denomFor, rungFor, levelFor, streamOf, agreedOn };
}

module.exports = { committeeOn, callsOf, callFromProbs, probsObj, CLASSES };
