// History Tuning arithmetic: the age discount, effective training days,
// and the SYSTEM-WIDE training floor (design ledger DESIGN-HISTORY-TUNING.md,
// owner rulings 2026-08-02/03). Pure functions, no imports at all — same
// discipline as lib/logreg.js.
//
// Vocabulary (GLOSSARY.md): half-life = the age at which a training example
// counts half as much. Effective training days = the weight-adjusted amount
// of training data the members really saw (sum of per-example weights
// expressed in days of chunk starts). Training floor = the minimum effective
// training days a run must have to be allowed to run; below it the launch
// REFUSES loudly, stating its number.

const DAY_MS = 24 * 3600 * 1000;

// The floor. GUESSED (design ledger): permits the 6-month arm (whose
// mathematical cap is ~262 effective days) while catching genuinely starved
// runs. Revisit from real probe results (where quality actually degrades).
const TRAINING_FLOOR_DAYS = 180;
const TRAINING_FLOOR_LABEL = 'GUESSED';

// Weight of one training example whose window ENDS at endTs, when training
// ends at trainEndTs, under half-life H in days (null/0 = no discount).
function ageWeight(endTs, trainEndTs, halfLifeDays) {
  if (!halfLifeDays) return 1;
  const ageDays = Math.max(0, (trainEndTs - endTs) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// Per-chunk weights for a training set. chunks: [{endTs}] (any objects with
// an endTs in ms). Returns { weights, effectiveDays } where effectiveDays is
// the sum of weights normalized to "days of chunk starts": chunks step one
// day apart, so one chunk at full weight = one day of training data.
function ageWeights(chunks, trainEndTs, halfLifeDays) {
  const weights = chunks.map((c) => ageWeight(c.endTs, trainEndTs, halfLifeDays));
  const effectiveDays = weights.reduce((a, b) => a + b, 0);
  return { weights, effectiveDays };
}

// The mathematical ceiling on effective days for a half-life, regardless of
// loaded history: H/ln2 = 1.4427 x H. Printed by launchers so a floor can
// never be set above an arm's ceiling (the money-gate disease, register 33).
function effectiveDaysCap(halfLifeDays) {
  return halfLifeDays ? halfLifeDays / Math.LN2 : Infinity;
}

// The floor check. Returns null when clear, else the loud refusal string —
// callers throw it or print it, they never soften it.
function floorRefusal(effectiveDays, context) {
  if (effectiveDays >= TRAINING_FLOOR_DAYS) return null;
  return `refused: effective training ${effectiveDays.toFixed(0)} days is below the training floor `
    + `${TRAINING_FLOOR_DAYS} (${TRAINING_FLOOR_LABEL})${context ? ` — ${context}` : ''}. `
    + 'Starved members return plausible-looking numbers; this run will not.';
}

// Calendar retrain milestones (owner ruling A): anchored to the DATA
// calendar, one every half-life counted from the start of loaded history,
// independent of test/hold placement. Returns ms timestamps strictly after
// historyStartTs and at-or-before walkEndTs. No discount = no milestones.
function retrainMilestones(historyStartTs, walkEndTs, halfLifeDays) {
  if (!halfLifeDays) return [];
  const out = [];
  const step = halfLifeDays * DAY_MS;
  for (let t = historyStartTs + step; t <= walkEndTs; t += step) out.push(t);
  return out;
}

module.exports = {
  DAY_MS,
  TRAINING_FLOOR_DAYS,
  TRAINING_FLOOR_LABEL,
  ageWeight,
  ageWeights,
  effectiveDaysCap,
  floorRefusal,
  retrainMilestones,
};
