// THE DECISION FIELD'S ARITHMETIC (FIELD-DESIGN.md; owner LOOP NOW!
// 2026-09-21). Every test here runs the engine on a coin fabricated so the
// answer is known before the engine is asked -- and the strongest one holds
// the incremental engine to a recount written the slow, plain way.
const { assert } = require('./helpers');
const F = require('../lib/field');
const { mulberry32 } = require('../lib/rng');

const DAY = 86400000;
const HOUR = 3600000;
const T0 = 1600000000000;

// a coin: n daily decisions, close `holdH` hours after the decision instant
// (a daily shape's decision is its chunk start plus the entry offset; the
// engine only reads the two instants, so they are typed here directly)
function coinOf(n, { holdH = 17, seed = 1, outcome, extraMoves = {} } = {}) {
  const rnd = mulberry32(seed);
  const decisionTs = []; const closeTs = []; const out = []; const m24 = [];
  const extra = {};
  for (const h of Object.keys(extraMoves)) extra[h] = [];
  for (let i = 0; i < n; i++) {
    const ts = T0 + i * DAY;
    const move = (rnd() - 0.5) * 4;
    decisionTs.push(ts); closeTs.push(ts + holdH * HOUR);
    m24.push(move);
    for (const h of Object.keys(extraMoves)) extra[h].push(extraMoves[h](i, rnd, move));
    out.push(outcome(move, rnd, i));
  }
  return { decisionTs, closeTs, out, moves: { 24: m24, ...extra } };
}
const DIALS = { windowDays: 100, halfLifeDays: 40, floor: 0.1, bands: [10, 50, 100, 150, 200], lookbackHours: [24], evidenceCap: 30, leastEvidence: 0.5, copies: 0, seedText: 't' };

function theDialsAreCheckedInWords() {
  const bad = (over, words) => {
    let msg = '';
    try { F.checkDials({ ...DIALS, ...over }); } catch (err) { msg = err.message; }
    assert(msg.includes(words), `${JSON.stringify(over)} should refuse with "${words}", got "${msg}"`);
  };
  bad({ windowDays: 0 }, 'window, days');
  bad({ halfLifeDays: 'x' }, 'half-life, days');
  bad({ floor: 2 }, 'weight floor');
  bad({ bands: '' }, 'sit-out bands is empty');
  bad({ bands: '10, 10' }, 'repeats a value');
  bad({ lookbackHours: [24, -1] }, 'not a number above zero');
  bad({ leastEvidence: 40 }, 'least evidence (40) is above the evidence cap');
  const ok = F.checkDials({ ...DIALS, bands: '200, 50, 100' });
  assert.deepStrictEqual(ok.bands, [50, 100, 200], 'a typed list is sorted ascending');
}

// THE NO-LEAK RULE: with a 41-hour hold, yesterday's chunk has not closed at
// today's decision instant and must not be in the points; the day before has.
function aChunkEntersThePointsOnlyOnceItHasClosed() {
  // every move rising and the same size, so every day reads rising at the
  // 50 band and the yardstick is exactly 1
  const n = 6;
  const decisionTs = []; const closeTs = []; const m24 = [];
  for (let i = 0; i < n; i++) { decisionTs.push(T0 + i * DAY); closeTs.push(T0 + i * DAY + 41 * HOUR); m24.push(1); }
  // decision 0 has no yardstick (nothing before it) and so no reading: it
  // never enters a point. Decisions 1 and 2 carry the two outcomes.
  const out = [0, -3, 5, 0, 0, 0];
  const dials = { ...DIALS, halfLifeDays: 100000, bands: [50], leastEvidence: 0 };
  const got = F.buildField({ decisionTs, closeTs, out, moves: { 24: m24 } }, dials);
  // day 2 (48h): decision 1 closes at 24h + 41h = 65h, so nothing has closed that can speak
  assert.strictEqual(got.days[2].speaking, 0, 'on day 2 no chunk with a reading has closed, so no point speaks');
  // day 3 (72h): decision 1 has closed (65h) and it fell; decision 2 closes at 89h
  assert.strictEqual(got.days[3].sign, -1, 'on day 3 only decision 1 has closed, and it fell');
  // day 4 (96h): decision 2 has closed (89h) and its rise outweighs the fall
  assert.strictEqual(got.days[4].sign, 1, 'on day 4 decision 2 has closed, and its rise outweighs the fall');
}

// THE WINDOW SLIDES AND THE FLOOR HOLDS: early rises leave the window and the
// sign follows what is left; a decision older than the floor age still weighs
// exactly the floor.
function theWindowSlidesAndTheFloorHolds() {
  const n = 40;
  const decisionTs = []; const closeTs = []; const m24 = []; const out = [];
  for (let i = 0; i < n; i++) {
    decisionTs.push(T0 + i * DAY); closeTs.push(T0 + i * DAY + 17 * HOUR); m24.push(1);
    out.push(i < 10 ? 5 : -1);   // ten rises, then falls
  }
  const dials = { ...DIALS, windowDays: 12, halfLifeDays: 100000, bands: [50], leastEvidence: 0, evidenceCap: 0 };
  const got = F.buildField({ decisionTs, closeTs, out, moves: { 24: m24 } }, dials);
  assert.strictEqual(got.days[12].sign, 1, 'with the ten rises still in a 12-day window their +5s outweigh two -1s');
  assert.strictEqual(got.days[25].sign, -1, 'once every rise has left the window only falls remain');
  // the floor: half-life one day, floor 0.1 -- a 20-day-old decision weighs 0.1, not 2^-20
  const one = { ...dials, windowDays: 30, halfLifeDays: 1, floor: 0.1 };
  const g2 = F.buildField({ decisionTs, closeTs, out, moves: { 24: m24 } }, one);
  // on day 21, decisions 1..20 have closed (decision 0 had no reading);
  // ages 20..1 days; the weights are the floor for all but the newest three
  const day = g2.days[21];
  let expect = 0;
  for (let i = 1; i <= 20; i++) expect += F.weightAt((decisionTs[21] - decisionTs[i]) / DAY, 1, 0.1);
  assert(Math.abs(day.evidence - expect) < 1e-9, `evidence on day 21 is the sum of the floored weights (${expect}), not ${day.evidence}`);
  assert(expect > 20 * 0.1 && expect < 20 * 0.1 + 2, 'and most of that sum is the floor itself');
}

// THE STRONGEST CHECK: the incremental engine, with its epoch form and its
// re-base, agrees with a recount that does nothing clever -- every day, every
// point, from scratch. The half-life is set small enough that the exponent
// passes the re-base threshold inside the run.
function theEngineMatchesABruteForceRecount() {
  const dials = { windowDays: 25, halfLifeDays: 0.05, floor: 0.02, bands: [40, 120], lookbackHours: [24, 72], evidenceCap: 3, leastEvidence: 0.01, copies: 0, seedText: 'brute' };
  const coin = coinOf(90, { holdH: 41, seed: 11, outcome: (m, rnd) => (rnd() - 0.4) * 3, extraMoves: { 72: (i, rnd) => (i < 3 ? null : (rnd() - 0.5) * 6) } });
  const got = F.buildField(coin, dials);
  const { decisionTs, closeTs, out, moves } = coin;
  const n = decisionTs.length;
  const W = dials.windowDays * DAY;
  const wOf = (age) => Math.max(dials.floor, Math.pow(0.5, age / dials.halfLifeDays));
  const yard = (h, d) => {
    const rows = [];
    for (let j = 0; j < d; j++) {
      if (decisionTs[d] - decisionTs[j] > W) continue;
      const m = moves[h][j];
      if (m == null) continue;
      rows.push({ v: Math.abs(m), w: wOf((decisionTs[d] - decisionTs[j]) / DAY) });
    }
    rows.sort((a, b) => a.v - b.v);
    const total = rows.reduce((a, r) => a + r.w, 0);
    if (!(total > 0)) return null;
    let run = 0;
    for (const r of rows) { run += r.w; if (run >= total / 2) return r.v; }
    return rows[rows.length - 1].v;
  };
  const reading = (h, d) => {
    const m = moves[h][d]; const y = yard(h, d);
    if (m == null || !(y > 0)) return { s: 0, nb: 0 };
    let nb = 0;
    while (nb < dials.bands.length && Math.abs(m) > y * dials.bands[nb] / 100) nb++;
    return { s: nb > 0 ? Math.sign(m) : 0, nb };
  };
  const reads = dials.lookbackHours.map((h) => Array.from({ length: n }, (_, d) => reading(String(h), d)));
  for (let d = 0; d < n; d++) {
    let Fsum = 0; let Fabs = 0; let speaking = 0; let evidence = 0;
    for (let hi = 0; hi < dials.lookbackHours.length; hi++) {
      const today = reads[hi][d];
      if (today.s === 0) continue;
      for (let b = 0; b < today.nb; b++) {
        let total = 0; let weight = 0;
        for (let i = 0; i < d; i++) {
          if (closeTs[i] > decisionTs[d]) continue;
          if (decisionTs[d] - decisionTs[i] > W) continue;
          const r = reads[hi][i];
          if (r.s !== today.s || r.nb <= b) continue;
          const w = wOf((decisionTs[d] - decisionTs[i]) / DAY);
          total += out[i] * w; weight += w;
        }
        if (!(weight > 0) || weight < dials.leastEvidence) continue;
        const avg = total / weight;
        if (avg === 0) continue;
        const w = Math.min(weight, dials.evidenceCap);
        Fsum += avg * w; Fabs += Math.abs(avg) * w; speaking++; evidence += w;
      }
    }
    const day = got.days[d];
    assert.strictEqual(day.speaking, speaking, `day ${d}: ${speaking} points speak in the recount, the engine says ${day.speaking}`);
    assert.strictEqual(day.sign, Math.sign(Fsum), `day ${d}: the sign`);
    const agr = Fabs > 0 ? Math.abs(Fsum) / Fabs * 100 : 0;
    assert(Math.abs(day.agreement - agr) < 1e-7, `day ${d}: agreement ${agr} in the recount, engine ${day.agreement}`);
    assert(Math.abs(day.size - Math.abs(Fsum)) < 1e-7, `day ${d}: size ${Math.abs(Fsum)} in the recount, engine ${day.size}`);
    assert(Math.abs(day.evidence - evidence) < 1e-7, `day ${d}: evidence ${evidence} in the recount, engine ${day.evidence}`);
  }
  // and the run did cross the re-base threshold, or the check proved less than it claims
  const spanExponent = (decisionTs[n - 1] - decisionTs[0]) / (dials.halfLifeDays * DAY);
  assert(spanExponent > 500, `the half-life must be small enough to force a re-base (exponent ${spanExponent})`);
}

// A COIN WITH A SIGNAL IS TOLD FROM ONE WITHOUT: outcomes that follow the
// one-day move give a field that agrees more and ranks above its slid copies
// more often than a coin whose outcomes are noise. The look-backs are made
// independent, as real ones are, so the points are not one point repeated.
function theFieldTellsASignalFromNoise() {
  const dials = { windowDays: 200, halfLifeDays: 150, floor: 0.1, bands: [20, 60, 100, 150], lookbackHours: [24, 48, 96], evidenceCap: 30, leastEvidence: 2, copies: 30, seedText: 'signal' };
  const extras = { 48: (i, rnd) => (rnd() - 0.5) * 5, 96: (i, rnd) => (rnd() - 0.5) * 8 };
  const follow = F.buildField(coinOf(600, { seed: 5, outcome: (m, rnd) => Math.sign(m) * (0.5 + rnd()), extraMoves: extras }), dials);
  const noise = F.buildField(coinOf(600, { seed: 9, outcome: (m, rnd) => (rnd() - 0.5) * 2, extraMoves: extras }), dials);
  const rf = F.agreementRange(follow.days, 200);
  const rn = F.agreementRange(noise.days, 200);
  assert(rf.certainty.median > rn.certainty.median + 20, `certainty: signal median ${rf.certainty.median} should sit well above noise median ${rn.certainty.median}`);
  assert(rf.agreement.median > rn.agreement.median, `agreement: signal median ${rf.agreement.median} above noise median ${rn.agreement.median}`);
  assert(follow.now && follow.now.copies === 30, 'the null sets record the copies they were read against');
  assert(follow.now.slidesAsGood < noise.now.slidesAsGood || follow.now.slidesAsGood <= 3, `slides as good now: signal ${follow.now.slidesAsGood}, noise ${noise.now.slidesAsGood}`);
  assert(follow.now.scramblesAsGood != null, 'the scrambles are read on the last day');
  assert(follow.days.every((d) => d.certainty != null), 'certainty is on every day');
  // the state and the grid say what the screen will show
  assert.strictEqual(follow.grid.length, 3, 'one grid row per look-back');
  assert.strictEqual(follow.grid[0].length, 4, 'one grid column per band');
  assert(follow.state.pointsWithEvidence.rising > 0 && follow.state.pointsWithEvidence.of === 12, 'the state counts the points with evidence');
  assert(follow.state.full && follow.state.daysInWindow === 200, 'the state says the window is full and how many days it holds');
}

// A DAY IS LOOKED UP BY ITS INSTANT: the latest decision at or before it.
function theReadingOnADayIsLookedUpByItsInstant() {
  const days = [{ ts: 100 }, { ts: 200 }, { ts: 300 }];
  assert.strictEqual(F.readAt(days, 50), null, 'before the first day there is nothing');
  assert.strictEqual(F.readAt(days, 100).ts, 100, 'exactly on a day');
  assert.strictEqual(F.readAt(days, 250).ts, 200, 'between two days, the earlier');
  assert.strictEqual(F.readAt(days, 999).ts, 300, 'after the last, the last');
}

// THE SAME INPUTS GIVE THE SAME FIELD, every time, on any thread: the copies
// are seeded, so certainty is reproducible too.
function theBuildIsDeterministic() {
  const dials = { ...DIALS, copies: 5, lookbackHours: [24] };
  const coin = coinOf(150, { seed: 3, outcome: (m, rnd) => (rnd() - 0.5) * 2 });
  const a = F.buildField(coin, dials);
  const b = F.buildField(coin, dials);
  assert.deepStrictEqual(a.days, b.days, 'two builds of one coin agree on every day');
  assert.deepStrictEqual(a.now, b.now, 'and on the null sets');
}

// THE NULL SETS ARE READ OVER THE CURRENT WINDOW ON EVERY BUILD (owner order,
// 2026-09-21): on the last day, not the day the window first filled; and any
// process that consults them reads them on the day it asks about.
function theNullSetsAreReadOverTheCurrentWindowOnEveryBuild() {
  const dials = { windowDays: 120, halfLifeDays: 60, floor: 0.1, bands: [20, 60, 100], lookbackHours: [24, 48], evidenceCap: 30, leastEvidence: 2, copies: 12, seedText: 'now' };
  // a coin of noise, so certainty moves from day to day and two days can be told apart
  const coin = coinOf(400, { seed: 11, outcome: (m, rnd) => (rnd() - 0.5) * 2, extraMoves: { 48: (i, rnd) => (rnd() - 0.5) * 5 } });
  const built = F.buildField(coin, dials);
  const last = built.days[built.days.length - 1];
  assert(built.now, 'the null sets are read');
  assert.strictEqual(built.now.ts, last.ts, 'on the last day');
  assert.strictEqual(built.now.full, true);
  assert.strictEqual(built.now.copies, 12);
  assert.strictEqual(built.now.slidesAsGood, Math.round((100 - last.certainty) / 100 * 12), 'the slid copies as the last day ranked them');
  assert(built.now.scramblesAsGood >= 0 && built.now.scramblesAsGood <= 12);
  // an earlier full day whose certainty differs from the last day's, so the two cannot be confused
  assert(built.fullAtDay != null && built.fullAtDay < built.days.length - 1);
  const other = built.days.findIndex((d, i) => i >= built.fullAtDay && d.certainty !== last.certainty);
  assert(other >= 0, 'the check needs a day whose certainty differs from the last day\'s');
  // any process that consults them gets the same answer for the same day ...
  assert.deepStrictEqual(F.nullSetsAt(coin, dials), built.now, 'the last day, asked for on its own');
  assert.deepStrictEqual(F.nullSetsAt(coin, dials, built.days.length - 1), built.now);
  // ... and a different day is read on that day, with its own copies rolled to it
  const then = F.nullSetsAt(coin, dials, other);
  assert.strictEqual(then.ts, built.days[other].ts);
  assert.strictEqual(then.slidesAsGood, Math.round((100 - built.days[other].certainty) / 100 * 12));
  assert.notStrictEqual(then.slidesAsGood, built.now.slidesAsGood, 'a different day reads differently');
  // a scrambled copy exactly as good as the real field counts as good: with
  // no history in reach, every copy ties the real field at nothing
  const early = F.nullSetsAt(coin, dials, 0);
  assert.strictEqual(early.scramblesAsGood, 12, 'on the first day nothing has entered any point, so every scrambled copy ties the real field');
  assert.strictEqual(early.full, false);
}

module.exports = {
  theDialsAreCheckedInWords,
  aChunkEntersThePointsOnlyOnceItHasClosed,
  theWindowSlidesAndTheFloorHolds,
  theEngineMatchesABruteForceRecount,
  theFieldTellsASignalFromNoise,
  theReadingOnADayIsLookedUpByItsInstant,
  theBuildIsDeterministic,
  theNullSetsAreReadOverTheCurrentWindowOnEveryBuild,
};
