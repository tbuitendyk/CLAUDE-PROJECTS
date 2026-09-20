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
//   plateaus         [{ centre, members }] over the extras, or none (3.205.0)
//   speaking         Set of member indices that were trained, or null for all
//
// WITH PLATEAUS THE COMMITTEE IS ITS VOTERS, NOT ITS MEMBERS (3.205.0): every
// base member and every loose extra as itself, and one voter per plateau per
// kind, folded through plateauVoters / foldPlateaus at the share the setting
// asks for (agr.plateau). Everything below -- the calls, the independent
// voices, the bars, the streams, what a share is a share of -- reads the
// voters, so a plateau is one vote everywhere and nine votes nowhere.
function committeeOn({ specs, memberProbsTest, taus = null, plateaus = null, speaking = null }) {
  const nTest = memberProbsTest.length ? memberProbsTest[0].length : 0;
  const hasPlateaus = Array.isArray(plateaus) && plateaus.length > 0;
  const voters = hasPlateaus ? plateauVoters(specs, plateaus, speaking)
    : (specs || []).map((s, mi) => ({ kind: 'member', mi, spec: s || {} }));
  const models = voters.map((v) => (v.spec || {}).model || 'logreg');
  const families = voters.map((v) => (v.spec || {}).view || 'full');
  // WHAT THE VOTERS SAY over a run of moments: each member as itself, each
  // plateau folded at the share asked for. A committee without plateaus folds
  // nothing and this is exactly the members' own calls and votes.
  const foldOf = (probsPerMember, decision, share) => {
    const calls = callsOf(probsPerMember, decision, taus);
    if (!hasPlateaus) return { probs: probsPerMember, calls };
    return foldPlateaus({ voters, probsPerMember, callsPerMember: calls, share: share == null ? 50 : share });
  };
  const testFoldCache = new Map();
  const testFold = (decision, share) => {
    const key = `${decision}|${hasPlateaus ? (share == null ? 50 : share) : ''}`;
    if (!testFoldCache.has(key)) testFoldCache.set(key, foldOf(memberProbsTest, decision, share));
    return testFoldCache.get(key);
  };
  const testCalls = (decision, share = null) => testFold(decision, share).calls;
  // WHAT THE COMMITTEE ACTUALLY IS, measured on the test slice and never on
  // any later window: which voters are independent voices and which are
  // near-copies of each other.
  const voiceCache = new Map();
  const voicesFor = (decision, copy, share = null) => {
    const key = `${decision}|${copy}|${hasPlateaus ? (share == null ? 50 : share) : ''}`;
    if (!voiceCache.has(key)) voiceCache.set(key, agreement.voiceGroups(testCalls(decision, share), nTest, copy / 100));
    return voiceCache.get(key);
  };
  // the votes and the extras a way of weighing reads, for one run of moments
  const ctxOf = (decision, agr, probsPerMember) => {
    const f = foldOf(probsPerMember, decision, agr.plateau);
    return {
      calls: f.calls, models, families,
      probs: agreement.READS_LEANS.has(agr.rule) ? f.probs : null,
      weights: agr.rule === 'voices' ? voicesFor(decision, agr.copy, agr.plateau).weights : null,
    };
  };
  // THE BAR TAKEN FROM WHAT THIS COMMITTEE REACHES, from the test slice only
  const cutoffCache = new Map();
  const cutoffFor = (decision, agr) => {
    const key = `${decision}|${agr.rule}|${agr.copy}|${agr.pct}|${hasPlateaus ? agr.plateau : ''}`;
    if (!cutoffCache.has(key)) cutoffCache.set(key, agreement.ownHistoryBar(ctxOf(decision, agr, memberProbsTest), nTest, agr.rule, agr.pct));
    return cutoffCache.get(key);
  };
  // WHAT A SHARE IS A SHARE OF, under this rule, for this committee
  const denomFor = (agr, decision) => (agr.rule === 'voices' ? voicesFor(decision, agr.copy, agr.plateau).voices
    : agr.rule === 'families' ? new Set(families).size : voters.length);
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
  return { nTest, models, families, voters, foldOf, testCalls, voicesFor, ctxOf, cutoffFor, denomFor, rungFor, levelFor, streamOf, agreedOn };
}

// ---- THE PLATEAU, FOLDED TO ONE VOICE PER KIND (3.204.0) ----------------------
//
// The nine around a promoted row are one piece of evidence read nine times,
// not nine pieces of evidence, so they do not get nine votes. Each plateau
// folds to ONE voter per kind (LOGREG, BOOST) with two faces, as the owner
// asked -- "that strength of signal from the combined nine to actually read
// forward in that single new member ... to each of the two sides":
//
//   * its LEAN is the trained members' votes added and shared out, so a way of
//     weighing that reads how hard a member leans (conviction, trained) sees
//     how firmly the region agrees;
//   * its CALL is the side at least `share` percent of the trained members
//     called, so a way of weighing that counts (count, voices, families) sees
//     one vote that is cast only when enough of the nine agree.
//
// A member that could not be trained (kind 'silent') is left out of both: it
// has no opinion, which is not the same as a neutral one. A member the unit
// carries outside every plateau is a voter on its own, as it always was.
//
// plateauVoters says WHO votes; foldPlateaus says WHAT each voter says at each
// moment, from the members' own votes and calls. Pure, like everything here.
function plateauVoters(specs, plateaus, speaking = null) {
  const list = Array.isArray(specs) ? specs : [];
  const inPlateau = new Set();
  const groups = [];
  (plateaus || []).forEach((pl, j) => {
    const members = new Set((pl && pl.members) || []);
    for (const model of ['logreg', 'boost']) {
      const idx = [];
      list.forEach((s, mi) => { if (s && s.at != null && members.has(s.at) && s.model === model) idx.push(mi); });
      if (!idx.length) continue;
      idx.forEach((mi) => inPlateau.add(mi));
      const centre = idx.find((mi) => list[mi].at === pl.centre);
      groups.push({
        kind: 'plateau', plateau: j, model, members: idx,
        speaking: speaking ? idx.filter((mi) => speaking.has(mi)) : idx,
        centre: centre == null ? null : centre,
        spec: { model, view: `plateau${j}`, at: null, plateau: j },
      });
    }
  });
  const voters = [];
  list.forEach((s, mi) => { if (!inPlateau.has(mi)) voters.push({ kind: 'member', mi, spec: s }); });
  return voters.concat(groups);
}
// what each voter says at each moment: a member as itself, a plateau folded
function foldPlateaus({ voters, probsPerMember, callsPerMember, share }) {
  const pct = Number(share);
  if (!(pct > 0 && pct <= 100)) throw new Error(`a plateau's share is a percent above 0 up to 100, not ${JSON.stringify(share)}`);
  const n = probsPerMember.length ? probsPerMember[0].length : 0;
  const probs = [];
  const calls = [];
  for (const v of voters) {
    if (v.kind !== 'plateau') { probs.push(probsPerMember[v.mi]); calls.push(callsPerMember[v.mi]); continue; }
    const sp = v.speaking;
    const need = Math.max(1, Math.ceil((pct / 100) * sp.length));
    const pr = new Array(n);
    const cl = new Array(n);
    for (let i = 0; i < n; i++) {
      if (!sp.length) { pr[i] = [0, 1, 0]; cl[i] = 0; continue; }
      let d = 0; let m = 0; let u = 0; let up = 0; let down = 0;
      for (const mi of sp) {
        const p = probsPerMember[mi][i];
        d += p[0]; m += p[1]; u += p[2];
        const c = callsPerMember[mi][i];
        if (c === 1) up++; else if (c === -1) down++;
      }
      pr[i] = [d / sp.length, m / sp.length, u / sp.length];
      cl[i] = (up >= need && up > down) ? 1 : ((down >= need && down > up) ? -1 : 0);
    }
    probs.push(pr);
    calls.push(cl);
  }
  return { probs, calls };
}

module.exports = { committeeOn, callsOf, callFromProbs, probsObj, CLASSES, plateauVoters, foldPlateaus };
