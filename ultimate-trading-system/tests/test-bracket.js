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
// THE LAB FEE, AS A RATE (owner order, 2026-08-23). This said 0.125 — dollars
// a leg. It is 0.00125 of the position now, which on the $100 paper clip is the
// same 25 cents the round trip, so every expected figure below is unchanged.
const { FEE_PER_LEG: FEE, NOTIONAL } = require('../lib/paper');

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
    const P = PER_ASSET(nDays); // 21 — the same at every chunk shape now
    const X = require('../lib/features').CROSS; // 5
    const s1 = comboViews(1, nDays);
    const s2 = comboViews(2, nDays);
    const s3 = comboViews(3, nDays);
    assert.strictEqual(s1.featureCount, P);
    assert.strictEqual(s2.featureCount, 2 * P + X);
    assert.strictEqual(s3.featureCount, 3 * P + 2 * X);
    assert.strictEqual(s1.views.cross, null); // nothing to cross on a single
    assert.strictEqual(s2.views.cross.length, X);
    assert.strictEqual(s3.views.cross.length, 2 * X); // AB cross + AC cross
    // the fourth reading exists on every combo size (owner order, 2026-08-28)
    assert.ok(s1.views.pricevol.length > 0 && s2.views.pricevol.length > 0 && s3.views.pricevol.length > 0);
    // full views cover the whole layout exactly once
    assert.strictEqual(s1.views.full.length, P);
    assert.strictEqual(s3.views.full.length, 3 * P + 2 * X);
    assert.strictEqual(new Set(s3.views.full).size, 3 * P + 2 * X);
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
  async aDeclaredAgreementCountIsPerCommitteeSize() {
    // Owner, 2026-07-31: committees are 6 members for a single coin and 8
    // with context coins, and one number cannot serve both — an exact 7 is
    // 7-of-8 on a context combo and SILENTLY UNANIMOUS on a single. So a
    // declaration names a count per size.
    const dec = validateDeclared({ gate: 'active', dMult: 1, tHours: 65, quorumSingles: 4, quorumContexts: 7 });
    assert.strictEqual(declaredQuorumFor(dec, 6, 1), 4, 'single combo uses the 6-member count');
    assert.strictEqual(declaredQuorumFor(dec, 8, 2), 7, 'context combo uses the 8-member count');
    assert.strictEqual(declaredQuorumFor(dec, 8, 3), 7, 'triples are context combos too');
    assert.ok(dec.label.includes('4/6') && dec.label.includes('7/8'), `label must show both: ${dec.label}`);
    // Only one named (a run that ticks one combo size) applies to whatever
    // it meets, clamped — never a guess.
    const onlySingles = validateDeclared({ gate: 'active', dMult: 1, tHours: 65, quorumSingles: 5 });
    assert.strictEqual(declaredQuorumFor(onlySingles, 6, 1), 5);
    assert.strictEqual(declaredQuorumFor(onlySingles, 8, 2), 5);
    // Ranges are enforced per size: 7 is impossible on a 6-member committee.
    assert.throws(() => validateDeclared({ gate: 'active', dMult: 1, tHours: 65, quorumSingles: 7 }), /1 to 6/);
    assert.throws(() => validateDeclared({ gate: 'active', dMult: 1, tHours: 65, quorumContexts: 9 }), /1 to 8/);
    // Older declarations keep working untouched.
    const legacy = validateDeclared({ gate: 'active', dMult: 1, tHours: 65, quorumRatio: 1 / 3 });
    assert.strictEqual(declaredQuorumFor(legacy, 6, 1), 2);
    assert.strictEqual(declaredQuorumFor(legacy, 8, 2), 3);
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
    // and the two sides are NOT negatives of each other — both pay the fee.
    // FEE is a fraction of the position, so the four legs cost 4*FEE*NOTIONAL:
    // the same 50 cents on the $100 clip that -4*$0.125 used to be, and now a
    // figure that follows the trade size instead of being fixed to one.
    assert.ok(Math.abs((h.buyHold + h.shortHold) - -4 * FEE * NOTIONAL) < 1e-12);

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

    // CHANGED 2026-08-22: the plan-building moved into planFor so the launcher
    // and the pre-launch estimate count the same way. The parameter reads moved
    // with it, so this reads planFor's body — which is where they now are.
    const fn = batchSrc.slice(batchSrc.indexOf('function planFor(params'));
    const body = fn.slice(0, fn.indexOf('const { branches, combos }'));
    const read = new Set([...body.matchAll(/params\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    read.delete('set');       // read as params.set?.x — forwarded as `set`
    read.delete('sizes');     // ditto
    read.delete('permute');   // ditto
    // DELIBERATELY not forwarded (the opposite fault class): the planted-check
    // flag and its stamped rules may only enter through POST /api/planted-gate,
    // which builds them itself (lib/planted.gateParams). If the public sweep
    // endpoint forwarded plantedGate, any caller could dress a real-looking
    // run in the reserved pair's clothing — the guard exists to prevent that.
    read.delete('plantedGate');
    read.delete('plantedRules');
    assert.ok(read.size >= 8, `expected to find the param reads, found ${[...read]}`);

    // CHANGED 2026-08-22: the request-to-parameters mapping moved into
    // sweepParams(), because the pre-launch estimate has to price exactly the
    // run the launch would start. That is where the forwarding now lives, and
    // it covers both callers at once — which makes this check stronger, not
    // weaker: a parameter missing here is missing from the estimate too.
    const call = serverSrc.slice(serverSrc.indexOf('function sweepParams(b) {'));
    const forwarded = call.slice(0, call.indexOf('\n}'));
    const missing = [...read].filter((k) => !new RegExp(`\\b${k}\\s*:`).test(forwarded));
    assert.deepStrictEqual(missing, [], `startBracketLab reads these but the API never forwards them: ${missing.join(', ')}`);

    // BLIND SPOT THIS CHECK USED TO HAVE. It scans for `params.X`, so a
    // setting HARD-CODED from a constant is invisible: nothing reads it from
    // params, so nothing looks missing. feePerLeg sat like that — the one
    // dimension cycle 9's result depends on (fees eat 86% of the gross edge)
    // could not be varied from any launcher, and this test said all was well.
    //
    // So also check the other direction: anything the worker reads off the
    // params object as `p.X` must be SOURCED from `params.X` in batch.js.
    const workSrc = fs.readFileSync(path.join(root, 'lib', 'bracketwork.js'), 'utf8');
    const consumed = new Set([...workSrc.matchAll(/\bp\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    // Derived inside the orchestrator rather than supplied by the caller.
    // declaredSet joins 'declared' for the same reason: both are BUILT here from
    // the caller's declared + declaredPermute and validated before the workers
    // see them. The caller-settable half (declaredPermute) is checked above.
    const INTERNAL = new Set(['labelShiftFrac', 'declared', 'declaredSet', 'set', 'sizes', 'permute', 'universe']);
    // "Sourced from params" = `params.<key>` appears anywhere in batch.js.
    // A per-line regex was too narrow: real definitions span lines and contain
    // commas (`Math.max(1, Number(params.minTrades) || 10)`), so it reported
    // reachable settings as hard-coded.
    // Scoped to startBracketLab's OWN body, not the whole file. batch.js holds
    // several job types and others read `params.feePerLeg` for themselves — a
    // file-wide search therefore made the bracketlab fee look reachable while
    // it was hard-coded. Same slice the forwarding check above uses.
    const unreachable = [...consumed].filter((k) => !INTERNAL.has(k)
      && new RegExp(`\\b${k}\\s*:`).test(body)
      && !body.includes(`params.${k}`));
    assert.deepStrictEqual(unreachable, [],
      `the sweep reads these but batch.js hard-codes them, so no caller can set them: ${unreachable.join(', ')}`);
  },
  async windowRotationHoldsTheBaselineTheEdgeIsScoredAgainst() {
    // edge = accuracy - majorityBaseline. A null draw scored against a SOFTER
    // baseline posts positive edge more easily with no change in skill, so a
    // rotation scheme that moves the baseline is not producing draws of the
    // same statistic. Measured on BTC/ZEC daily-3d (908 chunks), series-scope
    // rotation moved the holdout baseline from 0.265 to 0.419 across seven
    // draws while the real run sat at 0.353.
    //
    // Window scope must hold every window's label multiset EXACTLY — that is
    // what pins the band (calibrated on train) and the baseline (a function of
    // the train modal class and the holdout counts).
    const { rotateLabels, splitAndLabel, splitBounds } = require('../lib/bracketwork');
    const { classifierMetrics } = require('../lib/metrics');
    const branch = { band: 'auto' };
    // A deliberately drifting series, so the epochs genuinely differ and a
    // series rotation has something to smear.
    const mk = () => Array.from({ length: 120 }, (_, i) => ({
      diffPct: Math.sin(i / 7) * 3 + i * 0.05 - 3,
    }));

    const counts = (cs) => {
      const d = { '-1': 0, 0: 0, 1: 0 };
      for (const c of cs) d[c.label] += 1;
      return `${d['-1']}/${d['0']}/${d['1']}`;
    };
    const measure = (chunks) => {
      const s = splitAndLabel(chunks, branch, true);
      return {
        band: s.bandPct,
        train: counts(s.trainChunks),
        hold: counts(s.holdChunks),
        baseline: classifierMetrics(
          s.trainChunks.map((c) => c.label),
          s.holdChunks.map((c) => c.label),
          s.holdChunks.map(() => 0),
        ).majorityBaseline,
      };
    };

    const real = measure(mk());
    let windowMoved = 0;
    let seriesMoved = 0;
    for (const frac of [0.143, 0.286, 0.429, 0.571, 0.714, 0.857]) {
      const w = mk();
      rotateLabels(w, frac, 'window', true);
      const mw = measure(w);
      assert.strictEqual(mw.band, real.band, `window scope must not move the band (shift ${frac})`);
      assert.strictEqual(mw.train, real.train, `window scope must hold train balance (shift ${frac})`);
      assert.strictEqual(mw.hold, real.hold, `window scope must hold holdout balance (shift ${frac})`);
      assert.strictEqual(mw.baseline, real.baseline, `window scope must hold the baseline (shift ${frac})`);

      const s = mk();
      rotateLabels(s, frac, 'series', true);
      const ms = measure(s);
      if (ms.baseline !== real.baseline) seriesMoved++;
      // and the window rotation must actually SHUFFLE, not no-op
      const before = mk();
      if (w.some((c, i) => c.diffPct !== before[i].diffPct)) windowMoved++;
    }
    assert.strictEqual(windowMoved, 6, 'window rotation must actually permute every draw');
    assert.ok(seriesMoved >= 3,
      `series scope should move the baseline on most draws (moved on ${seriesMoved}/6) — if it stopped doing so, this test no longer demonstrates the confound it exists for`);

    // and the bounds helper must agree with the splitter it feeds
    const b = splitBounds(120, true);
    const s2 = splitAndLabel(mk(), branch, true);
    assert.strictEqual(b.nTrain, s2.trainChunks.length);
    assert.strictEqual(b.nTest, s2.testChunks.length);
    assert.strictEqual(b.nHold, s2.holdChunks.length);
  },
  async theRealArmCannotBeSecretlyScrambled() {
    // THIS BUG DESTROYED CYCLE 10 — 407 minutes, 3400 units, zero failures,
    // entirely worthless. unitTask resolved the per-unit shift as
    //   labelShiftFrac != null ? labelShiftFrac : p.labelShiftFrac
    // so the r=0 real arm, which passes null to mean "do not rotate me",
    // fell through to the run-wide 0.5 and was rotated. It came out
    // BIT-IDENTICAL to the r=10 scramble (-4703.2297069861515), so a scramble
    // was compared against 19 scrambles. Nothing crashed; the numbers were
    // plausible; only an impossible exact tie exposed it.
    //
    // The rule: PRESENCE of the key decides, never its value. An explicit
    // null or 0 means no rotation and the run-wide default must not win.
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bracketwork.js'), 'utf8');
    // Strip comment lines: the comment above the fix QUOTES the broken form in
    // order to explain it, and a naive grep over the whole file flags the
    // explanation as the defect. Check the CODE.
    const src = raw.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(/hasOwnProperty\.call\(task, 'labelShiftFrac'\)/.test(src),
      'the per-unit shift must be resolved by KEY PRESENCE, not by value — '
      + 'a value test lets an explicit null inherit the run-wide rotation');
    assert.ok(!/labelShiftFrac != null \? labelShiftFrac : p\.labelShiftFrac/.test(src),
      'the value-based fallback that broke cycle 10 must not come back');

    // And the resolution itself, exercised directly.
    const resolve = (task, runWide) => (
      Object.prototype.hasOwnProperty.call(task, 'labelShiftFrac')
        ? task.labelShiftFrac : runWide);
    assert.strictEqual(resolve({ labelShiftFrac: null }, 0.5), null,
      'explicit null must mean NO rotation even when the run sets 0.5');
    assert.strictEqual(resolve({ labelShiftFrac: 0 }, 0.5), 0,
      'explicit 0 must mean NO rotation even when the run sets 0.5');
    assert.strictEqual(resolve({ labelShiftFrac: 0.25 }, 0.5), 0.25,
      'an explicit shift must be honoured');
    assert.strictEqual(resolve({}, 0.5), 0.5,
      'a payload that names no shift may still inherit the run-wide one');
    // And falsy shifts must not rotate at all.
    for (const f of [null, 0, undefined]) {
      assert.ok(!f, `shiftFrac ${String(f)} must be falsy so 'if (shiftFrac)' skips rotation`);
    }
  },
  async savedModelsReproduceTheirOwnLiveCalls() {
    // THE ROUND TRIP. A saved model that does not reproduce the exact calls
    // its live twin made is not a saved model — it is a different model with
    // the same name. Eleven cycles discarded every fitted model at return;
    // this pins the serialize/reload path for both kinds.
    const { trainMember, predictMember } = require('../lib/bracket');
    // Deterministic synthetic data: 3 features, label follows feature 0's sign
    // with a dead zone, so both model kinds have something learnable.
    const mk = (n, seed) => Array.from({ length: n }, (_, i) => {
      const a = Math.sin(i * 0.7 + seed), b = Math.cos(i * 1.3 + seed), c = Math.sin(i * 2.1 + seed * 2);
      return { x: [a, b, c], label: a > 0.3 ? 1 : a < -0.3 ? -1 : 0 };
    });
    const trainChunks = mk(60, 1);
    const testChunks = mk(17, 9);
    for (const kind of ['logreg', 'boost']) {
      const { calls, model } = await trainMember({
        model: kind, viewIdx: [0, 1, 2], trainChunks, testChunks,
        decision: 'argmax', tradeMap: null, geo: null,
      });
      assert.ok(model && model.kind === kind, `${kind}: model must be returned`);
      // Serialize THROUGH JSON — that is how it will live on disk.
      const revived = JSON.parse(JSON.stringify(model));
      const replayed = testChunks.map((c) => predictMember(revived, c.x));
      assert.deepStrictEqual(replayed, calls,
        `${kind}: reloaded model must reproduce its own live calls exactly`);
    }
  },
  async symbolCacheRespectsTheDateRange() {
    // getMap cached by symbol alone and returned the FIRST range loaded for
    // any later request — two runs with different endMonths came back
    // identical in one process (2026-07-30). Same combo, two ranges, one
    // process: the chunk counts must differ.
    const { buildCombo } = require('../lib/bracketwork');
    const combo = { trade: 'BTCUSDT', ctx1: null, ctx2: null, size: 1 };
    const branch = { geometry: 'daily-3d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
    const a = await buildCombo(combo, branch, { startMonth: '2024-01', endMonth: '2024-06' });
    const b = await buildCombo(combo, branch, { startMonth: '2024-01', endMonth: '2024-11' });
    assert.ok(b.chunks.length > a.chunks.length,
      `a longer range must yield more chunks (${a.chunks.length} vs ${b.chunks.length}) — the cache is ignoring the range`);
  },
  async boardSortsPromotedRowsByHoldoutAndSlimBySearch() {
    // Owner, 2026-07-30: sort by held-back money. But promotion slices slim
    // rows in board order, so slim MUST stay in search order or the holdout
    // leaks into selection. Stage-aware, floor-aware.
    const { leaderCmp } = require('../lib/batch');
    const P = (key, holdPnl, trades, searchPnl = 0) => ({
      key, stage: 'promoted', pnl: searchPnl,
      holdout: holdPnl == null ? null : { pnl: holdPnl, trades },
    });
    const S = (key, pnl) => ({ key, stage: 'slim', pnl });
    const rows = [S('s-lo', 5), P('p-thin', 900, 2), P('p-best', 100, 40), S('s-hi', 50), P('p-mid', 60, 40), P('p-none', null, 0)];
    rows.sort((a, b) => leaderCmp(a, b, 10));
    assert.deepStrictEqual(rows.map((r) => r.key),
      ['p-best', 'p-mid', 'p-thin', 'p-none', 's-hi', 's-lo'],
      'promoted by holdout (floored rows sink), then slim by search');
  },
  async aBoardWithNoHeldBackWindowRanksOnTheSettingsWindow() {
    // Owner, 2026-07-31: a legacy run with the holdout unticked has no
    // held-back number at all, so every promoted row used to tie and the
    // board came out in ALPHABETICAL order — ranked by nothing, with no sign
    // that the order was meaningless. Those rows now rank on the settings
    // window, which is all that exists for them.
    const { leaderCmp } = require('../lib/batch');
    const P = (key, searchPnl) => ({ key, stage: 'promoted', pnl: searchPnl, holdout: null });
    // The money order must DISAGREE with the alphabetical one, or the test
    // cannot tell the two behaviours apart — the first version of this test
    // passed happily against the old code for exactly that reason (QC 44).
    const rows = [P('mid', 100), P('alpha', 10), P('zeta', 300)];
    rows.sort((a, b) => leaderCmp(a, b, 10));
    assert.deepStrictEqual(rows.map((r) => r.key), ['zeta', 'mid', 'alpha'],
      'no-holdout rows must rank by settings-window money, not by name');
    // ...and a judged row still outranks an unjudged one, however rich the
    // unjudged one looks on the window it was fitted on.
    const mixed = [P('rich-unjudged', 9999), { key: 'judged', stage: 'promoted', pnl: 0, holdout: { pnl: 1, trades: 40 } }];
    mixed.sort((a, b) => leaderCmp(a, b, 10));
    assert.deepStrictEqual(mixed.map((r) => r.key), ['judged', 'rich-unjudged'],
      'a held-back number must always outrank a settings-window one');
  },
  async everyMoneyFigureRecordsTheSettingsThatEarnedIt() {
    // A money figure with no record of the trade that produced it cannot be
    // investigated. Cycle 11's four worst setups lost up to 4x the widest stop
    // per trade, and whether that was unprotected market entry or a pricing
    // fault was UNANSWERABLE from the stored record — the winning settings
    // lived only on the profit-ranked leaderboard, which is capped and so
    // excludes precisely the setups worth looking at.
    //
    // Owner, 2026-07-30: record the execution settings every time.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8');
    const start = src.indexOf('rows.census.push({');
    assert.ok(start > 0, 'could not find the census push');
    const block = src.slice(start, src.indexOf('});', start));
    // Money is recorded...
    for (const f of ['holdPnl', 'holdTrades']) {
      assert.ok(block.includes(`${f}:`), `census must record ${f}`);
    }
    // ...so the settings behind it must be too.
    for (const f of ['cellEntry', 'cellGate', 'cellDMult', 'cellTHours',
                     'cellTrailMult', 'cellArmMult', 'cellQuorum', 'cellAmbiguous',
                     // both windows, every setup, uncapped (owner, 2026-07-30)
                     'searchPnl', 'searchTrades', 'searchWins', 'searchGrossPerTrade',
                     'searchStops', 'vsControl', 'holdStops', 'modelFile']) {
      assert.ok(block.includes(`${f}:`),
        `census records money but not ${f} — an untraceable figure`);
    }
  },
  async aMultiScrambleJobCarriesItsOwnRealArm() {
    // Cycle 8 ran 19 scrambles and had NOTHING to compare them against: the
    // expansion started at r=1, so the job produced only nulls, and the real
    // arm came from an earlier job on an earlier build. Five hours for no
    // comparison (QC 34). Both arms must ride in the same job.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8');
    const loop = src.slice(src.indexOf('if (p.labelShiftReps > 0) {'));
    const body = loop.slice(0, loop.indexOf('const slimRuns'));
    assert.ok(/for \(let r = 0; r <= p\.labelShiftReps; r\+\+\)/.test(body),
      'the scramble expansion must start at r = 0 so the real arm is included');
    assert.ok(/r === 0 \? null :/.test(body),
      'r = 0 must carry shiftFrac null — the unscrambled real arm');

    // And the arithmetic: N scrambles must yield N+1 slices, not N.
    const REPS = 19;
    const fracs = [];
    for (let r = 0; r <= REPS; r++) fracs.push(r === 0 ? null : r / (REPS + 1));
    assert.strictEqual(fracs.length, REPS + 1, 'N scrambles => N+1 slices');
    assert.strictEqual(fracs.filter((f) => f === null).length, 1, 'exactly one real arm');
    assert.strictEqual(new Set(fracs.filter((f) => f !== null)).size, REPS, 'scrambles must be distinct');
  },
  async jobIdsAreHumanReadableAndStillMachineSafe() {
    // Owner, 2026-07-29: a wall of bare timestamps meant the only way to tell
    // one run from another was to look each up — which is how three runs'
    // results got attributed to the wrong job ids in a report.
    //
    // The slug must not break anything: job ids are used as FILENAMES
    // (reports/audit-<id>.md), pasted into shell scripts, matched exactly by
    // reports/EDGE-JOB, and filtered on the `bracketlab-` prefix.
    const { idSlug } = require('../lib/batch');
    const cases = [
      [{ labelShiftReps: 19, labelShiftScope: 'window', edgeScreen: true, holdout: true }, '-null19-win-census'],
      // holdout OFF is called out loudly: a run with nothing held back cannot
      // answer an out-of-sample question, and that must be visible in the id.
      [{ labelShiftReps: 19, labelShiftScope: 'window', edgeScreen: true }, '-null19-win-census-noholdout'],
      [{ edgeScreen: true, holdout: true }, '-real-census'],
      [{ labelShiftFrac: 0.5, holdout: true }, '-null1'],
      [{ declared: {}, trailing: true, holdout: true }, '-real-declared-trail'],
      [{ holdout: false }, '-real-noholdout'],
      [{ label: 'Cycle 6 — the BIG one!!', holdout: true }, '-cycle-6-the-big-one'],
    ];
    for (const [p, want] of cases) {
      assert.strictEqual(idSlug(p), want, `idSlug(${JSON.stringify(p)})`);
    }
    // Machine-safety, checked on the assembled id rather than the slug alone.
    for (const [p] of cases) {
      const id = `bracketlab-20260729-0235${idSlug(p)}`;
      assert.ok(/^bracketlab-[0-9]{8}-[0-9]{4}[a-z0-9-]*$/.test(id), `unsafe id: ${id}`);
      assert.ok(id.startsWith('bracketlab-'), 'prefix filters must still match');
      assert.ok(!/[^A-Za-z0-9._-]/.test(id), `id is used as a filename: ${id}`);
      assert.ok(id.length <= 64, `id too long for comfort: ${id}`);
    }
    // A hostile label must not escape into a path or a shell word.
    const nasty = idSlug({ label: '../../etc/passwd; rm -rf /' });
    assert.ok(!nasty.includes('/') && !nasty.includes('.') && !nasty.includes(';'),
      `label sanitisation failed: ${nasty}`);

    // AND IT MUST ACTUALLY BE WIRED IN. Testing idSlug alone would pass
    // happily while the id template ignored it — a working function that
    // nothing calls is precisely the failure mode this suite keeps catching.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8');
    assert.ok(/id: `bracketlab-\$\{stamp\}\$\{idSlug\(/.test(src),
      'the bracketlab id must be built from idSlug(), not the bare timestamp');
    assert.ok(/description: p\.description/.test(src),
      'the run document must carry the description');
  },
  async drawCountHasNoCeilingTheSoftwarePicked() {
    // The draw count sets a FLOOR on the strongest claim available: beating all
    // N draws gives a rank-based p of 1/(N+1). This used to be capped, first at
    // 12 (which floored the best achievable p at 0.077 — the CAP, not the data,
    // deciding whether anything could ever be called significant) and then at
    // 24. The owner removed it entirely on 2026-08-22: a ceiling on how strong
    // a claim they may attempt is not the software's to set, and the standing
    // rule is that the software reports the cost and the human decides.
    //
    // So this now guards the ABSENCE of a cap, and the presence of the cost
    // report that replaced it. Reinstating any Math.min on labelShiftReps, or
    // a max attribute on the box, fails here.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8');
    const line = src.match(/labelShiftReps:.*$/m);
    assert.ok(line, 'the labelShiftReps parameter must still be read');
    assert.ok(!/Math\.min/.test(line[0]),
      `labelShiftReps is capped again — "${line[0].trim()}" — which puts a ceiling on the strongest claim the owner may attempt`);
    assert.ok(/Math\.max\(0,/.test(line[0]) && /Math\.floor/.test(line[0]),
      'it must still be forced to a whole number of boards, zero or more');
    // THE SCREEN HALF WAS REMOVED 2026-08-28 with the screen it named. It
    // checked that the old Sweep printed what the null boards cost before Start
    // sweep, because there they multiplied the whole run's training. On the
    // three-stage Sweep a null set is the same kept votes with their dates
    // shuffled — no training, ever — so there is no training cost to state and
    // nothing to re-point this at. The engine half above is the part that
    // guards the owner's decision, and it stands.
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    for (const id of ['swNull1', 'swNull3']) {
      const box = ui.match(new RegExp(`<input id="${id}"[^>]*>`));
      assert.ok(box, `the ${id} box must still exist`);
      assert.ok(!/max="/.test(box[0]),
        `#${id} carries a max — ${box[0]} — so the box refuses what the backend accepts`);
    }
  },
  async everyCommitteeSeatIsADistinctOpinion() {
    // The removed "regime" dimension (2026-07-30, QC 49) filled half the
    // committee with near-copies — same view, same algorithm, ~90% identical
    // training rows — so quorum counts read inflated. This guards against any
    // member dimension that does not change what the member LOOKS AT or HOW
    // it learns: every promoted seat must be a unique (view, model) pair and
    // specs must carry nothing else.
    const { specsFor } = require('../lib/bracketwork');
    // four readings for a coin on its own, five when it is read alongside
    // others (owner order, 2026-08-28: the fourth reading, so a single has
    // 8 members too)
    for (const [size, views] of [[1, 4], [2, 5], [3, 5]]) {
      const prom = specsFor(size, 'promoted');
      assert.strictEqual(prom.length, views * 2, `promoted committee for size ${size}`);
      const keys = new Set(prom.map((s) => `${s.view}|${s.model}`));
      assert.strictEqual(keys.size, prom.length, 'duplicate (view, model) seats');
      for (const s of prom) {
        assert.deepStrictEqual(Object.keys(s).sort(), ['model', 'view'],
          `spec carries extra dimensions: ${JSON.stringify(s)}`);
      }
      const slim = specsFor(size, 'slim');
      assert.strictEqual(slim.length, views, `slim committee for size ${size}`);
    }
  },
  async rotationTagSurvivesPromotion() {
    // A multi-rotation null is one job holding several draws. If the shift tag
    // does not survive into the promoted payload, every draw silently runs the
    // SAME rotation and the "distribution" is one number repeated.
    const b = { geometry: 'daily-3d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
    const units = [
      { c: { trade: 'AUSDT', ctx1: null, ctx2: null, size: 1 }, b, shiftFrac: 0.25 },
      { c: { trade: 'AUSDT', ctx1: null, ctx2: null, size: 1 }, b, shiftFrac: 0.75 },
    ];
    const out = promotionSet({ edgeScreen: true, promoteK: 1 }, { leaders: [] }, units);
    assert.strictEqual(out.length, 2);
    assert.deepStrictEqual(out.map((r) => r.shiftFrac), [0.25, 0.75]);
    // A unit with NO stance must promote with NO shiftFrac key at all —
    // presence is the stance (audit 2026-07-30): forcing null here is what
    // made run-wide labelShiftFrac jobs silently never rotate, because an
    // explicit null means "this unit must not rotate".
    const plain = promotionSet({ edgeScreen: true }, { leaders: [] }, [{ c: units[0].c, b }]);
    assert.ok(!('shiftFrac' in plain[0]), 'no stance must stay absent, not become an explicit null');
    // ...while a REAL arm inside a reps job (explicit null) keeps its null.
    const realArm = promotionSet({ edgeScreen: true }, { leaders: [] }, [{ c: units[0].c, b, shiftFrac: null }]);
    assert.strictEqual(realArm[0].shiftFrac, null);
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
