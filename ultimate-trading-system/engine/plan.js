'use strict';
// engine/plan.js -- ONE DECISION, CARRIED OUT (the new trading engine, loop of
// 2026-09-25; LOOP-2026-09-25-ENGINE.md).
//
// A plan is one decision of one setup: the call the committee made, the trade
// shape the greenlighted configuration carries (entry, gate, d, t, trail, arm),
// and the size. This file turns the prices that happen into the orders that
// shape calls for, and nothing else. It is PURE: step(state, event) returns the
// next state and the actions to take. It reads no clock, opens no connection and
// knows no exchange.
//
// ONE PATH FOR PAPER BOOKS AND LIVE TRADING (owner, 2026-09-25: "everything is
// 100% identical between Paper Books and Live Trading ... following the price
// action, moving stops, closing positions"). Nothing here asks which book a plan
// is on. The mode travels with every action to the exchange module, and only the
// module differs: the simulated exchange answers paper, the venue answers live.
//
// THE RULES ARE THE LAB'S (lib/bracket.js simBracket, simMarket), carried from
// hourly bars to prices as they print:
//   * breakout: at the entry hour the reference is that hour's opening price p;
//     two levels at p(1+d) and p(1-d), d = dMult x band. The gate says which may
//     open: 'active' both when the committee speaks, 'directional' only the one
//     the call points to. Reaching a level opens the position; the other level
//     is its stop.
//   * the stop sits still unless the configuration trails it: once the best
//     price since the entry has gone arm (armMult x band) in the position's
//     favour, the stop follows it trail (trailMult x band) behind and only ever
//     tightens. THE TRAIL MOVES ONCE AN HOUR, AS THE LAB PRICED IT: the stop is
//     checked against every price as it prints, and at the end of each whole
//     hour after the entry hour the best price of that hour is taken and the
//     stop ratcheted -- exactly the lab's bar (stop checked first, then the
//     bar's best, then the arm and the trail), so what trades is what was
//     measured (loop decision record).
//   * market: the position opens at the entry hour's opening price in the
//     called direction, with no levels and no stop.
//   * whatever is open at t hours after the entry hour closes at the first price
//     at or after that moment.
// The engine watches the price and sends the order itself when a level is
// reached, which every venue can carry out; a venue module that can hold such an
// order natively may do so behind the same action (LOOP decision record).
//
// NO AI anywhere: deterministic arithmetic over printed prices.

const HOUR_MS = 3600000;
const ENTRIES = ['breakout', 'market'];
const GATES = ['active', 'directional'];
const MODES = ['simulated', 'live'];
// the phases a plan ends in: nothing happens to it after one of these
const TERMINAL = ['closed', 'expired', 'skipped', 'failed', 'cancelled'];
// the phases the engine must keep watching prices for
const WATCHING = ['waiting', 'armed', 'entering', 'open', 'exiting'];

// A plan the engine can carry out, or the reasons it cannot, in words.
function planProblems(plan) {
  const out = [];
  const p = plan || {};
  if (typeof p.planId !== 'string' || !p.planId) out.push('planId: required');
  if (typeof p.setupId !== 'string' || !p.setupId) out.push('setupId: required');
  if (!MODES.includes(p.mode)) out.push(`mode: must be one of ${MODES.join(' / ')} -- a plan without one is refused, never taken as live`);
  if (typeof p.symbol !== 'string' || !/^[A-Z0-9]{5,20}$/.test(p.symbol)) out.push('symbol: required');
  if (!Number.isFinite(p.entryTs)) out.push('entryTs: the hour whose opening price is the reference, in ms');
  if (![1, -1, 0].includes(p.call)) out.push('call: 1, -1 or 0');
  const c = p.cell || {};
  if (!ENTRIES.includes(c.entry)) out.push(`cell.entry: one of ${ENTRIES.join(' / ')}`);
  if (c.entry === 'breakout' && !GATES.includes(c.gate)) out.push(`cell.gate: one of ${GATES.join(' / ')}`);
  if (!Number.isFinite(c.tHours) || c.tHours <= 0) out.push('cell.tHours: a positive hold in hours');
  if (c.entry === 'breakout' && !(Number.isFinite(c.dMult) && c.dMult > 0)) out.push('cell.dMult: required for breakout');
  for (const k of ['trailMult', 'armMult']) if (c[k] != null && !(Number.isFinite(c[k]) && c[k] >= 0)) out.push(`cell.${k}: null or a number 0 or more`);
  if (c.entry === 'breakout' && !(Number.isFinite(p.bandPct) && p.bandPct > 0)) out.push('bandPct: the band the multiples are read against');
  const s = p.size || {};
  if (!Number.isFinite(s.quoteUsd) || s.quoteUsd < 0) out.push('size.quoteUsd: the money the position is opened with');
  return out;
}

function sidesOf(plan) {
  const call = plan.call;
  if (plan.cell.entry === 'market') return call === 1 ? [1] : call === -1 ? [-1] : [];
  if (plan.cell.gate === 'active') return call !== 0 ? [1, -1] : [];
  return call === 1 ? [1] : call === -1 ? [-1] : [];
}

function newState(plan) {
  const problems = planProblems(plan);
  if (problems.length) throw new Error(`plan refused: ${problems.join('; ')}`);
  const c = plan.cell;
  const band = Number(plan.bandPct) || 0;
  return {
    planId: plan.planId,
    phase: 'waiting',
    endTs: plan.entryTs + c.tHours * HOUR_MS,
    sides: sidesOf(plan),
    d: c.entry === 'breakout' ? (c.dMult * band) / 100 : null,
    trail: c.trailMult == null ? null : (c.trailMult * band) / 100,
    arm: c.armMult == null ? 0 : (c.armMult * band) / 100,
    ref: null,
    rails: null,
    dir: 0,
    entry: null,
    qty: null,
    stop: null,
    ext: null,
    armed: false,
    openHour: null,
    curHour: null,
    hourSeen: false,
    hourBest: null,
    exit: null,
    reason: null,
    inFlight: null,
    seq: 0,
  };
}

// an order the runner hands to the exchange module; `atLevel` is the price the
// rule reached (the lab fills exactly there; the simulated exchange and the
// venue fill where the market lets them)
function order(state, plan, side, purpose, atLevel, why) {
  state.seq += 1;
  return {
    kind: 'order', orderId: `${plan.planId}#${state.seq}`, mode: plan.mode, symbol: plan.symbol,
    side, purpose, type: 'market', atLevel, why,
    quoteUsd: purpose === 'enter' ? plan.size.quoteUsd : null,
    qty: purpose === 'exit' ? state.qty : null,
  };
}
const note = (what, detail) => ({ kind: 'note', what, ...detail });

function openTrigger(state, plan, price, ts) {
  // the first level a printed price reaches opens the position
  const acts = [];
  if (state.sides.includes(1) && price >= state.rails.buy) {
    state.phase = 'entering';
    state.inFlight = { purpose: 'enter', dir: 1, level: state.rails.buy };
    acts.push(order(state, plan, 'BUY', 'enter', state.rails.buy, 'the price reached the buying level'));
    acts.push(note('level reached', { level: state.rails.buy, side: 'LONG', price, ts }));
  } else if (state.sides.includes(-1) && price <= state.rails.sell) {
    state.phase = 'entering';
    state.inFlight = { purpose: 'enter', dir: -1, level: state.rails.sell };
    acts.push(order(state, plan, 'SELL', 'enter', state.rails.sell, 'the price reached the selling level'));
    acts.push(note('level reached', { level: state.rails.sell, side: 'SHORT', price, ts }));
  }
  return acts;
}

function closeOrder(state, plan, atLevel, reason, price, ts) {
  state.phase = 'exiting';
  state.inFlight = { purpose: 'exit', reason };
  return [
    order(state, plan, state.dir === 1 ? 'SELL' : 'BUY', 'exit', atLevel, reason),
    note('closing', { reason, level: atLevel, price, ts }),
  ];
}

// the hour a moment falls in, counted from the entry hour (the lab's bars)
const hourOf = (plan, ts) => Math.floor((ts - plan.entryTs) / HOUR_MS);
const betterThan = (dir, a, b) => (b == null ? true : (dir === 1 ? a > b : a < b));

// THE END OF AN HOUR: the lab's trail step for the bar just finished, when it
// was a whole hour after the entry hour and saw at least one price
function endOfHour(state, plan, ts) {
  const acts = [];
  if (state.trail == null || !state.hourSeen || state.curHour == null || state.curHour <= state.openHour) return acts;
  if (state.hourBest != null && betterThan(state.dir, state.hourBest, state.ext)) state.ext = state.hourBest;
  const wasArmed = state.armed;
  if (state.armed || (state.dir === 1 ? state.ext >= state.entry * (1 + state.arm) : state.ext <= state.entry * (1 - state.arm))) {
    state.armed = true;
    const want = state.dir === 1 ? state.ext * (1 - state.trail) : state.ext * (1 + state.trail);
    const next = state.stop == null ? want : (state.dir === 1 ? Math.max(state.stop, want) : Math.min(state.stop, want));
    if (next !== state.stop) {
      state.stop = next;
      acts.push(note('stop moved', { stop: state.stop, best: state.ext, ts }));
    }
  }
  if (!wasArmed && state.armed) acts.push(note('trail armed', { best: state.ext, ts }));
  return acts;
}
function rollTo(state, plan, ts) {
  const h = hourOf(plan, ts);
  if (state.curHour != null && h <= state.curHour) return [];
  const acts = endOfHour(state, plan, ts);
  state.curHour = h;
  state.hourSeen = false;
  state.hourBest = null;
  return acts;
}

// the position follows the price: the hour's end first, then the stop against
// this price, then this price counted toward the hour's best
function follow(state, plan, price, ts) {
  if (ts >= state.endTs) return closeOrder(state, plan, price, 'time', price, ts);
  const acts = rollTo(state, plan, ts);
  if (state.stop != null && (state.dir === 1 ? price <= state.stop : price >= state.stop)) {
    return acts.concat(closeOrder(state, plan, state.stop, state.armed ? 'trailing stop' : 'stop', price, ts));
  }
  if (state.curHour > state.openHour) {
    state.hourSeen = true;
    if (betterThan(state.dir, price, state.hourBest)) state.hourBest = price;
  }
  return acts;
}

// step(state, plan, event) -> actions; `state` is changed in place and also returned by the caller's choice
function step(state, plan, ev) {
  const acts = [];
  const t = ev.type;
  if (TERMINAL.includes(state.phase)) return acts;
  if (t === 'cancel') {
    // the owner took the plan back: nothing open is simply ended; an open position is closed at the market
    if (state.phase === 'waiting' || state.phase === 'armed') { state.phase = 'cancelled'; state.reason = ev.why || 'cancelled'; acts.push(note('cancelled', { reason: state.reason, ts: ev.ts })); }
    else if (state.phase === 'open') return closeOrder(state, plan, null, ev.why || 'cancelled', null, ev.ts);
    else if (state.phase === 'entering') state.cancelAfterEntry = ev.why || 'cancelled';
    return acts;
  }
  if (t === 'ref') {
    if (state.phase !== 'waiting') return acts;
    if (!(Number.isFinite(ev.price) && ev.price > 0)) return acts;
    state.ref = ev.price;
    if (!state.sides.length) { state.phase = 'skipped'; state.reason = 'the committee did not speak'; acts.push(note('skipped', { reason: state.reason })); return acts; }
    if (!(plan.size.quoteUsd > 0)) { state.phase = 'skipped'; state.reason = 'sized to nothing'; acts.push(note('skipped', { reason: state.reason })); return acts; }
    if (plan.cell.entry === 'market') {
      state.phase = 'entering';
      const dir = state.sides[0];
      state.inFlight = { purpose: 'enter', dir, level: ev.price };
      acts.push(order(state, plan, dir === 1 ? 'BUY' : 'SELL', 'enter', ev.price, 'market entry at the entry hour'));
      return acts;
    }
    state.rails = { buy: ev.price * (1 + state.d), sell: ev.price * (1 - state.d) };
    state.phase = 'armed';
    acts.push(note('levels set', { ref: ev.price, buy: state.sides.includes(1) ? state.rails.buy : null, sell: state.sides.includes(-1) ? state.rails.sell : null, ts: ev.ts }));
    return acts;
  }
  if (t === 'price') {
    if (state.phase === 'armed') {
      if (ev.ts >= state.endTs) { state.phase = 'expired'; state.reason = 'no level was reached in the hold'; acts.push(note('expired', { ts: ev.ts })); return acts; }
      return openTrigger(state, plan, ev.price, ev.ts);
    }
    if (state.phase === 'open') return follow(state, plan, ev.price, ev.ts);
    return acts;
  }
  if (t === 'time') {
    if (state.phase === 'armed' && ev.ts >= state.endTs) { state.phase = 'expired'; state.reason = 'no level was reached in the hold'; acts.push(note('expired', { ts: ev.ts })); }
    else if (state.phase === 'open' && ev.ts >= state.endTs) return closeOrder(state, plan, null, 'time', null, ev.ts);
    else if (state.phase === 'open') return rollTo(state, plan, ev.ts);
    return acts;
  }
  if (t === 'filled') {
    if (!state.inFlight || ev.purpose !== state.inFlight.purpose) return acts;
    if (ev.purpose === 'enter') {
      const dir = state.inFlight.dir;
      state.dir = dir;
      state.entry = ev.price;
      state.qty = ev.qty;
      state.ext = ev.price;
      state.armed = false;
      // the hour it opened in is the entry bar: the trail starts with the next whole hour
      state.openHour = hourOf(plan, ev.ts);
      state.curHour = state.openHour;
      state.hourSeen = false;
      state.hourBest = null;
      // the other level is the stop; a market entry has none
      state.stop = plan.cell.entry === 'breakout' ? (dir === 1 ? state.rails.sell : state.rails.buy) : null;
      state.phase = 'open';
      state.inFlight = null;
      acts.push(note('opened', { side: dir === 1 ? 'LONG' : 'SHORT', price: ev.price, qty: ev.qty, stop: state.stop, ts: ev.ts }));
      if (state.cancelAfterEntry) return acts.concat(closeOrder(state, plan, null, state.cancelAfterEntry, null, ev.ts));
      return acts;
    }
    state.exit = ev.price;
    state.reason = state.inFlight.reason;
    state.phase = 'closed';
    state.inFlight = null;
    acts.push(note('closed', { price: ev.price, reason: state.reason, ts: ev.ts }));
    return acts;
  }
  if (t === 'refused') {
    // an entry the exchange refused is no trade; an exit it refused is sent again by the runner until it is taken
    if (state.inFlight && state.inFlight.purpose === 'enter' && ev.purpose === 'enter') {
      state.phase = 'failed'; state.reason = `the entry was refused: ${ev.why || 'no reason given'}`; state.inFlight = null;
      acts.push(note('failed', { reason: state.reason }));
    }
    return acts;
  }
  return acts;
}

// the money the lab books for a closed plan, per unit of size: its own arithmetic (lib/bracket.js)
function labMoney(state, notional, feePerLeg) {
  if (state.phase !== 'closed' || !Number.isFinite(state.entry) || !Number.isFinite(state.exit)) return null;
  const trip = notional * 2 * feePerLeg;
  return state.dir === 1 ? notional * (state.exit / state.entry - 1) - trip : notional * (1 - state.exit / state.entry) - trip;
}

module.exports = { planProblems, newState, step, sidesOf, labMoney, hourOf, HOUR_MS, ENTRIES, GATES, MODES, TERMINAL, WATCHING };
