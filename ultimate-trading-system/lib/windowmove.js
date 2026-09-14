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
function windowMoves(map, geometry) {
  const bracket = require('./bracket');
  const built = bracket.buildComboChunks({ trade: map }, geometry, false);
  const ts = [];
  const move = [];
  const out = [];
  let skipped = 0;
  for (const c of built.chunks) {
    if (c.c1 == null || c.diffPct == null) continue;
    const first = map.get(c.startTs);
    // A PRICE OF ZERO OR BELOW IS NOT A BASE A RETURN CAN BE MEASURED FROM.
    // That decision is skipped and counted, never invented.
    if (!first || !(first.open > 0)) { skipped++; continue; }
    ts.push(c.startTs);
    move.push(Number((((c.c1 - first.open) / first.open) * 100).toFixed(4)));
    out.push(Number(Number(c.diffPct).toFixed(4)));
  }
  return {
    periods: ts.length,
    ts,
    move,
    out,
    skipped,
    span: ts.length ? { fromTs: ts[0], toTs: ts[ts.length - 1] } : null,
  };
}

// THE YARDSTICK the band is read against: the coin's median window move for
// this shape, ignoring direction. The one place it is defined.
function medianAbsMove(move) {
  const abs = move.map((m) => Math.abs(Number(m) || 0)).sort((a, b) => a - b);
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

module.exports = { windowMoves, medianAbsMove, readingsUnderBand };
