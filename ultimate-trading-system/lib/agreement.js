// HOW A COMMITTEE'S VOTES BECOME ONE CALL.
//
// Built in the owner's loop of 2026-08-28. Until then there was exactly one
// rule: count how many members say the same thing and trade once the winning
// side reaches a rung. That count is the weakest possible summary of a
// committee, and it gets WEAKER as the committee grows, because it cannot
// tell eleven independent opinions from eleven near-copies. The owner's own
// tables proved the cost: on 16 of 49 units the six members were three
// voices counted twice, and the count could not see it.
//
// Every rule here is deterministic arithmetic over stored votes. Nothing
// learns, nothing is fitted at pricing time, and no rule may look at the
// held-back window (the caller passes the test slice for anything that needs
// a distribution).
//
// 'count' is bit-identical to the old rule ON PURPOSE — results from before
// this change must stay comparable to results after it.

// A member's strength triple is [down, nothing, up]. This is the net lean:
// +1 means certain up, -1 certain down, 0 no opinion either way.
function netLean(p) {
  const a = Array.isArray(p) ? p : [p.d, p.n, p.u];
  return (a[2] || 0) - (a[0] || 0);
}

// The plain argmax call from a strength triple — the same tie rule the
// engine uses (a later class wins only if it is strictly higher), so a
// measurement taken here can never disagree with a vote taken there.
function argmaxCall(p) {
  const a = Array.isArray(p) ? p : [p.d, p.n, p.u];
  let best = 0;
  for (let k = 1; k < 3; k++) if (a[k] > a[best]) best = k;
  return best - 1;
}

function assertVote(c) {
  if (c !== 1 && c !== -1 && c !== 0) {
    throw new Error(`agreement got a non-vote (${c === undefined ? 'undefined' : typeof c}) — pass call ARRAYS, not member objects`);
  }
}

// ---- INDEPENDENT VOICES ---------------------------------------------------
//
// Two members that make the same call almost every time are one voice, not
// two, however differently they were built. Members are grouped greedily: a
// member joins the first group whose FIRST member it agrees with at or above
// the threshold, otherwise it starts its own. Each member's weight is one
// divided by the size of its group, so a group of three doubled copies
// carries one vote between them, not three.
//
// Measured over the moments the caller passes — the test slice, never the
// held-back window.
function voiceGroups(callArrays, upTo, threshold = 0.98) {
  const M = callArrays.length;
  const n = Math.max(0, Math.min(upTo == null ? (callArrays[0] || []).length : upTo, (callArrays[0] || []).length));
  const groups = [];
  for (let m = 0; m < M; m++) {
    let joined = false;
    for (const g of groups) {
      const head = g[0];
      let same = 0;
      for (let i = 0; i < n; i++) if (callArrays[m][i] === callArrays[head][i]) same++;
      if (n > 0 && same / n >= threshold) { g.push(m); joined = true; break; }
    }
    if (!joined) groups.push([m]);
  }
  const weights = new Array(M).fill(1);
  for (const g of groups) for (const m of g) weights[m] = 1 / g.length;
  return { groups, weights, voices: groups.length };
}

// ---- THE RULES ------------------------------------------------------------
//
// Each rule answers ONE question at one moment: does this committee speak,
// and which way? Every rule returns 1, -1 or 0 (stand aside), and every rule
// stands aside on a tie, exactly as the plain count always has.
//
// levelsFor(rule, members, voices) gives the rungs the sweep may permute
// over, so the interface offers exactly what the rule can express and never
// a rung that means nothing.
// WHAT IS WEIGHED. Four ways, and 'unusual' is not among them any more: it was
// never a fifth way of weighing, it was `count` against a bar taken from the
// committee's own history. It is now that pair, and every other way of
// weighing can be asked the same question. The name stays readable here so a
// record set written before the split still says what it did.
const AGREE_RULES = ['count', 'conviction', 'voices', 'families'];
const AGREE_BARS = ['all', 'own'];
const LEGACY_RULES = { unusual: { rule: 'count', bar: 'own' } };

const RULE_WORDS = {
  count: 'how many members say the same thing',
  conviction: 'how strongly the members lean, added up',
  voices: 'how many INDEPENDENT voices say the same thing',
  families: 'how many different kinds of evidence agree',
  unusual: 'how unusual this much agreement is for this committee',
};

// The winning side and its plain counts at one moment.
function sides(callArrays, i) {
  let up = 0;
  let down = 0;
  for (const calls of callArrays) {
    const c = calls[i];
    assertVote(c);
    if (c === 1) up++;
    else if (c === -1) down++;
  }
  return { up, down, winner: up === down ? 0 : (up > down ? 1 : -1) };
}

// ONE MOMENT, ONE QUORUM. The rule says WHAT is weighed; the level says how
// much of it is enough. Every rule is the same comparison — what was reached
// against what was asked for — because they differ only in the first of those.
//
// This used to be five separate comparisons, one per rule, and `unusual` was a
// sixth kind of thing entirely: the same head count as `count`, against a bar
// taken from the committee's own history rather than from a share of its size.
// That made one control answer two questions and left combinations unreachable
// — "kinds of evidence, against its own history" could not be asked for. The
// bar is now the CALLER's business (see quorumBar), so a rule is just a way of
// weighing and any way of weighing can meet either kind of bar.
function agreementAt(ctx, i, rule, level) {
  const { calls } = ctx;
  // A NAME NOBODY IMPLEMENTS IS A CRASH, NOT A HEAD COUNT. achievedAt falls
  // through to the plain count for anything it does not recognise, which is
  // right for reading a value and wrong for deciding a trade: a mistyped way
  // of weighing would quietly become `count` and price a whole block under a
  // rule nobody asked for.
  if (!AGREE_RULES.includes(rule)) {
    throw new Error(`"${rule}" is not an agreement rule (${AGREE_RULES.join('/')})`);
  }
  const { winner } = sides(calls, i);
  if (!winner) return 0;
  if (rule === 'conviction') {
    // the leaning must back the majority before its size is even asked about
    let s = 0;
    for (let m = 0; m < calls.length; m++) s += netLean(ctx.probs[m][i]);
    if (Math.sign(s) !== winner) return 0;
  }
  // the crumb keeps 3 of 3 voices, and a lean that lands exactly on its bar,
  // from failing on floating-point dust
  return achievedAt(ctx, i, rule, winner) + 1e-9 >= level ? winner : 0;
}

// THE BAR, TAKEN FROM WHAT THIS COMMITTEE ACTUALLY REACHES, for any way of
// weighing — not just a head count (owner order, 2026-08-29).
//
// Why this exists. A bar set as a share of what EXISTS only makes sense when
// the thing weighed actually reaches its maximum in practice. A head count
// does. A sum of how hard eight members lean does not: on any noisy market the
// leans are small, so 75% of eight was a bar that could not be cleared, on any
// data. Setting the bar from the committee's own spread cures that for every
// way of weighing at once, and needs no special case for any of them.
//
// The share is STRICTNESS either way, so the dial never changes direction:
// 100 admits only the very best this committee ever reaches, a small share
// admits nearly everything.
//
// Read from the test slice only. That is the same window the ordering was done
// on, so the bar is chosen knowing the window it will be scored on — mild, and
// said on the screen. It never reads the held-back window.
function ownHistoryBar(ctx, nTest, rule, strictPct) {
  const reached = [];
  for (let i = 0; i < nTest; i++) {
    const { winner } = sides(ctx.calls, i);
    reached.push(winner ? achievedAt(ctx, i, rule, winner) : 0);
  }
  if (!reached.length) return Infinity;      // nothing to learn from: nothing passes
  reached.sort((a, b) => b - a);
  const frac = Math.max(0, Math.min(1, (100 - strictPct) / 100));
  const at = Math.max(0, Math.min(reached.length - 1, Math.ceil(frac * reached.length) - 1));
  return reached[Math.max(0, at)];
}

// WHAT ACTUALLY AGREED at a moment, on the same scale as the rung.
//
// The rung says what a setting DEMANDED. Every rule has always been "at or
// above" it, so on most moments MORE than the bar's worth of members line up
// — and until now nothing anywhere recorded how much. A table of settings all
// built on one share therefore printed that one share on every row and gave
// no way to tell a bare six-of-eight from a unanimous call.
//
// Read at the same moments and off the same votes the rule read, so the
// number is the rule's own arithmetic reported rather than a second opinion.
// Reporting only — no rule reads it, and it is never taken from the held-back
// window.
function achievedAt(ctx, i, rule, winner) {
  const { calls } = ctx;
  if (rule === 'voices') {
    let w = 0;
    for (let m = 0; m < calls.length; m++) if (calls[m][i] === winner) w += ctx.weights[m];
    return w;
  }
  if (rule === 'conviction') {
    let s = 0;
    for (let m = 0; m < calls.length; m++) s += netLean(ctx.probs[m][i]);
    return Math.abs(s);
  }
  if (rule === 'families') {
    const seen = new Set();
    for (let m = 0; m < calls.length; m++) if (calls[m][i] === winner) seen.add(ctx.families[m]);
    return seen.size;
  }
  // count and unusual both weigh the plain head count of the winning side
  let n = 0;
  for (let m = 0; m < calls.length; m++) if (calls[m][i] === winner) n++;
  return n;
}

// A whole stream of calls under one rule, with the two modifiers applied.
//
//   bothModels — the winning side must contain at least one of each kind of
//                member (LOGREG and BOOST), so a call can never be one
//                kind's quirk
//   persist    — the same call must have stood for this many moments before
//                it is acted on
function agreementStream(ctx, rule, level, mods = {}) {
  const n = ctx.calls[0] ? ctx.calls[0].length : 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let c = agreementAt(ctx, i, rule, level);
    if (c && mods.bothModels) {
      const kinds = new Set();
      for (let m = 0; m < ctx.calls.length; m++) if (ctx.calls[m][i] === c) kinds.add(ctx.models[m]);
      if (kinds.size < 2) c = 0;
    }
    out[i] = c;
  }
  const p = Math.max(0, Math.floor(mods.persist || 0));
  if (!p) return out;
  const held = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!out[i]) continue;
    let ok = true;
    for (let k = 1; k <= p; k++) { if (i - k < 0 || out[i - k] !== out[i]) { ok = false; break; } }
    held[i] = ok ? out[i] : 0;
  }
  return held;
}

module.exports = {
  AGREE_RULES, AGREE_BARS, LEGACY_RULES, RULE_WORDS, voiceGroups, argmaxCall,
  agreementStream, agreementAt, achievedAt, ownHistoryBar, netLean, sides,
};
