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
const fs = require('fs');
const path = require('path');
const coins = require('./coins');
const { GEOMETRIES } = require('./dataset');

// THE BAND GRID, one home, served to the screen (B1). Fine enough that three
// consecutive points is a plateau and not the whole axis.
// THE GRID REACHES THE BANDS THE WALK CAN TRY (owner decision, 2026-09-18:
// "yes, grid should reach"). It stopped at 300 while `bands to try` on Walk it
// forward takes anything, and the owner has been running 200 to 500 -- so a
// band the walk could walk was one the plateau could never choose, and the two
// halves of the Coins screen were searching different spaces. 51 points now
// instead of 31, at the same step, which is 1.65x the sweep on a reading.
//
// AND IT IS THE OWNER'S TO SET (owner order, 2026-09-18: "PUT THAT GRID
// ONSCREEN AS A CONTROL"). It was three numbers frozen in this file, reachable
// from no screen, and the range `sweet spot band` can take was therefore one
// the owner could neither see nor originate -- RULE FIVE. The figures below are
// the BUILT-IN, used only until the owner sets their own; everything that reads
// the grid reads `bandGridNow()`, never the constant, so there is one home for
// the answer and the screen is it.
const BUILT_IN_GRID = Object.freeze({ from: 0, to: 500, step: 10 });
const GRID_KEY = 'coins_plateau_grid';
// A CEILING, not a curation: the sweep is run per coin per chunk shape on every
// reading, so a mistyped step of 0.1 is a job that never lands. 200 points is
// about four times what the built-in asks for, and the refusal says the number
// so the owner is never guessing at it.
const MAX_GRID_POINTS = 200;
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}
function gridPoints(g) { return Math.floor((g.to - g.from) / g.step) + 1; }
// ONE PLACE SAYS WHETHER A GRID IS A GRID, and it is used by the setter and by
// the reader both, so a value that could never be set can never be read either.
function gridOrRefuse(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const from = Number(g.from); const to = Number(g.to); const step = Number(g.step);
  if (!Number.isFinite(from) || from < 0) throw new Error(`the lowest band is 0 or more — not ${JSON.stringify(g.from)}`);
  if (!Number.isFinite(to) || to <= from) throw new Error(`the highest band is above the lowest (${from}) — not ${JSON.stringify(g.to)}`);
  if (!Number.isFinite(step) || step <= 0) throw new Error(`the step is above zero — not ${JSON.stringify(g.step)}`);
  const n = gridPoints({ from, to, step });
  if (n > MAX_GRID_POINTS) {
    throw new Error(`that is ${n} bands to search on every coin and chunk shape, and ${MAX_GRID_POINTS} is the most — widen the step, or narrow the range`);
  }
  return { from, to, step };
}
// THE GRID IN FORCE. A stored value that does not pass the same check the
// setter applies is ignored rather than obeyed -- a settings file edited by
// hand cannot start a sweep the screen would have refused.
function bandGridNow() {
  const raw = readSettings()[GRID_KEY];
  if (raw === undefined || raw === null) return BUILT_IN_GRID;
  try { return Object.freeze(gridOrRefuse(raw)); } catch (_) { return BUILT_IN_GRID; }
}
function setBandGrid(raw) {
  const g = gridOrRefuse(raw);
  const settings = readSettings();
  settings[GRID_KEY] = g;
  const tmp = `${SETTINGS_FILE}.tmp${process.pid}`;
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, SETTINGS_FILE);
  return { grid: g, points: gridPoints(g), note: 'read the coins again for this to reach the readings' };
}
function bandGrid() {
  const g = bandGridNow();
  const out = [];
  for (let b = g.from; b <= g.to; b += g.step) out.push(b);
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
//
// Chance's spread is the spread of EVERY outcome on the stretch, called or
// sat out (B10): that is the null the link cut deals from -- the outcomes
// dealt into a different order across all decisions -- and it does not shrink
// with the band. Read over the two or three decisions a wide band still
// calls, the spread once came out near zero and a ratio of 1264x with it.
//
// When both leans agree with the blind one, the colour-seeing trader makes
// every call the blind one makes: the edge is exactly nothing and so is its
// chance. That is a reading of 0, not a hole (B9). A hole is only a band
// where no lean can be learned or nothing is called.
function edgeOn(reading, out, from, to, leans, k) {
  const { dr, df, d1 } = leans;
  let nr = 0; let nf = 0; let sum = 0; let sq = 0; let all = 0; let seen = 0; let blind = 0;
  for (let i = from; i <= to; i++) {
    const c = reading[i];
    const o = Number(out[i]);
    if (Number.isFinite(o)) { sum += o; sq += o * o; all++; }
    if (c !== 'r' && c !== 'f') continue;
    if (c === 'r') { nr++; seen += dr * o; } else { nf++; seen += df * o; }
    blind += d1 * o;
  }
  const n = nr + nf;
  if (!n || !all || !leans.nr || !leans.nf) return { n, edge: null, chance: null, ratio: null, same: false };
  const same = dr === d1 && df === d1;
  const edge = (seen - blind) / n;
  const mean = sum / all;
  const sd = Math.sqrt(Math.max(0, sq / all - mean * mean));
  const chance = (sd * Math.sqrt(k) * Math.sqrt(((dr - d1) ** 2) * nr + ((df - d1) ** 2) * nf)) / n;
  if (same) return { n, edge: 0, chance: 0, ratio: 0, same };
  return { n, edge, chance, ratio: chance > 0 ? edge / chance : null, same };
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
    // true when the colour changes no call at this band: both leans are the blind one
    same: !!edge.same,
    // edge per decision of the whole stretch, called or not: what the band is
    // buying when it sits decisions out, read beside edge per called trade
    perDecision: edge.edge == null || !n ? null : edge.edge * (called / n),
  };
}

// THE PLATEAU, NOT THE SPIKE (S5). The ratio is smoothed three points wide
// (the ends use what exists); a plateau is the longest run of at least three
// consecutive grid points whose smoothed ratio reaches the bar; between runs
// of equal length, the one with the higher mean.
//
// THE SWEET SPOT FAVOURS BANDS THAT STILL TRADE (owner, 2026-09-14: "we want
// to favour bands that still trade"; B15). Every band of the plateau beats
// chance per called trade; the one to trade at is the band inside it that
// keeps the most edge PER DECISION of the whole stretch -- edge per called
// trade times the share called -- smoothed three wide like the ratio, the
// lower band on a tie. Without a per-decision edge to read (the tests' bare
// ratio lists) it is the middle point of the run, the lower middle when the
// run is even.
//
// A band with no reading stays a hole after smoothing (B11): a step that
// cannot be read cannot be one of three steps that beat chance together. Its
// neighbours smooth over what exists beside them. Before this, a hole took
// its neighbours' average and a run once spanned two holes, five points wide
// on three readings.
function smooth3(values) {
  return values.map((v, i) => {
    if (v == null || !Number.isFinite(v)) return null;
    const win = [values[i - 1], v, values[i + 1]].filter((x) => x != null && Number.isFinite(x));
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
}
function findPlateau(bands, ratios, perDecision = null) {
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
  let pick = mid;
  const pd = Array.isArray(perDecision) && perDecision.length === ratios.length ? smooth3(perDecision) : null;
  if (pd) {
    pick = -1;
    for (let i = best.from; i <= best.to; i++) {
      if (pd[i] == null) continue;
      if (pick < 0 || pd[i] > pd[pick]) pick = i;
    }
    if (pick < 0) pick = mid;
  }
  return {
    smoothed: sm,
    plateau: { fromBand: bands[best.from], toBand: bands[best.to], points: best.len, meanRatio: best.mean, middleBand: bands[mid] },
    sweetSpot: { band: bands[pick], ratio: ratios[pick], smoothedRatio: sm[pick], perDecision: pd ? pd[pick] : null },
  };
}

// THE TRAITS (S6), one word each, read at one band. The eight words have ONE
// home here: the screen prints them as marks, and the closed word list
// (tests/sweep-words.js) reads them from this object the way it reads the
// other values a screen prints out of the engine.
const TRAIT_WORDS = Object.freeze({
  reverting: 'reverting', trending: 'trending',
  steady: 'steady', fading: 'fading', mixed: 'mixed',
  often: 'often', much: 'much', both: 'both',
});
function holdingOf(signs) {
  // signs: per part in time order, +1/-1/0/null; null and 0 are skipped
  const s = signs.filter((x) => x != null && x !== 0);
  if (s.length < 2) return null;
  const first = s[0];
  if (s.every((x) => x === first)) return TRAIT_WORDS.steady;
  // fading: everything that disagrees is a suffix
  let i = s.length - 1;
  while (i > 0 && s[i] !== first) i--;
  const suffixOnly = s.slice(0, i + 1).every((x) => x === first);
  return suffixOnly ? TRAIT_WORDS.fading : TRAIT_WORDS.mixed;
}
function combineHolding(a, b) {
  const list = [a, b].filter(Boolean);
  if (!list.length) return null;
  if (list.includes(TRAIT_WORDS.mixed)) return TRAIT_WORDS.mixed;
  if (list.includes(TRAIT_WORDS.fading)) return TRAIT_WORDS.fading;
  return TRAIT_WORDS.steady;
}
function traitsAt(bandRead, layouts, trainLayout) {
  const g = bandRead.gaps;
  const trainParts = g[trainLayout];
  const train = trainParts ? trainParts[0] : null;
  const dirSign = train ? sgn(train.gapShare == null ? 0 : train.gapShare) : 0;
  const direction = dirSign < 0 ? TRAIT_WORDS.reverting : dirSign > 0 ? TRAIT_WORDS.trending : null;
  const holdOf = (field) => combineHolding(...layouts.map((l) => (g[l] ? holdingOf(g[l].map((p) => sgn(p[field] == null ? 0 : p[field]))) : null)));
  const often = holdOf('gapShare');
  const much = holdOf('gapMove');
  const holds = (h) => h === TRAIT_WORDS.steady;
  const carrier = holds(often) && holds(much) ? TRAIT_WORDS.both : holds(often) ? TRAIT_WORDS.often : holds(much) ? TRAIT_WORDS.much : null;
  return { direction, holding: often, carrier, holdingMove: much };
}

// THE THREE-PART LAYOUT is the one whose split has the fewest parts: its
// first part is train and everything after it is the judging stretch.
function trainLayoutOf(layouts) {
  return layouts.map((l) => ({ l, k: (() => { try { return coins.partsFor(100, l).length; } catch (_) { return Number.MAX_SAFE_INTEGER; } })() }))
    .sort((a, b) => a.k - b.k)[0].l;
}

// THE WHOLE READING OF ONE SHAPE OF ONE COIN (S2, S5, S6, S8).
// `dealt` is set only by the link-cut check: outcomes dealt into another
// order share no hours with their neighbours, so their overlap factor is 1
// (B13) -- with the shape's own k the dealt ratios came out a third too
// narrow on the 41-hour holds and every dealt plateau was rarer than it
// should be.
function signalSummary(shapeRec, geometryKey, layouts, currentBand, { dealt = false } = {}) {
  const move = Array.isArray(shapeRec && shapeRec.move) ? shapeRec.move : [];
  const out = Array.isArray(shapeRec && shapeRec.out) ? shapeRec.out : [];
  const n = move.length;
  const lays = layouts.slice();
  const trainLayout = trainLayoutOf(lays);
  const k = dealt ? 1 : overlapFactor(geometryKey);
  const grid = bandGrid();
  if (!n || out.length !== n) {
    return { grid: bandGridNow(), k, sweep: [], plateau: null, sweetSpot: null, traits: null, atCurrent: null, why: 'no decisions to read' };
  }
  const rec = { move, out };
  const sweep = grid.map((b) => readBand(rec, b, k, lays, trainLayout));
  const { smoothed, plateau, sweetSpot } = findPlateau(grid, sweep.map((s) => s.ratio), sweep.map((s) => s.perDecision));
  sweep.forEach((s, i) => { s.smoothed = smoothed[i]; });
  const atBand = sweetSpot ? sweetSpot.band : currentBand;
  const traitRead = grid.includes(atBand) ? sweep[grid.indexOf(atBand)] : readBand(rec, atBand, k, lays, trainLayout);
  const traits = traitsAt(traitRead, lays, trainLayout);
  const cur = grid.includes(currentBand) ? sweep[grid.indexOf(currentBand)] : readBand(rec, currentBand, k, lays, trainLayout);
  const anyRatio = sweep.some((s) => s.ratio != null);
  return {
    grid: bandGridNow(),
    k,
    trainLayout,
    sweep: sweep.map((s) => ({ band: s.band, called: s.called, ratio: s.ratio, smoothed: s.smoothed, edge: s.edge, chance: s.chance, perDecision: s.perDecision, judged: s.judged, same: s.same })),
    plateau,
    sweetSpot,
    traits,
    traitsAtBand: atBand,
    atCurrent: { band: currentBand, ratio: cur.ratio, edge: cur.edge, chance: cur.chance, called: cur.called, lean: cur.lean, same: cur.same },
    why: anyRatio ? null : 'the train part never holds both colours, so no lean can be learned at any band',
  };
}

// ONE BAND'S READING ON ITS OWN, shaped as `atCurrent`: what a shape drawn at
// its own sweet spot reports for that band, without a second sweep.
function atBand(shapeRec, geometryKey, layouts, band) {
  const move = Array.isArray(shapeRec && shapeRec.move) ? shapeRec.move : [];
  const out = Array.isArray(shapeRec && shapeRec.out) ? shapeRec.out : [];
  if (!move.length || out.length !== move.length) return null;
  const lays = layouts.slice();
  const cur = readBand({ move, out }, band, overlapFactor(geometryKey), lays, trainLayoutOf(lays));
  return { band, ratio: cur.ratio, edge: cur.edge, chance: cur.chance, called: cur.called, lean: cur.lean, same: cur.same };
}

// THE INSTRUMENT CHECKED AGAINST ITSELF (S7): the outcomes dealt into a
// different order while the readings stay, so nothing links window to
// outcome. How often the analysis still finds a plateau -- and one at least
// as strong as the real one -- is what a plateau is worth. Deterministic:
// same coin, same answer.
//
// THE DEAL STAYS INSIDE EACH PART (B13). Dealt across the whole history, a
// coin whose last years were wilder than its first (or calmer) got a judging
// stretch with the wrong spread: on one coin the dealt edges came out a
// third the size the closed form said, on another half again as big. Each
// part of the three-part layout keeps its own outcomes and only their order
// goes, so the dealt stretch has the real stretch's spread and drift and the
// only thing cut is the link between a window and its outcome.
//
// A plateau's STRENGTH is its width times its height: the number of grid
// points in the run times their mean smoothed ratio (B12). The review of
// 2026-09-13 found the bar of 1 across 31 bands still names a plateau in a
// quarter of the shuffles (up to half on the short weekly rows), so the count
// of any plateau says little; the count of one at least this strong is the
// number that says what the real one is worth.
function plateauStrength(plateau) {
  return plateau ? plateau.points * plateau.meanRatio : null;
}
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
function shuffledWithin(arr, parts, seed) {
  const out = arr.slice();
  let s = (seed >>> 0) || 1;
  for (const p of parts) {
    for (let i = p.to; i > p.from; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = p.from + (s % (i - p.from + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
  }
  return out;
}
function* dealtPlateaus(shapeRec, geometryKey, layouts, currentBand, trials) {
  const n = Array.isArray(shapeRec && shapeRec.out) ? shapeRec.out.length : 0;
  const parts = n ? partsOf(n, trainLayoutOf(layouts.slice())) : null;
  const deal = (seed) => (parts ? shuffledWithin(shapeRec.out, parts, seed) : shuffledCopy(shapeRec.out, seed));
  for (let t = 0; t < trials; t++) {
    const cut = { move: shapeRec.move, out: deal(20260914 + t) };
    yield signalSummary(cut, geometryKey, layouts, currentBand, { dealt: true }).plateau;
  }
}
function tallyDeals(trials, plateaus) {
  let found = 0;
  const ratios = [];
  const strengths = [];
  for (const p of plateaus) if (p) { found++; ratios.push(p.meanRatio); strengths.push(Number(plateauStrength(p).toFixed(3))); }
  return { trials, found, meanRatioWhenFound: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null, strengths };
}
function plateauFalseAlarms(shapeRec, geometryKey, layouts, currentBand, trials = 50) {
  return { ...tallyDeals(trials, [...dealtPlateaus(shapeRec, geometryKey, layouts, currentBand, trials)]), grid: { ...bandGridNow() } };
}
// THE SAME CHECK WITH CONTROL HANDED BACK BETWEEN DEALS (B16). A coin's read
// runs inside the service, and fifty deals on five shapes held it for six
// seconds a coin -- two minutes across the box -- during which it could
// answer nothing, so the screen's own asks timed out at the front door and it
// declared itself incomplete. Between deals the loop now yields to whatever
// else is waiting, so an ask waits for one deal, not for the whole read. The
// numbers are exactly those of plateauFalseAlarms: same deals, same seeds.
async function plateauFalseAlarmsYielding(shapeRec, geometryKey, layouts, currentBand, trials = 50) {
  const plateaus = [];
  for (const p of dealtPlateaus(shapeRec, geometryKey, layouts, currentBand, trials)) {
    plateaus.push(p);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { ...tallyDeals(trials, plateaus), grid: { ...bandGridNow() } };
}
// WHAT THE REAL PLATEAU IS WORTH against the stored shuffles: how many of them
// produced a plateau at least this strong. Null when there is no real plateau
// (then `found` alone is the reading) or no check was stored.
function linkCutWorth(plateau, linkCut) {
  if (!linkCut || !Array.isArray(linkCut.strengths)) return null;
  // A CHECK TAKEN ON A DIFFERENT GRID IS NOT THIS PLATEAU'S CHECK (3.169.0).
  // The deals are re-plateaued over whatever grid was in force when the coin
  // was read; widen the grid and the real plateau moves while the stored deals
  // do not. Saying which grid a check came from is a refusal to guess, not a
  // translation of it -- the answer is to read the coins again, and the screen
  // says so. A record from before the grid was stamped carries no grid at all
  // and is named the same way.
  const now = bandGridNow();
  const onGrid = !!(linkCut.grid && linkCut.grid.from === now.from
    && linkCut.grid.to === now.to && linkCut.grid.step === now.step);
  const strength = plateauStrength(plateau);
  const asStrong = strength == null ? null : linkCut.strengths.filter((w) => w >= strength - 1e-9).length;
  return {
    trials: linkCut.trials, found: linkCut.found, strength, asStrong, onGrid,
    grid: linkCut.grid || null, wantGrid: { ...now },
  };
}

module.exports = {
  BUILT_IN_GRID, MAX_GRID_POINTS, bandGridNow, setBandGrid, gridPoints, PLATEAU_MIN_POINTS, CHANCE_BAR, TRAIT_WORDS,
  bandGrid, overlapFactor, leansOn, edgeOn, readBand, smooth3, findPlateau,
  holdingOf, traitsAt, trainLayoutOf, signalSummary, atBand, shuffledCopy, shuffledWithin,
  plateauFalseAlarms, plateauFalseAlarmsYielding, plateauStrength, linkCutWorth,
};
