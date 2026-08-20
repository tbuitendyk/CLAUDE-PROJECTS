// THE DASHBOARD'S SUMMED MONEY, EXECUTED (added 2026-08-18 — QC-162).
//
// WHY THIS EXISTS RATHER THAN THE BROWSER CHECK ALONE. tests/browser.js verifies
// the Dashboard totals against the server's per-setup records, which is a real
// check of the arithmetic — but it CANNOT discriminate the fault that matters
// most. On a box holding a single paper book, a total that wrongly folds in both
// books is NUMERICALLY IDENTICAL to the correct one. I proved that by injecting
// the QC-149 fault (dropping the per-card book filter): the browser check passed.
// A check that passes when the fault is present is not coverage.
//
// The discriminating condition is data holding a real AND a paper book at once.
// No box can produce that today — a setup needs per-setup key routing before it
// can run both (open gap G8) — so it is SYNTHESISED here, which is exactly what
// a unit test is for. The fixture is not a claim about any real account; it is
// the one arrangement in which right and wrong give different answers.
//
// It runs the SHIPPED function, lifted out of public/trade.html by name and
// brace-matched, the same way test-declaredset.js lifts rankDeclaredConfigs. A
// copy would agree with itself (QC-148).
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadDashTotals() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');
  const start = src.indexOf('function dashTotals(');
  assert(start > 0,
    'dashTotals is gone — the Dashboard money is inline again, which puts it back '
    + 'beyond the reach of any test that can tell the two books apart');
  let i = src.indexOf('(', start);
  let paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') paren++;
    else if (src[i] === ')') { paren--; if (paren === 0) break; }
  }
  let depth = 0;
  i = src.indexOf('{', i);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(from + 1, i);
  assert(/totR\s*\+=/.test(body) && /openPositions/.test(body),
    'the lifted body is not the totals function — the extraction is reading the wrong span');
  // eslint-disable-next-line no-new-func
  return new Function('parts', 'isPaper', body);
}

// ONE setup holding BOTH books at once — the arrangement in which a mixed total
// differs from a correct one. Paper: +10 realized, +1 unrealized, 2 positions.
// Real: +100 realized, +7 unrealized, 3 positions. Every number distinct, so any
// wrong combination lands on a value no correct filter could produce.
const bothBooks = () => ({
  g: { id: 'cfg-1' },
  ch: { setupId: 'setup-1', open: 999 },   // 999 = must never be used; st is present
  st: {
    paperRealizedPnl: 10, paperUnrealizedPnl: 1,
    realizedPnl: 100, unrealizedPnl: 7,
    openPositions: [
      { paper: true }, { paper: true },
      { paper: false }, { paper: false }, { paper: false },
    ],
  },
});

module.exports.thePaperTotalsCountOnlyThePaperBook = function () {
  const dashTotals = loadDashTotals();
  const out = dashTotals([bothBooks()], true);
  assert(out.totR === 10,
    `paper realized totalled ${out.totR}; the paper book holds 10 (110 would be both books, `
    + '100 would be the real one)');
  assert(out.totU === 1, `paper unrealized totalled ${out.totU}, expected 1`);
  assert(out.totOpen === 2,
    `paper open totalled ${out.totOpen}; this book holds 2 (5 would be the unfiltered merged list)`);
};

module.exports.theRealTotalsCountOnlyTheRealBook = function () {
  const dashTotals = loadDashTotals();
  const out = dashTotals([bothBooks()], false);
  assert(out.totR === 100,
    `live realized totalled ${out.totR}; the real book holds 100 (110 would be both books)`);
  assert(out.totU === 7, `live unrealized totalled ${out.totU}, expected 7`);
  assert(out.totOpen === 3,
    `live open totalled ${out.totOpen}; the real book holds 3 (5 would be the unfiltered merged list) `
    + '— paper positions counted under a real-money heading is the QC-149 failure');
};

// The specific, most dangerous wrong answer stated as its own assertion, so the
// failure message names the defect rather than just a number mismatch.
module.exports.neitherSideEverReportsTheSumOfBothBooks = function () {
  const dashTotals = loadDashTotals();
  const paper = dashTotals([bothBooks()], true);
  const live = dashTotals([bothBooks()], false);
  for (const [label, out] of [['paper', paper], ['live', live]]) {
    assert(out.totR !== 110, `the ${label} Dashboard realized total is the sum of BOTH books`);
    assert(out.totOpen !== 5, `the ${label} Dashboard is counting positions from both books`);
  }
};

// F1 predates channels: it is always real and has no paper book, so its rows are
// the ones WITHOUT the paper flag. Getting this backwards would show the pilot's
// real money as zero (or worse, someone else's paper money) on the live screen.
// EVERY CONFIG IS COUNTED THE SAME WAY. There used to be one that always
// reported its REAL money whatever side you were looking at, because it had no
// paper book and was not a setup that could be on two sides. That exception is
// gone with it: a config now reports the book of the side you are on, and a
// config with no book on that side contributes nothing to that side's total —
// never the other side's money.
module.exports.eachSideReportsItsOwnBookAndNeverTheOthers = function () {
  const dashTotals = loadDashTotals();
  const cfg = {
    g: { id: 'cfg-1' },
    ch: { setupId: 's1' },
    st: {
      realizedPnl: -0.2573, unrealizedPnl: -0.21,
      paperRealizedPnl: 999, paperUnrealizedPnl: 999,
      openPositions: [{ paper: false }, { paper: true }],
    },
  };
  const live = dashTotals([cfg], false);
  assert(Math.abs(live.totR - (-0.2573)) < 1e-9,
    `the live side read ${live.totR}; it must read the real book (999 means it took the paper field)`);
  assert(live.totOpen === 1,
    `the live side counted ${live.totOpen} open; exactly one row is real (2 means it counted a paper row)`);
  const paper = dashTotals([cfg], true);
  assert(Math.abs(paper.totR - 999) < 1e-9,
    `the paper side read ${paper.totR}; it must read the PAPER book, not the real one`);
  assert(paper.totOpen === 1,
    `the paper side counted ${paper.totOpen} open; exactly one row is paper`);
};

// A setup whose status could not be read must contribute its channel's own count,
// not a zero that silently shrinks the total the operator is reading.
module.exports.anUnreadableStatusFallsBackToTheChannelCountNotToZero = function () {
  const dashTotals = loadDashTotals();
  const out = dashTotals([{ g: { id: 'cfg-2' }, ch: { setupId: 's2', open: 4 }, st: null }], true);
  assert(out.totOpen === 4,
    `a setup whose status failed to load contributed ${out.totOpen} open positions, expected its `
    + "channel's own count of 4 — reporting 0 understates what is actually open");
  assert(out.totR === 0, 'unreadable money must contribute 0, not NaN');
  assert(!Number.isNaN(out.totR) && !Number.isNaN(out.totU), 'totals must never be NaN');
};
