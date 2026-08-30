// Pure task functions for the three-stage system (Sweep / Boards) — the
// unit of work either the main thread or a worker executes identically, in
// the same mould as bracketwork.js and under the same rule: every function
// here is deterministic given its descriptor, touches no shared state, and
// returns a plain object.
//
// WHAT THE STAGES ARE (owner's design, approved on the drawings it was worked
// out on, 2026-08-27):
//
//   Stage 1  trains each unit's slim members once (logreg per view), KEEPS
//            EVERY VOTE the members cast on the test and held-back windows,
//            and ranks the units by one fixed, settings-free rule: did the
//            pooled votes beat their own null set — the same votes with the
//            calendar shuffled away — at plain forecasting on the test
//            window. No trade box, no fee, no choice anywhere in the rank.
//   Stage 2  trains ONLY the boost members, only for carried units; the
//            logreg members are reused, votes and all.
//   Stage 3  never trains: it prices any block of settings straight from the
//            kept votes — decision, band, 24/5, agree, entry, gate, d, t,
//            trail, arm and the fee are all applied here, as arithmetic.
//
// The training and pricing steps call the SAME engine functions today's
// screens' numbers come from (logreg/boost fits, tuneTau, quorumCall,
// simCell, holdControls) — reimplementing any of them would let the two
// worlds' numbers quietly disagree.
const bracketLib = require('./bracket');
const { buildCombo, splitAndLabel, quorumCall, declaredQuorumFor } = require('./bracketwork');
const agreement = require('./agreement');
const { standardizeFit, standardizeApply, tuneAndTrain, trainSoftmax, predict: predictLogreg } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');
const { tuneTau } = require('./pipeline');
const { directionalCall } = require('./paper');
const { nullRng } = require('./walkforward');

// Sureness spreads are stored as [down, nowhere, up] arrays, 4 decimal
// places — enough that argmax and every threshold on the tau menu read the
// stored number and the live number identically, small enough to keep
// millions of rows on disk without regret.
const q4 = (x) => Math.round(x * 10000) / 10000;
const probsArr = (p) => [q4(p['-1']), q4(p[0]), q4(p[1])];
const probsObj = (a) => ({ '-1': a[0], 0: a[1], 1: a[2] });

// The stored spread back into a call, exactly the way the engine reads a
// live prediction: argmax scans [-1, 0, 1] and strict `>` keeps the first of
// a tie, matching predictLogreg/predictBoost; directional goes through the
// same directionalCall every live path uses.
const CLASSES = [-1, 0, 1];
function callFromProbs(a, decision, tau) {
  if (decision === 'directional') return directionalCall(probsObj(a), tau);
  let best = 0;
  for (let k = 1; k < 3; k++) if (a[k] > a[best]) best = k;
  return CLASSES[best];
}

// Pool the members' spreads for one chunk: the committee's collective lean,
// a plain mean per outcome. Used only by the stage 1 ordering rule.
function pooledAt(memberProbs, i) {
  let d = 0; let n = 0; let u = 0;
  for (const m of memberProbs) { d += m[i][0]; n += m[i][1]; u += m[i][2]; }
  const c = memberProbs.length;
  return [d / c, n / c, u / c];
}

// THE FIXED ORDERING RULE (owner order, 2026-08-27: "offer an alternative
// objective methodology not requiring guessing at settings combinations").
// The forecast score adds up the sureness the pooled vote placed on what
// actually happened, chunk after chunk, over the given index order. Knowing
// something scores high, guessing scores middling, confident-and-wrong
// scores worst. No trade settings exist anywhere in it.
function forecastScore(memberProbs, labels, order = null) {
  let s = 0;
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    const at = order ? order[i] : i;
    const p = pooledAt(memberProbs, at);
    s += p[labels[i] + 1];
  }
  return s;
}

// One shuffle order for a slice — the SAME order applied to every member
// (QC 81: dealing members independently destroys their agreement as well as
// the calendar, and the null must destroy the calendar alone). Built with
// the engine's own nullRng so a set's deals are reproducible from its seed.
function dealOrder(seed, unitKey, slice, n) {
  const rng = nullRng(seed, unitKey, 0, 0, slice);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  return order;
}

// lead over null set: how far above the null set's typical score the real
// one sits, against the null set's own spread. Population spread; a spread
// of zero reads 0, never infinity (decision record #6).
function leadOver(real, nullScores) {
  if (!nullScores.length) return null;
  const mean = nullScores.reduce((a, b) => a + b, 0) / nullScores.length;
  const varr = nullScores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nullScores.length;
  const sd = Math.sqrt(varr);
  if (!(sd > 0)) return 0;
  return (real - mean) / sd;
}

// ---- member training, plain fit ---------------------------------------------
//
// The same fitting steps trainMember runs for an argmax member — same lambda
// ladder, same scaler, same boost probe for the round count — but what comes
// back is the member's SURENESS per chunk, kept, plus the probe's votes on
// the validation slice (what tau tuning reads at stage 3) and the fitted
// model. No decision, no class weights, no tau here: decision is stage 3's
// business (decision record #1).
async function trainProbMember({ model, viewIdx, trainChunks, predictChunks }) {
  const Xtr = trainChunks.map((c) => viewIdx.map((i) => c.x[i]));
  const ytr = trainChunks.map((c) => c.label);
  const Xte = predictChunks.map((c) => viewIdx.map((i) => c.x[i]));
  const nVal = Math.max(3, Math.round(Xtr.length * 0.25));
  const nSub = Xtr.length - nVal;
  let saved;
  let picked;
  let probs;
  let tauProbs;
  if (model === 'logreg') {
    const scaler = standardizeFit(Xtr);
    const Ztr = standardizeApply(Xtr, scaler);
    const Zte = standardizeApply(Xte, scaler);
    const { model: m, chosenLambda } = await tuneAndTrain(Ztr, ytr, { onProgress: () => {} });
    saved = { kind: 'logreg', lambda: chosenLambda, f: m.f, W: Array.from(m.W),
      mean: Array.from(scaler.mean), std: Array.from(scaler.std) };
    picked = `lambda=${chosenLambda}`;
    probs = Zte.map((z) => probsArr(predictLogreg(m, z).probs));
    const probe = await trainSoftmax(Ztr.slice(0, nSub), ytr.slice(0, nSub), chosenLambda, {});
    tauProbs = [];
    for (let i = nSub; i < Ztr.length; i++) tauProbs.push(probsArr(predictLogreg(probe, Ztr[i]).probs));
  } else {
    const probe = await trainBoost(Xtr.slice(0, nSub), ytr.slice(0, nSub), { Xval: Xtr.slice(nSub), yval: ytr.slice(nSub) });
    tauProbs = [];
    for (let i = nSub; i < Xtr.length; i++) tauProbs.push(probsArr(predictBoost(probe, Xtr[i]).probs));
    const m = await trainBoost(Xtr, ytr, { rounds: probe.bestRound });
    saved = { kind: 'boost', rounds: m.bestRound, priors: m.priors, trees: m.trees };
    picked = `rounds=${m.bestRound}`;
    probs = Xte.map((x) => probsArr(predictBoost(m, x).probs));
  }
  return { saved, picked, probs, tauProbs, nSub };
}

// Shared unit plumbing: chunks built and split exactly as the sweep engine
// builds them, under the stages' fixed training branch — auto band, 24/7,
// argmax-style labels (decision record #2). The reserve layout seals its
// final 13% before the split, same as unitTask.
async function unitChunks(combo, geometry, p) {
  const branch = { geometry, decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const { geo, maps, chunks } = await buildCombo(combo, branch, {
    allLoaded: !!p.allLoaded, startMonth: p.startMonth, endMonth: p.endMonth,
  });
  let workChunks = chunks;
  let reserve = null;
  if (p.windowLayout === 'reserve61') {
    const nReserve = Math.max(2, Math.round(workChunks.length * 0.13));
    const sealed = workChunks.slice(workChunks.length - nReserve);
    reserve = { chunks: nReserve, fromTs: sealed[0].startTs, toTs: sealed[sealed.length - 1].endTs };
    workChunks = workChunks.slice(0, workChunks.length - nReserve);
  }
  const holdout = p.windowLayout !== 'legacy80';
  const split = splitAndLabel(workChunks, branch, holdout);
  return { geo, maps, split, reserve, holdout };
}

const viewsFor = (combo, geo) => bracketLib.comboViews(combo.size, geo.featureHours / 24).views;

// ---- TASK: one stage 1 unit ----------------------------------------------------
//
// Train the slim members (logreg per view), keep every test/held-back vote,
// score the unit under the fixed rule, deal the null set from the kept votes
// and read beat / lead. Returns everything the orchestrator writes.
async function s1UnitTask(task) {
  const { combo, geometry, params: p, seed, unitKey, nullN } = task;
  const { geo, maps, split, reserve } = await unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks, bandPct } = split;
  const views = viewsFor(combo, geo);
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const specs = require('./bracketwork').slimViewsFor(combo.size).map((view) => ({ model: 'logreg', view }));
  const members = [];
  for (const spec of specs) {
    const m = await trainProbMember({ model: spec.model, viewIdx: views[spec.view], trainChunks, predictChunks });
    members.push({ spec, ...m });
  }
  const testLabels = testChunks.map((c) => c.label);
  const testProbs = members.map((m) => m.probs.slice(0, testChunks.length));
  const score = forecastScore(testProbs, testLabels);
  const nullScores = [];
  for (let d = 0; d < nullN; d++) {
    const order = dealOrder(seed, unitKey, `s1#${d}`, testChunks.length);
    nullScores.push(forecastScore(testProbs, testLabels, order));
  }
  let beat = 0;
  for (const s of nullScores) if (score > s) beat++;
  return {
    bandPct,
    reserve,
    counts: {
      train: trainChunks.length,
      test: testChunks.length,
      hold: holdChunks.length,
      nSub: members.length ? trainChunks.length - members[0].tauProbs.length : null,
    },
    members: members.map((m) => ({
      spec: m.spec, picked: m.picked, saved: m.saved, tauProbs: m.tauProbs,
      probs: m.probs,
    })),
    ts: {
      test: testChunks.map((c) => c.startTs),
      hold: holdChunks.map((c) => c.startTs),
    },
    labels: { test: testLabels, hold: holdChunks.map((c) => c.label) },
    score, nullScores, beat, pairs: nullN, lead: leadOver(score, nullScores),
  };
}

// ---- TASK: one stage 2 unit ----------------------------------------------------
//
// Train ONLY the boost members for one carried unit; the logreg members'
// votes arrive in the payload from the stage 1 record set and are never
// retrained. Returns the boost members plus the unit's forecast score with
// the stage 1 members alone and with every member pooled.
async function s2UnitTask(task) {
  const { combo, geometry, params: p, s1 } = task;
  const { geo, split } = await unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks } = split;
  // The stage 1 votes must be describing THESE chunks. Refuse a unit whose
  // stored timestamps disagree with the rebuild — a manifest mismatch should
  // make this impossible, but refusing beats guessing (decision record #14).
  const ts = testChunks.map((c) => c.startTs);
  const tsH = holdChunks.map((c) => c.startTs);
  if (ts.length !== s1.ts.test.length || ts.some((t, i) => t !== s1.ts.test[i])
    || tsH.length !== s1.ts.hold.length || tsH.some((t, i) => t !== s1.ts.hold[i])) {
    throw new Error('stage 1 votes do not line up with the rebuilt chunks — the price files changed underneath the set');
  }
  const views = viewsFor(combo, geo);
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const specs = require('./bracketwork').slimViewsFor(combo.size).map((view) => ({ model: 'boost', view }));
  const members = [];
  for (const spec of specs) {
    const m = await trainProbMember({ model: spec.model, viewIdx: views[spec.view], trainChunks, predictChunks });
    members.push({ spec, ...m });
  }
  const testLabels = testChunks.map((c) => c.label);
  const s1Test = s1.probs.map((mp) => mp.slice(0, testChunks.length));
  const boostTest = members.map((m) => m.probs.slice(0, testChunks.length));
  const score3 = forecastScore(s1Test, testLabels);
  const scoreAll = forecastScore([...s1Test, ...boostTest], testLabels);
  return {
    members: members.map((m) => ({ spec: m.spec, picked: m.picked, saved: m.saved, tauProbs: m.tauProbs, probs: m.probs })),
    score3, scoreAll, helped: scoreAll - score3,
  };
}

// ---- TASK: one stage 3 unit ----------------------------------------------------
//
// Price every setting of the declared block for one unit, from the kept
// votes: derive each member's calls under the setting's decision (tau tuned
// from the stored probe votes at THIS run's fee), pool them at the agree
// count, mask 24/5 by chunk start time, and run the same simCell /
// holdControls the sweep engine prices with. The null set deals the kept
// votes once per draw — the same deals for every setting in the block.

// WHAT A REALISED AGREEMENT IS KEYED BY, in one place because two things
// read it: the pass that computes it, and the totalling that folds it onto
// every record. It depends on the unit and on the way of asking, and on
// NOTHING about the trade shape — which is why 329,280 settings on ten units
// need 600 numbers rather than 3.3 million.
// A SETTING'S QUORUM, in one shape, read from the setting itself. It reads
// exactly what is stored and translates nothing: a record set written before
// the bar became a dial is migrated to say so (RULE NINE), never interpreted.
const agrOf = (st) => ({
  rule: st.agreeRule || 'count',
  bar: st.agreeBar === 'own' ? 'own' : 'all',
  pct: Number(st.agreePct) || 50,
  both: !!st.agreeBoth,
  persist: Math.max(0, Math.floor(Number(st.agreePersist) || 0)),
});
const agreedKey = (decision, agr) => `${decision}|${agr.rule}|${agr.bar}|${agr.pct}|${agr.both ? 1 : 0}|${agr.persist}`;
// THE SAME KEY, BUILT THE SAME WAY. These were two expressions that had to
// agree and did not: one went through agrOf and one read the fields raw, so a
// row whose stored name differed from its resolved one missed its answer
// entirely. One of them is now the other.
const agreedKeyOfRecord = (r) => agreedKey(r.decision, agrOf(r));

async function s3UnitTask(task) {
  const { combo, geometry, params: p, unit, settings, fee, nullN, seed, unitKey, agreedOnly = false } = task;
  const { geo, maps, split } = await unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks } = split;
  const tsT = testChunks.map((c) => c.startTs);
  if (tsT.length !== unit.ts.test.length || tsT.some((t, i) => t !== unit.ts.test[i])) {
    throw new Error('stage 2 votes do not line up with the rebuilt chunks — the price files changed underneath the set');
  }
  // 24/5 mask: which test/hold positions start on a weekday the chunk
  // builder itself would keep. Read from the builder, not re-derived.
  const wkKeep = new Set(
    bracketLib.buildComboChunks(maps, geometry, true).chunks.map((c) => c.startTs),
  );
  const maskIdx = (chunksArr) => chunksArr.map((c, i) => (wkKeep.has(c.startTs) ? i : -1)).filter((i) => i >= 0);
  const wkTest = maskIdx(testChunks);
  const wkHold = maskIdx(holdChunks);

  const memberProbs = unit.probs;                       // per member: test+hold arrays
  const nTest = testChunks.length;
  const takeSlice = (mp, idxs, offset) => idxs.map((i) => mp[offset + i]);

  // tau per member, tuned once per run fee from the stored probe votes on the
  // member's validation slice — the same tuneTau menu the engine has always
  // used (decision record #1).
  const taus = unit.members.map((m) => {
    const nSub = trainChunks.length - m.tauProbs.length;
    const valChunks = trainChunks.slice(nSub);
    if (valChunks.length !== m.tauProbs.length) {
      throw new Error('stored tau votes do not line up with the rebuilt validation slice');
    }
    return tuneTau(valChunks, m.tauProbs.map(probsObj), maps.trade, geo, fee).tau;
  });

  // Deal orders, shared by every setting (decision record #7): per slice so
  // a one-directional held-back window cannot pay the real arm for its lean.
  const deals = [];
  for (let d = 0; d < (agreedOnly ? 0 : nullN); d++) {
    deals.push({
      test: dealOrder(seed, unitKey, `s3-test#${d}`, testChunks.length),
      hold: dealOrder(seed, unitKey, `s3-hold#${d}`, holdChunks.length),
    });
  }

  // Calls per (decision, arm, slice), derived once and cached; quorum streams
  // per (calls, agree) likewise. Settings sharing a stream share the work.
  const callCache = new Map();
  const callsFor = (decision, dealIdx, slice) => {
    const key = `${decision}|${dealIdx}|${slice}`;
    if (callCache.has(key)) return callCache.get(key);
    const offset = slice === 'hold' ? nTest : 0;
    const len = slice === 'hold' ? holdChunks.length : nTest;
    const out = memberProbs.map((mp, mi) => {
      const tau = decision === 'directional' ? taus[mi] : null;
      const arr = new Array(len);
      for (let i = 0; i < len; i++) arr[i] = callFromProbs(mp[offset + i], decision, tau);
      if (dealIdx >= 0) {
        const order = deals[dealIdx][slice];
        return order.map((k) => arr[k]);
      }
      return arr;
    });
    callCache.set(key, out);
    return out;
  };
  // The members' strengths, sliced and dealt exactly as their calls are, so
  // a rule that reads how strongly they lean sees the same moments in the
  // same order as a rule that only counts them.
  const probCache = new Map();
  const probsFor = (dealIdx, slice) => {
    const key = `${dealIdx}|${slice}`;
    if (probCache.has(key)) return probCache.get(key);
    const offset = slice === 'hold' ? nTest : 0;
    const len = slice === 'hold' ? holdChunks.length : nTest;
    const out = memberProbs.map((mp) => {
      const arr = new Array(len);
      for (let i = 0; i < len; i++) arr[i] = mp[offset + i];
      if (dealIdx >= 0) { const order = deals[dealIdx][slice]; return order.map((k) => arr[k]); }
      return arr;
    });
    probCache.set(key, out);
    return out;
  };

  // WHAT THE COMMITTEE ACTUALLY IS, measured on the test slice and never on
  // the held-back window: which members are independent voices and which are
  // near-copies of each other. A null-set deal shuffles every member by the
  // SAME order, so the committee's own structure is untouched by it — the
  // weights and cutoffs below are worked out once, from the real test slice,
  // and are correct for the deals too.
  const models = (unit.members || []).map((m) => (m.spec || {}).model || 'logreg');
  const families = (unit.members || []).map((m) => (m.spec || {}).view || 'full');
  const voiceCache = new Map();
  const voicesFor = (decision) => {
    if (voiceCache.has(decision)) return voiceCache.get(decision);
    const v = agreement.voiceGroups(callsFor(decision, -1, 'test'), nTest);
    voiceCache.set(decision, v);
    return v;
  };
  // THE BAR TAKEN FROM WHAT THIS COMMITTEE REACHES, for whichever way of
  // weighing is asked. Worked out once per (decision, way of weighing, share)
  // and always from the test slice — the held-back window is never read for it.
  const cutoffCache = new Map();
  const cutoffFor = (decision, rule, pct) => {
    const key = `${decision}|${rule}|${pct}`;
    if (cutoffCache.has(key)) return cutoffCache.get(key);
    const c = agreement.ownHistoryBar(barCtx(decision, rule), nTest, rule, pct);
    cutoffCache.set(key, c);
    return c;
  };
  // WHAT A SHARE IS A SHARE OF, under this rule, for THIS unit. One
  // definition: the rung divides by it, and the agreement actually reached
  // divides by the same thing, so the two are on one scale and comparable.
  const denomFor = (rule, decision) => (rule === 'voices' ? voicesFor(decision).voices
    : rule === 'families' ? new Set(families).size : memberProbs.length);
  // The rung a share lands on for THIS unit, under this rule.
  const rungFor = (rule, pct, decision) => {
    const n = denomFor(rule, decision);
    return Math.max(1, Math.min(n, Math.ceil((pct / 100) * n)));
  };
  // the votes and the extras a way of weighing needs, on the test slice, for
  // working out the bar. Declared before ctxFor because the bar is worked out
  // before any stream is; both build the same shape.
  const barCtx = (decision, rule) => ({
    calls: callsFor(decision, -1, 'test'), models, families,
    probs: rule === 'conviction' ? probsFor(-1, 'test') : null,
    weights: rule === 'voices' ? voicesFor(decision).weights : null,
  });
  // WHAT IS ENOUGH, for this unit, this way of weighing and this bar.
  const levelFor = (agr, decision) => ((agr.bar === 'own')
    ? cutoffFor(decision, agr.rule, agr.pct)
    : rungFor(agr.rule, agr.pct, decision));

  // The votes and the extras a rule reads, built once per way of asking.
  // Pulled out of streamFor so the agreement REACHED can be read off exactly
  // the same votes the rule read, rather than off a second copy that could
  // drift from it.
  const ctxCache = new Map();
  const ctxFor = (decision, agr, dealIdx, slice) => {
    const key = `${decision}|${agr.rule}|${dealIdx}|${slice}`;
    if (ctxCache.has(key)) return ctxCache.get(key);
    const ctx = {
      calls: callsFor(decision, dealIdx, slice), models, families,
      probs: agr.rule === 'conviction' ? probsFor(dealIdx, slice) : null,
      weights: agr.rule === 'voices' ? voicesFor(decision).weights : null,
    };
    ctxCache.set(key, ctx);
    return ctx;
  };

  const streamCache = new Map();
  const streamFor = (decision, agr, dealIdx, slice) => {
    const key = `${decision}|${agr.rule}|${agr.pct}|${agr.both ? 1 : 0}|${agr.persist}|${dealIdx}|${slice}`;
    if (streamCache.has(key)) return streamCache.get(key);
    const ctx = ctxFor(decision, agr, dealIdx, slice);
    const s = agreement.agreementStream(ctx, agr.rule, levelFor(agr, decision), { bothModels: agr.both, persist: agr.persist });
    streamCache.set(key, s);
    return s;
  };

  // HOW MUCH ACTUALLY AGREED, averaged over the moments this way of asking
  // spoke on the test slice, as a share of whatever the rule counts. The bar
  // is the floor of this number, never the whole of it: a setting asking for
  // 75% of eight fires on six, seven or eight, and this is what it got.
  //
  // Measured on the TEST slice only — every other thing this committee is
  // described by (its independent voices, the unusual rule's own cutoff) is
  // worked out there, and the held-back window stays unread.
  //
  // Cached on the same key the stream is, minus the window: which moments
  // speak depends on the rule, the share, +both and +hold, and on nothing
  // about the trade shape. So this is worked out once per way of asking and
  // re-used by every trade shape that asks that way.
  const agreedCache = new Map();
  const agreedFor = (decision, agr) => {
    const key = agreedKey(decision, agr);
    if (agreedCache.has(key)) return agreedCache.get(key);
    const spoke = streamFor(decision, agr, -1, 'test');
    const ctx = ctxFor(decision, agr, -1, 'test');
    const denom = denomFor(agr.rule, decision);
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
    const out = (n && denom) ? { agreed: pct(sum / n), agreedLow: pct(lo), agreedHigh: pct(hi), agreedN: n }
      : { agreed: null, agreedLow: null, agreedHigh: null, agreedN: 0 };
    agreedCache.set(key, out);
    return out;
  };
  const pick = (arr, idxs) => idxs.map((i) => arr[i]);
  const holdCtlCache = new Map();
  const holdControlsFor = (chunksArr, idxs, tHours, cacheKey) => {
    const key = `${cacheKey}|${tHours}`;
    if (holdCtlCache.has(key)) return holdCtlCache.get(key);
    const h = bracketLib.holdControls(pick(chunksArr, idxs), maps.trade, geo, tHours, fee);
    holdCtlCache.set(key, h);
    return h;
  };

  // Every distinct way of asking in this block, each answered once.
  const agreedMapFor = (list) => {
    const out = {};
    for (const st of list) {
      const agr = agrOf(st);
      const key = agreedKey(st.decision, agr);
      if (out[key]) continue;
      out[key] = agreedFor(st.decision, agr);
    }
    return out;
  };
  // THE BACKFILL DOOR (owner order, 2026-08-29). A set priced before this was
  // measured can still have it: the votes are on its stage 2 parent and the
  // answer never depended on the trade shape. This rebuilds the same unit and
  // walks the same streams, and prices nothing at all.
  if (agreedOnly) return { agreed: agreedMapFor(settings), counts: { test: testChunks.length, hold: holdChunks.length } };

  const rows = [];
  for (let si = 0; si < settings.length; si++) {
    const st = settings[si];
    const stream = st;                                   // decision / band / weekdaysOnly ride on the setting
    const bandPct = stream.band === 'auto' ? unit.bandPct : Math.abs(Number(stream.band));
    const tIdx = stream.weekdaysOnly ? wkTest : testChunks.map((_, i) => i);
    const hIdx = stream.weekdaysOnly ? wkHold : holdChunks.map((_, i) => i);
    const agr = agrOf(st);
    const cell = { entry: st.entry, gate: st.gate, dMult: st.dMult, tHours: st.tHours, trailMult: st.trailMult ?? null, armMult: st.armMult ?? null };
    const testCallsAll = streamFor(stream.decision, agr, -1, 'test');
    const tRes = bracketLib.simCell(cell, pick(testChunks, tIdx), pick(testCallsAll, tIdx), maps.trade, geo, bandPct, fee);
    let holdout = null;
    let beat = 0;
    let lead = null;
    if (holdChunks.length) {
      const holdCallsAll = streamFor(stream.decision, agr, -1, 'hold');
      const hRes = bracketLib.simCell(cell, pick(holdChunks, hIdx), pick(holdCallsAll, hIdx), maps.trade, geo, bandPct, fee);
      const hc = holdControlsFor(holdChunks, hIdx, st.tHours, stream.weekdaysOnly ? 'wk' : 'all');
      holdout = {
        pnl: hRes.pnl, trades: hRes.trades, stops: hRes.stops,
        vsAlwaysLong: hRes.pnl - hc.alwaysLong,
      };
      const dealPnls = [];
      for (let d = 0; d < nullN; d++) {
        const dh = streamFor(stream.decision, agr, d, 'hold');
        const dRes = bracketLib.simCell(cell, pick(holdChunks, hIdx), pick(dh, hIdx), maps.trade, geo, bandPct, fee);
        dealPnls.push(dRes.pnl);
        if (hRes.pnl > dRes.pnl) beat++;
      }
      // the same one rule stage 1 reads by (decision record #6): how far the
      // real held-back money sits above the deals' typical, against their spread
      lead = leadOver(hRes.pnl, dealPnls);
    }
    rows.push({
      si,
      label: st.label,
      decision: stream.decision,
      bandMode: stream.band === 'auto' ? 'auto' : Number(stream.band),
      weekdaysOnly: !!stream.weekdaysOnly,
      bandPct,
      entry: st.entry, gate: st.gate, dMult: st.dMult ?? null, tHours: st.tHours,
      trailMult: st.trailMult ?? null, armMult: st.armMult ?? null,
      agreeRule: agr.rule, agreeBar: agr.bar, agreePct: agr.pct, agreeBoth: agr.both, agreePersist: agr.persist,
      rung: levelFor(agr, stream.decision),
      members: memberProbs.length, voices: voicesFor(stream.decision).voices,
      pnl: tRes.pnl, trades: tRes.trades,
      holdout,
      beat, pairs: holdChunks.length ? nullN : 0, lead,
    });
  }
  return { rows, agreed: agreedMapFor(settings), counts: { test: testChunks.length, hold: holdChunks.length } };
}

// ---- the stage 3 tally, foldable and shardable --------------------------------
//
// ONE folding rule for the stage 3 tables, expressed once and used by both
// the single-pass build and the sharded build (owner order, 2026-08-27:
// "yes" to multithreading the totalling). Sums are commutative, the block
// sets are unions, and the finishing sort happens after the merge — so the
// sharded answer is the single-pass answer, and a test holds the two equal.
function newTallyAcc() {
  return { perSetting: new Map(), perCoin: new Map(), rows: 0 };
}
function tallyFold(acc, r, blockIdx, agreedAt = null) {
  // What the members ACTUALLY did, looked up by the unit and the way of
  // asking. It is not on the record: 329,280 settings on ten units share 600
  // answers between them, so it is kept once per answer and joined here.
  const agreed = agreedAt ? agreedAt[`${r.u}|${agreedKeyOfRecord(r)}`] : null;
  let s = acc.perSetting.get(r.si);
  if (!s) {
    s = { si: r.si, label: r.label,
      decision: r.decision, bandMode: r.bandMode, weekdaysOnly: r.weekdaysOnly,
      entry: r.entry, gate: r.gate, dMult: r.dMult, tHours: r.tHours, trailMult: r.trailMult, armMult: r.armMult,
      // null, never undefined: undefined vanishes through the worker boundary
      // and the sharded fold would then disagree with the single-pass one on a
      // field neither of them actually used
      agreeRule: r.agreeRule ?? null, agreeBar: r.agreeBar ?? null, agreePct: r.agreePct ?? null,
      agreeBoth: r.agreeBoth ?? null, agreePersist: r.agreePersist ?? null,
      members: r.members ?? null,
      perCoin: new Map() };
    acc.perSetting.set(r.si, s);
  }
  let c = s.perCoin.get(r.trade);
  if (!c) { c = { test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, vsl: 0, vsln: 0, beat: 0, pairs: 0, ld: 0, ldN: 0, rung: 0, rungN: 0, voices: 0, voicesN: 0, agr: 0, agrN: 0 }; s.perCoin.set(r.trade, c); }
  c.test += r.pnl || 0; c.testN++;
  if (r.rung != null) { c.rung += r.rung; c.rungN++; }
  if (r.voices != null) { c.voices += r.voices; c.voicesN++; }
  // records priced before this measurement existed simply have no value here,
  // and a column with no value reads as absent rather than as zero
  if (agreed && agreed.agreed != null) { c.agr += agreed.agreed; c.agrN++; }
  if (r.holdout && r.holdout.pnl != null) {
    c.hold += r.holdout.pnl; c.holdN++;
    c.trades += r.holdout.trades || 0;
    if (r.holdout.vsAlwaysLong != null) { c.vsl += r.holdout.vsAlwaysLong; c.vsln++; }
  }
  c.beat += r.beat || 0; c.pairs += r.pairs || 0;
  if (r.lead != null) { c.ld += r.lead; c.ldN++; }

  const cellLabel = r.label.split(' · ')[0];
  const ck = `${cellLabel}|${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}`;
  let k = acc.perCoin.get(ck);
  if (!k) {
    k = { cellLabel, trade: r.trade, ctx1: r.ctx1, ctx2: r.ctx2, geometry: r.geometry,
      beat: 0, pairs: 0, test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, tradesN: 0, vsl: 0, vsln: 0,
      agr: 0, agrN: 0, rows: 0, b: new Set() };
    acc.perCoin.set(ck, k);
  }
  k.rows++;
  if (agreed && agreed.agreed != null) { k.agr += agreed.agreed; k.agrN++; }
  k.beat += r.beat || 0; k.pairs += r.pairs || 0;
  k.test += r.pnl || 0; k.testN++;
  if (r.holdout && r.holdout.pnl != null) {
    k.hold += r.holdout.pnl; k.holdN++;
    k.trades += r.holdout.trades || 0; k.tradesN++;
    if (r.holdout.vsAlwaysLong != null) { k.vsl += r.holdout.vsAlwaysLong; k.vsln++; }
  }
  k.b.add(blockIdx);
  acc.rows++;
}
// Across-thread shapes: Maps and Sets do not survive the worker boundary, so
// a shard hands back plain arrays and the merge folds them into the same
// accumulator shape the single pass builds.
function serializeTallyAcc(acc) {
  return {
    rows: acc.rows,
    perSetting: [...acc.perSetting.values()].map((s) => ({ ...s, perCoin: [...s.perCoin.entries()] })),
    perCoin: [...acc.perCoin.entries()].map(([ck, k]) => [ck, { ...k, b: [...k.b] }]),
  };
}
function mergeTallyAcc(acc, part) {
  acc.rows += part.rows;
  for (const ps of part.perSetting) {
    let s = acc.perSetting.get(ps.si);
    if (!s) { s = { ...ps, perCoin: new Map() }; delete s.perCoin; s.perCoin = new Map(); acc.perSetting.set(ps.si, s); }
    for (const [trade, add] of ps.perCoin) {
      let c = s.perCoin.get(trade);
      if (!c) { c = { test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, vsl: 0, vsln: 0, beat: 0, pairs: 0, ld: 0, ldN: 0, rung: 0, rungN: 0, voices: 0, voicesN: 0, agr: 0, agrN: 0 }; s.perCoin.set(trade, c); }
      c.test += add.test; c.testN += add.testN; c.hold += add.hold; c.holdN += add.holdN;
      c.trades += add.trades; c.vsl += add.vsl; c.vsln += add.vsln;
      c.beat += add.beat; c.pairs += add.pairs;
      c.ld += add.ld || 0; c.ldN += add.ldN || 0;
      c.rung += add.rung || 0; c.rungN += add.rungN || 0;
      c.voices += add.voices || 0; c.voicesN += add.voicesN || 0;
      c.agr += add.agr || 0; c.agrN += add.agrN || 0;
    }
  }
  for (const [ck, add] of part.perCoin) {
    let k = acc.perCoin.get(ck);
    if (!k) {
      k = { cellLabel: add.cellLabel, trade: add.trade, ctx1: add.ctx1, ctx2: add.ctx2, geometry: add.geometry,
        beat: 0, pairs: 0, test: 0, testN: 0, hold: 0, holdN: 0, trades: 0, tradesN: 0, vsl: 0, vsln: 0,
        agr: 0, agrN: 0, rows: 0, b: new Set() };
      acc.perCoin.set(ck, k);
    }
    k.rows += add.rows;
    k.beat += add.beat; k.pairs += add.pairs;
    k.test += add.test || 0; k.testN += add.testN || 0;
    k.hold += add.hold; k.holdN += add.holdN;
    k.trades += add.trades; k.tradesN += add.tradesN;
    k.vsl += add.vsl; k.vsln += add.vsln;
    k.agr += add.agr || 0; k.agrN += add.agrN || 0;
    for (const b of add.b) k.b.add(b);
  }
  return acc;
}
// TASK: fold one shard of the records store — a list of whole blocks, each
// read exactly once, each row tagged with the block it came from.
async function s3TallyShardTask({ id, blocks, agreedAt = null }) {
  const rowstore = require('./rowstore');
  const acc = newTallyAcc();
  for (const bIdx of blocks) {
    for (const got of rowstore.readBlocks(id, 'records', [bIdx])) tallyFold(acc, got.row, bIdx, agreedAt);
  }
  return serializeTallyAcc(acc);
}

// S2_ORDERINGS lived here until 2026-08-27: the owner replaced the two-way
// order by with sorts picked on the tables themselves and saved on the set
// (lib/stages.js SORT_KEYS) — the carry reads the saved sort, so a separate
// launch-side ordering menu was a second answer to the same question. The
// export outlived the control by one deploy (the word-list generator
// compiles the SERVED commit's vocabulary, which asked for it at load) and
// came out once the box served a vocabulary without it.

module.exports = {
  s1UnitTask, s2UnitTask, s3UnitTask, s3TallyShardTask,
  agreedKey, agreedKeyOfRecord, agrOf,
  newTallyAcc, tallyFold, serializeTallyAcc, mergeTallyAcc,
  // the arithmetic, exported so the tests can pencil it
  forecastScore, pooledAt, leadOver, dealOrder, callFromProbs, trainProbMember, unitChunks,
  probsArr, probsObj,
};
