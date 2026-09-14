// confirm.js -- THE CONFIRMATION OVERLAY ON STAGE 3 (COINS.md section 11; owner
// GO NOW! 2026-09-14). Pure arithmetic, no I/O, one home for every rule the
// overlay has, so the worker that prices, the tally that sums and the tests
// that check them all read the same definitions.
//
// A unit whose coin and chunk shape passes on Coins carries a lean: at its
// sweet spot band, a window that read `rising` says which way the trade
// leans and a window that read `falling` the other. Against it, every call
// the committee makes is confirmed (agrees), unconfirmed (disagrees) or has
// no lean (the decision sat under the band). `off` prices every trade at
// size 1; `confirmed only` drops the unconfirmed; `sized` scales confirmed
// trades by `confirmed x` and unconfirmed by `unconfirmed x`.
//
// THE VERDICT is decided from six numbers -- money and count of the three
// kinds of trade -- in the order section 11 wrote down before any number
// existed, and nowhere else.

// the three values of the dial, as the screen prints them: one list
const CONFIRM_VALUES = Object.freeze(['off', 'confirmed only', 'sized']);
const DEFAULT_KX = 2;
const DEFAULT_UX = 1;
const VERDICTS = Object.freeze(['adds nothing', 'just leverage', 'adds value', 'better signal']);

function isConfirm(v) { return CONFIRM_VALUES.includes(v); }

// the two multipliers a value prices with
function multipliersOf(confirm, kx = DEFAULT_KX, ux = DEFAULT_UX) {
  if (confirm === 'confirmed only') return { kx: 1, ux: 0 };
  if (confirm === 'sized') return { kx: Number(kx), ux: Number(ux) };
  return { kx: 1, ux: 1 };
}
function multiplierOrRefuse(value, what, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${what} must be a number of zero or more — not ${JSON.stringify(value)}`);
  return v;
}

// THE LEAN PER DECISION: +1 long, -1 short, 0 none, from the window readings
// ('r' / 'f' / 's') and the unit's lean after each colour.
function leanSigns(readings, lean) {
  const out = new Array(readings.length);
  for (let i = 0; i < readings.length; i++) {
    const c = readings[i];
    out[i] = c === 'r' ? (lean.rising || 0) : c === 'f' ? (lean.falling || 0) : 0;
  }
  return out;
}

// THE THREE KINDS OF CALL, as three call lists over the same periods (a
// period a list does not own reads 0, stood aside), so each can be priced by
// the one simulator on its own and the money added back up.
function splitCalls(calls, signs) {
  const n = calls.length;
  const c = new Array(n).fill(0); const u = new Array(n).fill(0); const z = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const call = calls[i];
    if (call !== 1 && call !== -1) continue;
    const s = signs ? (signs[i] || 0) : 0;
    if (s === 0) z[i] = call;
    else if (s === call) c[i] = call;
    else u[i] = call;
  }
  return { c, u, z };
}

// MONEY AND SIZE under the two multipliers, from the three parts.
// parts: { c: { pnl, n }, u: { pnl, n }, z: { pnl, n } } (n = trades taken)
function combine(parts, kx, ux) {
  const P = (x) => (x && Number.isFinite(x.pnl) ? x.pnl : 0);
  const N = (x) => (x && Number.isFinite(x.n) ? x.n : 0);
  return {
    pnl: kx * P(parts.c) + ux * P(parts.u) + P(parts.z),
    trades: (kx > 0 ? N(parts.c) : 0) + (ux > 0 ? N(parts.u) : 0) + N(parts.z),
    size: kx * N(parts.c) + ux * N(parts.u) + N(parts.z),
    at1: { pnl: P(parts.c) + P(parts.u) + P(parts.z), size: N(parts.c) + N(parts.u) + N(parts.z) },
  };
}

// THE VERDICT (section 11), in its written order. null when the unit carried
// no lean at all (no confirmed and no unconfirmed trade), because then the
// overlay changed nothing and there is nothing to judge.
function verdictOf(parts, kx, ux) {
  const P = (x) => (x && Number.isFinite(x.pnl) ? x.pnl : 0);
  const N = (x) => (x && Number.isFinite(x.n) ? x.n : 0);
  if (!parts || (N(parts.c) === 0 && N(parts.u) === 0)) return null;
  const g = combine(parts, kx, ux);
  if (!(g.pnl > g.at1.pnl)) return 'adds nothing';
  const perSized = g.size > 0 ? g.pnl / g.size : null;
  const perAt1 = g.at1.size > 0 ? g.at1.pnl / g.at1.size : null;
  if (perSized == null || perAt1 == null || !(perSized > perAt1)) return 'just leverage';
  const cPer = N(parts.c) ? P(parts.c) / N(parts.c) : null;
  const uPer = N(parts.u) ? P(parts.u) / N(parts.u) : null;
  const zPer = N(parts.z) ? P(parts.z) / N(parts.z) : null;
  const beatsU = cPer != null && (uPer == null ? false : cPer > uPer);
  const beatsZ = cPer != null && (zPer == null ? true : cPer > zPer);
  return beatsU && beatsZ ? 'better signal' : 'adds value';
}

// what the verdict rests on, in words, for the hover beside it
function verdictWhy(word) {
  return {
    'adds nothing': 'sized money is not above money at size 1',
    'just leverage': 'sized money is above money at size 1, but not per unit of size deployed: a bigger bet, not a better one',
    'adds value': 'sized money is above money at size 1, and above per unit of size deployed too',
    'better signal': 'adds value, and the confirmed trades make more per trade than the unconfirmed ones and than the no-lean ones',
  }[word] || '';
}

// SUMS OF PARTS across units: the same six numbers, added.
function addParts(acc, parts) {
  const out = acc || { c: { pnl: 0, n: 0 }, u: { pnl: 0, n: 0 }, z: { pnl: 0, n: 0 } };
  for (const k of ['c', 'u', 'z']) {
    const x = parts && parts[k];
    if (!x) continue;
    out[k].pnl += Number.isFinite(x.pnl) ? x.pnl : 0;
    out[k].n += Number.isFinite(x.n) ? x.n : 0;
  }
  return out;
}

module.exports = {
  CONFIRM_VALUES, DEFAULT_KX, DEFAULT_UX, VERDICTS,
  isConfirm, multipliersOf, multiplierOrRefuse, leanSigns, splitCalls, combine, verdictOf, verdictWhy, addParts,
};
