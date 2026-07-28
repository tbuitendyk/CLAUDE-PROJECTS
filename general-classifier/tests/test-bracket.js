const { assert } = require('./helpers');
const { comboViews, simBracket, simMarket, execSweep, bestCell, PER_ASSET, ENTRIES, D_MULTS, T_HOURS, GATES } = require('../lib/bracket');
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
