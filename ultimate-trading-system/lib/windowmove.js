// windowmove.js -- THE WINDOW MOVE, ITS YARDSTICK AND ITS READING. Pure
// arithmetic with one home (3.130.0): Coins reads a coin's windows with it,
// and the stage 3 worker reads a unit's windows with the SAME functions when
// a setting prices with the coin's lean (COINS.md section 11). It lives apart
// from lib/coins.js because the worker may not reach that module -- it
// reaches the vocabulary, and through it the orchestrator -- and a copy of
// this arithmetic in the worker would be a second copy that drifts.
//
// ONE READING PER DECISION, FROM ITS OWN WINDOW.
//
// THE DECISIONS ARE THE SWEEP'S OWN DECISIONS. They come from buildComboChunks,
// the same function a stage 1 launch builds its rows with, so a bar here lines
// up one for one with the rows training will see (owner: "that could be lined
// up to the actual trading decisions that'll be made under the training"). A
// chunk carries the moment its window starts and the price its trade opens
// at; the first candle of the window is read straight off the hourly map at
// that moment. Nothing is added to a chunk and nothing new is stored on it
// (owner: "it does not need a new field. We have all the hourly candles").
//
// The move is a percentage of the window's first price, so a ten per cent
// move counts the same at fifty dollars and at five thousand.
//
// AND THE TRADE'S OWN OUTCOME RIDES WITH IT (owner, 2026-09-13: "add the gap
// metric too"). `out` is the chunk's own diffPct -- how far price moved from
// the open of the trade to its close, the number the training's label is made
// from. It is what the gap below is read against: how differently a trade
// turns out after a rising window than after a falling one. The window ends
// at the open and the outcome starts there, so the two never overlap.
// WHERE THE DECISION IS TAKEN, AND AT WHAT PRICE (owner, 2026-09-17).
//
// The move used to end at `c1`, which is the price the TRADE FILLS AT. On the
// daily shapes those are the same instant -- c1 is one candle's open at the
// entry hour -- so nothing there changes. On the weekly shape c1 is the mean
// of six candles, Tuesday 00:00 to 05:59, and the nominal entry sits in the
// MIDDLE of it at 195h. Averaging is right for a fill: it stands in for
// entering across a morning instead of at one jumpy print, and the owner is
// right that it is not a fault.
//
// It is wrong for the READING, which is the number that decides whether to
// trade at all, because half of that average had not happened yet. And the
// direction it pushes is unhelpfully exact: a morning that falls drags c1
// down, so the window reads MORE fallen and the outcome measured from that
// lower c1 reads BETTER -- manufacturing "a big fall is followed by a rise"
// out of the two sharing one number.
//
// So the decision is taken at the FIRST CANDLE OF THE FILL WINDOW, at its open
// (owner's choice, 2026-09-17), and the fill stays exactly as it was. On the
// daily shapes that is the same candle and the same open as before.
function decisionAt(map, startTs, geo) {
  const { TUE_OFFSET_H } = require('./dataset');
  const hours = geo.labelMode === 'windows' ? TUE_OFFSET_H : geo.entryOffsetH;
  const ts = startTs + hours * 3600000;
  const c = map.get(ts);
  return { ts, price: c && c.open > 0 ? c.open : null };
}

// A MOVE OVER ANY LOOK-BACK, not only the one the chunk shape happens to use
// (owner, 2026-09-17: "the daily two day doesn't just look at two days of
// history to the decision point ... but also could look back, say, three days,
// four days, five days a week, two weeks").
//
// The shape decides the TRADE -- when it opens and how long it is held. There
// is no reason it should also decide what is LOOKED AT. `own` keeps the
// shape's own span, from the start of its window to the decision; a number of
// hours measures from that many hours before the decision instead. Everything
// still ends at the decision, so no look-back can see past it.
function windowMoves(map, geometry, lookbacks = []) {
  const bracket = require('./bracket');
  const { GEOMETRIES } = require('./dataset');
  const geo = GEOMETRIES[geometry];
  const built = bracket.buildComboChunks({ trade: map }, geometry, false);
  const ts = [];
  const move = [];
  const out = [];
  const moves = {};
  const wanted = [...new Set((lookbacks || []).map(Number).filter((h) => Number.isFinite(h) && h > 0))].sort((a, b) => a - b);
  for (const h of wanted) moves[String(h)] = [];
  let skipped = 0;
  for (const c of built.chunks) {
    if (c.c1 == null || c.diffPct == null) continue;
    const first = map.get(c.startTs);
    const at = decisionAt(map, c.startTs, geo);
    // A PRICE OF ZERO OR BELOW IS NOT A BASE A RETURN CAN BE MEASURED FROM.
    // That decision is skipped and counted, never invented.
    if (!first || !(first.open > 0) || at.price == null) { skipped++; continue; }
    ts.push(c.startTs);
    move.push(Number((((at.price - first.open) / first.open) * 100).toFixed(4)));
    out.push(Number(Number(c.diffPct).toFixed(4)));
    for (const h of wanted) {
      const back = map.get(at.ts - h * 3600000);
      // A LOOK-BACK WITH NO CANDLE BEHIND IT IS NOT MEASURED AND NOT GUESSED.
      // The early decisions of a coin's life have nothing two weeks back, and
      // a null there is read as "this decision is not in this look-back's
      // reading" rather than being filled in from somewhere.
      moves[String(h)].push(back && back.open > 0 ? Number((((at.price - back.open) / back.open) * 100).toFixed(4)) : null);
    }
  }
  return {
    periods: ts.length,
    ts,
    move,
    out,
    moves,
    skipped,
    span: ts.length ? { fromTs: ts[0], toTs: ts[ts.length - 1] } : null,
  };
}

// THE YARDSTICK the band is read against: the coin's median window move for
// this shape, ignoring direction. The one place it is defined.
// A DECISION WITH NO PRICE THAT FAR BACK IS LEFT OUT, NOT COUNTED AS NOTHING
// (3.159.0). A look-back array carries nulls at the start of a coin's life --
// there is no candle two weeks before its first week -- and reading those as a
// 0% move dragged the median down and made the band too tight for every
// decision after them.
function medianAbsMove(move) {
  const abs = move.filter((m) => m != null && Number.isFinite(Number(m)))
    .map((m) => Math.abs(Number(m))).sort((a, b) => a - b);
  const n = abs.length;
  if (!n) return null;
  return n % 2 ? abs[(n - 1) / 2] : (abs[n / 2 - 1] + abs[n / 2]) / 2;
}

// THE THREE READINGS, from the moves and the one band. `band` is a percentage
// of the yardstick: 50 means a decision sits out when its window moved less
// than half what this coin typically moves over that window. Returned as one
// character per decision -- r, f, s -- because that is what the screen draws.
// A YARDSTICK MAY BE HANDED IN (3.130.0): stage 3 reads a unit's windows at
// the yardstick Coins worked out on the coin's whole record, so a window is
// the same colour on Boards as on Coins whatever range the run loaded. With
// none given, the yardstick is the median of the moves handed in, as before.
function readingsUnderBand(move, band, yardstickGiven = null) {
  const yardstick = yardstickGiven != null && Number.isFinite(Number(yardstickGiven)) ? Number(yardstickGiven) : medianAbsMove(move);
  const share = Number(band);
  if (!Number.isFinite(share) || share < 0) throw new Error(`the sit-out band must be a number of zero or more — not ${band}`);
  const threshold = yardstick == null ? null : yardstick * (share / 100);
  let reading = '';
  for (const m of move) reading += m > threshold ? 'r' : (m < -threshold ? 'f' : 's');
  return { yardstick, threshold, reading };
}

module.exports = { windowMoves, medianAbsMove, readingsUnderBand, decisionAt };
