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
//   allowed  categorical dials: { gate: ['active', 'directional'] }
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

// The survivors themselves with the money swapped for one scrambled copy's.
// Equal to nullCopy(all, rule, d) whenever the rule carries no cut -- ranges,
// allowed values and the rebuilt-number limits never read the money, so
// filtering first and swapping second lands on the same rows -- and a pass
// over the survivors instead of over every setting. The walk's rule never
// carries a cut before step 7, so this is what the readings use; a rule that
// does carry one goes through nullCopy, which lets the copy take its own top N.
function swapMoney(rows, d) {
  const i = Math.max(0, Math.floor(Number(d) || 0));
  return (rows || []).map((r) => ({ ...r, [funnel.TEST_MONEY]: (r.noiseTest || [])[i] ?? null }));
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

// ---- the widest region, as a rule (§16.4, step 5) -------------------------------
//
// A region is a set of neighbouring settings; its edges on every ordered dial
// and its values on every word-valued one ARE a rule, and this turns
// widestRegion's `bounds` and `values` into one. The centre is deliberately not
// used: a rule that kept only the centre would keep one setting, and the whole
// point of a wide region is that its interior is defensible as a region.
function regionRule(region, dials) {
  const R = { ranges: {}, allowed: {} };
  if (!region || !region.size) return R;
  const ordered = new Set((dials && dials.ordered) || funnel.ORDERED_DIALS);
  const categorical = new Set((dials && dials.categorical) || funnel.CATEGORICAL_DIALS);
  for (const [dial, b] of Object.entries(region.bounds || {})) {
    if (!ordered.has(dial) || !b || b.min == null) continue;
    R.ranges[dial] = { min: b.min, max: b.max };
  }
  for (const [dial, v] of Object.entries(region.values || {})) {
    if (!categorical.has(dial) || v === undefined) continue;
    // A dial the region was allowed to cross holds every value the region
    // reached, not one (3.65.0), and the rule has to keep all of them or it
    // would keep a slice of the region and call it the region.
    R.allowed[dial] = (Array.isArray(v) ? v : [v]).map((x) => funnel.keyOf(x));
  }
  return R;
}

// ---- THE RULE THE OWNER BUILT, BEFORE STEP 5 REPLACED IT ----------------------
//
// (3.61.0, owner order 2026-09-04: "The user created rule and the number of
// records included which feeds into '5. a plateau or a knife edge' needs to be
// retained so that the cutting down of the ranges that happens at step 5 does
// not forever hide the 'user ranges' that were chosen.")
//
// `keep the widest region` REPLACES every range and every value on the rule.
// What the owner chose on steps 2 and 3 to arrive there then survives only as
// words in the walk's own recorded steps -- which is a record of the decision
// with the decision taken out of it.
//
// A walk cut from now on carries the rule itself: the page hands it over at the
// moment step 5 replaces it. This replays the words instead, for a set cut
// before that, and the answer is STAMPED ONTO THE RECORD the first time the set
// is opened, so nothing ever reads it twice (RULE NINE).
//
// A word-valued block spans every value between its two ends, and the ends are
// all the step recorded; `axes` supplies that dial's values in the board's own
// order so the same slice can be taken again. Without it the two ends are all
// that is claimed, which is honest rather than invented.
function spanIntoRule(rule, dial, span, values) {
  if (!dial || !span) return;
  const cut = String(span).split('..');
  if (cut.length !== 2) return;
  const [from, to] = cut;
  const nums = [Number(from), Number(to)];
  if (String(from).trim() !== '' && String(to).trim() !== '' && nums.every((n) => Number.isFinite(n))) {
    rule.ranges[dial] = { min: Math.min(...nums), max: Math.max(...nums) };
    delete rule.allowed[dial];
    return;
  }
  const list = Array.isArray(values) ? values.map(String) : [];
  const i = list.indexOf(String(from));
  const j = list.indexOf(String(to));
  rule.allowed[dial] = (i >= 0 && j >= 0)
    ? list.slice(Math.min(i, j), Math.max(i, j) + 1)
    : [...new Set([String(from), String(to)])];
  delete rule.ranges[dial];
}
function userRuleFromSteps(steps, axes = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const at = list.findIndex((s) => s && Number(s.n) === 5 && String(s.what || '').trim() === 'the widest region');
  if (at < 0) return null;                  // the region was never kept: the final rule IS the owner's
  const rule = { ranges: {}, allowed: {}, floors: {} };
  // THE DIAL IS THE FIRST TOKEN, whatever follows it. "the shape of dMult (d)"
  // carries the Sweep label in brackets; "removed from the rule: entry is
  // breakout or market" carries the whole clause. Splitting on " (" alone read
  // that second one as a dial called "entry is breakout or market", and the
  // clause the owner removed was replayed straight back in.
  const dialOf = (text) => String(text || '').trim().split(/[\s(]/)[0].trim();
  for (const s of list.slice(0, at)) {
    const what = String((s && s.what) || '');
    const chose = String((s && s.chose) || '');
    let m = what.match(/^the values of (.+)$/);
    if (m) {
      const dial = dialOf(m[1]);
      const vals = chose.split(',').map((x) => x.trim()).filter(Boolean);
      if (vals.length) { rule.allowed[dial] = vals; delete rule.ranges[dial]; }
      continue;
    }
    m = what.match(/^the shape of (.+)$/);
    if (m) {
      const dial = dialOf(m[1]);
      const alsoNone = / or none$/.test(chose);
      const ends = chose.replace(/ or none$/, '').split(' to ');
      const lo = String(ends[0] ?? '').trim();
      const hi = String(ends[1] ?? '').trim();
      if (lo === '' && hi === '' && !alsoNone) { delete rule.ranges[dial]; continue; }
      const r = { min: lo === '' ? null : Number(lo), max: hi === '' ? null : Number(hi) };
      if (alsoNone) r.also = ['none'];
      rule.ranges[dial] = r;
      delete rule.allowed[dial];
      continue;
    }
    m = what.match(/^a block on (.+?) x (.+)$/);
    if (m) {
      const a = dialOf(m[1]);
      const b = dialOf(m[2]);
      const sides = chose.replace(/ \(recommended\)$/, '').split(' x ');
      spanIntoRule(rule, a, sides[0], axes[a]);
      spanIntoRule(rule, b, sides[1], axes[b]);
      continue;
    }
    m = what.match(/^removed from the rule: (.+)$/);
    if (m) {
      const dial = dialOf(m[1]);
      delete rule.ranges[dial];
      delete rule.allowed[dial];
    }
  }
  return rule;
}

// ---- marks (§16.5) -------------------------------------------------------------
//
// A MARK IS AN OBSERVATION THE WALK WAS CARRIED PAST. It is not a warning that
// can be dismissed and not a refusal: the halves disagreed, a kept range was a
// spike, the region was not wider than the check. It rides on the Stage 4 set
// beside the rule and is never cleared, so a rule walked past one is visibly
// thinner evidence than one that was not, wherever the set is read.
const MARKS = Object.freeze({
  halvesDisagree: 'the two halves did not agree on the leading dials at step 1',
  leadNotEven: 'the leading dial was not evenly swept',
  spike: 'a kept range had a spike shape',
  interact: 'the two dials interact and the single-dial ranges were kept anyway',
  slices: 'accepted across slices with some not positive',
  regionNotWider: 'the widest region was not wider than the check',
  regionPapered: 'the region was widened over settings that lost money',
  regionAcross: 'the region was joined across dials whose values are words, which have no order',
  regionReach: 'the region was joined over settings missing from the board',
  checkIsHalves: 'no scrambled copies were kept, so the two halves stood in as the check',
});
function recordMark(doc, mark) {
  if (!mark || !MARKS[mark.key]) return doc;
  if (!Array.isArray(doc.marks)) doc.marks = [];
  const dup = doc.marks.find((m) => m.key === mark.key && m.step === (mark.step ?? null) && m.detail === (mark.detail ?? null));
  if (dup) return doc;
  doc.marks.push({ at: new Date().toISOString(), key: mark.key, step: mark.step ?? null, what: MARKS[mark.key], detail: mark.detail ?? null });
  return doc;
}

// ---- the record --------------------------------------------------------------

function newFunnelSet({ id, seq, name, parent, release, target, seed, boardNull, sealed, unit = null, unitName = null, check = null }) {
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
    // ONE RULE PER COIN-AND-SHAPE UNIT (§17): the unit this set was walked and
    // cut on, by key and by the name the screen prints. null means the
    // blended board.
    unit: unit || null,
    unitName: unitName || null,
    // THE CHECK THIS WALK WAS READ AGAINST: the kind (scrambled copies or the
    // two halves), how many copies, the share of them a value had to beat and
    // the count that share came to on this set (beats at least `bar` of `k`),
    // and what a bar like that clears by chance. Written here because a bold
    // row means one thing under sixteen of twenty and another under eight,
    // and the set has to say which it was cut under.
    check: check ? { kind: check.kind || null, k: check.k ?? null, barPct: check.barPct ?? null, bar: check.bar ?? null, chance: check.chance ?? null } : null,
    steps: [],
    backSteps: [],
    rule: { ...EMPTY_RULE },
    survivors: null,
    counts: null,
    closing: null,
    warnings: [],
    // observations the walk was carried past (§16.5); never cleared
    marks: [],
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
  tightenRule, ruleWithClosing, nullCopy, swapMoney, topColumnNames, TOP_COLUMNS,
  regionRule, MARKS, recordMark,
  EMPTY_RULE, CLOSINGS,
  normaliseRule, inRange, applyRule, ruleSentence,
  newFunnelSet, recordStep, recordBackStep, warningsFor, finishFunnelSet, replay,
  userRuleFromSteps,
};
