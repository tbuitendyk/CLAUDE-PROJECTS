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
  // a trail wider than the other level is from the entry: the stop stays at the other level until the trail
  // passes it, and never moves back -- the one kind where the ratchet's floor decides the trade
  { name: 'breakout active, a wide trail that must not loosen the stop', cell: { entry: 'breakout', gate: 'active', dMult: 0.5, tHours: 65, trailMult: 2.0, armMult: 0 }, band: 5 },
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

// ---- THE ENGINE RUNNING: a plan through the simulated exchange, on a market
// scripted here (no network), every step written down -------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');

function fakeMarket() {
  const m = {
    followed: new Set(), books: new Map(), trades: new Map(), opens: new Map(), mins: [],
    follow(s) { m.followed = new Set(s); },
    book: (s) => m.books.get(s) || null,
    trade: (s) => m.trades.get(s) || null,
    filtersOf: async () => ({ tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5, baseAsset: 'LTC', quoteAsset: 'USDT' }),
    hourOpenOf: async (s, t) => m.opens.get(`${s}|${t}`) ?? null,
    minutes: async () => m.mins,
    status: () => ({ feed: 'fake', connected: true }),
  };
  return m;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

module.exports.aPlanRunsThroughTheSimulatedExchangeAndEveryStepIsWrittenDown = async function () {
  const { Journal } = require('../engine/journal');
  const { Runner } = require('../engine/runner');
  const { SimulatedExchange } = require('../engine/venues/simulated');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
  const t0 = Date.UTC(2026, 8, 26, 1);   // the entry hour
  let now = t0 - 60000;
  const market = fakeMarket();
  const journal = new Journal(path.join(dir, 'journal.jsonl'));
  const sim = new SimulatedExchange({ market, feePerLeg: 0.001, now: () => now });
  const runner = new Runner({ journal, market, venues: { simulated: sim }, now: () => now });
  const plan = {
    planId: 'setup-a|2026-09-22', setupId: 'setup-a', mode: 'simulated', symbol: 'LTCUSDT', entryTs: t0, call: 1,
    cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 }, bandPct: 5,
    size: { quoteUsd: 100 }, feePerLeg: 0.001, walletStartUsd: 1000,
  };
  // S5: a live plan is refused on an engine with real orders off
  const live = runner.addPlan({ ...plan, planId: 'x', mode: 'live' });
  assert.ok(!live.ok && live.problems.some((p) => /real orders are switched off on this platform/.test(p)), JSON.stringify(live));
  assert.deepStrictEqual(runner.addPlan(plan).ok, true);
  assert.deepStrictEqual(runner.addPlan(plan).already, true, 'the same plan twice is the same plan');
  assert.ok(market.followed.has('LTCUSDT'), 'the engine follows the symbol a plan is on');
  // the entry hour opens at 70.00: levels at 72.625 and 67.375
  now = t0;
  runner.onKline({ symbol: 'LTCUSDT', openTime: t0, open: 70 });
  let st = runner.plans.get(plan.planId).state;
  assert.deepStrictEqual([st.phase, st.rails.buy, st.rails.sell], ['armed', 70 * 1.0375, 70 * 0.9625]);
  // the book the fill will walk, and a print that reaches the buying level
  market.books.set('LTCUSDT', { bids: [[72.6, 1], [72.5, 5]], asks: [[72.7, 0.5], [72.8, 5]], ts: now });
  market.trades.set('LTCUSDT', { price: 72.63, ts: now });
  now = t0 + 10 * 60000;
  market.books.get('LTCUSDT').ts = now;
  runner.onTrade({ symbol: 'LTCUSDT', price: 72.63, ts: now });
  await settle();
  st = runner.plans.get(plan.planId).state;
  const led = runner.plans.get(plan.planId).ledger;
  assert.strictEqual(st.phase, 'open');
  // 100 / 72.7 = 1.375 (to the step); 0.5 at 72.7 and 0.875 at 72.8
  assert.strictEqual(led.entry.qty, 1.375);
  assert.ok(Math.abs(led.entry.price - (0.5 * 72.7 + 0.875 * 72.8) / 1.375) < 1e-12, `${led.entry.price}`);
  assert.deepStrictEqual(led.entry.against.levels, [[72.7, 0.5], [72.8, 0.875]], 'the fill records the levels it took');
  assert.strictEqual(st.stop, 70 * 0.9625, 'the other level is the stop');
  // the next whole hour runs to 76.5 (past arm at +2.5%): at its end the stop follows 7.5% behind
  now = t0 + H + 60000;
  runner.onTrade({ symbol: 'LTCUSDT', price: 76.5, ts: now });
  now = t0 + 2 * H + 1000;
  runner.tick();
  st = runner.plans.get(plan.planId).state;
  assert.deepStrictEqual([st.armed, st.stop], [true, 76.5 * 0.925], 'armed and ratcheted at the hour\'s end');
  // a print through the stop closes it; the exit walks the bids
  market.books.set('LTCUSDT', { bids: [[70.7, 0.4], [70.6, 5]], asks: [[70.8, 5]], ts: now });
  runner.onTrade({ symbol: 'LTCUSDT', price: 70.7, ts: now });
  await settle();
  st = runner.plans.get(plan.planId).state;
  assert.deepStrictEqual([st.phase, st.reason], ['closed', 'trailing stop']);
  const x = runner.plans.get(plan.planId).ledger;
  const exitPrice = (0.4 * 70.7 + 0.975 * 70.6) / 1.375;
  assert.ok(Math.abs(x.exit.price - exitPrice) < 1e-12);
  const want = 1.375 * (exitPrice - x.entry.price) - x.entry.feeUsd - x.exit.feeUsd;
  assert.ok(Math.abs(x.pnlUsd - want) < 1e-9, `${x.pnlUsd} vs ${want}`);
  assert.ok(!market.followed.has('LTCUSDT'), 'a closed plan is no longer followed');
  // everything written down, in order
  const kinds = journal.since(1, 1000).map((r) => r.type === 'note' ? `note:${r.what}` : r.type);
  for (const k of ['plan', 'note:levels set', 'note:level reached', 'order', 'fill', 'note:opened', 'note:trail armed', 'note:stop moved', 'note:closing', 'note:closed']) assert.ok(kinds.includes(k), `${k} is in the record: ${kinds.join(' ')}`);
  // A RESTART READS IT ALL BACK
  const again = new Runner({ journal: new Journal(path.join(dir, 'journal.jsonl')), market: fakeMarket(), venues: { simulated: sim }, now: () => now });
  assert.strictEqual(again.recover(), 1);
  const r2 = again.plans.get(plan.planId);
  assert.deepStrictEqual([r2.state.phase, r2.ledger.pnlUsd], ['closed', x.pnlUsd], 'the same plan, where it ended, with its money');
  fs.rmSync(dir, { recursive: true, force: true });
};

// A PLAN WHOSE HOUR BEGAN BEFORE IT ARRIVED: its reference is asked of the
// exchange; if a level was already reached, it is skipped in words, never
// entered late as though it were the same trade
module.exports.aLatePlanIsSkippedWhenALevelWasAlreadyReached = async function () {
  const { Journal } = require('../engine/journal');
  const { Runner } = require('../engine/runner');
  const { SimulatedExchange } = require('../engine/venues/simulated');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
  const t0 = Date.UTC(2026, 8, 26, 1);
  let now = t0 + 30 * 60000;
  const market = fakeMarket();
  market.opens.set(`LTCUSDT|${t0}`, 70);
  market.mins = [{ ts: t0 + 5 * 60000, open: 70, high: 72.9, low: 69.9, close: 72 }];
  const journal = new Journal(path.join(dir, 'journal.jsonl'));
  const runner = new Runner({ journal, market, venues: { simulated: new SimulatedExchange({ market, feePerLeg: 0.001 }) }, now: () => now });
  const base = { setupId: 's', mode: 'simulated', symbol: 'LTCUSDT', entryTs: t0, call: -1, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: null, armMult: null }, bandPct: 5, size: { quoteUsd: 100 } };
  runner.addPlan({ ...base, planId: 'late-1' });
  runner.tick();
  await settle(); await settle();
  const st = runner.plans.get('late-1').state;
  assert.strictEqual(st.phase, 'skipped');
  assert.ok(/late: the price reached a level at 01:05 UTC, before the plan reached the platform/.test(st.reason), st.reason);
  // no level reached yet: the late plan is armed on the hour's opening price
  market.mins = [{ ts: t0 + 5 * 60000, open: 70, high: 71, low: 69.5, close: 70.5 }];
  runner.addPlan({ ...base, planId: 'late-2' });
  runner.tick();
  await settle(); await settle();
  assert.deepStrictEqual([runner.plans.get('late-2').state.phase, runner.plans.get('late-2').state.ref], ['armed', 70]);
  fs.rmSync(dir, { recursive: true, force: true });
};

// THE WEBSOCKET CLIENT against a server on this machine: the upgrade checked,
// text messages read whole, a ping answered with a pong
module.exports.theWebsocketClientReadsMessagesAndAnswersPings = async function () {
  const net = require('net');
  const crypto = require('crypto');
  const { WebSocketClient } = require('../engine/ws');
  let pong = null;
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let up = false;
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      if (!up) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(buf.slice(0, end).toString())[1];
        buf = buf.slice(end + 4);
        up = true;
        const acc = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
        const frame = (op, text) => { const p = Buffer.from(text); return Buffer.concat([Buffer.from([0x80 | op, p.length]), p]); };
        sock.write(frame(1, '{"data":{"e":"trade"}}'));
        sock.write(frame(9, 'hi'));
        return;
      }
      if (buf.length >= 2 && (buf[0] & 0x0f) === 0xA) {
        const len = buf[1] & 0x7f; const mask = buf.slice(2, 6);
        pong = Buffer.from(buf.slice(6, 6 + len).map((x, i) => x ^ mask[i % 4])).toString();
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ws = new WebSocketClient(`ws://127.0.0.1:${server.address().port}/stream?streams=x`);
  const got = await new Promise((resolve, reject) => { ws.on('message', resolve); ws.on('error', reject); ws.connect(); });
  await settle(); await settle();
  assert.strictEqual(got, '{"data":{"e":"trade"}}');
  assert.strictEqual(pong, 'hi', 'the ping is answered with its own payload');
  ws.close(); server.close();
};

// S6 AND D6: THE SIMULATED EXCHANGE FILLS ONLY WHAT THE LIVE BOOK HOLDS. A
// market order walks the book for its size and records the levels it took; an
// order the book cannot fill in full, a book too old to trust, a size under the
// venue's step or its smallest order, and an order that says any mode but
// simulated are each refused in words -- never filled at an invented price.
module.exports.theSimulatedExchangeFillsOnlyWhatTheLiveBookHolds = async function () {
  const { SimulatedExchange } = require('../engine/venues/simulated');
  const now = Date.UTC(2026, 8, 26, 2);
  const market = fakeMarket();
  const sim = new SimulatedExchange({ market, feePerLeg: 0.001, maxBookAgeMs: 3000, now: () => now });
  const order = (x) => sim.placeOrder({ mode: 'simulated', setupId: 's', symbol: 'LTCUSDT', purpose: 'enter', side: 'BUY', ...x });
  let r = await order({ mode: 'live', qty: 1 });
  assert.ok(r.status === 'refused' && /this is the simulated exchange and the order says "live"/.test(r.why), JSON.stringify(r));
  r = await order({ qty: 1 });
  assert.ok(r.status === 'refused' && /no live order book for this symbol yet/.test(r.why), JSON.stringify(r));
  market.books.set('LTCUSDT', { bids: [[69.9, 1], [69.8, 2]], asks: [[70, 1], [70.1, 2]], ts: now - 5000 });
  r = await order({ qty: 1 });
  assert.ok(r.status === 'refused' && /the live order book is 5 seconds old/.test(r.why), JSON.stringify(r));
  market.books.get('LTCUSDT').ts = now - 100;
  r = await order({ qty: 3.5 });
  assert.ok(r.status === 'refused' && /the live order book's top 2 levels hold less than 3\.5/.test(r.why), JSON.stringify(r));
  r = await order({ qty: 0.0004 });
  assert.ok(r.status === 'refused' && /under the exchange's smallest step or quantity/.test(r.why), JSON.stringify(r));
  r = await order({ qty: 0.05 });
  assert.ok(r.status === 'refused' && /the order is worth 3\.50, under the exchange's smallest order of 5/.test(r.why), JSON.stringify(r));
  // a buy walks up the asks for its size, and pays the account's fee on what it took
  r = await order({ qty: 2 });
  assert.strictEqual(r.status, 'filled');
  assert.deepStrictEqual(r.against.levels, [[70, 1], [70.1, 1]], 'the levels it took');
  assert.ok(Math.abs(r.price - 70.05) < 1e-12, `${r.price}`);
  assert.ok(Math.abs(r.feeUsd - 140.1 * 0.001) < 1e-12, `${r.feeUsd}`);
  assert.deepStrictEqual([r.against.bestBid, r.against.bestAsk, r.against.bookAgeMs], [69.9, 70, 100], 'what it filled against');
  // a sell sized in dollars walks down the bids, its quantity floored to the venue's step
  r = await order({ side: 'SELL', quoteUsd: 100 });
  assert.strictEqual(r.status, 'filled');
  assert.strictEqual(r.qty, 1.43, 'the dollars at the best bid, floored to the step: 100 / 69.9 = 1.4306');
  assert.deepStrictEqual(r.against.levels.map((l) => l[0]), [69.9, 69.8]);
};

// A TAKE-BACK FOR ENTRIES ONLY (a setup that stopped): a plan still waiting is
// cancelled; a position already open is left to close by its own rules; the
// owner's plain take-back still closes an open position at the market
module.exports.aTakeBackForEntriesOnlyLeavesAnOpenPositionAlone = function () {
  const plan = { planId: 'p', setupId: 's', mode: 'simulated', symbol: 'LTCUSDT', entryTs: Date.UTC(2026, 8, 26, 1), call: 1, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 }, bandPct: 5, size: { quoteUsd: 100 } };
  const waiting = P.newState(plan);
  P.step(waiting, plan, { type: 'cancel', why: 'the setup is stopped: it takes no new entry', entriesOnly: true, ts: plan.entryTs - 1000 });
  assert.deepStrictEqual([waiting.phase, waiting.reason], ['cancelled', 'the setup is stopped: it takes no new entry']);
  const open = P.newState(plan);
  P.step(open, plan, { type: 'ref', price: 70, ts: plan.entryTs });
  P.step(open, plan, { type: 'price', price: 72.7, ts: plan.entryTs + 60000 });
  P.step(open, plan, { type: 'filled', purpose: 'enter', price: 72.7, qty: 1.375, ts: plan.entryTs + 61000 });
  assert.strictEqual(open.phase, 'open');
  const acts = P.step(open, plan, { type: 'cancel', why: 'the setup is stopped: it takes no new entry', entriesOnly: true, ts: plan.entryTs + 120000 });
  assert.deepStrictEqual([open.phase, acts.length], ['open', 0], 'the open position is left to its stop and its hold');
  const closing = P.step(open, plan, { type: 'cancel', why: 'taken back by the owner', ts: plan.entryTs + 180000 });
  assert.ok(open.phase === 'exiting' && closing.some((a) => a.kind === 'order' && a.purpose === 'exit' && a.type === 'market'), 'a plain take-back closes it at the market');
};

// A MARKET ENTRY'S STOP (item 5, 3.259.0): the setup's Stop % against the
// price it opened at, reached only when a printed trade goes PAST it -- Tune's
// own boundary -- and booked at the stop; a trail tightens it with the trail's
// own boundary; a breakout plan keeps the level on the other side
module.exports.aMarketEntrysStopIsItsStopPctAndIsReachedOnlyPastIt = function () {
  const t0 = Date.UTC(2026, 8, 26, 1);
  const plan = { planId: 'm', setupId: 's', mode: 'simulated', symbol: 'LTCUSDT', entryTs: t0, call: 1, cell: { entry: 'market', gate: 'directional', tHours: 65, trailMult: null, armMult: null }, bandPct: 5, size: { quoteUsd: 100 }, stopPct: 0.05 };
  const open = (p, price, dir = 1) => {
    const st = P.newState(p);
    P.step(st, p, { type: 'ref', price, ts: p.entryTs });
    P.step(st, p, { type: 'filled', purpose: 'enter', price, qty: 100 / price, ts: p.entryTs + 1000 });
    assert.strictEqual(st.dir, dir);
    return st;
  };
  const long = open(plan, 70);
  assert.deepStrictEqual([long.stop, long.stopStrict], [66.5, true], '5% below the price it opened at');
  P.step(long, plan, { type: 'price', price: 66.5, ts: t0 + 2 * H });
  assert.strictEqual(long.phase, 'open', 'a print exactly at the stop does not reach it: the worst price must go past it');
  const acts = P.step(long, plan, { type: 'price', price: 66.49, ts: t0 + 2 * H + 1000 });
  const exit = acts.find((a) => a.kind === 'order');
  assert.deepStrictEqual([long.phase, exit.purpose, exit.atLevel, exit.why], ['exiting', 'exit', 66.5, 'stop'], 'past it: closed, booked at the stop');
  const short = open({ ...plan, call: -1 }, 70, -1);
  assert.strictEqual(short.stop, 73.5);
  P.step(short, { ...plan, call: -1 }, { type: 'price', price: 73.5, ts: t0 + 2 * H });
  assert.strictEqual(short.phase, 'open');
  // no Stop %, no stop
  assert.strictEqual(open({ ...plan, stopPct: null }, 70).stop, null);
  // a trail tightens it from there, and its stop is reached AT it
  const tp = { ...plan, cell: { ...plan.cell, trailMult: 1, armMult: 0.5 } };
  const tr = open(tp, 70);
  P.step(tr, tp, { type: 'price', price: 73, ts: t0 + H + 10000 });
  P.step(tr, tp, { type: 'price', price: 72, ts: t0 + 2 * H + 10000 });
  assert.deepStrictEqual([tr.armed, Number(tr.stop.toFixed(4)), tr.stopStrict], [true, 69.35, false], 'armed past 71.75, stop 5% behind the best of 73');
  P.step(tr, tp, { type: 'price', price: tr.stop, ts: t0 + 2 * H + 20000 });
  assert.strictEqual(tr.phase, 'exiting', 'the trail\'s stop is reached at it');
  // a breakout plan keeps the level on the other side, whatever Stop % says
  const bp = { ...plan, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: null, armMult: null } };
  const b = P.newState(bp);
  P.step(b, bp, { type: 'ref', price: 70, ts: t0 });
  P.step(b, bp, { type: 'price', price: 72.7, ts: t0 + 60000 });
  P.step(b, bp, { type: 'filled', purpose: 'enter', price: 72.625, qty: 1.37, ts: t0 + 61000 });
  assert.deepStrictEqual([b.fixedStop, b.stop, b.stopStrict], [null, 70 * (1 - 0.0375), false]);
  // a Stop % outside (0, 1) is refused with the plan, in words
  assert.deepStrictEqual(P.planProblems({ ...plan, stopPct: 1.2 }), ['stopPct: a fraction of the price the position opened at, above 0 and below 1, or none']);
};
