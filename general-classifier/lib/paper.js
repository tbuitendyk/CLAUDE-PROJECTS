const { TUE_OFFSET_H, THU_OFFSET_H } = require('./dataset');

// Paper-trade mechanics — the single source of truth shared by the live
// tracker and the consensus screens' per-spec one-shot books, so a dollar
// means the same thing everywhere: $100 notional per order, market orders
// at the TIME midpoint of each label window (entry Tue 03:00 open, exit
// Thu 15:00 open), $0.50 friction per leg ($1.00 per round trip).

const NOTIONAL = 100;
const FEE_PER_LEG = 0.5;
const ENTRY_OFFSET_H = TUE_OFFSET_H + 3; // Tue 03:00, midpoint of 00:00-05:59
const EXIT_OFFSET_H = THU_OFFSET_H + 3; // Thu 15:00, midpoint of 12:00-17:59

function pnlFor(direction, entry, exit) {
  if (direction === 0) return 0;
  const gross = direction === 1 ? NOTIONAL * (exit / entry - 1) : NOTIONAL * (1 - exit / entry);
  return gross - 2 * FEE_PER_LEG;
}

// Majority vote over an array of -1/0/+1 calls — the tracker's exact rule
// (tracker.js voteOf, which takes the same counts over an object): the most
// common call wins outright; ANY tie for the top stands aside. Shared here
// so the consensus screen's simulated vote book can never drift from what
// the live tracker actually does.
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

module.exports = { NOTIONAL, FEE_PER_LEG, ENTRY_OFFSET_H, EXIT_OFFSET_H, pnlFor, voteOf, superOf, directionalCall };
