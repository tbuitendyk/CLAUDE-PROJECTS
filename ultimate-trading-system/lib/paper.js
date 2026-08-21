// Paper-trade arithmetic — the single source of truth for what a dollar means,
// so the simulator, the sweep and anything that scores a trade cannot drift
// apart. $100 per order, priced open to open.
//
// It used to carry a second set of numbers as well: a $0.50-per-leg stress rate
// and fixed Tuesday/Thursday entry and exit hours, which belonged to the frozen
// paper books. Those books were retired with the screen that ran them, and
// their four values went with them — nothing else ever used them.

const NOTIONAL = 100;

// What a trade is assumed to cost, set 2026-07-26. Binance spot taker is 0.10%
// per side and these books quote roughly one to two hundredths of a percent of
// spread at this size, so twelve and a half cents a leg — twenty-five cents the
// round trip — covers reality with an allowance on top.
//
// THIS IS DOLLARS, NOT A PERCENTAGE. It equals 0.125% only because the clip
// above is $100. Trade size is configurable per setup, so at any other size the
// percentage reading is wrong. Callers that need a rate divide by NOTIONAL.
const REAL_FEE_PER_LEG = 0.125;

function pnlAt(direction, entry, exit, feePerLeg = REAL_FEE_PER_LEG) {
  if (direction === 0) return 0;
  const gross = direction === 1 ? NOTIONAL * (exit / entry - 1) : NOTIONAL * (1 - exit / entry);
  return gross - 2 * feePerLeg;
}

// Majority vote over an array of -1/0/+1 calls:
// the most common call wins outright, and ANY tie for the top stands aside.
// One definition, so no two places can disagree about what a committee said.
function voteOf(labels) {
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const p of labels) counts[p]++;
  const top = Math.max(counts['-1'], counts['0'], counts['1']);
  const winners = Object.keys(counts).filter((k) => counts[k] === top);
  return winners.length === 1 ? Number(winners[0]) : 0;
}

// Supermajority gate: trade only when at least `quorum` specs agree on the
// SAME direction (absolute count, not a fraction of those present).
// Plurality is irrelevant — 5 up vs 3 down stands aside at quorum 6, even
// though the majority vote would go long. This is the conviction-
// concentration counterpart to voteOf: fewer trades, each backed by broad
// cross-method agreement, aimed at the fee drag that eats thin edges.
function superOf(labels, quorum = 6) {
  let up = 0;
  let down = 0;
  for (const p of labels) {
    if (p === 1) up++;
    else if (p === -1) down++;
  }
  if (up >= quorum) return 1;
  if (down >= quorum) return -1;
  return 0;
}

// Big-move hunter decision rule: act on the LARGER of the two directional
// probabilities — P(0) never wins by default, because standing aside is a
// choice about CONFIDENCE, not a class to be predicted — but stand aside
// unless that probability clears tau. tau = 0 means always-in. tau itself
// is tuned upstream on validation paper P&L, never on the test window.
function directionalCall(probs, tau) {
  const up = probs['1'];
  const down = probs['-1'];
  if (up === down) return 0;
  const label = up > down ? 1 : -1;
  return Math.max(up, down) >= tau ? label : 0;
}

module.exports = { NOTIONAL, REAL_FEE_PER_LEG, pnlAt, voteOf, superOf, directionalCall };
