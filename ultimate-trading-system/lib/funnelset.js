// funnelset.js -- the Stage 4 record: what the Funnel produces, and the rule
// that produced it.
//
// THE THING THAT IS PRESERVED IS THE RULE, NOT THE ROW. A row picked off a board
// cannot be null-tested; a rule can, because the same rule can be applied to a
// noise board. That single distinction is why this is a record set with a rule
// on it rather than a "selected row" flag, and it is also why the broken
// selection path is not being repaired: POST /api/bracketlab/:id/select is
// written by no screen, and every reader that gates on it comes to read one of
// these instead.
//
// IT ALSO RECORDS THE LOOKING. Every step, in order, with what was chosen -- and
// every step BACK, because going back and re-choosing is more looking and the
// record must not hide it. The one-touch reserve grade at the end of the chain
// counts looks; it can only count what was written down.

const funnel = require('./funnel');

// ---- the rule ----------------------------------------------------------------
//
// ONE FUNCTION APPLIES IT, at cut time and at replay time alike. Two
// applications that could drift is the whole reason a replay is worth testing,
// so there is only one.
//
//   ranges   ordered dials: { tHours: { min, max } } -- inclusive both ends
//   allowed  categorical dials: { gate: ['active', 'always'] }
//   floors   step 6: { maxDrawdown: 500, trades: 20 } -- read from the rebuilt
//            numbers, each named with the direction it cuts
const EMPTY_RULE = Object.freeze({ ranges: {}, allowed: {}, floors: {} });

function normaliseRule(rule) {
  const r = rule || {};
  return {
    ranges: r.ranges && typeof r.ranges === 'object' ? r.ranges : {},
    allowed: r.allowed && typeof r.allowed === 'object' ? r.allowed : {},
    floors: r.floors && typeof r.floors === 'object' ? r.floors : {},
  };
}

// A range on a dial the run swept as text ('auto') cannot be compared with < and
// >. Rather than coerce it to NaN and silently drop every row, a non-numeric
// value is kept only when the range explicitly lists it.
function inRange(value, spec) {
  const lo = spec && spec.min != null ? Number(spec.min) : null;
  const hi = spec && spec.max != null ? Number(spec.max) : null;
  const keep = spec && Array.isArray(spec.also) ? spec.also.map(String) : [];
  if (value == null) return keep.includes('none');
  const n = Number(value);
  if (!Number.isFinite(n)) return keep.includes(String(value));
  if (lo != null && n < lo) return false;
  if (hi != null && n > hi) return false;
  return true;
}

function applyRule(rows, rule) {
  const R = normaliseRule(rule);
  return (rows || []).filter((row) => {
    for (const [dial, spec] of Object.entries(R.ranges)) {
      if (!inRange(row[dial], spec)) return false;
    }
    for (const [dial, allowed] of Object.entries(R.allowed)) {
      if (!Array.isArray(allowed) || !allowed.length) continue;
      if (!allowed.map(String).includes(funnel.keyOf(row[dial]))) return false;
    }
    for (const [field, spec] of Object.entries(R.floors)) {
      const v = row[field];
      if (v == null) return false;         // a floor cannot pass on a number that is not there
      const n = Number(v);
      if (!Number.isFinite(n)) return false;
      if (spec && spec.min != null && n < Number(spec.min)) return false;
      if (spec && spec.max != null && n > Number(spec.max)) return false;
    }
    return true;
  });
}

// The rule in one sentence, so the page can state it back before it is pressed.
// Built from the rule itself rather than from what the owner clicked, because
// what gets written is what gets replayed.
function ruleSentence(rule) {
  const R = normaliseRule(rule);
  const parts = [];
  for (const [dial, spec] of Object.entries(R.ranges)) {
    const lo = spec && spec.min != null ? spec.min : null;
    const hi = spec && spec.max != null ? spec.max : null;
    const also = spec && spec.also && spec.also.length ? ` or ${spec.also.join('/')}` : '';
    if (lo != null && hi != null) parts.push(`${dial} ${lo} to ${hi}${also}`);
    else if (lo != null) parts.push(`${dial} ${lo} or more${also}`);
    else if (hi != null) parts.push(`${dial} ${hi} or less${also}`);
  }
  for (const [dial, allowed] of Object.entries(R.allowed)) {
    if (Array.isArray(allowed) && allowed.length) parts.push(`${dial} is ${allowed.join(' or ')}`);
  }
  for (const [field, spec] of Object.entries(R.floors)) {
    if (spec && spec.min != null) parts.push(`${field} at least ${spec.min}`);
    if (spec && spec.max != null) parts.push(`${field} at most ${spec.max}`);
  }
  return parts.length ? parts.join('; ') : 'everything (no choices made yet)';
}

// ---- closing the gap to the target -------------------------------------------
//
// THREE WAYS, ALL OFFERED, NONE REMOVED (owner rulings 5 and 6). The third is
// shopping on the very board the funnel exists to stop you shopping, and it says
// so in those words rather than being quietly withheld -- removing the owner's
// choice is the fault RULE ZERO and RULE FIVE exist to prevent.
const CLOSINGS = Object.freeze({
  rule: {
    key: 'rule',
    label: 'accept what the rule gives',
    cost: 'nothing. The target was a guide, not a promise.',
  },
  tighten: {
    key: 'tighten',
    label: 'tighten the ranges toward the middle',
    cost: 'little. It narrows each range inward from BOTH ends, so it keeps the '
      + "region's interior rather than moving toward the best value.",
  },
  top: {
    key: 'top',
    label: 'take the top N by a column',
    cost: 'the most. This is shopping, on the board the funnel exists to stop you '
      + 'shopping. It is offered because the choice is yours, and it is recorded '
      + 'on the set so the reserve grade knows what it is judging.',
  },
});

// ---- the record --------------------------------------------------------------

function newFunnelSet({ id, name, parent, release, target, seed, boardNull, sealed }) {
  return {
    id,
    name: name || id,
    kind: 'funnel',
    stage: 4,
    createdAt: new Date().toISOString(),
    // the release that made THIS reading, beside the release that priced the
    // board it read -- a rebuilt number and a stored one can come from
    // different engines and the set has to be able to say so
    release: release || null,
    parent: parent ? { id: parent.id, name: parent.name, release: (parent.params || {}).engineVersion || null } : null,
    // the target is a guide from the first step, never a trim
    target: target == null ? null : Math.max(0, Math.floor(target)),
    seed: seed || id,
    // whether a noise twin was available at all, as a first-class field, so no
    // reader has to notice an absence and infer it
    boardNull: boardNull || null,
    sealed: sealed || null,
    steps: [],
    backSteps: [],
    rule: { ...EMPTY_RULE },
    survivors: null,
    counts: null,
    closing: null,
    warnings: [],
    heldBackReadAt: null,
  };
}

function recordStep(doc, step) {
  doc.steps.push({
    at: new Date().toISOString(),
    n: (step && step.n) || doc.steps.length + 1,
    what: (step && step.what) || null,
    chose: (step && step.chose) || null,
    survivors: (step && step.survivors) == null ? null : step.survivors,
    splitHalf: (step && step.splitHalf) || null,
    noiseTwin: (step && step.noiseTwin) || null,
  });
  return doc;
}

// GOING BACK IS LOOKING. A funnel walked forward once and a funnel walked back
// four times have seen different amounts of the board, and only one of them
// admits it.
function recordBackStep(doc, { from, to, why }) {
  doc.backSteps.push({ at: new Date().toISOString(), from: from ?? null, to: to ?? null, why: why || null });
  return doc;
}

// AN EMPTY OR ONE-SETTING RESULT IS WRITTEN WITH A WARNING, NEVER REFUSED
// (owner ruling 6, "no restrictions"). A refusal here would take the owner's
// decision away invisibly, which is the thing RULE ZERO is for; a set that
// says it is empty is honest and can be looked at.
function warningsFor(survivors, target) {
  const out = [];
  const n = survivors ? survivors.length : 0;
  if (n === 0) out.push('this rule keeps nothing — the set is empty, and it is written so the rule that emptied it can be read back');
  else if (n === 1) out.push('this rule keeps one setting — a single row cannot be checked against anything on the tab that compares rows');
  if (target != null && target > 0 && n > target * 3) {
    out.push(`this rule keeps ${n}, which is well past the target of ${target}`);
  }
  return out;
}

function finishFunnelSet(doc, survivors, closing) {
  const list = survivors || [];
  doc.survivors = list.map((r) => ({ si: r.si, label: r.label }));
  doc.counts = { survivors: list.length, target: doc.target };
  doc.closing = closing && CLOSINGS[closing.key]
    ? { key: closing.key, label: CLOSINGS[closing.key].label, detail: closing.detail || null }
    : { key: 'rule', label: CLOSINGS.rule.label, detail: null };
  doc.warnings = warningsFor(list, doc.target);
  doc.ruleSentence = ruleSentence(doc.rule);
  return doc;
}

// A STAGE 4 SET MUST REPLAY. Re-running its recorded rule against its parent's
// rows has to give exactly the same settings back — otherwise the record is a
// story about a decision rather than the decision itself.
function replay(doc, parentRows) {
  const got = applyRule(parentRows, doc.rule).map((r) => r.label).sort();
  const had = (doc.survivors || []).map((s) => s.label).sort();
  const same = got.length === had.length && got.every((l, i) => l === had[i]);
  return {
    same,
    got: got.length,
    had: had.length,
    missing: had.filter((l) => !got.includes(l)).slice(0, 20),
    extra: got.filter((l) => !had.includes(l)).slice(0, 20),
  };
}

module.exports = {
  EMPTY_RULE, CLOSINGS,
  normaliseRule, inRange, applyRule, ruleSentence,
  newFunnelSet, recordStep, recordBackStep, warningsFor, finishFunnelSet, replay,
};
