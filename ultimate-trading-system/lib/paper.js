// Paper-trade arithmetic — the single source of truth for what a dollar means,
// so the simulator, the sweep and anything that scores a trade cannot drift
// apart. $100 per order, priced open to open.
//
// It used to carry a second set of numbers as well: a $0.50-per-leg stress rate
// and fixed Tuesday/Thursday entry and exit hours, which belonged to the frozen
// paper books. Those books were retired with the screen that ran them, and
// their four values went with them — nothing else ever used them.

const NOTIONAL = 100;

// A FEE IS A PERCENTAGE OF WHAT IS TRADED. NEVER A FIXED NUMBER OF DOLLARS.
// (owner order, 2026-08-23: "all trading fees are going to be percentage based
// ... we're gonna get all that fixed dollar amount business out of the fees.")
//
// It used to be $0.125 A LEG — a dollar amount, which is only the right cost at
// one single trade size. It read as 0.125% purely because the clip above is
// $100, and the moment anything traded a different clip that reading was wrong.
// The screen text for the live books already carried the scar: publishing the
// $100 figure beside a $10 clip made live execution look ten times cheaper than
// the lab had modelled.
//
// Worse, the same name meant two different things in two halves of the engine.
// lib/stoptuner.js has always taken feePerLeg as a FRACTION, and lib/stopsweep.js
// and lib/convictionsweep.js each carried a hand conversion with a scar comment
// of its own: "Passing the dollar 0.125 straight in made a 25% round-trip hurdle
// instead of 0.25% and misclassified almost every trade." One name, two meanings,
// and a conversion anybody could forget. Now there is one meaning.
//
// THE RATE IS UNCHANGED AT THE PAPER CLIP. Binance spot taker is 0.10% per side
// and these books quote roughly one to two hundredths of a percent of spread at
// this size, so 0.125% a leg — 0.25% the round trip — covers reality with an
// allowance on top. $0.125 on a $100 clip IS 0.00125 of the position, so every
// number this engine has ever produced at the paper size stays exactly what it
// was. What changes is that the cost now follows the trade size, which is what
// a fee does.
const FEE_PER_LEG = 0.00125;             // fraction of the position, per leg
const FEE_ROUND_TRIP = 2 * FEE_PER_LEG;  // both legs, 0.25%

// THE DOLLAR MEANING CANNOT COME BACK BY ACCIDENT. Every fee that reaches the
// arithmetic goes through here first. A real trading fee is small — a tenth of
// a percent, a percent at the very worst — so anything at or above 5% a leg is
// not a rate somebody chose, it is a dollar amount that took a wrong turn. Every
// dollar value this system ever used (0.125, and the 0..2 the launcher allowed)
// lands above that line and is refused by name rather than silently charging a
// hundred times the real cost.
const MAX_FEE_PER_LEG = 0.05;

function feeRate(v, where) {
  if (!Number.isFinite(v) || v < 0) {
    throw new TypeError(`${where}: the fee per leg must be a real fraction of the position — got ${JSON.stringify(v)}.`);
  }
  if (v >= MAX_FEE_PER_LEG) {
    throw new RangeError(`${where}: a fee of ${v} a leg is ${(100 * v).toFixed(1)}% of the position. `
      + `Fees are FRACTIONS here, not dollars — ${FEE_PER_LEG} is the ${(100 * FEE_PER_LEG).toFixed(3)}% this system trades at. `
      + 'A run recorded before 2026-08-23 stored dollars on a $100 clip; read it with feeFracOf(params), never straight.');
  }
  return v;
}

// READING A FEE OFF A STORED RUN. Runs recorded before 2026-08-23 carry dollars
// on the $100 paper clip and no `feeUnits`; runs recorded since carry a fraction
// and say so. Converting is not keeping the dollar business alive — it is the
// only way an old run's numbers still mean what they meant when they were
// computed (QC 74: a computed record is never destroyed, and silently rereading
// $0.125 as 12.5% a leg would destroy every one of them).
function feeFracOf(params, fallback = FEE_PER_LEG) {
  const p = params || {};
  if (p.feePerLeg == null) return fallback;
  const v = Number(p.feePerLeg);
  if (!Number.isFinite(v)) return fallback;
  // Checked on the way out, so a run that somehow carries a dollar figure UNDER
  // the fraction marker is refused by name instead of charging a hundred times
  // the real cost quietly.
  return feeRate(p.feeUnits === 'fraction' ? v : v / NOTIONAL, 'feeFracOf');
}

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
function pnlAt(direction, entry, exit, feePerLeg = FEE_PER_LEG) {
  if (direction !== 1 && direction !== -1 && direction !== 0) {
    throw new TypeError(`pnlAt: direction must be exactly 1, -1 or 0 — got ${JSON.stringify(direction)}. `
      + 'Anything else used to be priced as a short, so a long that arrived as text was booked as a loss.');
  }
  if (direction === 0) return 0;
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0 || exit <= 0) {
    throw new TypeError(`pnlAt: entry and exit must be real positive prices — got ${JSON.stringify(entry)} and ${JSON.stringify(exit)}. `
      + 'An entry of zero used to produce an infinite profit that then beat every genuine result.');
  }
  // THE COST IS THE RATE APPLIED TO WHAT IS TRADED. That is the whole change:
  // the fee arrives as a share of the position and is turned into this book's
  // money here, instead of a fixed number of dollars being assumed.
  //
  // The arithmetic is deliberately grouped the way it always was — gross first,
  // then the cost taken off — rather than the tidier NOTIONAL * (gross - cost).
  // The tidier form is algebraically identical and NOT identical in floating
  // point: checked over 800,000 random price pairs, it disagreed with the
  // original in 11.5% of them, always in the last bit of a double (worst
  // relative gap 5.8e-16). Harmless as money and not harmless as a property —
  // every number this system reports is meant to be re-derivable from the same
  // inputs, and a row re-scored today must not come back differing from the one
  // already stored. Grouped this way the two agree in every one of those cases.
  const gross = direction === 1 ? NOTIONAL * (exit / entry - 1) : NOTIONAL * (1 - exit / entry);
  return gross - NOTIONAL * 2 * feeRate(feePerLeg, 'pnlAt');
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

module.exports = { NOTIONAL, FEE_PER_LEG, FEE_ROUND_TRIP, MAX_FEE_PER_LEG,
  feeRate, feeFracOf, pnlAt, voteOf, superOf, directionalCall };
