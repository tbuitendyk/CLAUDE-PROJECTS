// Forward books — out-of-sample money records for setups whose backtest
// window is spent.
//
// WHY THIS MODULE EXISTS. The three setups below cleared the declared money
// screen on discovery board bracketlab-20260805-193433-real. They were
// selected BY their held-back money, so that window can never again serve as
// evidence for them. The only untainted evidence is data no run has touched.
// This module scores the frozen setups on data AFTER the selecting runs could
// see, and nothing else.
//
// The specifications, training cutoff, scoring start and reading rules were
// committed in vps-access reports/FORWARD-BOOKS.md BEFORE this file existed
// and before any forward number existed. Nothing here may be changed to suit a
// result. If a book looks bad it stays in the record.
//
// NO STATE FILE, ON PURPOSE. Training is frozen at a date and scoring starts at
// a date, so a book is a deterministic function of (frozen spec, cached data):
// re-running reproduces the whole record and extends it as data arrives. A
// stored state file could drift from what the spec says; a recomputation
// cannot. This also means there is no init/tick ordering to get wrong.
//
// SEPARATE MODULE BY DESIGN, like lib/dogebook.js: lib/tracker.js stays
// byte-identical so the DOT/AVAX record can never be perturbed by work here.
// Shared code is limited to the engine primitives these books are defined in
// terms of.
const bracketLib = require('./bracket');
const { scoreDiff } = require('./dataset');
const { REAL_FEE_PER_LEG } = require('./paper');
const { buildCombo, trainMembers, quorumCall, specsFor } = require('./bracketwork');

// Members are trained ONCE on data ending here — the last date any of the
// selecting runs could see. A book that retrains has stopped being a forward
// test of the thing that was selected.
const TRAIN_THROUGH = Date.UTC(2026, 5, 30, 23, 59, 59); // 2026-06-30 UTC
// Nothing before this is ever counted, including the window they were picked on.
const SCORE_FROM = Date.UTC(2026, 6, 1); // 2026-07-01 UTC
// Below this many forward trades a book reports its numbers but claims NO
// verdict. GUESSED, not derived — a stop on premature reading, not a
// significance threshold (FORWARD-BOOKS.md R3).
const VERDICT_FLOOR_TRADES = 30;

// Frozen specifications. Committee specs are written out in full so a freeze
// does not depend on specsFor() staying put; they are cross-checked against it
// at load (below) so a silent divergence cannot pass unnoticed.
const BOOKS = [
  {
    id: 'F1',
    note: 'money-screen leader',
    combo: { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3 },
    branch: { geometry: 'daily-4d', decision: 'argmax', band: 1.69, weekdaysOnly: false },
    stage: 'slim',
    members: [
      { model: 'logreg', view: 'full' }, { model: 'logreg', view: 'prices' },
      { model: 'logreg', view: 'volume' }, { model: 'logreg', view: 'cross' },
    ],
    cell: { quorum: 1, entry: 'market', gate: 'directional', dMult: null, tHours: 137, trailMult: null, armMult: null },
    backtest: { net: 158.32, trades: 224, breakEvenPerLeg: 0.4784 },
  },
  {
    id: 'F2',
    note: '4-member arm of the XLM pair',
    combo: { trade: 'XLMUSDT', ctx1: 'DOTUSDT', ctx2: 'TRXUSDT', size: 3 },
    branch: { geometry: 'daily-4d', decision: 'directional', band: 1.61, weekdaysOnly: false },
    stage: 'slim',
    members: [
      { model: 'logreg', view: 'full' }, { model: 'logreg', view: 'prices' },
      { model: 'logreg', view: 'volume' }, { model: 'logreg', view: 'cross' },
    ],
    cell: { quorum: 1, entry: 'breakout', gate: 'active', dMult: 1.5, tHours: 161, trailMult: null, armMult: null },
    backtest: { net: 40.96, trades: 240, breakEvenPerLeg: 0.2103 },
  },
  {
    id: 'F3',
    note: '8-member arm of the same pair — F2 vs F3 is a one-variable test of committee size',
    combo: { trade: 'XLMUSDT', ctx1: 'DOTUSDT', ctx2: 'TRXUSDT', size: 3 },
    branch: { geometry: 'daily-4d', decision: 'directional', band: 1.61, weekdaysOnly: false },
    stage: 'promoted',
    members: [
      { model: 'logreg', view: 'full' }, { model: 'boost', view: 'full' },
      { model: 'logreg', view: 'prices' }, { model: 'boost', view: 'prices' },
      { model: 'logreg', view: 'volume' }, { model: 'boost', view: 'volume' },
      { model: 'logreg', view: 'cross' }, { model: 'boost', view: 'cross' },
    ],
    cell: { quorum: 1, entry: 'breakout', gate: 'active', dMult: 1.5, tHours: 161, trailMult: null, armMult: null },
    backtest: { net: 30.81, trades: 242, breakEvenPerLeg: 0.1887 },
  },
];

// A frozen member list that has silently drifted from what the engine builds
// is the QC 71 failure mode wearing different clothes. Fail loudly at load.
function assertFrozenMembersMatchEngine() {
  for (const b of BOOKS) {
    const built = specsFor(b.combo.size, b.stage);
    const a = JSON.stringify(built.map((s) => ({ model: s.model, view: s.view })));
    const f = JSON.stringify(b.members);
    if (a !== f) {
      throw new Error(`forward book ${b.id}: frozen committee no longer matches specsFor(${b.combo.size}, '${b.stage}')`
        + ` — frozen ${f} vs engine ${a}. The book was specified against the engine as it was; decide deliberately`
        + ' whether the book restarts (FORWARD-BOOKS.md R4) rather than letting it drift.');
    }
  }
}

// One book, scored end to end. Deterministic given the cached data.
async function scoreBook(book, opts = {}) {
  const fee = opts.feePerLeg ?? REAL_FEE_PER_LEG;
  const params = { allLoaded: true, feePerLeg: fee };
  const { geo, maps, chunks } = await buildCombo(book.combo, book.branch, params);

  // The frozen band, never re-derived: re-deriving it on new data would move
  // the labels the members were trained against.
  const bandPct = Math.abs(book.branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  const trainChunks = chunks.filter((c) => c.endTs <= TRAIN_THROUGH);
  const fwdChunks = chunks.filter((c) => c.startTs >= SCORE_FROM);
  if (!trainChunks.length) throw new Error(`forward book ${book.id}: no training chunks at or before the freeze date`);
  if (!fwdChunks.length) {
    return {
      id: book.id, note: book.note, combo: book.combo, branch: book.branch, cell: book.cell,
      bandPct, fee, trainChunks: trainChunks.length, periods: 0, trades: 0,
      pending: 'no completed period since the scoring start date yet',
      backtest: book.backtest,
    };
  }

  const views = bracketLib.comboViews(book.combo.size, geo.featureHours / 24).views;
  const members = await trainMembers(book.members, views, trainChunks, fwdChunks, book.branch, maps, geo);
  const memberCalls = members.map((m) => m.calls);
  const calls = fwdChunks.map((_, i) => quorumCall(memberCalls, i, book.cell.quorum));

  const res = bracketLib.simCell(book.cell, fwdChunks, calls, maps.trade, geo, bandPct, fee);
  const holds = bracketLib.holdControls(fwdChunks, maps.trade, geo, book.cell.tHours, fee);

  const trades = res.trades || 0;
  const legs = trades * 2;
  const gross = res.pnl + legs * fee;
  return {
    id: book.id,
    note: book.note,
    combo: book.combo,
    branch: book.branch,
    cell: book.cell,
    bandPct,
    fee,
    trainChunks: trainChunks.length,
    trainThrough: TRAIN_THROUGH,
    scoreFrom: SCORE_FROM,
    firstPeriodTs: fwdChunks[0].startTs,
    lastPeriodTs: fwdChunks[fwdChunks.length - 1].endTs,
    periods: fwdChunks.length,
    // R1 — the only verdict that counts, and it is forward money only.
    net: res.pnl,
    trades,
    wins: res.wins,
    gross,
    // R2 — cost realism. Null when there are no trades to divide by.
    breakEvenPerLeg: legs ? gross / legs : null,
    feeHeadroomPct: legs ? 100 * (gross / legs / fee - 1) : null,
    // R5 — the comparison that matters.
    alwaysLong: holds.alwaysLong ? holds.alwaysLong.pnl : null,
    alwaysShort: holds.alwaysShort ? holds.alwaysShort.pnl : null,
    // R3 — thinness is reported, never hidden.
    verdictAllowed: trades >= VERDICT_FLOOR_TRADES,
    verdictFloorTrades: VERDICT_FLOOR_TRADES,
    thinness: trades >= VERDICT_FLOOR_TRADES ? null
      : `${trades} forward trades — below the ${VERDICT_FLOOR_TRADES}-trade floor; numbers are shown, NO verdict is claimed`,
    backtest: book.backtest,
  };
}

async function scoreAll(opts = {}) {
  assertFrozenMembersMatchEngine();
  const books = [];
  for (const b of BOOKS) books.push(await scoreBook(b, opts));
  return {
    preregistration: 'vps-access reports/FORWARD-BOOKS.md (committed before any forward number existed)',
    trainThrough: TRAIN_THROUGH,
    scoreFrom: SCORE_FROM,
    verdictFloorTrades: VERDICT_FLOOR_TRADES,
    books,
  };
}

module.exports = {
  BOOKS, TRAIN_THROUGH, SCORE_FROM, VERDICT_FLOOR_TRADES,
  scoreBook, scoreAll, assertFrozenMembersMatchEngine,
};
