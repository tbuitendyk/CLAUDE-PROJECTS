// HISTORY TUNING v2 — the paired age-dial instrument (DESIGN-HT2.md,
// owner-approved 2026-08-04/05). Replaces v1's 35-arm shopped grid for the
// age question with ONE pre-declared comparison:
//
//   reference (uniform training weights)  vs  ONE half-life h
//
// walked over ~20 paired folds. No menus, no retunes, no winner-picking —
// the traded cell is the candidate's FROZEN cell in both arms, so the only
// variable is how training data is weighted by age. The verdict is a
// sign-flip randomization test on the per-fold paired deltas, and it fires
// on EVERY run, pass or fail (v1 fault: power was never measured on
// failures). Audit obligations are computed by the verdict itself (QC 78).
//
// ENTRANCE EXAMS (QC 56): the instrument may not touch a real pair until,
// on the CURRENT engine version, it has (A) PASSED on PLANTEDLATEUSDT
// (rule on only in the final third — age-weighting has a known advantage)
// and (B) NOT passed on PLANTEDUSDT (stationary rule — age-weighting has a
// known non-advantage). Both fabricated, both reserved, both refusals ride
// in the ordinary launcher.

const bracketLib = require('./bracket');
const { feeFracOf } = require('./paper');
const H = require('./history');
const { mulberry32 } = require('./rng');

const DAY_MS = H.DAY_MS;

// The declarable half-lives. 6mo is excluded a priori: its effective
// training mass sits at the starvation floor on this project's history
// lengths (measured in the v1 record — eff. days 194-349), so it tests
// data starvation, not recency emphasis.
const HALF_LIVES = {
  '12mo': 365,
  '24mo': 730,
  '36mo': 1095,
};

const K_TARGET = 20;   // DERIVED: per-fold delta sd measured at ~$134 (v1 record); ~20 folds resolve ~$60/fold effects at 2 sd
const K_MIN = 12;      // below this the resolution claim collapses — refuse
const MIN_WINDOW_DAYS = 30; // GUESSED: ~15 trades per fold at the candidate family's observed trade rate
const RESAMPLES = 10000;

const READING_RULES_V2 = {
  R1: {
    label: 'DERIVED',
    text: 'The statistic is the SUM of per-fold paired deltas (half-life arm dollars minus reference '
      + 'dollars, same fold, same frozen cell). Positive-fold count is descriptive, never the verdict.',
  },
  R2: {
    label: 'DERIVED — always fires',
    text: `The null is the sign-flip randomization of the per-fold deltas (${RESAMPLES} resamples, seeded `
      + 'from the run id): under "no systematic arm effect" each fold\'s delta sign is exchangeable. '
      + 'p = (resamples with sum >= observed + 1) / (resamples + 1). PASS needs p <= 0.05 AND the '
      + 'concentration rule. This null fires on every run, pass or fail.',
  },
  R3: {
    label: 'DERIVED — endpoint-computed (QC 78)',
    text: 'Concentration: the largest single positive fold delta over the total positive sum, printed with '
      + 'every verdict. A sum carried >50% by one fold is CARRIED-BY-ONE-FOLD and cannot pass.',
  },
  R4: {
    label: 'DERIVED',
    text: 'The instrument touches no real pair until, on the current engine version, it has PASSED exam A '
      + '(PLANTEDLATEUSDT, rule on only late — a known advantage) and NOT passed exam B (PLANTEDUSDT, '
      + 'stationary rule — a known non-advantage). The launcher refuses, like the planted gate.',
  },
};

// ---- fold geometry ----------------------------------------------------------
// Expanding training, K equal disjoint graded windows at the back of the
// usable span. No test windows exist: nothing is picked, so every window is
// graded. Training run-up mirrors v1's floor.

function foldGeometry(usableStartTs, usableEndTs) {
  const spanDays = (usableEndTs - usableStartTs) / DAY_MS;
  let k = K_TARGET;
  let windowDays = Math.floor((spanDays - 425) / k);
  while (windowDays < MIN_WINDOW_DAYS && k > K_MIN) {
    k -= 1;
    windowDays = Math.floor((spanDays - 425) / k);
  }
  if (windowDays < MIN_WINDOW_DAYS) {
    return { refusal: `refused: usable span ${spanDays.toFixed(0)} days gives ${windowDays}-day folds even at K=${K_MIN} — below the ${MIN_WINDOW_DAYS}-day floor. Load more history.` };
  }
  const W = windowDays * DAY_MS;
  const backStart = usableEndTs - k * W;
  const folds = Array.from({ length: k }, (_, i) => ({
    index: i,
    foldStartTs: backStart + i * W,
    foldEndTs: backStart + (i + 1) * W,
  }));
  return { folds, windowDays, k, refusal: null };
}

// ---- one fold, both arms ------------------------------------------------------

function reachMsFor(geo, tHours) {
  return (geo.entryOffsetH + tHours + 3) * 3600 * 1000;
}

async function htTwoFoldTask(payload) {
  const { combo, branch, fold, params: p } = payload;
  const { buildCombo, quorumCall, specsFor } = require('./bracketwork');
  const { scoreDiff } = require('./dataset');
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  const usable = chunks.filter((c) => c.startTs >= p.usableStartTs && c.startTs < p.usableEndTs);
  const bandPct = p.declaredCell.bandPct;
  for (const c of usable) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  const cell = p.declaredCell;
  const cellReach = reachMsFor(geo, cell.tHours);
  const trainReach = Math.max(geo.featureHours, (geo.exitOffsetH ?? 0) + 3, geo.entryOffsetH + cell.tHours + 3) * 3600 * 1000;

  // Training set: everything whose full execution reach settles before the
  // fold opens (v1's purge rule, unchanged).
  const trainSet = usable.filter((c) => c.startTs + trainReach <= fold.foldStartTs);
  // Fold set: decisions inside the fold whose own trade settles inside it
  // (per-cell edge purge, v1 ruling C).
  const foldChunks = usable.filter((c) => c.startTs >= fold.foldStartTs
    && c.startTs < fold.foldEndTs && c.startTs + cellReach <= fold.foldEndTs);
  if (!foldChunks.length) return { fold: fold.index, skipped: 'no scoreable decisions inside this fold' };

  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  const specs = specsFor(combo.size, 'promoted');

  const arms = {};
  for (const armKey of ['ref', 'arm']) {
    const halfLifeDays = armKey === 'arm' ? p.halfLifeDays : null;
    const { weights, effectiveDays } = H.ageWeights(
      trainSet.map((c) => ({ endTs: c.startTs })), fold.foldStartTs, halfLifeDays,
    );
    const floorRefusal = H.floorRefusal(effectiveDays, `fold ${fold.index}, ${armKey === 'arm' ? p.halfLifeKey : 'reference'}`);
    if (floorRefusal) return { fold: fold.index, refused: floorRefusal, arm: armKey, effectiveDays };
    const memberCalls = [];
    for (const spec of specs) {
      const { calls } = await bracketLib.trainMember({
        model: spec.model,
        viewIdx: views[spec.view],
        trainChunks: trainSet,
        testChunks: foldChunks,
        decision: branch.decision,
        feePerLeg: feeFracOf(p),
        tradeMap: maps.trade,
        geo,
        ageWeights: halfLifeDays ? weights : null,
      });
      memberCalls.push(calls);
    }
    const stream = foldChunks.map((_, i) => quorumCall(memberCalls, i, cell.quorum || 1));
    const r = bracketLib.simCell(cell, foldChunks, stream, maps.trade, geo, bandPct, feeFracOf(p));
    arms[armKey] = { pnl: r.pnl, trades: r.trades, effectiveDays };
  }

  return {
    fold: fold.index,
    foldStartTs: fold.foldStartTs,
    foldEndTs: fold.foldEndTs,
    decisions: foldChunks.length,
    ref: arms.ref,
    arm: arms.arm,
    delta: arms.arm.pnl - arms.ref.pnl,
  };
}

// ---- the verdict (pure arithmetic; audit obligations computed here) -----------

function signFlipP(deltas, seedText) {
  let h = 0;
  for (const ch of String(seedText)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = mulberry32(h || 1);
  const observed = deltas.reduce((s, d) => s + d, 0);
  let atOrAbove = 0;
  for (let r = 0; r < RESAMPLES; r++) {
    let sum = 0;
    for (const d of deltas) sum += rng() < 0.5 ? d : -d;
    if (sum >= observed) atOrAbove++;
  }
  return { observed, p: (atOrAbove + 1) / (RESAMPLES + 1), resamples: RESAMPLES };
}

function httwoVerdict(doc) {
  const out = { id: doc.id, engineVersion: doc.params?.engineVersion || 'unknown', pass: false, sentences: [] };
  if (doc.status !== 'done') {
    out.sentences.push(`run ${doc.id} is ${doc.status} — no verdict until it finishes`);
    return out;
  }
  const rows = (doc.foldRows || []).filter((r) => !r.refused && !r.skipped);
  const dropped = (doc.foldRows || []).length - rows.length;
  const usable = rows.filter((r) => (r.ref.trades + r.arm.trades) > 0);
  const silent = rows.length - usable.length;
  const deltas = usable.map((r) => r.delta);
  out.folds = { planned: doc.params?.foldCount ?? null, completed: rows.length, dropped, silentBothArms: silent, used: usable.length };
  if (usable.length < K_MIN) {
    out.sentences.push(`INSUFFICIENT FOLDS: ${usable.length} usable of ${K_MIN} minimum — no claim either way`);
    return out;
  }
  const test = signFlipP(deltas, doc.id);
  out.sum = test.observed;
  out.p = test.p;
  out.positiveFolds = deltas.filter((d) => d > 0).length;
  // R3, computed here so it cannot be skipped (QC 78):
  const positives = deltas.filter((d) => d > 0);
  const posSum = positives.reduce((s, d) => s + d, 0);
  out.concentration = posSum > 0 ? Math.max(...positives) / posSum : null;
  out.carriedByOneFold = out.concentration != null && out.concentration > 0.5;
  out.pass = test.p <= 0.05 && !out.carriedByOneFold;
  const money = (x) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(2)}`;
  out.sentences.push(`paired sum ${money(test.observed)} over ${usable.length} folds (${out.positiveFolds} positive); sign-flip p = ${test.p.toFixed(4)} (${test.resamples} resamples)`);
  out.sentences.push(`concentration: largest positive fold carries ${out.concentration == null ? 'n/a (no positive folds)' : `${(100 * out.concentration).toFixed(0)}% of the positive sum`}${out.carriedByOneFold ? ' — CARRIED-BY-ONE-FOLD, cannot pass' : ''}`);
  if (silent) out.sentences.push(`${silent} fold(s) had zero trades in both arms and were excluded from the statistic (disclosed, not hidden)`);
  out.sentences.push(out.pass
    ? `PASS: the ${doc.params?.halfLifeKey} half-life beat the reference beyond the sign-flip null on ${usable.length} paired folds.`
    : `NO EFFECT SHOWN: the ${doc.params?.halfLifeKey} half-life did not beat the reference beyond noise${out.carriedByOneFold ? ' (or the sum was carried by one fold)' : ''}.`);
  return out;
}

// ---- the entrance-exam gate ---------------------------------------------------

// Computed on the fly from stored httwo docs — no state file to rot. Exam A
// must PASS on the late-rule pair; exam B must NOT pass on the stationary
// pair; both on the current engine version.
function examStatus(currentVersion, docs) {
  const done = docs.filter((d) => d.kind === 'httwo' && d.status === 'done'
    && (d.params?.engineVersion === currentVersion));
  const newest = (pair) => done.filter((d) => d.params?.combo?.trade === pair)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] || null;
  const a = newest('PLANTEDLATEUSDT');
  const b = newest('PLANTEDUSDT');
  const av = a ? httwoVerdict(a) : null;
  const bv = b ? httwoVerdict(b) : null;
  const ready = !!(av && av.pass === true && bv && bv.pass === false);
  return {
    engineVersion: currentVersion,
    ready,
    examA: a ? { id: a.id, pass: av.pass, p: av.p } : null,
    examB: b ? { id: b.id, pass: bv.pass, p: bv.p } : null,
    detail: ready
      ? `exams passed on engine ${currentVersion}: found the late-rule plant (A) and refused the stationary one (B)`
      : `instrument not exam-cleared on engine ${currentVersion}: `
        + `${!a ? 'exam A (PLANTEDLATEUSDT) not run' : av.pass ? 'exam A passed' : 'exam A DID NOT PASS'}; `
        + `${!b ? 'exam B (PLANTEDUSDT) not run' : !bv.pass ? 'exam B correctly found nothing' : 'exam B WRONGLY PASSED — the instrument sees ghosts'}`,
  };
}

module.exports = {
  HALF_LIVES, K_TARGET, K_MIN, MIN_WINDOW_DAYS, RESAMPLES, READING_RULES_V2,
  foldGeometry, htTwoFoldTask, signFlipP, httwoVerdict, examStatus,
};
