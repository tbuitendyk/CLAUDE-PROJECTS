// THE SIGNAL READING: per shape, the band sweep, the plateau, the sweet spot
// and the traits (LOOP-2026-09-14-SIGNAL.md section A; owner LOOP NOW!
// 2026-09-14). The rules these check were written in section A before any
// number existed, which is the only reason a green result here means anything.
const { assert, numberLiteralsIn } = require('./helpers');
const fs = require('fs');
const path = require('path');
const S = require('../lib/coinsignal');
const coins = require('../lib/coins');
const { GEOMETRIES } = require('../lib/dataset');

const LAYOUTS = ['split70', 'reserve61'];

// A LIST WITH A KNOWN LINK BETWEEN WINDOW AND OUTCOME. `pull` is how hard the
// outcome leans against the window's sign (negative: up after falling, the
// mean reversion the LTC review found); zero is pure noise.
function series(n, { pull = -0.35, seed = 99, noise = 4 } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const move = []; const out = [];
  for (let i = 0; i < n; i++) {
    const m = (rnd() - 0.5) * 6;
    move.push(Number(m.toFixed(4)));
    out.push(Number((pull * Math.sign(m) * Math.min(3, Math.abs(m)) + (rnd() - 0.5) * noise).toFixed(4)));
  }
  return { move, out };
}

// THE SWEEP IS A SETTING NOW, so a test that changes it must put the box back
// exactly as it found it -- including putting the file back to not having the
// key at all, which is not the same as having it set to the built-in.
function withBands(bands, fn) {
  const fs = require('fs'); const path = require('path');
  const f = path.join(__dirname, '..', 'data', 'settings.json');
  let before = null; let had = false;
  try { before = fs.readFileSync(f, 'utf8'); had = true; } catch (_) { /* no file yet */ }
  try {
    S.setSweepBands(bands);
    return fn();
  } finally {
    if (had) fs.writeFileSync(f, before);
    else { try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing to undo */ } }
  }
}

module.exports = {
  // THE SWEEP IS A LIST THE OWNER OWNS (owner order, 2026-09-19: "that field
  // becomes the truth of the matter, and how it's constructed with gaps and
  // extras etc. etc. is completely irrelevant").
  //
  // It began as three numbers frozen in the file, then three boxes; it is a
  // list now and the three boxes only fill it in. So the thing to check is not
  // that a range works but that an ARBITRARY list does -- gaps, one extra band
  // on its own, out of order -- and that every reader takes it.
  theSweepIsAListTheOwnerOwnsAndEveryReaderTakesIt() {
    withBands('0, 50, 60, 70, 500, 137', () => {
      assert.deepStrictEqual(S.sweepBands(), [0, 50, 60, 70, 137, 500],
        'a list with a gap and an extra is just a list, sorted and deduped');
      assert.deepStrictEqual(S.bandGrid(), [0, 50, 60, 70, 137, 500], 'and it is what the sweep walks');
      const r = S.signalSummary(series(600), 'daily-1d', LAYOUTS, 50);
      assert.deepStrictEqual(r.sweep.map((x) => x.band), [0, 50, 60, 70, 137, 500], 'and what a reading walks');
      assert.deepStrictEqual(r.grid, [0, 50, 60, 70, 137, 500], 'and a reading records the list it walked');
      // the check that refuses a reading taken on another sweep compares LISTS
      const same = S.linkCutWorth({ points: 3, meanRatio: 1.2 },
        { trials: 50, found: 1, strengths: [1.0], grid: [0, 50, 60, 70, 137, 500] });
      assert.strictEqual(same.onGrid, true, 'a check taken on this list is this plateau\'s check');
      assert.deepStrictEqual(same.wantGrid, [0, 50, 60, 70, 137, 500], 'and the panel is told which list it wants');
      const other = S.linkCutWorth({ points: 3, meanRatio: 1.2 },
        { trials: 50, found: 1, strengths: [1.0], grid: [0, 50, 60, 70, 500] });
      assert.strictEqual(other.onGrid, false, 'one band different is a different sweep');
      // AND A READING FROM BEFORE THE LIST carries the old from/to/step shape,
      // which is not a list and must be NAMED rather than compared
      const old = S.linkCutWorth({ points: 3, meanRatio: 1.2 },
        { trials: 50, found: 1, strengths: [1.0], grid: { from: 0, to: 500, step: 10 } });
      assert.strictEqual(old.onGrid, false, 'a reading taken before the sweep was a list is left out, not misread');
    });
  },

  // THE THREE BOXES ONLY FILL THE LIST IN; they are not the setting.
  theThreeBoxesMakeAListAndStoreNothing() {
    assert.deepStrictEqual(S.bandsFromRange(100, 300, 50), [100, 150, 200, 250, 300]);
    assert.deepStrictEqual(S.bandsFromRange(0, 10, 2.5), [0, 2.5, 5, 7.5, 10], 'a step need not be whole');
    const bad = [
      [[-1, 500, 10], /lowest sit-out band is 0 or more/],
      [[300, 300, 10], /highest sit-out band is above the lowest/],
      [[0, 500, 0], /step is above zero/],
      [[0, 500, 0.1], /5000 sit-out bands .* 200 is the most/],
    ];
    for (const [r, why] of bad) assert.throws(() => S.bandsFromRange(...r), why, `${JSON.stringify(r)} was accepted`);
  },

  // A TYPING MISTAKE IS REFUSED BY NAME, and a value that could never be SET is
  // never READ either: a settings file edited by hand cannot start a sweep the
  // screen would have refused.
  aSweepListThatCouldOnlyBeATypingMistakeIsRefusedByName() {
    const bad = [
      ['', /at least one sit-out band/],
      ['0,abc', /a sit-out band is a number of 0 or more — not "abc"/],
      ['-5,10', /a sit-out band is a number of 0 or more — not "-5"/],
      [Array.from({ length: 201 }, (_, i) => i), /201 sit-out bands .* 200 is the most/],
    ];
    for (const [g, why] of bad) assert.throws(() => S.setSweepBands(g), why, `${JSON.stringify(g)} was accepted`);
    const fs = require('fs'); const path = require('path');
    const f = path.join(__dirname, '..', 'data', 'settings.json');
    let before = null; let had = false;
    try { before = fs.readFileSync(f, 'utf8'); had = true; } catch (_) { /* none */ }
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ ...(had ? JSON.parse(before) : {}), coins_sweep_bands: ['abc'] }));
      assert.deepStrictEqual(S.sweepBands(), S.BUILT_IN_BANDS.slice(),
        'a sweep nobody could have set through the screen falls back to the built-in rather than running');
    } finally {
      if (had) fs.writeFileSync(f, before); else { try { fs.rmSync(f, { force: true }); } catch (_) { /* none */ } }
    }
  },

  // AND NO READER KEPT A COPY. The fault this replaces is a number frozen in
  // one file and read from several; a second frozen copy would bring it back.
  theGridIsNotFrozenAnywhereAReaderCanSeeIt() {
    const fs = require('fs'); const path = require('path');
    const ROOT = path.join(__dirname, '..');
    const bad = [];
    for (const rel of ['lib/coinsrun.js', 'lib/coinscan.js', 'lib/stages.js', 'server.js', 'public/construct.js']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (/BAND_GRID|bandGridNow/.test(src)) bad.push(`${rel} keeps its own idea of the sweep`);
    }
    assert.deepStrictEqual(bad, [], `the grid has one home and these kept their own copy: ${bad.join('; ')}`);
  },

  // S2: the grid has one home and is what the sweep walks. Since 3.173.0 that
  // home is a setting the owner sets on Coins, so the test reads what is IN
  // FORCE rather than a constant -- a check written against the built-in would
  // pass on a box whose owner had changed it and prove nothing.
  theBandGridHasOneHomeAndTheSweepWalksAllOfIt() {
    const grid = S.bandGrid();
    const now = S.sweepBands();
    assert.deepStrictEqual(grid, now, 'the sweep walks exactly the bands in force, in order');
    const r = S.signalSummary(series(600), 'daily-1d', LAYOUTS, 50);
    assert.deepStrictEqual(r.sweep.map((x) => x.band), grid, 'the sweep must visit every band of the list, in order');
    assert.deepStrictEqual(r.grid, now, 'and say which list it walked');
    // called share falls as the band widens, never rises
    for (let i = 1; i < r.sweep.length; i++) assert.ok(r.sweep[i].called <= r.sweep[i - 1].called + 1e-12, `called share rose from band ${r.sweep[i - 1].band} to ${r.sweep[i].band}`);
    assert.strictEqual(r.sweep[0].called, 1, 'at band 0 every decision that moved at all is called');
  },

  // S4: the overlap factor is read off the shape's own hours
  theOverlapFactorIsReadOffTheShapeNeverTyped() {
    for (const [key, g] of Object.entries(GEOMETRIES)) {
      const hold = g.exitOffsetH - g.entryOffsetH;
      const want = 1 + (2 * Math.max(0, hold - g.stepHours)) / hold;
      assert.ok(Math.abs(S.overlapFactor(key) - want) < 1e-12, `${key}: k must be 1 + 2·max(0, hold − step)/hold`);
    }
    assert.strictEqual(S.overlapFactor('daily-1d'), 1, 'a hold inside its own step overlaps nothing');
    assert.strictEqual(S.overlapFactor('weekly-8d'), 1);
    assert.ok(S.overlapFactor('daily-4d') > 1.5, 'a 41-hour hold on a 24-hour step overlaps');
    assert.throws(() => S.overlapFactor('not-a-shape'), /unknown chunk shape/);
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsignal.js'), 'utf8');
    const body = src.slice(src.indexOf('function overlapFactor'), src.indexOf('const sgn'));
    assert.deepStrictEqual(numberLiteralsIn(body).filter((v) => v > 2), [], 'no hold or step is typed into the overlap factor');
  },

  // S3: the two-way edge, by hand on a tiny stretch
  theTwoWayEdgeIsWhatTheColourSeeingTraderKeepsBeyondTheBlindOne() {
    // train: after r the outcome sums positive, after f negative -> leans +1 / -1, blind +1 (total +0.5)
    const reading = 'rrffrf' + 'rfrfrf';
    const out = [1, 2, -1, -1.5, 0.5, -0.5, /* judge: */ 2, -2, 1, -1, 1, -1];
    const leans = S.leansOn(reading, out, 0, 5);
    assert.deepStrictEqual({ dr: leans.dr, df: leans.df, d1: leans.d1 }, { dr: 1, df: -1, d1: 1 });
    const e = S.edgeOn(reading, out, 6, 11, leans, 1);
    // colour-seeing: +2 +2 +1 +1 +1 +1 = 8; blind: 2-2+1-1+1-1 = 0; edge per trade = 8/6
    assert.ok(Math.abs(e.edge - 8 / 6) < 1e-12, `edge must be 8/6, got ${e.edge}`);
    assert.strictEqual(e.n, 6);
    // chance: sd of the six outcomes (mean 0, sq mean 2 -> sd sqrt 2), k=1,
    // sqrt((1-1)^2*3 + (-1-1)^2*3) = sqrt 12, / 6
    const want = Math.sqrt(2) * Math.sqrt(12) / 6;
    assert.ok(Math.abs(e.chance - want) < 1e-12, `chance must be ${want}, got ${e.chance}`);
    assert.ok(Math.abs(e.ratio - (8 / 6) / want) < 1e-12);
    // a train part with one colour missing learns no lean for it: no ratio
    const one = S.leansOn('rrrrrr', out, 0, 5);
    assert.strictEqual(S.edgeOn(reading, out, 6, 11, one, 1).ratio, null, 'no lean for a missing colour, no ratio');
    // the overlap factor widens chance and shrinks the ratio, never the edge
    const wide = S.edgeOn(reading, out, 6, 11, leans, 4);
    assert.ok(Math.abs(wide.edge - e.edge) < 1e-12 && Math.abs(wide.chance - 2 * e.chance) < 1e-12, 'k=4 doubles chance and leaves the edge alone');
    // B9: when both leans are the blind one the colour changes no call -- a
    // reading of 0, never a hole
    const agree = S.edgeOn(reading, out, 6, 11, { dr: 1, df: 1, d1: 1, nr: 3, nf: 3 }, 1);
    assert.deepStrictEqual([agree.ratio, agree.edge, agree.same], [0, 0, true], 'leans that all agree read 0, and say so');
    // B10: chance's spread is the spread of EVERY outcome on the stretch,
    // called or sat out -- the null the link cut deals from
    const withSitOut = 'rrffrf' + 'rfssss';
    const o2 = [1, 2, -1, -1.5, 0.5, -0.5, /* judge: */ 2, -2, 10, -10, 10, -10];
    const e2 = S.edgeOn(withSitOut, o2, 6, 11, leans, 1);
    // called: r(2) f(-2): seen = 2 + 2 = 4, blind = 0, edge = 2; sd over all six
    // judged outcomes = sqrt((4+4+100*4)/6) = sqrt(68), Σ = 4*1 -> chance = sqrt(68)*2/2
    assert.ok(Math.abs(e2.edge - 2) < 1e-12);
    assert.ok(Math.abs(e2.chance - Math.sqrt(68)) < 1e-9, `chance must read the spread of all six outcomes, got ${e2.chance}`);
    assert.strictEqual(e2.n, 2, 'and the edge is still per called trade');
  },

  // S5: the plateau is the longest run of three or more smoothed points at
  // the bar, and the sweet spot is its middle, never its peak
  thePlateauIsTheMiddleOfTheLongestRunNeverTheSpike() {
    const bands = S.bandGrid();
    // a spike at one band, then a long plateau later
    const ratios = bands.map((b) => (b === 20 ? 9 : (b >= 120 && b <= 200 ? 1.3 : 0.2)));
    const r = S.findPlateau(bands, ratios);
    assert.ok(r.plateau, 'a nine-point run at 1.3 is a plateau');
    assert.strictEqual(r.sweetSpot.band, 160, `with no per-decision edge the sweet spot is the middle of 120..200, got ${r.sweetSpot.band}`);
    assert.strictEqual(r.plateau.middleBand, 160);
    assert.ok(r.sweetSpot.band !== 20, 'the spike at 20 must never be chosen');
    // B15: the sweet spot favours bands that still trade -- inside the plateau,
    // the band with the most edge per decision (smoothed three wide), never a
    // band outside it however much it keeps, the lower band on a tie
    const perDecision = bands.map((b) => (b === 20 ? 9 : b === 130 ? 0.9 : b === 140 ? 0.9 : b >= 120 && b <= 200 ? 0.5 : 0.1));
    const f = S.findPlateau(bands, ratios, perDecision);
    assert.deepStrictEqual([f.plateau.fromBand, f.plateau.toBand], [r.plateau.fromBand, r.plateau.toBand], 'the plateau itself is unchanged');
    assert.strictEqual(f.sweetSpot.band, 130, `the band inside the plateau with the most edge per decision, the lower on a tie, got ${f.sweetSpot.band}`);
    assert.ok(f.sweetSpot.perDecision > 0.5, 'and the line carries that edge');
    assert.strictEqual(f.plateau.middleBand, 160, 'the middle is still named');
    // the spike alone is no plateau: smoothed, one point at 9 between 0.2s is (0.2+9+0.2)/3 = 3.1 at 20 and (0.2+0.2+9)/3 at 10, 30 -> three points reach the bar? check the rule holds it to width
    const spikeOnly = bands.map((b) => (b === 20 ? 9 : 0.2));
    const r2 = S.findPlateau(bands, spikeOnly);
    // smoothing spreads a spike to three points; the rule is width in SMOOTHED
    // points, so a single wild band does become a three-point run. That is why
    // the review measures false alarms (S7): the record says so.
    assert.ok(r2.plateau == null || r2.plateau.points === 3, 'a lone spike can at most make a three-point run after smoothing');
    // two points at the bar are not a plateau
    const two = bands.map((b) => (b === 100 || b === 110 ? 1.05 : 0));
    assert.strictEqual(S.findPlateau(bands, two).plateau, null, 'two points at the bar are not a plateau');
    // ties on length go to the higher mean
    const tie = bands.map((b) => ((b >= 0 && b <= 40) ? 1.1 : (b >= 200 && b <= 240 ? 1.6 : 0)));
    assert.strictEqual(S.findPlateau(bands, tie).sweetSpot.band, 220, 'between two runs of one length, the higher mean wins');
    // nothing at the bar, no plateau, and the sweep still says so
    assert.strictEqual(S.findPlateau(bands, bands.map(() => 0.5)).plateau, null);
    // the smoothing is three wide and uses what exists at the ends
    assert.deepStrictEqual(S.smooth3([1, 2, 3]), [1.5, 2, 2.5]);
    // B11: a hole stays a hole; its neighbours smooth over what exists
    assert.deepStrictEqual(S.smooth3([1, null, 3]), [1, null, 3], 'a band with no reading is not given its neighbours\' average');
    const holed = bands.map((b) => (b >= 100 && b <= 140 ? (b === 120 ? null : 1.5) : 0));
    assert.strictEqual(S.findPlateau(bands, holed).plateau, null, 'two readings either side of a hole are not three steps together');
    // a 0 (the colour changes no call) is a reading: it is smoothed with its
    // neighbours like any other, and pulls a run of 1.2s under the bar
    const zeroed = bands.map((b) => (b >= 100 && b <= 140 ? (b === 120 ? 0 : 1.2) : 0));
    assert.strictEqual(S.findPlateau(bands, zeroed).plateau, null, 'a 0 in the middle of 1.2s pulls the run under the bar');
    const dipped = bands.map((b) => (b >= 100 && b <= 140 ? (b === 120 ? 0 : 1.5) : 0));
    assert.ok(S.findPlateau(bands, dipped).plateau, 'a 0 between 1.5s is smoothed to the bar and the run holds: a dip, not a hole');
  },

  // S6: the traits, by hand
  theTraitsAreReadOffTheGapSignsAcrossTheParts() {
    assert.strictEqual(S.holdingOf([-1, -1, -1]), 'steady');
    assert.strictEqual(S.holdingOf([-1, -1, 1]), 'fading', 'disagreement only at the end is fading');
    assert.strictEqual(S.holdingOf([-1, -1, 1, 1]), 'fading');
    assert.strictEqual(S.holdingOf([-1, 1, -1]), 'mixed');
    assert.strictEqual(S.holdingOf([-1, null, 0, -1]), 'steady', 'a part with no gap is skipped, not counted against');
    assert.strictEqual(S.holdingOf([-1]), null, 'one sign says nothing about holding');
    const g = (parts) => ({ split70: parts.slice(0, 3), reserve61: parts });
    const mk = (shares, moves) => ({ gaps: g(shares.map((s, i) => ({ gapShare: s, gapMove: moves[i] }))) });
    const t1 = S.traitsAt(mk([-0.1, -0.08, -0.12, -0.09], [-1, -1, -1, -1]), LAYOUTS, 'split70');
    assert.deepStrictEqual([t1.direction, t1.holding, t1.carrier], ['reverting', 'steady', 'both']);
    const t2 = S.traitsAt(mk([0.1, 0.08, -0.12, -0.09], [1, 1, 1, 1]), LAYOUTS, 'split70');
    assert.deepStrictEqual([t2.direction, t2.holding, t2.carrier], ['trending', 'fading', 'much'], 'points fade at the end while the move holds: the carrier is the move');
    const t3 = S.traitsAt(mk([0.0, 0.1, -0.1, 0.1], [0.5, -0.5, 0.5, -0.5]), LAYOUTS, 'split70');
    assert.deepStrictEqual([t3.direction, t3.holding, t3.carrier], [null, 'mixed', null]);
    // the eight words have one home, and every trait the reading prints is one of them
    assert.deepStrictEqual(Object.values(S.TRAIT_WORDS).sort(), ['both', 'fading', 'mixed', 'much', 'often', 'reverting', 'steady', 'trending']);
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsignal.js'), 'utf8');
    const traitsBody = src.slice(src.indexOf('function holdingOf'), src.indexOf('// THE WHOLE READING'));
    for (const w of Object.values(S.TRAIT_WORDS)) assert.ok(!new RegExp(`'${w}'`).test(traitsBody), `'${w}' is typed again in the traits instead of read from TRAIT_WORDS`);
  },

  // S1 + S8: a built-in signal is found, noise is not, and every shape gets an answer
  aBuiltInSignalIsFoundAndNoiseIsNotAndNothingIsRefused() {
    const on = S.signalSummary(series(1800, { pull: -0.35 }), 'daily-3d', LAYOUTS, 50);
    assert.ok(on.plateau, 'a built-in reversion must show a plateau');
    assert.ok(on.sweetSpot && on.sweetSpot.ratio > 1, 'and a sweet spot that beats chance');
    assert.deepStrictEqual([on.traits.direction, on.traits.holding], ['reverting', 'steady']);
    assert.strictEqual(on.trainLayout, 'split70', 'the leans are learned on the three-part layout\'s train');
    const off = S.signalSummary(series(1800, { pull: 0 }), 'daily-3d', LAYOUTS, 50);
    assert.ok(!off.plateau || off.plateau.meanRatio < 1.3, `pure noise must not read as a clear plateau (got ${JSON.stringify(off.plateau)})`);
    assert.ok(off.atCurrent && off.atCurrent.band === 50, 'the band the box is set to is reported too');
    // nothing refused: an empty shape and a train part with one colour still answer
    const empty = S.signalSummary({ move: [], out: [] }, 'daily-1d', LAYOUTS, 50);
    assert.ok(empty.why && empty.sweep.length === 0, 'no decisions: a sentence, not a throw');
    const oneColour = S.signalSummary({ move: new Array(300).fill(5), out: new Array(300).fill(1) }, 'daily-1d', LAYOUTS, 50);
    assert.ok(oneColour.why && /both colours/.test(oneColour.why), `one colour only: a sentence saying why, got ${oneColour.why}`);
    // S1: the summary never rewrites the record it read
    const rec = series(400);
    const before = JSON.stringify(rec);
    S.signalSummary(rec, 'daily-2d', LAYOUTS, 50);
    assert.strictEqual(JSON.stringify(rec), before, 'the analysis must not rewrite the record');
  },

  // S7: with the link cut, a plateau is rare; and the check is deterministic
  async withTheLinkCutAPlateauIsRareAndTheCheckIsDeterministic() {
    const rec = series(1800, { pull: -0.35 });
    const a = S.plateauFalseAlarms(rec, 'daily-3d', LAYOUTS, 50, 20);
    const b = S.plateauFalseAlarms(rec, 'daily-3d', LAYOUTS, 50, 20);
    assert.deepStrictEqual(a, b, 'same coin, same answer');
    assert.strictEqual(a.trials, 20);
    assert.ok(a.found < a.trials / 2, `with the link cut a plateau must be the exception, found ${a.found} of ${a.trials}`);
    // B12: every shuffled plateau's strength (points × mean ratio) is kept, and
    // the real one is judged against them
    assert.strictEqual(a.strengths.length, a.found, 'one strength per plateau found');
    const real = S.signalSummary(rec, 'daily-3d', LAYOUTS, 50).plateau;
    assert.ok(Math.abs(S.plateauStrength(real) - real.points * real.meanRatio) < 1e-12, 'strength is width times height');
    const worth = S.linkCutWorth(real, a);
    assert.strictEqual(worth.trials, 20);
    assert.strictEqual(worth.found, a.found);
    assert.ok(worth.asStrong <= worth.found, 'as-strong can never exceed found');
    assert.strictEqual(worth.asStrong, 0, `a built-in signal must beat every shuffled plateau, got ${worth.asStrong}`);
    assert.strictEqual(S.linkCutWorth(null, a).asStrong, null, 'no real plateau: found alone is the reading');
    assert.strictEqual(S.linkCutWorth(real, null), null, 'no stored check: nothing to say');
    assert.strictEqual(S.linkCutWorth({ points: 3, meanRatio: 0.0001 }, a).asStrong, a.found, 'a plateau weaker than every shuffled one is beaten by all of them');
    const fake = { trials: 3, found: 3, strengths: [3, 6, 9] };
    assert.strictEqual(S.linkCutWorth({ points: 5, meanRatio: 1 }, fake).asStrong, 2, 'strength 5 against 3, 6, 9: two are at least as strong');
    // B16: the same check with control handed back between deals gives the
    // same numbers, and actually hands control back
    const busy = { turns: 0 };
    const tick = setInterval(() => { busy.turns++; }, 1);
    const y = await S.plateauFalseAlarmsYielding(rec, 'daily-3d', LAYOUTS, 50, 20);
    clearInterval(tick);
    assert.deepStrictEqual(y, a, 'yielding changes no number');
    assert.ok(busy.turns >= 5, `the timer must get turns while the deals run, got ${busy.turns}`);
    // B13: the deal stays inside each part of the three-part layout, and a
    // dealt series has no overlap
    const parts = require('../lib/coins').layoutParts(rec.out.length, S.trainLayoutOf(LAYOUTS)).parts;
    const within = S.shuffledWithin(rec.out, parts, 7);
    for (const p of parts) {
      assert.deepStrictEqual(within.slice(p.from, p.to + 1).sort(), rec.out.slice(p.from, p.to + 1).sort(), `${p.name} keeps its own outcomes`);
    }
    assert.notDeepStrictEqual(within, rec.out, 'and their order goes');
    assert.strictEqual(S.signalSummary(rec, 'daily-3d', LAYOUTS, 50, { dealt: true }).k, 1, 'a dealt series shares no hours: k is 1');
    assert.ok(S.signalSummary(rec, 'daily-3d', LAYOUTS, 50).k > 1.5, 'the real one keeps the shape\'s overlap');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsignal.js'), 'utf8');
    assert.ok(/signalSummary\(cut, geometryKey, layouts, currentBand, \{ dealt: true \}\)/.test(src), 'the check deals with dealt: true');
    // the shuffle keeps every outcome and only moves them
    const sh = S.shuffledCopy(rec.out, 5);
    assert.deepStrictEqual(sh.slice().sort(), rec.out.slice().sort(), 'a shuffle keeps the same numbers');
    assert.notDeepStrictEqual(sh, rec.out, 'and changes the order');
  },

  // S8 + B2: the only bar in the file is chance's own, and no share is typed
  theOnlyBarIsChanceItselfAndNoShareIsTyped() {
    assert.strictEqual(S.CHANCE_BAR, 1, 'the bar is edge equal to chance, nothing else');
    assert.strictEqual(S.PLATEAU_MIN_POINTS, 3);
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsignal.js'), 'utf8');
    const nums = numberLiteralsIn(src);
    for (const v of [0.13, 0.15, 0.61, 0.7, 0.74, 0.85]) assert.ok(!nums.includes(v), `a layout share (${v}) is typed into the analysis`);
    // and the parts come from lib/coins, which comes from the engine
    assert.ok(/coins\.layoutParts\(/.test(src) && !/splitBounds|reserveChunks/.test(src), 'the parts must come through lib/coins, never a second split');
  },
};
