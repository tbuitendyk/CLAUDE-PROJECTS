const { assert } = require('./helpers');
const { comboViews, simBracket, simMarket, holdControls, simCell, execSweep, bestCell, PER_ASSET, ENTRIES, D_MULTS, T_HOURS, GATES, TRAIL_MULTS, ARM_MULTS } = require('../lib/bracket');
const { pnlAt } = require('../lib/paper');
const { classifierMetrics } = require('../lib/metrics');
const { expandBracketPlan, validateDeclared, declaredQuorumFor, promotionSet } = require('../lib/batch');
const { GEOMETRIES } = require('../lib/dataset');

const HOUR_MS = 3_600_000;
const geo = GEOMETRIES['daily-3d']; // entry +73h

// Synthetic hourly map: candles from a spec of {offsetH: [open, high, low]}.
function mapFrom(t0, bars) {
  const m = new Map();
  for (const [h, [open, high, low]] of Object.entries(bars)) {
    m.set(t0 + geo.entryOffsetH * HOUR_MS + Number(h) * HOUR_MS, { open, high, low, close: open });
  }
  return m;
}
const period = (t0) => [{ startTs: t0 }];
const FEE = 0.125;

module.exports = {
  async bracketFillsAndTimeExit() {
    const t0 = Date.UTC(2024, 0, 1);
    // p=100; d=2% → buy rail 102 / sell rail 98. Bar1 touches 103 (long at
    // 102, never near 98), then quiet until the 17h exit candle opens at 105.
    const bars = { 0: [100, 101, 99.5], 1: [101, 103, 100.5], 17: [105, 105, 104] };
    for (let h = 2; h < 17; h++) bars[h] = [101, 101.5, 100.5];
    const m = mapFrom(t0, bars);
    const r = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    assert.strictEqual(r.trades, 1);
    assert.strictEqual(r.stops, 0);
    assert.strictEqual(r.ambiguous, 0);
    assert.ok(Math.abs(r.pnl - (100 * (105 / 102 - 1) - 0.25)) < 1e-9);
    assert.strictEqual(r.wins, 1);
  },
  async bracketStopOut() {
    const t0 = Date.UTC(2024, 0, 1);
    const bars = { 0: [100, 102.5, 99.5], 5: [99, 99.5, 97], 17: [104, 104, 103] };
    for (const h of [1, 2, 3, 4]) bars[h] = [101, 101.5, 100.5];
    const m = mapFrom(t0, bars);
    const r = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    // long at 102 (bar0 high 102.5), stopped at 98 in bar5
    assert.strictEqual(r.trades, 1);
    assert.strictEqual(r.stops, 1);
    assert.ok(Math.abs(r.pnl - (100 * (98 / 102 - 1) - 0.25)) < 1e-9);
    assert.strictEqual(r.wins, 0);
  },
  async ambiguousBarResolvesAgainstTheBook() {
    const t0 = Date.UTC(2024, 0, 1);
    // one violent bar spans BOTH rails before entry → pessimistic rule:
    // entered long at 102, stopped at 98 inside the same bar, counted
    const m = mapFrom(t0, { 0: [100, 103, 97] });
    const r = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    assert.strictEqual(r.trades, 1);
    assert.strictEqual(r.ambiguous, 1);
    assert.strictEqual(r.stops, 1);
    assert.ok(Math.abs(r.pnl - (100 * (98 / 102 - 1) - 0.25)) < 1e-9);
  },
  async gatesControlWhichRailsExist() {
    const t0 = Date.UTC(2024, 0, 1);
    // bar touches ONLY the sell rail; directional gate long → no entry
    const down = mapFrom(t0, { 0: [100, 100.5, 97.5], 17: [98, 98, 97] });
    const long = simBracket(period(t0), [1], down, geo, { dPct: 2, tHours: 17, gate: 'directional', feePerLeg: FEE });
    assert.strictEqual(long.trades, 0);
    // same bar, directional short → short at 98, time exit at 98 open… use a
    // later bar so the exit differs from entry
    const down2 = mapFrom(t0, { 0: [100, 100.5, 97.5], 17: [96, 96, 95] });
    const short = simBracket(period(t0), [-1], down2, geo, { dPct: 2, tHours: 17, gate: 'directional', feePerLeg: FEE });
    assert.strictEqual(short.trades, 1);
    assert.ok(Math.abs(short.pnl - (100 * (1 - 96 / 98) - 0.25)) < 1e-9);
    // active gate with a dormant call places nothing
    const active = simBracket(period(t0), [0], down2, geo, { dPct: 2, tHours: 17, gate: 'active', feePerLeg: FEE });
    assert.strictEqual(active.trades, 0);
    // always gate ignores the call entirely
    const always = simBracket(period(t0), [0], down2, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    assert.strictEqual(always.trades, 1);
  },
  async comboLayoutsCompose() {
    const nDays = 3;
    const P = PER_ASSET(nDays); // 15
    const s1 = comboViews(1, nDays);
    const s2 = comboViews(2, nDays);
    const s3 = comboViews(3, nDays);
    assert.strictEqual(s1.featureCount, P);
    assert.strictEqual(s2.featureCount, 2 * P + 4);
    assert.strictEqual(s3.featureCount, 3 * P + 8);
    assert.strictEqual(s1.views.cross, null); // nothing to cross on a single
    assert.strictEqual(s2.views.cross.length, 4);
    assert.strictEqual(s3.views.cross.length, 8); // AB cross + AC cross
    // full views cover the whole layout exactly once
    assert.strictEqual(s1.views.full.length, P);
    assert.strictEqual(s3.views.full.length, 3 * P + 8);
    assert.strictEqual(new Set(s3.views.full).size, 3 * P + 8);
    // every triple index in range
    for (const i of s3.views.full) assert.ok(i >= 0 && i < s3.featureCount);
  },
  async planMathAndWeeklySkip() {
    const plan = expandBracketPlan({
      universe: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      sizes: { singles: true, doubles: true, triples: true },
      permute: { geometry: false, decision: false, band: false, weekdays: false },
      set: { geometry: 'daily-3d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
    });
    // 8 singles + 8·7 doubles + 8·C(7,2) triples = 8 + 56 + 168
    assert.strictEqual(plan.combos.length, 8 + 56 + 168);
    assert.strictEqual(plan.branches.length, 1);
    const perm = expandBracketPlan({
      universe: ['A'],
      sizes: { singles: true, doubles: false, triples: false },
      permute: { geometry: true, decision: true, band: true, weekdays: true },
      set: {},
    });
    // 5 geo × 2 dec × 4 band × 2 wd = 80, minus weekly+24/5 duplicates (8)
    assert.strictEqual(perm.branches.length, 72);
  },
  async declaredConfigTravelsAsARatio() {
    // Replication mode: the declared quorum is a FRACTION of the member set,
    // so row 9's 4-of-12 means the same thing on a 16-member combo.
    const dec = validateDeclared({ gate: 'directional', dMult: 1.5, tHours: 65, quorumRatio: 1 / 3 });
    assert.strictEqual(dec.gate, 'directional');
    assert.strictEqual(declaredQuorumFor(dec, 12), 4);   // singles: row 9 exactly
    assert.strictEqual(declaredQuorumFor(dec, 16), 5);   // with contexts
    assert.strictEqual(declaredQuorumFor(dec, 3), 1);    // slim grid
    // absolute quorum still supported, and clamped to the member count
    const abs = validateDeclared({ gate: 'active', dMult: 1, tHours: 41, quorum: 9 });
    assert.strictEqual(declaredQuorumFor(abs, 12), 9);
    assert.strictEqual(declaredQuorumFor(abs, 4), 4);
    // menu membership is enforced — a declared cell must exist in the sweep
    assert.throws(() => validateDeclared({ gate: 'nope', dMult: 1.5, tHours: 65, quorum: 4 }), /gate must be/);
    assert.throws(() => validateDeclared({ gate: 'always', dMult: 0.9, tHours: 65, quorum: 4 }), /dMult must be/);
    assert.throws(() => validateDeclared({ gate: 'always', dMult: 1, tHours: 50, quorum: 4 }), /tHours must be/);
    assert.throws(() => validateDeclared({ gate: 'always', dMult: 1, tHours: 65, quorumRatio: 0 }), /quorumRatio/);
    assert.strictEqual(validateDeclared(null), null); // opt-in only
  },
  async marketDeclarationRejectsMeaninglessParameters() {
    // The classifier's own trade, declared. Gate and distance do not exist
    // for it, and a silently-ignored parameter is how a declared config stops
    // meaning what its author thought it meant — so they are refused, not
    // dropped.
    const dec = validateDeclared({ entry: 'market', tHours: 41, quorumRatio: 0.25 });
    assert.strictEqual(dec.entry, 'market');
    assert.strictEqual(dec.gate, 'directional'); // definitional, not a choice
    assert.strictEqual(dec.dMult, null);
    assert.ok(dec.label.includes('market'));
    assert.throws(() => validateDeclared({ entry: 'market', dMult: 1, tHours: 41, quorum: 3 }), /dMult is meaningless/);
    assert.throws(() => validateDeclared({ entry: 'market', gate: 'always', tHours: 41, quorum: 3 }), /must be omitted or/);
    assert.throws(() => validateDeclared({ entry: 'nope', tHours: 41, quorum: 3 }), /entry must be one of/);
    // breakout stays the default so every existing declaration is unchanged
    assert.strictEqual(validateDeclared({ gate: 'active', dMult: 1, tHours: 161, quorum: 4 }).entry, 'breakout');

    // matchesDeclared must find the market cell, which carries dMult null —
    // the old triple-equality would never have matched it.
    const { matchesDeclared } = require('../lib/bracketwork');
    const marketRow = { entry: 'market', gate: 'directional', dMult: null, tHours: 41 };
    const breakoutRow = { entry: 'breakout', gate: 'active', dMult: 1, tHours: 41 };
    assert.ok(matchesDeclared(marketRow, dec));
    assert.ok(!matchesDeclared(breakoutRow, dec));
    const bdec = validateDeclared({ gate: 'active', dMult: 1, tHours: 41, quorum: 4 });
    assert.ok(matchesDeclared(breakoutRow, bdec));
    assert.ok(!matchesDeclared(marketRow, bdec));
    // a legacy selection with no entry field must still read as breakout
    assert.ok(matchesDeclared({ gate: 'active', dMult: 1, tHours: 41 }, { gate: 'active', dMult: 1, tHours: 41 }));
  },
  async replicationPromotesEveryUnit() {
    // The declared cell is only read at the promoted stage. If replication
    // promoted the leaderboard's top-K, every per-asset number in the
    // replication table would be conditioned on slim P&L — the exact
    // selection effect the mode exists to remove.
    const b = { geometry: 'daily-3d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
    const units = ['AUSDT', 'BUSDT', 'CUSDT'].map((t) => ({ c: { trade: t, ctx1: null, ctx2: null, size: 1 }, b }));
    const doc = { leaders: [{ stage: 'slim', trade: 'AUSDT', size: 1, geometry: 'daily-3d', decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, key: 'a' }] };

    const dec = validateDeclared({ gate: 'active', dMult: 1, tHours: 161, quorumRatio: 0.25 });
    const rep = promotionSet({ declared: dec, promoteK: 1 }, doc, units);
    assert.strictEqual(rep.length, 3);               // every unit, promoteK ignored
    assert.deepStrictEqual(rep.map((r) => r.trade), ['AUSDT', 'BUSDT', 'CUSDT']);
    assert.strictEqual(rep[0].bandMode, 'auto');     // branch fields the payload needs
    assert.strictEqual(rep[0].geometry, 'daily-3d');
    assert.ok(rep[0].key);

    // Discovery mode is untouched: promotion IS the selection step there.
    const disc = promotionSet({ declared: null, promoteK: 1 }, doc, units);
    assert.strictEqual(disc.length, 1);
    assert.strictEqual(disc[0].trade, 'AUSDT');
  },
  async marketEntryIsTheBooksOwnTrade() {
    // The whole point of the market mode: enter at the entry candle's OPEN in
    // the called direction, hold to t, exit at that candle's open. No rails,
    // so a bar that would have stopped a bracket does nothing here.
    const t0 = Date.UTC(2024, 0, 1);
    const bars = { 0: [100, 102.5, 90], 5: [95, 96, 80], 17: [105, 105, 104] };
    for (const h of [1, 2, 3, 4]) bars[h] = [101, 101.5, 100.5];
    const m = mapFrom(t0, bars);
    const r = simMarket(period(t0), [1], m, geo, { tHours: 17, feePerLeg: FEE });
    assert.strictEqual(r.trades, 1);
    assert.strictEqual(r.stops, 0);        // structurally impossible here
    assert.strictEqual(r.ambiguous, 0);
    // priced with the BOOKS' own helper, not a re-derivation
    assert.ok(Math.abs(r.pnl - pnlAt(1, 100, 105, FEE)) < 1e-12);
    assert.strictEqual(r.wins, 1);
    // and the same bars as a breakout WOULD have been stopped out — proving
    // the two modes are genuinely different trades, not a relabelling
    const b = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    assert.strictEqual(b.stops, 1);
  },
  async marketStandsAsideOnAZeroCall() {
    // A dormant call is a stand-aside, exactly as the books treat it — not a
    // skipped/unpriced period.
    const t0 = Date.UTC(2024, 0, 1);
    const m = mapFrom(t0, { 0: [100, 101, 99], 17: [105, 105, 104] });
    const r = simMarket(period(t0), [0], m, geo, { tHours: 17, feePerLeg: FEE });
    assert.strictEqual(r.trades, 0);
    assert.strictEqual(r.pnl, 0);
    assert.strictEqual(r.unpriced, 0);
    // short call takes the other side of the same move
    const down = simMarket(period(t0), [-1], m, geo, { tHours: 17, feePerLeg: FEE });
    assert.ok(Math.abs(down.pnl - pnlAt(-1, 100, 105, FEE)) < 1e-12);
  },
  async execSweepCarriesMarketCellsWithoutDisturbingTheControl() {
    const t0 = Date.UTC(2024, 0, 1);
    const bars = { 0: [100, 101, 99] };
    for (let h = 1; h <= 164; h++) bars[h] = [100 + h * 0.01, 100 + h * 0.01 + 0.5, 100 + h * 0.01 - 0.5];
    const m = mapFrom(t0, bars);
    const rows = execSweep(period(t0), [1], m, geo, 2, FEE);
    const market = rows.filter((r) => r.entry === 'market');
    const breakout = rows.filter((r) => r.entry === 'breakout');
    assert.strictEqual(breakout.length, GATES.length * D_MULTS.length * T_HOURS.length);
    assert.strictEqual(market.length, T_HOURS.length);         // one per horizon
    assert.ok(market.every((r) => r.gate === 'directional'));   // definitionally
    assert.ok(market.every((r) => r.dMult === null));           // no distance exists
    // The always-gate control must be untouched by the addition, or every
    // vs-control number recorded before this change would silently shift.
    assert.ok(rows.filter((r) => r.gate === 'always').every((r) => r.entry === 'breakout'));
    assert.deepStrictEqual(ENTRIES, ['breakout', 'market']);
  },
  async classifierMetricsMatchThePipelineDefinitions() {
    // train majority is 0; test labels are deliberately NOT the same mix, so
    // majorityBaseline and bestConstant come apart and a wrong one shows.
    const train = [0, 0, 0, 0, 1, -1];
    const test = [1, 1, -1, 0];
    const calls = [1, 0, -1, 1];
    const mt = classifierMetrics(train, test, calls);
    assert.strictEqual(mt.testAcc, 2 / 4);          // idx 0 and 2 match
    assert.strictEqual(mt.majorityClass, 0);        // from TRAIN counts
    assert.strictEqual(mt.majorityBaseline, 1 / 4); // one 0 in test
    assert.strictEqual(mt.edge, 2 / 4 - 1 / 4);
    assert.strictEqual(mt.bestConstant, 2 / 4);     // two 1s in test
    assert.strictEqual(mt.hindsightEdge, 0);
    // directional: three non-zero calls, two exactly right. A +1 on a 0 label
    // is a MISS — same as pipeline.js, which counts exact matches only.
    assert.strictEqual(mt.directionalCalls, 3);
    assert.strictEqual(mt.directionalHits, 2);
    assert.strictEqual(mt.directionalHitRate, 2 / 3);
    // balanced accuracy averages recall over classes PRESENT in test:
    // +1 recall 1/2, -1 recall 1/1, 0 recall 0/1 → mean 1/2
    assert.ok(Math.abs(mt.balancedAcc - 0.5) < 1e-12);
    assert.ok(Math.abs(mt.balancedEdge - (0.5 - 1 / 3)) < 1e-12);
    assert.strictEqual(classifierMetrics([0], [], []), null);
  },
  async holdControlsAnswerTheDriftObjection() {
    // Owner's method for factoring market direction out of a result: put
    // long-and-hold and short-and-hold on the SAME window and make the
    // strategy beat them.
    const t0 = Date.UTC(2024, 0, 1);
    const t1 = t0 + 24 * HOUR_MS;
    const bars = {};
    for (let h = 0; h <= 60; h++) bars[h] = [100 + h, 100 + h + 0.5, 100 + h - 0.5]; // steady uptrend
    const m = mapFrom(t0, bars);
    // two periods a day apart; entry offsets land at +0h and +24h
    const periods = [{ startTs: t0 }, { startTs: t1 }];
    const h = holdControls(periods, m, geo, 17, FEE);

    // always-long = the same execution with the direction forced, so it must
    // equal simMarket driven by a constant +1 stream
    const forced = simMarket(periods, [1, 1], m, geo, { tHours: 17, feePerLeg: FEE });
    assert.ok(Math.abs(h.alwaysLong - forced.pnl) < 1e-12);
    assert.strictEqual(h.alwaysLongTrades, 2);
    assert.ok(h.alwaysLong > 0);                    // trend is up
    assert.ok(h.alwaysShort < 0);

    // buy-and-hold spans first entry to last exit: open 100 -> open 141
    assert.ok(Math.abs(h.buyHold - pnlAt(1, 100, 141, FEE)) < 1e-12);
    assert.ok(Math.abs(h.shortHold - pnlAt(-1, 100, 141, FEE)) < 1e-12);
    // and the two sides are NOT negatives of each other — both pay the fee
    assert.ok(Math.abs((h.buyHold + h.shortHold) - -4 * FEE) < 1e-12);

    // one round trip over the whole window beats paying it twice per period
    assert.ok(h.buyHold > h.alwaysLong);
    // empty window degrades rather than throwing
    const none = holdControls([], m, geo, 17, FEE);
    assert.strictEqual(none.buyHold, null);
    assert.strictEqual(none.alwaysLong, 0);
  },
  async trailingStopRatchetsAndNeverLoosens() {
    const t0 = Date.UTC(2024, 0, 1);
    // p=100, d=2% -> long at 102. Then a run to 110, then a fade.
    // trail = 2% of band(=2%) ... band is passed as dPct here, so use the
    // simBracket primitive directly with explicit percentages.
    const bars = { 0: [100, 102.5, 99.5] };
    for (let h = 1; h <= 6; h++) bars[h] = [102 + h, 102 + h + 0.5, 102 + h - 0.5]; // up to ~108.5
    bars[7] = [108, 108, 104];   // fade: trail from high 108.5 at 2% = 106.33 -> stopped
    for (let h = 8; h < 17; h++) bars[h] = [104, 104.5, 103.5];
    bars[17] = [104, 104, 103];
    const m = mapFrom(t0, bars);
    const trailed = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE, trailPct: 2, armPct: 0 });
    const staticStop = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    // static stop never triggers (never revisits 98) and exits on the clock
    assert.strictEqual(staticStop.stops, 0);
    // trailing locks in the run instead of giving it back
    assert.strictEqual(trailed.stops, 1);
    assert.ok(trailed.pnl > staticStop.pnl, `${trailed.pnl} should beat ${staticStop.pnl}`);
    // a trail never ratchets DOWN: exit must be above the original rail
    assert.ok(trailed.pnl > 100 * (98 / 102 - 1));
  },
  async armDelaysTheTrailAndStaticIsUnchanged() {
    const t0 = Date.UTC(2024, 0, 1);
    // long at 102, drifts to 103 then fades to 99. With arm=0 the trail is
    // live immediately and stops out near 103*0.98; with a big arm it never
    // arms, so the original rail (98) is still the stop and nothing triggers.
    const bars = { 0: [100, 102.5, 99.5], 1: [102.5, 103, 102], 2: [102, 102.5, 99.2] };
    for (let h = 3; h < 17; h++) bars[h] = [99.5, 100, 99];
    bars[17] = [99.5, 99.5, 99];
    const m = mapFrom(t0, bars);
    const eager = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE, trailPct: 2, armPct: 0 });
    const lazy = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE, trailPct: 2, armPct: 10 });
    assert.strictEqual(eager.stops, 1);
    assert.strictEqual(lazy.stops, 0);   // never armed -> rail stop, never hit
    assert.ok(eager.pnl > lazy.pnl);
    // trailPct null must reproduce the pre-trailing behaviour exactly
    const a = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    const b = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE, trailPct: null, armPct: 0 });
    assert.deepStrictEqual(a, b);
  },
  async trailAmbiguityIsCountedNotHidden() {
    const t0 = Date.UTC(2024, 0, 1);
    // every bar makes a new high AND retraces past the trail — OHLC cannot
    // order them, so each one is an assumption and must be disclosed.
    const bars = { 0: [100, 102.5, 99.5] };
    for (let h = 1; h <= 4; h++) bars[h] = [103, 104 + h, 100];
    for (let h = 5; h < 17; h++) bars[h] = [103, 103.5, 102.5];
    bars[17] = [103, 103, 102];
    const m = mapFrom(t0, bars);
    const r = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE, trailPct: 2, armPct: 0 });
    assert.ok(r.trailAmbiguous >= 1, 'a bar that extends and stops out must be counted');
    // and the static run reports zero of them, since it has no trail to race
    const st = simBracket(period(t0), [1], m, geo, { dPct: 2, tHours: 17, gate: 'always', feePerLeg: FEE });
    assert.strictEqual(st.trailAmbiguous, 0);
  },
  async trailingIsOptInAndMultipliesTheMenu() {
    const t0 = Date.UTC(2024, 0, 1);
    const bars = {};
    for (let h = 0; h <= 164; h++) bars[h] = [100 + h * 0.01, 100 + h * 0.01 + 0.5, 100 + h * 0.01 - 0.5];
    const m = mapFrom(t0, bars);
    const base = execSweep(period(t0), [1], m, geo, 2, FEE);
    const wide = execSweep(period(t0), [1], m, geo, 2, FEE, { trailing: true });
    const plane = GATES.length * D_MULTS.length * T_HOURS.length;
    assert.strictEqual(base.length, plane + T_HOURS.length);
    assert.strictEqual(wide.length, plane * (1 + TRAIL_MULTS.length * ARM_MULTS.length) + T_HOURS.length);
    // OFF must be byte-identical to the pre-trailing menu, or every board
    // recorded so far stops being comparable
    assert.ok(base.every((r) => r.trailMult === null && r.armMult === null));
    // and the static cells inside the wide sweep must equal the base ones
    const key = (r) => `${r.entry}|${r.gate}|${r.dMult}|${r.tHours}`;
    const staticWide = new Map(wide.filter((r) => r.trailMult === null).map((r) => [key(r), r]));
    for (const r of base) assert.deepStrictEqual(staticWide.get(key(r)), r);
  },
  async simCellReproducesTheSweptCell() {
    // The holdout and minute confirmation must re-run the SELECTED trade, not
    // a lookalike — so simCell has to agree with execSweep cell for cell.
    const t0 = Date.UTC(2024, 0, 1);
    const bars = { 0: [100, 103, 98] };
    for (let h = 1; h <= 40; h++) bars[h] = [101 + h * 0.1, 101 + h * 0.1 + 0.8, 101 + h * 0.1 - 0.8];
    const m = mapFrom(t0, bars);
    const rows = execSweep(period(t0), [1], m, geo, 2, FEE, { trailing: true });
    for (const r of rows.slice(0, 40)) {
      const again = simCell(r, period(t0), [1], m, geo, 2, FEE);
      assert.strictEqual(again.pnl, r.pnl, `simCell disagrees for ${JSON.stringify({ e: r.entry, g: r.gate, d: r.dMult, t: r.tHours, tr: r.trailMult })}`);
      assert.strictEqual(again.trades, r.trades);
    }
  },
  async minuteResolutionSurvivesTheParser() {
    // The hourly parser floors every timestamp to the hour. Feeding 1m files
    // through it would collapse sixty candles onto one key and discard 59 of
    // them silently, with a plausible-looking result — the worst possible
    // failure for a confirmation step.
    const { parseKlineCsv } = require('../lib/binance');
    const csv = [
      '1700000000000,10,11,9,10.5,1,0,100',
      '1700000060000,10.5,12,10,11,1,0,100',
      '1700000120000,11,13,10.5,12,1,0,100',
    ].join('\n');
    assert.strictEqual(new Set(parseKlineCsv(csv).map((r) => r.ts)).size, 1);          // 1h: collapses by design
    assert.strictEqual(new Set(parseKlineCsv(csv, 60_000).map((r) => r.ts)).size, 3);  // 1m: all survive
  },
  async finerBarsResolveWhatHourlyBarsMustAssume() {
    // The trail must already be LIVE for this to be about trailing at all —
    // a bar that spans both ENTRY rails trips the entry ambiguity and closes
    // the position before any trail exists.
    //
    // Setup: long at the 102 rail, trail rides up to a stop of 102.90, then
    // one hour prints high 110 and low 102. Hourly cannot say whether the
    // rally or the dip came first, so the book is charged the dip. Minute
    // bars show the rally came first, which drags the stop to 107.80.
    const t0 = Date.UTC(2024, 0, 1);
    const E = t0 + geo.entryOffsetH * HOUR_MS;
    const M = 60_000;
    const bar = (o, h, l) => ({ open: o, high: h, low: l, close: o });

    const hourly = new Map();
    hourly.set(E, bar(100, 102.5, 99.5));          // entry: touches the 102 rail
    hourly.set(E + HOUR_MS, bar(103, 105, 102.5)); // trail ratchets to 105*0.98
    hourly.set(E + 2 * HOUR_MS, bar(105, 110, 102)); // extends AND dips: unknowable
    for (let h = 3; h <= 20; h++) hourly.set(E + h * HOUR_MS, bar(108, 108.2, 107.8));

    // The minute path must be CONSISTENT with the hourly bars, not merely
    // plausible: hour 0 prints low 99.5, so that dip has to happen somewhere —
    // and where it happens matters. Placed BEFORE the entry it is harmless;
    // placed after, it stops the trail out at 99.96 and the finer run comes
    // out worse. Both are legitimate readings of the same hourly bar, which is
    // the whole reason this confirmation exists.
    const minute = new Map();
    for (let i = 0; i < 30; i++) minute.set(E + i * M, i === 10 ? bar(99.8, 100, 99.5) : bar(99.9, 100.1, 99.7));
    minute.set(E + 30 * M, bar(101, 102.5, 100.8));            // the entry touch
    for (let i = 31; i < 60; i++) minute.set(E + i * M, bar(102.6, 102.8, 102.5));
    for (let i = 0; i < 60; i++) { const px = 103 + (i / 59) * 2; minute.set(E + HOUR_MS + i * M, bar(px, px + 0.05, px - 0.05)); }
    for (let i = 0; i < 30; i++) { const px = 105 + (i / 29) * 5; minute.set(E + 2 * HOUR_MS + i * M, bar(px, px + 0.05, px - 0.05)); }
    for (let i = 30; i < 60; i++) { const px = 110 - ((i - 30) / 29) * 8; minute.set(E + 2 * HOUR_MS + i * M, bar(px, px + 0.05, px - 0.05)); }
    for (let h = 3; h <= 20; h++) for (let i = 0; i < 60; i++) minute.set(E + h * HOUR_MS + i * M, bar(108, 108.2, 107.8));

    const cell = { entry: 'breakout', gate: 'always', dMult: 1, tHours: 17, trailMult: 1, armMult: 0 };
    const h = simCell(cell, period(t0), [1], hourly, geo, 2, FEE, HOUR_MS);
    const m = simCell(cell, period(t0), [1], minute, geo, 2, FEE, 60_000);

    assert.strictEqual(h.trades, 1);
    assert.strictEqual(m.trades, 1);
    // hourly had to guess, and says so
    assert.ok(h.trailAmbiguous >= 1, `expected an assumption, got ${h.trailAmbiguous}`);
    assert.strictEqual(h.stops, 1);
    // both stopped out, but the finer path stopped far higher up
    assert.strictEqual(m.stops, 1);
    // Here the rally genuinely came first, so the finer path stops far higher.
    // NOTE: this is NOT a general guarantee — confirmation can move a number
    // in either direction, because the hourly bar hides the ordering both
    // ways. Asserting "finer is better" would bake in exactly the optimism
    // this step exists to remove.
    assert.ok(m.pnl > h.pnl + 3, `minute ${m.pnl.toFixed(2)} vs pessimistic hourly ${h.pnl.toFixed(2)}`);
    // and at minute resolution the ordering question does not arise here
    assert.strictEqual(m.trailAmbiguous, 0);
  },
  async everyBracketParamSurvivesTheApi() {
    // A parameter the orchestrator reads but the endpoint never forwards is
    // invisible: the form offers it, the caller sends it, the server drops
    // it, and the run silently does something else. That is exactly how
    // "trailing" and "holdout" shipped unreachable — every trailing sweep ran
    // with trailing off and looked like a real result.
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const batchSrc = fs.readFileSync(path.join(root, 'lib', 'batch.js'), 'utf8');
    const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

    const fn = batchSrc.slice(batchSrc.indexOf('function startBracketLab'));
    const body = fn.slice(0, fn.indexOf('const { branches, combos }'));
    const read = new Set([...body.matchAll(/params\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    read.delete('set');       // read as params.set?.x — forwarded as `set`
    read.delete('sizes');     // ditto
    read.delete('permute');   // ditto
    assert.ok(read.size >= 8, `expected to find the param reads, found ${[...read]}`);

    const call = serverSrc.slice(serverSrc.indexOf('batch.startBracketLab({'));
    const forwarded = call.slice(0, call.indexOf('});'));
    const missing = [...read].filter((k) => !new RegExp(`\\b${k}\\s*:`).test(forwarded));
    assert.deepStrictEqual(missing, [], `startBracketLab reads these but the API never forwards them: ${missing.join(', ')}`);
  },
  async bestCellHonorsFloorAndTies() {
    const rows = [
      { gate: 'always', dMult: 1, tHours: 17, pnl: 50, trades: 4 }, // under floor
      { gate: 'active', dMult: 1, tHours: 41, pnl: 30, trades: 20 },
      { gate: 'active', dMult: 0.5, tHours: 41, pnl: 30, trades: 12 }, // tie → fewer trades
      { gate: 'directional', dMult: 1.5, tHours: 65, pnl: -5, trades: 30 },
    ];
    const best = bestCell(rows, 10);
    assert.strictEqual(best.trades, 12);
    assert.strictEqual(bestCell([{ pnl: 9, trades: 3, gate: 'always', dMult: 1, tHours: 17 }], 10), null);
  },
};
