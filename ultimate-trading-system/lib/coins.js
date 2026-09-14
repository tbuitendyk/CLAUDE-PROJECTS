// coins.js -- THE COINS READING: every decision a coin's history offers, read
// on its own window (COINS.md Part one; owner LOOP NOW! 2026-09-13).
//
// WHAT IS READ, in the owner's words: "how much price has moved from the start
// of this examination period for the trade window in question ... the start of
// the history characterization for each chunk is the start of that chunk's
// analysis window." One decision is one chunk. Its window move is the price
// change from the first candle of its window to the price its trade opens at.
// Nothing after the open is read, so the same number is known live, at the
// moment a real trade would open, which is what lets one set of members sit
// out while the other votes.
//
// THE THREE READINGS come from one number, the sit-out band, applied at draw
// time and never at read time: rising if the window move is up by more than
// the band, falling if down by more than it, sit out otherwise. The record on
// disk holds the moves, which are facts about the history; the band is applied
// when the screen asks, so changing it recolours every bar without reading a
// single candle again.
//
// THE BAND IS ONE NUMBER FOR EVERY COIN, READ ON EACH COIN'S OWN SCALE (owner:
// "a five percent number, for example, might mean one thing on Bitcoin might
// mean something else on Doge"). It is a share of the coin's MEDIAN window
// move for that chunk shape, ignoring direction. Median rather than mean
// because a few wild days do not move it. This yardstick is the session's
// recommendation, recorded as such in COINS.md Part one section 3; it is one
// function below and nowhere else, so changing it is one edit.
//
// TRADE LENGTH NEVER ENTERS. The window belongs to the chunk shape; how long
// the trade is then held changes nothing about what the decision saw before it
// opened. Five shapes, five readings per coin, and no grouping by hold.
//
// NOTHING HERE REFUSES A COIN (owner, 2026-09-12: "We're only reporting."), and
// nothing here is tuned: there is no percentage to search for, no stretch to
// find, no turn to confirm. Each decision is read alone.
//
// Pure arithmetic, no I/O. The plumbing that loads candles and writes records
// is lib/coinsrun.js.
const { GEOMETRIES } = require('./dataset');

// THE FIVE CHUNK SHAPES, DERIVED FROM THE ENGINE'S OWN TABLE and never typed
// here. A shape added to lib/dataset.js tomorrow gets a bar on Coins without
// anybody remembering to add one. The label is the one Sweep's dropdown shows,
// read from the same vocabulary, so the bar is named exactly as the control
// that picks the shape.
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function shapes() {
  const { vocabulary } = require('./vocabulary');
  const labels = new Map((vocabulary().geometry || []).map((o) => [String(o.value), o.label]));
  return Object.entries(GEOMETRIES).map(([key, g]) => {
    const weekly = g.stepHours >= 168;
    const hh = String(g.entryOffsetH % 24).padStart(2, '0');
    return {
      key,
      label: labels.get(key) || key,
      windowHours: g.featureHours,
      every: weekly ? 'week' : 'day',
      at: weekly ? `${DAY_NAMES[Math.floor(g.entryOffsetH / 24) % 7]} ${hh}:00` : `${hh}:00`,
      startsPerWeek: Math.round((7 * 24) / g.stepHours),
    };
  });
}

// THE WINDOW MOVE, ITS YARDSTICK AND ITS READING live in lib/windowmove.js
// (3.130.0): the stage 3 worker reads them too, and the worker may not reach
// this module. Re-exported here so every caller on the Coins side reads the
// one name it always did.
const { windowMoves, medianAbsMove, readingsUnderBand } = require('./windowmove');

// THE PARTS OF HISTORY, READ FROM THE ENGINE'S OWN ARITHMETIC. Never typed as
// 61/13/13/13 or 70/15/15: the divisions come from the same splitBounds the
// sweep engine splits by, and the sealed reserve comes off exactly the way the
// engine seals it. Typing the percentages here would be a second copy of the
// arithmetic, and two copies drift.
function partsFor(n, layout) {
  const { splitBounds, reserveChunks } = require('./bracketwork');
  if (layout === 'reserve61') {
    const nReserve = reserveChunks(n);
    const rest = n - nReserve;
    const b = splitBounds(rest, true);
    return [
      { name: 'train', from: 0, to: b.nTrain - 1 },
      { name: 'test', from: b.nTrain, to: b.nTrain + b.nTest - 1 },
      { name: 'held', from: b.nTrain + b.nTest, to: rest - 1 },
      { name: 'reserve', from: rest, to: n - 1 },
    ];
  }
  if (layout === 'split70') {
    const b = splitBounds(n, true);
    return [
      { name: 'train', from: 0, to: b.nTrain - 1 },
      { name: 'test', from: b.nTrain, to: b.nTrain + b.nTest - 1 },
      { name: 'held', from: b.nTrain + b.nTest, to: n - 1 },
    ];
  }
  throw new Error(`unknown window layout '${layout}'`);
}

// A SPLIT THAT LEAVES A PART WITH NOTHING IN IT IS NOT A SPLIT, and saying so
// is the honest answer for a coin with almost no history. It is not a refusal
// of the coin: the bar is still drawn and every other layout is still read.
// The floor this puts on the decision count is whatever the engine's own
// arithmetic implies -- there is no number typed here to be argued with.
function layoutParts(n, layout) {
  const parts = partsFor(n, layout);
  for (const p of parts) {
    if (p.to < p.from) return { why: `${n} decisions do not divide into ${layout} — the split leaves '${p.name}' with nothing in it` };
  }
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].from !== parts[i - 1].to + 1) return { why: `${n} decisions do not divide into ${layout} — '${parts[i - 1].name}' and '${parts[i].name}' do not meet` };
  }
  if (parts[0].from !== 0 || parts[parts.length - 1].to !== n - 1) return { why: `${n} decisions do not divide into ${layout} — the parts do not cover the span` };
  return { parts };
}

// THE COUNTS OVER A STRETCH OF THE BAR: how many decisions read each way, and
// how many times the colour changes inside it. A change is counted between two
// neighbouring decisions both inside the stretch, so the change AT a boundary
// belongs to neither part and the parts' changes never double-count it.
function countIn(reading, from, to) {
  let rising = 0; let falling = 0; let sitOut = 0; let changes = 0;
  for (let i = from; i <= to; i++) {
    const c = reading[i];
    if (c === 'r') rising++; else if (c === 'f') falling++; else sitOut++;
    if (i > from && reading[i] !== reading[i - 1]) changes++;
  }
  return { decisions: Math.max(0, to - from + 1), rising, falling, sitOut, changes };
}

// THE GAP: how differently a trade turns out after a rising window than after
// a falling one, over a stretch of the bar. Two readings of it, both shown:
// the share of trades that went up after each kind of window, and the average
// move from open to close after each. The gap is rising minus falling. Zero
// means the two sets of members would learn the same lesson twice; wide means
// the split has something to learn from. Sit-out decisions are in neither
// side, because neither set would be trained to call on them.
//
// BESIDE IT, WHAT QUALIFIES IT. The thin side: the smaller of the two counts,
// because a gap built on forty falling decisions is not a gap. The run length:
// decisions per colour change, because a reading that flips every day is not
// a regime. Neither is a cut-off; both are there to be read with the gap.
function gapIn(reading, out, from, to) {
  const side = { n: 0, up: 0, sum: 0 };
  const r = { ...side }; const f = { ...side };
  for (let i = from; i <= to; i++) {
    const c = reading[i];
    const o = Number(out[i]);
    if (c === 'r') { r.n++; if (o > 0) r.up++; r.sum += o; } else if (c === 'f') { f.n++; if (o > 0) f.up++; f.sum += o; }
  }
  const fin = (x) => ({ n: x.n, shareUp: x.n ? x.up / x.n : null, meanOut: x.n ? x.sum / x.n : null });
  const R = fin(r); const F = fin(f);
  return {
    afterRising: R,
    afterFalling: F,
    gapShare: R.n && F.n ? R.shareUp - F.shareUp : null,
    gapMove: R.n && F.n ? R.meanOut - F.meanOut : null,
    thinSide: R.n <= F.n ? { n: R.n, which: 'rising' } : { n: F.n, which: 'falling' },
  };
}
function runLength(counts) {
  return counts.decisions ? counts.decisions / (counts.changes + 1) : null;
}
// one stretch of the bar, everything the table prints for it
function stretchOf(reading, out, from, to) {
  const c = countIn(reading, from, to);
  return { ...c, run: runLength(c), gap: gapIn(reading, out, from, to) };
}

// ONE SHAPE OF ONE COIN, SUMMED UP UNDER THE BAND: everything the screen draws
// for one bar. The moves and the moments come back with it because the bar is
// drawn from them and the hover reads them; the reading string is what colours
// it; the counts per part under each layout are the numbers beside it.
function shapeSummary(shapeRec, band, layouts) {
  const move = Array.isArray(shapeRec && shapeRec.move) ? shapeRec.move : [];
  const ts = Array.isArray(shapeRec && shapeRec.ts) ? shapeRec.ts : [];
  const out = Array.isArray(shapeRec && shapeRec.out) ? shapeRec.out : [];
  const n = move.length;
  const { yardstick, threshold, reading } = readingsUnderBand(move, band);
  let largestRise = null; let largestFall = null;
  for (const m of move) {
    if (largestRise == null || m > largestRise) largestRise = m;
    if (largestFall == null || m < largestFall) largestFall = m;
  }
  const byLayout = {};
  for (const layout of layouts) {
    if (!n) { byLayout[layout] = { why: 'no decisions to divide' }; continue; }
    const lp = layoutParts(n, layout);
    byLayout[layout] = lp.parts
      ? { parts: lp.parts.map((p) => ({ ...p, ...stretchOf(reading, out, p.from, p.to) })) }
      : { why: lp.why };
  }
  // THE MOMENTS GO OUT AS HOURS SINCE THE ONE BEFORE, and the moves to two
  // places. Eighteen coins of eight years is a quarter of a million decisions
  // in one reply; sent as full timestamps and four-place moves that is several
  // megabytes for a screen draw, most of it digits that never change. The
  // record on disk keeps the full values; this is only what the bar is drawn
  // from and the hover reads.
  const dt = [];
  for (let i = 1; i < ts.length; i++) dt.push(Math.round((ts[i] - ts[i - 1]) / 3600000));
  return {
    periods: n,
    span: shapeRec && shapeRec.span ? shapeRec.span : null,
    skipped: (shapeRec && shapeRec.skipped) || 0,
    yardstick,
    threshold,
    range: { largestRise, largestFall },
    whole: stretchOf(reading, out, 0, n - 1),
    layouts: byLayout,
    reading,
    t0: ts.length ? ts[0] : null,
    dt,
    move: move.map((m) => Number(Number(m).toFixed(2))),
    out: out.map((o) => Number(Number(o).toFixed(2))),
  };
}

module.exports = {
  shapes, windowMoves, medianAbsMove, readingsUnderBand,
  partsFor, layoutParts, countIn, gapIn, runLength, stretchOf, shapeSummary,
};
