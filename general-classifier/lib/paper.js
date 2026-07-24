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

module.exports = { NOTIONAL, FEE_PER_LEG, ENTRY_OFFSET_H, EXIT_OFFSET_H, pnlFor };
