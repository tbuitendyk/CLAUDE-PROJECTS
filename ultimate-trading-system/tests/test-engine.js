// The new trading engine (LOOP-2026-09-25-ENGINE.md). The rules a plan is
// carried out by are the lab's, carried from hourly bars to prices as they
// print; these tests hold the two together to the cent (S3), and hold the plan
// to one path whatever book it is on (S2).
const { assert } = require('./helpers');
const P = require('../engine/plan');
const bracketLib = require('../lib/bracket');
const { mulberry32 } = require('../lib/rng');

const H = P.HOUR_MS;
const NOTIONAL = require('../lib/paper').NOTIONAL;

// a coin's hourly candles, made up and seeded: a walk with enough movement to
// reach levels a few percent away in its wild stretches and not in its calm
// ones, a few hours missing and a few invented
function fabricatedCandles(seed, hours, t0) {
  const rng = mulberry32(seed);
  const map = new Map();
  let price = 70;
  for (let h = 0; h < hours; h++) {
    const ts = t0 + h * H;
    const open = price;
    // calm stretches and wild ones, so some plans meet no level in their hold and others meet both
    const vol = Math.floor(h / 150) % 3 === 0 ? 0.1 : 1;
    const drift = (rng() - 0.5) * 0.03 * vol;
    const close = Math.max(1, open * (1 + drift));
    const high = Math.max(open, close) * (1 + rng() * 0.012 * vol);
    const low = Math.min(open, close) * (1 - rng() * 0.012 * vol);
    price = close;
    const r = rng();
    if (r < 0.004) continue;                     // an hour the exchange has no candle for
    map.set(ts, { ts, open, high, low, close, ...(r > 0.997 ? { filled: true } : {}) });
  }
  return map;
}

// THE LAB'S PRICES FED AS PRINTS, in the lab's own worst-case order within each
// hour: a flat plan meets the side it would open on first, and then the other
// extreme; an open position meets its adverse extreme before its favourable one.
// Every order fills exactly at the level the rule reached, as the lab books it.
function throughTheLabsPrices(plan, tradeMap) {
  const st = P.newState(plan);
  const refRaw = tradeMap.get(plan.entryTs);
  if (!refRaw || refRaw.filled) return { unpriced: true, st };
  const feed = (ev) => {
    const acts = P.step(st, plan, ev);
    for (const a of acts) if (a.kind === 'order') P.step(st, plan, { type: 'filled', purpose: a.purpose, price: a.atLevel, qty: 1, ts: ev.ts });
  };
  const live = () => st.phase === 'armed' || st.phase === 'open';
  feed({ type: 'ref', price: refRaw.open, ts: plan.entryTs });
  for (let h = 0; h < plan.cell.tHours && live(); h++) {
    const ts = plan.entryTs + h * H;
    const bar = tradeMap.get(ts);
    if (!bar) continue;
    let path;
    if (st.phase === 'armed') path = st.sides.includes(1) && bar.high >= st.rails.buy ? [bar.high, bar.low] : [bar.low, bar.high];
    else path = st.dir === 1 ? [bar.low, bar.high] : [bar.high, bar.low];
    for (const p of path) { if (!live()) break; feed({ type: 'price', price: p, ts }); }
  }
  if (st.phase === 'armed') feed({ type: 'time', ts: st.endTs });   // the hold ends with no level reached
  if (st.phase === 'open') {
    let exitBar = null;
    let at = null;
    for (let g = 0; g <= 3 && !exitBar; g++) { at = st.endTs + g * H; exitBar = tradeMap.get(at); }
    if (!exitBar) return { unpriced: true, st };
    feed({ type: 'price', price: exitBar.open, ts: at });
  }
  return { unpriced: false, st };
}

const CELLS = [
  // the manual pick greenlighted on 2026-09-25: breakout, active, d 0.75, t 65, trail 1.5, arm 0.5, band 5
  { name: 'the manual pick', cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 }, band: 5 },
  { name: 'breakout directional, a stop that stays', cell: { entry: 'breakout', gate: 'directional', dMult: 0.5, tHours: 41, trailMult: null, armMult: null }, band: 4 },
  { name: 'breakout active, a trail armed at once', cell: { entry: 'breakout', gate: 'active', dMult: 1.0, tHours: 89, trailMult: 0.5, armMult: 0 }, band: 3 },
  { name: 'breakout directional, a tight trail armed late', cell: { entry: 'breakout', gate: 'directional', dMult: 0.25, tHours: 41, trailMult: 0.5, armMult: 1.0 }, band: 6 },
  { name: 'market', cell: { entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null }, band: 5 },
];

module.exports = {
  // S3: TO THE CENT ON THE LAB'S PRICES, for every kind of trade a rule can call for
  theEngineTakesTheLabsTradesToTheCentOnTheLabsPrices() {
    const fee = 0.00125;
    const t0 = Date.UTC(2024, 0, 1);
    const geo = { entryOffsetH: 97 };
    for (const [ci, c] of CELLS.entries()) {
      const tradeMap = fabricatedCandles(101 + ci, 24 * 420, t0);
      const rng = mulberry32(7 + ci);
      let trades = 0; let stops = 0; let trails = 0; let expired = 0; let unpriced = 0;
      for (let k = 0; k < 400; k++) {
        const period = { startTs: t0 + k * 24 * H };
        const r = rng();
        const call = r < 0.3 ? -1 : (r < 0.7 ? 1 : 0);
        const size = [0, 0.75, 1, 1.25][Math.floor(rng() * 4)];
        const lab = bracketLib.simCell(c.cell, [period], [call], tradeMap, geo, c.band, fee, undefined, [size]);
        const plan = {
          planId: `t|${k}`, setupId: 'setup-test', mode: 'simulated', symbol: 'LTCUSDT',
          entryTs: period.startTs + geo.entryOffsetH * H, call, cell: c.cell, bandPct: c.band,
          size: { quoteUsd: NOTIONAL * size },
        };
        const got = throughTheLabsPrices(plan, tradeMap);
        if (got.unpriced) { unpriced++; assert.strictEqual(lab.trades, 0, `${c.name} period ${k}: the lab priced a trade the engine could not`); continue; }
        if (lab.trades === 0) {
          assert.ok(got.st.phase !== 'closed', `${c.name} period ${k}: the engine traded (${got.st.phase}, ${got.st.reason}) where the lab did not`);
          if (got.st.phase === 'expired') expired++;
          continue;
        }
        assert.strictEqual(got.st.phase, 'closed', `${c.name} period ${k}: the lab traded and the engine ended ${got.st.phase} (${got.st.reason})`);
        const money = P.labMoney(got.st, NOTIONAL, fee) * size;
        assert.ok(Math.abs(money - lab.pnl) < 1e-9, `${c.name} period ${k}: the engine booked ${money}, the lab ${lab.pnl}`);
        trades++;
        if (got.st.reason === 'stop') stops++;
        if (got.st.reason === 'trailing stop') trails++;
      }
      assert.ok(trades > 40, `${c.name}: enough trades to mean something (${trades})`);
      // a trail armed at once takes over from the other level after the first whole hour, so there the stops are the trail's
      if (c.cell.entry === 'breakout') assert.ok(c.cell.trailMult != null && c.cell.armMult === 0 ? stops + trails > 0 : stops > 0, `${c.name}: some trades stopped at the other level (${stops})`);
      if (c.cell.trailMult != null) assert.ok(trails > 0, `${c.name}: some trades closed on the trail (${trails})`);
      if (c.cell.entry === 'breakout') assert.ok(expired > 0, `${c.name}: some plans met no level in the hold (${expired})`);
    }
  },

  // S2: ONE PATH -- the same plan on the same prices asks for the same orders and
  // passes through the same states whichever book it is on; only the mode on each
  // order differs, and a plan without a mode is refused
  aPlanRunsTheSamePathOnPaperAndLive() {
    const t0 = Date.UTC(2024, 3, 1);
    const tradeMap = fabricatedCandles(55, 24 * 30, t0);
    const base = {
      planId: 'p|1', setupId: 'setup-test', symbol: 'LTCUSDT', entryTs: t0 + 97 * H, call: 1,
      cell: CELLS[0].cell, bandPct: 5, size: { quoteUsd: 100 },
    };
    const trace = (mode) => {
      const plan = { ...base, mode };
      const st = P.newState(plan);
      const out = [];
      const feed = (ev) => {
        for (const a of P.step(st, plan, ev)) {
          out.push(a.kind === 'order' ? { ...a, mode: undefined } : a);
          if (a.kind === 'order') assert.strictEqual(a.mode, mode, 'every order carries the plan\'s mode');
          if (a.kind === 'order') for (const x of P.step(st, plan, { type: 'filled', purpose: a.purpose, price: a.atLevel, qty: 1, ts: ev.ts })) out.push(x);
        }
        out.push({ phase: st.phase, stop: st.stop });
      };
      feed({ type: 'ref', price: tradeMap.get(base.entryTs).open, ts: base.entryTs });
      for (let h = 0; h < 80; h++) {
        const bar = tradeMap.get(base.entryTs + h * H);
        if (bar) { feed({ type: 'price', price: bar.low, ts: bar.ts }); feed({ type: 'price', price: bar.high, ts: bar.ts }); }
      }
      return out;
    };
    assert.deepStrictEqual(trace('live'), trace('simulated'), 'the same orders and states on both books');
    let threw = null;
    try { P.newState({ ...base, mode: undefined }); } catch (e) { threw = e; }
    assert.ok(threw && /mode: must be one of simulated \/ live -- a plan without one is refused, never taken as live/.test(threw.message), threw && threw.message);
  },
};
