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

// COLUMNS A NULL COPY ACTUALLY HAS (owner order, 2026-09-01). Taking the top N
// only means anything if the same rule takes the top N of a null copy too --
// then the comparison is your best N against the null set's best N, and the
// shopping is measured instead of hidden.
//
// Which is only true for a column the null copy HAS. A null copy is the real
// table with its money swapped for what each setting made in one scrambled
// copy; every other column is still the real one. So sorting a null copy by
// anything else would sort it by REAL numbers and hand back the same rows --
// a comparison that looks like one and is not.
//
// Held-back money is deliberately NOT here even though the kept figures carry
// it: the walk runs on test money so the sealed window stays shut until the
// cut, and sorting by held-back money at the cut is opening the seal to decide
// what to keep.
const TOP_COLUMNS = Object.freeze({ avgTest: 'avg test $' });
const topColumnNames = () => Object.keys(TOP_COLUMNS);

function normaliseCut(cut) {
  const c = cut || {};
  if (c.kind !== 'top') return null;
  const column = TOP_COLUMNS[c.column] ? String(c.column) : null;
  const n = Math.max(0, Math.floor(Number(c.n) || 0));
  if (!column || !n) return null;
  return { kind: 'top', column, n };
}

function normaliseRule(rule) {
  const r = rule || {};
  return {
    ranges: r.ranges && typeof r.ranges === 'object' ? r.ranges : {},
    allowed: r.allowed && typeof r.allowed === 'object' ? r.allowed : {},
    floors: r.floors && typeof r.floors === 'object' ? r.floors : {},
    // PART OF THE RULE, not a step taken after it. That is the whole point:
    // whatever reads this rule -- including the pass that reads it against a
    // null copy -- performs the same cut.
    cut: normaliseCut(r.cut),
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
  const kept = (rows || []).filter((row) => {
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
  if (!R.cut) return kept;
  // SORTED THE SAME WAY EVERY TIME. A tie broken differently on the real table
  // and on a null copy makes the two uncomparable, and makes the rule fail to
  // reproduce its own survivors on a re-read. The label is unique per setting
  // (the cut refuses to run otherwise), so it is a total order.
  const val = (r) => {
    const v = r[R.cut.column];
    return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  };
  const ordered = kept.slice().sort((a, b) => {
    const av = val(a); const bv = val(b);
    if (av == null && bv == null) return String(a.label).localeCompare(String(b.label));
    if (av == null) return 1;                 // nothing to rank by sits last, either way
    if (bv == null) return -1;
    return (bv - av) || String(a.label).localeCompare(String(b.label));
  });
  return ordered.slice(0, R.cut.n);
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
  const base = parts.length ? parts.join('; ') : 'everything (no choices made yet)';
  // THE CUT IS IN THE SENTENCE. It is part of the rule and it is the part that
  // throws the most away, so a sentence without it reads as the whole decision
  // while hiding the sharpest part.
  if (!R.cut) return base;
  return `${parts.length ? base : 'everything'}, then the top ${R.cut.n} by ${TOP_COLUMNS[R.cut.column]}`;
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

// ---- tightening the ranges toward the middle ---------------------------------
//
// It narrows each ranged dial INWARD FROM BOTH ENDS, one swept value at a time,
// until the rule keeps the target or nothing can narrow further.
//
// BOTH ENDS, and that is the whole difference between this and shopping. Moving
// one end inward walks the range toward whichever value looks best; moving both
// keeps the middle of what was chosen, which is the part a wide region makes
// defensible. It never looks at the money.
//
// IT PRODUCES A NEW RULE, not a shorter list. So it replays, and a null copy
// handed the same rule narrows itself the same way.
//
// Deterministic: the dials are taken in ALL_DIALS order and the values in
// numeric order, so the same rule and the same rows always give the same
// answer. A replay that wobbled would be worse than no tighten at all.
function tightenRule(rows, rule, target) {
  const R = normaliseRule(rule);
  const want = Math.max(0, Math.floor(Number(target) || 0));
  if (!want) return { rule: R, steps: 0, why: 'no target to tighten toward' };
  if (applyRule(rows, R).length <= want) return { rule: R, steps: 0, why: 'the rule already keeps the target or fewer' };

  const dials = funnel.ALL_DIALS.filter((d) => R.ranges[d]);
  if (!dials.length) return { rule: R, steps: 0, why: 'no dial carries a range, so there is nothing to narrow' };

  // the values each dial was actually swept at, in order -- narrowing means
  // giving up the outermost one that is still in play
  const ladder = {};
  for (const d of dials) {
    const seen = new Set();
    for (const r of rows) {
      const v = Number(r[d]);
      if (Number.isFinite(v)) seen.add(v);
    }
    ladder[d] = [...seen].sort((a, b) => a - b);
  }

  const out = { ...R, ranges: { ...R.ranges } };
  for (const d of dials) out.ranges[d] = { ...R.ranges[d] };
  let steps = 0;
  let moved = true;
  while (moved && applyRule(rows, out).length > want) {
    moved = false;
    for (const d of dials) {
      const inPlay = ladder[d].filter((v) => inRange(v, out.ranges[d]));
      if (inPlay.length <= 2) continue;              // two values left is not a range any more
      out.ranges[d] = { ...out.ranges[d], min: inPlay[1], max: inPlay[inPlay.length - 2] };
      steps++;
      moved = true;
      if (applyRule(rows, out).length <= want) break;
    }
  }
  const kept = applyRule(rows, out).length;
  return {
    rule: out,
    steps,
    why: kept <= want
      ? `narrowed ${steps} time(s) to reach ${kept}`
      : `narrowed ${steps} time(s) and stopped at ${kept} — no range can give up another value without collapsing`,
  };
}

// ---- the same table, dealt wrong ---------------------------------------------
//
// A SCRAMBLED COPY IS THE WHOLE TABLE WITH ITS MONEY SWAPPED, and then the rule
// runs on it exactly as it ran on the real one.
//
// THE ORDER IS THE POINT. Swap first, filter second, so the copy picks its OWN
// rows -- that is the comparison. Filter first and the copy is handed the rows
// the REAL money chose, so a rule taking the top N compares the best N against
// the same N and cannot come back with anything but a win.
//
// Only the test-money column is swapped, because that is the only column a
// scrambled copy has. Every other column on it is still the real one.
function nullCopy(rows, rule, d) {
  const i = Math.max(0, Math.floor(Number(d) || 0));
  return applyRule((rows || []).map((r) => ({ ...r, [funnel.TEST_MONEY]: (r.noiseTest || [])[i] ?? null })), rule);
}

// ---- the closing, folded into the rule ---------------------------------------
//
// ONE FUNCTION TURNS A CLOSING INTO A RULE, for the same reason one function
// applies a rule: the number the screen shows before the button is pressed and
// the number the written set holds have to come from the same arithmetic.
//
// The result is a RULE, never a shortened list, so a scrambled copy handed it
// does the same thing to itself and the comparison stays a comparison.
function ruleWithClosing(rows, rule, closing, target) {
  const R = normaliseRule(rule);
  const key = closing && CLOSINGS[closing.key] ? String(closing.key) : 'rule';
  if (key === 'top') {
    const cut = normaliseCut({ kind: 'top', column: (closing || {}).column, n: (closing || {}).n });
    // A half-made choice keeps everything and says which half is missing,
    // rather than being treated as a cut that happened.
    if (!cut) {
      const missing = [];
      if (!TOP_COLUMNS[(closing || {}).column]) missing.push('column');
      if (!(Math.floor(Number((closing || {}).n)) > 0)) missing.push('count');
      return { rule: R, key, detail: `no ${missing.join(' and no ')} chosen yet, so nothing was taken off the top` };
    }
    return { rule: normaliseRule({ ...R, cut }), key, detail: `top ${cut.n} by ${TOP_COLUMNS[cut.column]}` };
  }
  if (key === 'tighten') {
    const tg = tightenRule(rows, R, target);
    return { rule: tg.rule, key, detail: tg.why };
  }
  return { rule: R, key, detail: null };
}

// ---- the record --------------------------------------------------------------

function newFunnelSet({ id, seq, name, parent, release, target, seed, boardNull, sealed }) {
  return {
    id,
    // listSets summarises on stage AND seq, and seqFor counts the highest seq it
    // finds. A set with no seq leaves seqFor stuck at 1, so every Funnel set
    // after the first would be minted as "#1" -- two records with one name.
    seq: seq == null ? null : Number(seq),
    name: name || id,
    kind: 'funnel',
    stage: 4,
    // a cut is instantaneous; there is no running state to be caught in
    status: 'done',
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
  tightenRule, ruleWithClosing, nullCopy, topColumnNames, TOP_COLUMNS,
  EMPTY_RULE, CLOSINGS,
  normaliseRule, inRange, applyRule, ruleSentence,
  newFunnelSet, recordStep, recordBackStep, warningsFor, finishFunnelSet, replay,
};
