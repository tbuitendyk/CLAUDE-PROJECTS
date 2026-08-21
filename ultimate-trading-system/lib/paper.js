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

// WHICH WAY IS THIS TRADE FACING, AND ARE THESE REAL PRICES (hardened
// 2026-08-21). This asked `direction === 1` and treated literally everything
// else that was not exactly 0 as a SHORT. The case that matters is not exotic:
// a number that has been through a stored file comes back as the TEXT "1", and
// the same winning trade was then booked as an equal and opposite loss. `true`,
// `null` and not-a-number were all priced as real short trades too.
//
// A price of zero was worse. It produced an infinite profit, counted as a real
// trade, which then outranked every genuine result it was compared against.
//
// Refusing is the right answer here rather than guessing. This is the last step
// before a number becomes money on a screen, and there is no safe way to invent
// what a caller meant.
function pnlAt(direction, entry, exit, feePerLeg = REAL_FEE_PER_LEG) {
  if (direction !== 1 && direction !== -1 && direction !== 0) {
    throw new TypeError(`pnlAt: direction must be exactly 1, -1 or 0 — got ${JSON.stringify(direction)}. `
      + 'Anything else used to be priced as a short, so a long that arrived as text was booked as a loss.');
  }
  if (direction === 0) return 0;
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0 || exit <= 0) {
    throw new TypeError(`pnlAt: entry and exit must be real positive prices — got ${JSON.stringify(entry)} and ${JSON.stringify(exit)}. `
      + 'An entry of zero used to produce an infinite profit that then beat every genuine result.');
  }
  const gross = direction === 1 ? NOTIONAL * (exit / entry - 1) : NOTIONAL * (1 - exit / entry);
  return gross - 2 * feePerLeg;
}

// Majority vote over an array of -1/0/+1 calls:
// the most common call wins outright, and ANY tie for the top stands aside.
// One definition, so no two places can disagree about what a committee said.
function voteOf(labels) {
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const p of labels) {
    // AN OPINION THE CODE DOES NOT RECOGNISE IS NOT A VOTE, and it must not be
    // able to change the answer. It used to increment nothing at all, which
    // sounds harmless and is not: it still counted towards nothing while the
    // committee's shape changed around it, so adding one stray value to a tied
    // committee altered the result (found 2026-08-21). Refuse it instead.
    if (p !== 1 && p !== -1 && p !== 0) {
      throw new TypeError(`voteOf: a committee opinion must be 1, -1 or 0 — got ${JSON.stringify(p)}`);
    }
    counts[p]++;
  }
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
  // A QUORUM OF ZERO MEANS NOBODY HAS TO AGREE. An empty committee at quorum 0
  // returned a definite LONG — a trading direction out of no opinions at all
  // (found 2026-08-21). One agreeing voice is the least this can mean.
  if (!Number.isInteger(quorum) || quorum < 1) {
    throw new TypeError(`superOf: quorum must be a whole number of at least 1 — got ${JSON.stringify(quorum)}. `
      + 'At zero, an empty committee produced a definite direction.');
  }
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
  // THE DIRECTION AND THE CONFIDENCE MUST BE READ THE SAME WAY. The direction
  // came from `>`, which compares text as text, and the confidence from
  // Math.max, which converts to numbers. So "0.5" against "0.50" — a dead tie —
  // was read as equal by one half and different by the other, and stood aside
  // in one reading while placing a trade in the other (found 2026-08-21).
  // Missing probabilities were worse: undefined against undefined, and a trade
  // placed on a forecast that does not exist.
  if (!Number.isFinite(up) || !Number.isFinite(down)) {
    throw new TypeError(`directionalCall: needs real probabilities for 1 and -1 — got ${JSON.stringify(up)} and ${JSON.stringify(down)}`);
  }
  if (up === down) return 0;
  const label = up > down ? 1 : -1;
  return Math.max(up, down) >= tau ? label : 0;
}

module.exports = { NOTIONAL, REAL_FEE_PER_LEG, pnlAt, voteOf, superOf, directionalCall };
