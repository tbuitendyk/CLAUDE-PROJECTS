// plateau.js -- find the widest REGION of neighbouring settings that all work,
// rather than the single best-scoring cell.
//
// WHY (owner, 2026-08-17). Taking the top row of a board is how you find flukes:
// the best of ~1,260 tries looks good even when nothing is there. Noise gives an
// isolated spike — one good cell with bad ones either side. Something real gives
// a REGION: a cell that works whose neighbours also work. So a candidate is
// judged here by how many neighbouring settings hold up around it, and the same
// number is computed for the null boards, which is what makes it a comparison
// rather than an adjective.
//
// Pure and dependency-free: it reads the rows execSweep already produced (the
// sweep computes every cell and keeps only the winner), so this is a second
// reading of work already done, not more work.

// Which settings have an ORDER, and therefore have neighbours. entry and gate are
// categories — 'market' is not next to 'breakout' in any meaningful sense — so a
// region never spans them; they slice the space instead.
const ORDERED_AXES = ['dMult', 'tHours', 'quorum', 'trailMult', 'armMult'];
const CATEGORICAL_AXES = ['entry', 'gate'];

// The bar a cell must clear to belong to a region. Zero is deliberate and is NOT
// a tuned threshold: it means "this setting made money after fees". Any other
// number would be a knob that could be turned until the region looked good, which
// is the shopping this exists to avoid. minTrades keeps a cell that never traded
// from counting — $0 by absence is not the same as $0 by skill.
function clears(row, minTrades) {
  return Number.isFinite(row.pnl) && row.pnl > 0 && (row.trades || 0) >= minTrades;
}

// Index the values of each ordered axis so "next to" means "one step along the
// menu this run actually computed", not one step along the library's full menu.
// A run with a custom grid has its own spacing and must be judged on it.
function axisIndex(rows, ordered = ORDERED_AXES) {
  const idx = {};
  for (const axis of ordered) {
    const vals = [...new Set(rows.map((r) => r[axis]).filter((v) => v != null))]
      .sort((a, b) => a - b);
    idx[axis] = new Map(vals.map((v, i) => [v, i]));
  }
  return idx;
}

// A cell's coordinates: its slice (the categorical part, which regions never
// cross) and its position on each ordered axis. A null on an ordered axis — a
// market cell has no dMult, an untrailed cell no trailMult — is its own position
// so those cells still neighbour each other along the axes they do have.
function coordsOf(row, idx, ordered = ORDERED_AXES, categorical = CATEGORICAL_AXES) {
  const slice = categorical.map((a) => String(row[a])).join('|');
  const pos = ordered.map((a) => (row[a] == null ? -1 : idx[a].get(row[a]) ?? -1));
  return { slice, pos };
}

// Two cells are neighbours when they sit in the same slice and differ by exactly
// one step on exactly one ordered axis. Diagonal steps do not connect: requiring
// a contiguous walk is the whole point, and letting a region hop two settings at
// once would let scattered luck read as a plateau.
function adjacent(a, b) {
  if (a.slice !== b.slice) return false;
  let diff = 0;
  for (let i = 0; i < a.pos.length; i++) {
    const d = Math.abs(a.pos[i] - b.pos[i]);
    if (d === 0) continue;
    if (d !== 1) return false;
    diff += 1;
    if (diff > 1) return false;
  }
  return diff === 1;
}

// The widest region: the largest set of cells that all clear the bar and are all
// reachable from one another by single steps.
//
// Returns { size, centre, sliceLabel, cellsConsidered, cellsClearing, bar } where
// centre is the region's most INTERIOR cell — the one with the most neighbours
// inside the region, not the highest-scoring one. Picking the peak of the region
// would quietly put the shopped cell back in charge; the point of a plateau is
// that its middle is defensible precisely because it is not the maximum.
// An axis list is a list of field names. Anything else is refused rather than
// coerced: a caller passing a string, or a list with a hole in it, would cut a
// region on axes nobody chose and hand back a number that looks fine.
function axisListOf(given, fallback, what) {
  if (given == null) return fallback;
  if (!Array.isArray(given) || !given.length) throw new Error(`${what} must be a non-empty list of field names`);
  for (const a of given) {
    if (typeof a !== 'string' || !a) throw new Error(`${what} holds something that is not a field name`);
  }
  return given;
}

function widestRegion(rows, opts = {}) {
  const minTrades = opts.minTrades == null ? 1 : opts.minTrades;
  // WHICH DIALS HAVE AN ORDER IS A PROPERTY OF THE RUN, NOT OF THIS LIBRARY
  // (Funnel design, 2026-08-31). ORDERED_AXES named `quorum`, which the
  // three-stage system does not have — its agreement dials replaced it — so a
  // stage 3 board cut with the constants would have every cell reading -1 on
  // that axis and would still return a region, silently measured on four axes
  // instead of five. The defaults keep the old sweep byte-identical.
  const ordered = axisListOf(opts.orderedAxes, ORDERED_AXES, 'orderedAxes');
  const categorical = axisListOf(opts.categoricalAxes, CATEGORICAL_AXES, 'categoricalAxes');
  // A dial named on both lists would slice the space AND be walked along it —
  // nonsense, and nonsense that returns a plausible-looking number.
  const both = ordered.filter((a) => categorical.includes(a));
  if (both.length) throw new Error(`${both.join(', ')} named as both an ordered and a categorical axis`);
  const all = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
  const good = all.filter((r) => clears(r, minTrades));
  const base = {
    size: 0,
    centre: null,
    sliceLabel: null,
    cellsConsidered: all.length,
    cellsClearing: good.length,
    bar: 'pnl > 0 after fees',
    // provenance: a region size means nothing without knowing what "next to"
    // meant when it was cut
    axes: { ordered, categorical },
  };
  if (!good.length) return base;

  const idx = axisIndex(all, ordered);
  const nodes = good.map((r) => ({ row: r, ...coordsOf(r, idx, ordered, categorical) }));

  // neighbour lists, then connected components by flood fill
  const nbrs = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (adjacent(nodes[i], nodes[j])) { nbrs[i].push(j); nbrs[j].push(i); }
    }
  }
  const seen = new Array(nodes.length).fill(false);
  let bestComp = null;
  for (let i = 0; i < nodes.length; i++) {
    if (seen[i]) continue;
    const comp = [];
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const n = stack.pop();
      comp.push(n);
      for (const m of nbrs[n]) if (!seen[m]) { seen[m] = true; stack.push(m); }
    }
    // Bigger wins. On a tie the deeper interior wins, then a stable key, so the
    // same board always yields the same region — a result that moved between
    // identical runs would be untraceable.
    if (!bestComp || comp.length > bestComp.length) bestComp = comp;
    else if (comp.length === bestComp.length) {
      const deg = (c) => Math.max(...c.map((n) => nbrs[n].length));
      if (deg(comp) > deg(bestComp)) bestComp = comp;
      else if (deg(comp) === deg(bestComp)) {
        const key = (c) => c.map((n) => nodes[n].pos.join(',')).sort()[0];
        if (key(comp) < key(bestComp)) bestComp = comp;
      }
    }
  }
  if (!bestComp) return base;

  // The centre is the DEEPEST cell — the one furthest from the region's edge —
  // not the one with the most neighbours and not the highest scorer. Counting
  // neighbours cannot tell the middle of a line of five from its second cell
  // (both have two), and picking the peak would quietly put the shopped cell
  // back in charge. Depth is measured by walking inward from the edge.
  //
  // A cell is ON the edge when any of its lattice neighbours is missing from the
  // region — INCLUDING a neighbour that falls off the end of the menu this run
  // computed. That is deliberate: a region running to the edge of what was swept
  // is not known to be wide there, so it is not treated as interior.
  const inCompSet = new Set(bestComp);
  const memberAt = new Map(bestComp.map((n) => [`${nodes[n].slice}#${nodes[n].pos.join(',')}`, n]));
  const axisLen = ordered.map((a) => idx[a].size);
  const depth = new Map();
  const queue = [];
  for (const n of bestComp) {
    const { slice, pos } = nodes[n];
    let onEdge = false;
    for (let ax = 0; ax < pos.length && !onEdge; ax++) {
      if (pos[ax] < 0) continue; // axis absent for this cell (market has no dMult)
      // An axis this run swept only ONE value of cannot make a cell interior or
      // exterior — there is no room to move along it. Counting its ends as edges
      // would mark every cell in the region as an edge cell and leave no middle.
      if (axisLen[ax] <= 1) continue;
      for (const step of [-1, 1]) {
        const q = pos[ax] + step;
        if (q < 0 || q >= axisLen[ax]) { onEdge = true; break; }
        const probe = pos.slice();
        probe[ax] = q;
        if (!memberAt.has(`${slice}#${probe.join(',')}`)) { onEdge = true; break; }
      }
    }
    if (onEdge) { depth.set(n, 1); queue.push(n); }
  }
  // every cell on the edge already found; walk inward one ring at a time
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head];
    for (const m of nbrs[n]) {
      if (!inCompSet.has(m) || depth.has(m)) continue;
      depth.set(m, depth.get(n) + 1);
      queue.push(m);
    }
  }
  let centreIdx = bestComp[0];
  let centreDepth = -1;
  for (const n of bestComp) {
    // a region with no edge at all (every neighbour present, impossible on a
    // finite menu) would leave depth unset; treat that as maximally interior
    const d = depth.has(n) ? depth.get(n) : Number.MAX_SAFE_INTEGER;
    const better = d > centreDepth
      || (d === centreDepth && nodes[n].pos.join(',') < nodes[centreIdx].pos.join(','));
    if (better) { centreDepth = d; centreIdx = n; }
  }
  const centreRow = nodes[centreIdx].row;
  // Built from the axis lists rather than typed out, so a caller naming its own
  // dials gets its own dials back. With the defaults this is the same key set
  // it has always been, which is what lets greenlight go on spreading it.
  const centre = {};
  for (const a of categorical) centre[a] = centreRow[a];
  for (const a of ordered) centre[a] = centreRow[a] ?? null;
  centre.pnl = centreRow.pnl;
  centre.trades = centreRow.trades;
  centre.depthFromEdge = centreDepth;
  return {
    ...base,
    size: bestComp.length,
    sliceLabel: nodes[centreIdx].slice,
    centre,
  };
}

module.exports = { widestRegion, clears, adjacent, coordsOf, axisIndex, axisListOf, ORDERED_AXES, CATEGORICAL_AXES };
