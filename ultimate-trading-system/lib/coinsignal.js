// coinsignal.js -- THE SIGNAL READING: per coin, per chunk shape, how much the
// window reading is worth, at which sit-out band, and in one-word traits
// (LOOP-2026-09-14-SIGNAL.md; owner LOOP NOW! 2026-09-14).
//
// The owner: "build a scoring mechanism into the current code which basically
// BY CODE determines what you stated ... a general metric about 'aptness to
// coin history signal' for each coin", then "the analysis ... based on each
// shape within each coin", wrapped in "sit-out band sweeps (one per coin and
// shape) that find the sweet spot for the signal, focusing of course on
// middle-of-plateau not spikes".
//
// ONE LIST IN, ONE ANSWER OUT (S1). The analysis of one shape reads only the
// record's window moves and outcomes and the engine's own split. Nothing is
// stored, nothing is read from the candles again, and the band on the box is
// never touched: every band in the grid is tried on the same moves.
//
// THE TWO-WAY EDGE (S3), defined here and nowhere else. On the train part of
// the three-part layout, a trader who sees the colour learns one lean per
// colour: the sign of the summed outcome after rising windows, and after
// falling ones. A trader who does not see it learns one lean for everything.
// Both trade every called decision of test and held, skipping sit out. The
// edge is what the colour-seeing one keeps per called trade beyond the blind
// one. Chance is the usual size of that number when the colours carry
// nothing (closed form, below). The ratio is edge over chance, and 1 -- edge
// the size of chance -- is the only bar anywhere in this file.
//
// NOTHING HERE REFUSES A COIN (owner, 2026-09-12: "We're only reporting.").
// Every shape gets a line: a band and a ratio, or a sentence saying no band
// beats chance.
//
// Pure arithmetic, no I/O. lib/coinsrun.js serves it beside each bar.
const coins = require('./coins');
const { GEOMETRIES } = require('./dataset');

// THE BAND GRID, one home, served to the screen (B1). Fine enough that three
// consecutive points is a plateau and not the whole axis.
const BAND_GRID = Object.freeze({ from: 0, to: 300, step: 10 });
function bandGrid() {
  const out = [];
  for (let b = BAND_GRID.from; b <= BAND_GRID.to; b += BAND_GRID.step) out.push(b);
  return out;
}
// the least a plateau can be (B3): one point above the bar is a spike, two is
// ambiguous, three is a plateau
const PLATEAU_MIN_POINTS = 3;
// the bar: edge the size of chance (B2). Chance's own definition, not a number
// to argue with.
const CHANCE_BAR = 1;

// THE OVERLAP FACTOR (S4). Trades open at the same time share their outcome,
// so the outcomes of neighbouring decisions are not independent and chance
// has to be widened. Read off the shape's own hours, never typed per shape.
function overlapFactor(geometryKey) {
  const g = GEOMETRIES[geometryKey];
  if (!g) throw new Error(`unknown chunk shape '${geometryKey}'`);
  const hold = g.exitOffsetH - g.entryOffsetH;
  return 1 + (2 * Math.max(0, hold - g.stepHours)) / hold;
}

const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// THE LEANS LEARNED ON A STRETCH: one per colour, and one blind.
function leansOn(reading, out, from, to) {
  let sr = 0; let sf = 0; let nr = 0; let nf = 0;
  for (let i = from; i <= to; i++) {
    const c = reading[i];
    const o = Number(out[i]);
    if (c === 'r') { sr += o; nr++; } else if (c === 'f') { sf += o; nf++; }
  }
  return { dr: sgn(sr), df: sgn(sf), d1: sgn(sr + sf), nr, nf };
}

// THE EDGE OVER CHANCE on a judging stretch, given the leans (S3).
function edgeOn(reading, out, from, to, leans, k) {
  const { dr, df, d1 } = leans;
  let nr = 0; let nf = 0; let sum = 0; let sq = 0; let seen = 0; let blind = 0;
  for (let i = from; i <= to; i++) {
    const c = reading[i];
    if (c !== 'r' && c !== 'f') continue;
    const o = Number(out[i]);
    if (c === 'r') { nr++; seen += dr * o; } else { nf++; seen += df * o; }
    blind += d1 * o;
    sum += o; sq += o * o;
  }
  const n = nr + nf;
  if (!n || !leans.nr || !leans.nf) return { n, edge: null, chance: null, ratio: null };
  const edge = (seen - blind) / n;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const chance = (sd * Math.sqrt(k) * Math.sqrt(((dr - d1) ** 2) * nr + ((df - d1) ** 2) * nf)) / n;
  return { n, edge, chance, ratio: chance > 0 ? edge / chance : null };
}

// THE PARTS IN TIME ORDER, under one layout: null when the count will not divide.
function partsOf(n, layout) {
  const lp = coins.layoutParts(n, layout);
  return lp.parts || null;
}

// ONE BAND: called share, the gap per part under each layout, and the edge.
// `trainLayout` is the three-part one -- train is its first part and the
// judging stretch is everything after it.
function readBand(rec, band, k, layouts, trainLayout) {
  const move = rec.move; const out = rec.out; const n = move.length;
  const { reading } = coins.readingsUnderBand(move, band);
  let called = 0;
  for (const c of reading) if (c !== 's') called++;
  const gaps = {};
  for (const layout of layouts) {
    const parts = partsOf(n, layout);
    gaps[layout] = parts ? parts.map((p) => {
      const g = coins.gapIn(reading, out, p.from, p.to);
      return { name: p.name, gapShare: g.gapShare, gapMove: g.gapMove, thin: g.thinSide.n };
    }) : null;
  }
  const tp = partsOf(n, trainLayout);
  let edge = { n: 0, edge: null, chance: null, ratio: null };
  let leans = null;
  if (tp && tp.length >= 2) {
    const train = tp[0];
    leans = leansOn(reading, out, train.from, train.to);
    edge = edgeOn(reading, out, tp[1].from, tp[tp.length - 1].to, leans, k);
  }
  return {
    band,
    called: n ? called / n : null,
    gaps,
    lean: leans ? { rising: leans.dr, falling: leans.df, blind: leans.d1 } : null,
    judged: edge.n,
    edge: edge.edge,
    chance: edge.chance,
    ratio: edge.ratio,
    // edge per decision of the whole stretch, called or not: what the band is
    // buying when it sits decisions out, read beside edge per called trade
    perDecision: edge.edge == null || !n ? null : edge.edge * (called / n),
  };
}

// THE PLATEAU, NOT THE SPIKE (S5). The ratio is smoothed three points wide
// (the ends use what exists); a plateau is the longest run of at least three
// consecutive grid points whose smoothed ratio reaches the bar; between runs
// of equal length, the one with the higher mean. The sweet spot is the middle
// point of the run, the lower middle when it is even.
function smooth3(values) {
  return values.map((v, i) => {
    const win = [values[i - 1], v, values[i + 1]].filter((x) => x != null && Number.isFinite(x));
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}
function findPlateau(bands, ratios) {
  const sm = smooth3(ratios);
  const runs = [];
  let start = null;
  for (let i = 0; i <= sm.length; i++) {
    const on = i < sm.length && sm[i] != null && sm[i] >= CHANCE_BAR;
    if (on && start == null) start = i;
    if (!on && start != null) {
      const len = i - start;
      if (len >= PLATEAU_MIN_POINTS) {
        const mean = sm.slice(start, i).reduce((a, b) => a + b, 0) / len;
        runs.push({ from: start, to: i - 1, len, mean });
      }
      start = null;
    }
  }
  if (!runs.length) return { smoothed: sm, plateau: null, sweetSpot: null };
  runs.sort((a, b) => b.len - a.len || b.mean - a.mean || a.from - b.from);
  const best = runs[0];
  const mid = best.from + Math.floor((best.len - 1) / 2);
  return {
    smoothed: sm,
    plateau: { fromBand: bands[best.from], toBand: bands[best.to], points: best.len, meanRatio: best.mean },
    sweetSpot: { band: bands[mid], ratio: ratios[mid], smoothedRatio: sm[mid] },
  };
}

// THE TRAITS (S6), one word each, read at one band.
function holdingOf(signs) {
  // signs: per part in time order, +1/-1/0/null; null and 0 are skipped
  const s = signs.filter((x) => x != null && x !== 0);
  if (s.length < 2) return null;
  const first = s[0];
  if (s.every((x) => x === first)) return 'steady';
  // fading: everything that disagrees is a suffix
  let i = s.length - 1;
  while (i > 0 && s[i] !== first) i--;
  const suffixOnly = s.slice(0, i + 1).every((x) => x === first);
  return suffixOnly ? 'fading' : 'mixed';
}
function combineHolding(a, b) {
  const list = [a, b].filter(Boolean);
  if (!list.length) return null;
  if (list.includes('mixed')) return 'mixed';
  if (list.includes('fading')) return 'fading';
  return 'steady';
}
function traitsAt(bandRead, layouts, trainLayout) {
  const g = bandRead.gaps;
  const trainParts = g[trainLayout];
  const train = trainParts ? trainParts[0] : null;
  const dirSign = train ? sgn(train.gapShare == null ? 0 : train.gapShare) : 0;
  const direction = dirSign < 0 ? 'reverting' : dirSign > 0 ? 'trending' : null;
  const holdOf = (field) => combineHolding(...layouts.map((l) => (g[l] ? holdingOf(g[l].map((p) => sgn(p[field] == null ? 0 : p[field]))) : null)));
  const often = holdOf('gapShare');
  const much = holdOf('gapMove');
  const holds = (h) => h === 'steady';
  const carrier = holds(often) && holds(much) ? 'both' : holds(often) ? 'often' : holds(much) ? 'much' : null;
  return { direction, holding: often, carrier, holdingMove: much };
}

// THE WHOLE READING OF ONE SHAPE OF ONE COIN (S2, S5, S6, S8).
function signalSummary(shapeRec, geometryKey, layouts, currentBand) {
  const move = Array.isArray(shapeRec && shapeRec.move) ? shapeRec.move : [];
  const out = Array.isArray(shapeRec && shapeRec.out) ? shapeRec.out : [];
  const n = move.length;
  const lays = layouts.slice();
  // the three-part layout is the one whose split has the fewest parts
  const trainLayout = lays.map((l) => ({ l, k: (() => { try { return coins.partsFor(100, l).length; } catch (_) { return Number.MAX_SAFE_INTEGER; } })() }))
    .sort((a, b) => a.k - b.k)[0].l;
  const k = overlapFactor(geometryKey);
  const grid = bandGrid();
  if (!n || out.length !== n) {
    return { grid: BAND_GRID, k, sweep: [], plateau: null, sweetSpot: null, traits: null, atCurrent: null, why: 'no decisions to read' };
  }
  const rec = { move, out };
  const sweep = grid.map((b) => readBand(rec, b, k, lays, trainLayout));
  const { smoothed, plateau, sweetSpot } = findPlateau(grid, sweep.map((s) => s.ratio));
  sweep.forEach((s, i) => { s.smoothed = smoothed[i]; });
  const atBand = sweetSpot ? sweetSpot.band : currentBand;
  const traitRead = grid.includes(atBand) ? sweep[grid.indexOf(atBand)] : readBand(rec, atBand, k, lays, trainLayout);
  const traits = traitsAt(traitRead, lays, trainLayout);
  const cur = grid.includes(currentBand) ? sweep[grid.indexOf(currentBand)] : readBand(rec, currentBand, k, lays, trainLayout);
  const anyRatio = sweep.some((s) => s.ratio != null);
  return {
    grid: BAND_GRID,
    k,
    trainLayout,
    sweep: sweep.map((s) => ({ band: s.band, called: s.called, ratio: s.ratio, smoothed: s.smoothed, edge: s.edge, chance: s.chance, perDecision: s.perDecision, judged: s.judged })),
    plateau,
    sweetSpot,
    traits,
    traitsAtBand: atBand,
    atCurrent: { band: currentBand, ratio: cur.ratio, edge: cur.edge, chance: cur.chance, called: cur.called, lean: cur.lean },
    why: anyRatio ? null : 'the train part never holds both colours, so no lean can be learned at any band',
  };
}

// THE INSTRUMENT CHECKED AGAINST ITSELF (S7): the outcomes dealt into a
// different order while the readings stay, so nothing links window to
// outcome. How often the analysis still finds a plateau is what a plateau is
// worth. Deterministic: same coin, same answer.
function shuffledCopy(arr, seed) {
  const out = arr.slice();
  let s = (seed >>> 0) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}
function plateauFalseAlarms(shapeRec, geometryKey, layouts, currentBand, trials = 50) {
  let found = 0;
  const ratios = [];
  for (let t = 0; t < trials; t++) {
    const cut = { move: shapeRec.move, out: shuffledCopy(shapeRec.out, 20260914 + t) };
    const s = signalSummary(cut, geometryKey, layouts, currentBand);
    if (s.plateau) { found++; ratios.push(s.plateau.meanRatio); }
  }
  return { trials, found, meanRatioWhenFound: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null };
}

module.exports = {
  BAND_GRID, PLATEAU_MIN_POINTS, CHANCE_BAR,
  bandGrid, overlapFactor, leansOn, edgeOn, readBand, smooth3, findPlateau,
  holdingOf, traitsAt, signalSummary, shuffledCopy, plateauFalseAlarms,
};
