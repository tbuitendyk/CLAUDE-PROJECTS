'use strict';
// engine/runner.js -- THE ENGINE RUNNING: plans held, prices followed, orders
// sent to the exchange module the plan's mode names, every step written down.
//
// It owns no rule of its own. What a price means for a plan is engine/plan.js;
// what an order costs is the exchange module. This file only joins them, keeps
// the money each plan made, and writes every event to the journal the web box
// reads Paper Books and Live Trading from.
//
// MODE IS A PARAMETER OF EVERY CALL (owner, 2026-09-25). A plan says
// 'simulated' or 'live'; the runner hands its orders to the module registered
// for that mode and to no other. A live plan is refused outright unless real
// orders have been switched on for this engine by the owner -- nothing in the
// loop that built it switches them on.
const P = require('./plan');

const HOUR_MS = P.HOUR_MS;
const LATE_MARKET_MS = 5 * 60000;   // a market entry more than five minutes after its hour is not the trade the lab priced

class Runner {
  constructor({ journal, market, venues, liveEnabled = false, now = () => Date.now(), log = () => {} }) {
    this.journal = journal;
    this.market = market;
    this.venues = venues;           // { simulated, live? }
    this.liveEnabled = !!liveEnabled;
    this.now = now;
    this.log = log;
    this.plans = new Map();         // planId -> { plan, state, ledger, fetchingRef, lateChecked }
    this.marks = new Map();         // planId -> the last mark sent
    this.retry = new Map();         // orderId -> attempts
  }

  // ---- the journal ----
  write(event) { return this.journal.append(event, this.now()); }
  snapshot(id) {
    const r = this.plans.get(id);
    if (!r) return;
    const s = r.state;
    this.write({ type: 'state', planId: id, setupId: r.plan.setupId, mode: r.plan.mode, state: { ...s }, ledger: r.ledger });
  }

  // THE STATE AFTER A RESTART, read back out of the journal: each plan as it was
  // received and as its last snapshot left it
  recover() {
    const lastOrder = new Map();
    for (const rec of this.journal.readAll()) {
      if (rec.type === 'plan' && rec.plan) this.plans.set(rec.plan.planId, { plan: rec.plan, state: P.newState(rec.plan), ledger: emptyLedger() });
      else if (rec.type === 'state' && this.plans.has(rec.planId)) { const r = this.plans.get(rec.planId); r.state = rec.state; r.ledger = rec.ledger || r.ledger; }
      else if (rec.type === 'order' && rec.order) lastOrder.set(rec.planId, rec.order);
    }
    for (const [id, r] of this.plans) {
      // AN ORDER LEFT IN FLIGHT BY A RESTART is sent again under its own id: the
      // simulated exchange never saw it fill, and a live venue refuses an id it
      // has already taken, which the live module then asks about (stage D)
      const o = lastOrder.get(id);
      if (r.state.inFlight && o && o.purpose === r.state.inFlight.purpose) {
        this.write({ type: 'note', planId: id, what: 'an order in flight at the restart is sent again', purpose: o.purpose, orderId: o.orderId });
        this.send(r, o);
      }
    }
    this.followSymbols();
    return this.plans.size;
  }

  active() { return [...this.plans.values()].filter((r) => P.WATCHING.includes(r.state.phase)); }
  followSymbols() { this.market.follow(new Set(this.active().map((r) => r.plan.symbol))); }

  // ---- plans in ----
  addPlan(plan) {
    const problems = P.planProblems(plan);
    if (plan && plan.mode === 'live' && !this.liveEnabled) problems.push('real orders are switched off on this engine: a live plan is refused until the owner switches them on');
    if (plan && plan.mode === 'live' && !this.venues.live) problems.push('this engine has no live exchange module');
    if (problems.length) return { ok: false, problems };
    const had = this.plans.get(plan.planId);
    if (had) return { ok: true, planId: plan.planId, already: true, phase: had.state.phase };
    const rec = { plan, state: P.newState(plan), ledger: emptyLedger() };
    this.plans.set(plan.planId, rec);
    this.write({ type: 'plan', planId: plan.planId, setupId: plan.setupId, mode: plan.mode, plan });
    this.snapshot(plan.planId);
    this.followSymbols();
    return { ok: true, planId: plan.planId, phase: rec.state.phase };
  }

  cancelPlan(planId, why = 'cancelled by the owner') {
    const r = this.plans.get(planId);
    if (!r) return { ok: false, problems: [`no plan ${planId}`] };
    this.feed(planId, { type: 'cancel', why, ts: this.now() });
    return { ok: true, phase: r.state.phase };
  }

  // ---- prices in ----
  onTrade(t) {
    for (const r of this.active()) if (r.plan.symbol === t.symbol) this.feed(r.plan.planId, { type: 'price', price: t.price, ts: t.ts });
  }
  onKline(k) {
    for (const r of this.active()) {
      if (r.plan.symbol === k.symbol && r.state.phase === 'waiting' && k.openTime === r.plan.entryTs && !r.lateChecked) {
        r.lateChecked = true;
        this.feed(r.plan.planId, { type: 'ref', price: k.open, ts: k.openTime, source: 'the hour\'s candle as it opened' });
      }
    }
  }

  // THE CLOCK: expiries, time exits, the hour's end for the trail, a plan whose
  // hour began before it arrived, and the hour's borrowing on an open short
  tick() {
    const now = this.now();
    for (const r of this.active()) {
      const id = r.plan.planId;
      if (r.state.phase === 'waiting' && now >= r.plan.entryTs + 2000 && !r.lateChecked && !r.fetchingRef) this.catchUp(r);
      this.feed(id, { type: 'time', ts: now });
      this.accrue(r, now);
    }
    this.sendMarks(now);
  }

  // A PLAN WHOSE ENTRY HOUR HAS ALREADY BEGUN: its reference is that hour's
  // opening price, asked of the exchange; and if the price has already reached a
  // level since then, the lab's trade is already under way where the engine
  // cannot follow it -- the plan is skipped and the gap written down, never
  // entered late as though it were the same trade
  async catchUp(r) {
    r.fetchingRef = true;
    const id = r.plan.planId;
    try {
      const ref = await this.market.hourOpenOf(r.plan.symbol, r.plan.entryTs);
      if (ref == null) { r.fetchingRef = false; return; }
      r.lateChecked = true;
      const now = this.now();
      const c = r.plan.cell;
      if (c.entry === 'market') {
        if (now - r.plan.entryTs > LATE_MARKET_MS) { this.skip(id, `late: the plan reached the engine ${Math.round((now - r.plan.entryTs) / 60000)} minutes after its entry hour began`); return; }
      } else {
        const d = (c.dMult * r.plan.bandPct) / 100;
        const buy = ref * (1 + d);
        const sell = ref * (1 - d);
        const sides = P.sidesOf(r.plan);
        const mins = await this.market.minutes(r.plan.symbol, r.plan.entryTs, now);
        const hit = mins.find((m) => (sides.includes(1) && m.high >= buy) || (sides.includes(-1) && m.low <= sell));
        if (hit) { this.skip(id, `late: the price reached a level at ${new Date(hit.ts).toISOString().slice(11, 16)} UTC, before the plan reached the engine`); return; }
      }
      this.feed(id, { type: 'ref', price: ref, ts: r.plan.entryTs, source: 'the hour\'s opening price asked of the exchange' });
    } catch (e) {
      this.write({ type: 'note', planId: id, what: 'could not read the entry hour yet', why: e.message });
    } finally { r.fetchingRef = false; }
  }
  skip(id, why) {
    const r = this.plans.get(id);
    r.state.phase = 'skipped';
    r.state.reason = why;
    this.write({ type: 'note', planId: id, what: 'skipped', reason: why });
    this.snapshot(id);
    this.followSymbols();
  }

  // ---- the plan machine, and what it asks for ----
  feed(id, ev) {
    const r = this.plans.get(id);
    if (!r) return;
    const before = `${r.state.phase}|${r.state.stop}|${r.state.armed}`;
    const acts = P.step(r.state, r.plan, ev);
    for (const a of acts) {
      if (a.kind === 'note') this.write({ type: 'note', planId: id, setupId: r.plan.setupId, mode: r.plan.mode, ...a, kind: undefined });
      else if (a.kind === 'order') this.send(r, a);
    }
    if (`${r.state.phase}|${r.state.stop}|${r.state.armed}` !== before) {
      this.snapshot(id);
      if (!P.WATCHING.includes(r.state.phase)) this.followSymbols();
    }
  }

  venueFor(mode) {
    if (mode === 'simulated') return this.venues.simulated;
    if (mode === 'live' && this.liveEnabled) return this.venues.live || null;
    return null;
  }

  async send(r, a) {
    const id = r.plan.planId;
    const venue = this.venueFor(a.mode);
    this.write({ type: 'order', planId: id, setupId: r.plan.setupId, mode: a.mode, order: a });
    if (!venue) return this.refused(r, a, `no exchange module will take a ${a.mode} order on this engine`);
    let res;
    try {
      res = await venue.placeOrder({ ...a, setupId: r.plan.setupId, feePerLeg: r.plan.feePerLeg, walletStartUsd: r.plan.walletStartUsd });
    } catch (e) { res = { status: 'refused', why: e.message }; }
    if (res.status !== 'filled') return this.refused(r, a, res.why);
    const leg = { price: res.price, qty: res.qty, feeUsd: res.feeUsd, ts: res.ts, against: res.against, orderId: a.orderId };
    if (a.purpose === 'enter') r.ledger.entry = leg;
    else {
      r.ledger.exit = leg;
      r.ledger.pnlUsd = closedMoney(r);
    }
    this.write({ type: 'fill', planId: id, setupId: r.plan.setupId, mode: a.mode, purpose: a.purpose, side: a.side, why: a.why, ...leg });
    this.feed(id, { type: 'filled', purpose: a.purpose, price: res.price, qty: res.qty, ts: res.ts });
    return res;
  }

  refused(r, a, why) {
    const id = r.plan.planId;
    this.write({ type: 'refused', planId: id, setupId: r.plan.setupId, mode: a.mode, purpose: a.purpose, orderId: a.orderId, why });
    if (a.purpose === 'exit') {
      // AN EXIT IS SENT AGAIN UNTIL IT IS TAKEN: a position left open because
      // one close was refused is money nobody is managing
      const n = (this.retry.get(a.orderId) || 0) + 1;
      this.retry.set(a.orderId, n);
      const wait = Math.min(30000, 1000 * 2 ** Math.min(n, 5));
      setTimeout(() => { if (r.state.phase === 'exiting') this.send(r, a); }, wait).unref();
      return null;
    }
    this.feed(id, { type: 'refused', purpose: a.purpose, why });
    return null;
  }

  // THE HOUR'S BORROWING on an open short, once per hour held
  accrue(r, now) {
    if (r.state.phase !== 'open' || r.state.dir !== -1 || !r.ledger.entry) return;
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const last = r.ledger.interestHours.length ? r.ledger.interestHours[r.ledger.interestHours.length - 1].hourTs : Math.floor(r.ledger.entry.ts / HOUR_MS) * HOUR_MS - HOUR_MS;
    if (hour <= last) return;
    const venue = this.venueFor(r.plan.mode);
    const rate = venue && venue.borrowRate ? venue.borrowRate() : { rate: null, source: null };
    const row = { hourTs: hour, qty: r.ledger.entry.qty, rate: rate.rate, source: rate.source, owedBase: rate.rate == null ? null : r.ledger.entry.qty * rate.rate };
    r.ledger.interestHours.push(row);
    this.write({ type: 'interest', planId: r.plan.planId, setupId: r.plan.setupId, mode: r.plan.mode, ...row, ...(rate.rate == null ? { why: 'the borrowing rate has not been read from the venue yet' } : {}) });
  }

  // ---- live figures, not written down: the price now and the money open ----
  sendMarks(now) {
    for (const r of this.active()) {
      if (r.state.phase !== 'open' || !r.ledger.entry) continue;
      const t = this.market.trade(r.plan.symbol);
      if (!t) continue;
      const m = { type: 'mark', planId: r.plan.planId, setupId: r.plan.setupId, mode: r.plan.mode, price: t.price, ts: now, stop: r.state.stop, best: r.state.ext, armed: r.state.armed, openUsd: openMoney(r, t.price) };
      this.marks.set(r.plan.planId, m);
      this.journal.emit('mark', m);
    }
  }

  view() {
    return [...this.plans.values()].map((r) => ({ plan: r.plan, state: r.state, ledger: r.ledger, mark: this.marks.get(r.plan.planId) || null }));
  }
}

function emptyLedger() { return { entry: null, exit: null, interestHours: [], pnlUsd: null }; }
function interestUsd(r, price) {
  return r.ledger.interestHours.reduce((a, h) => a + (h.owedBase == null ? 0 : h.owedBase * price), 0);
}
// THE MONEY A CLOSED PLAN MADE: the price moved on the quantity held, less both
// fees and, on a short, the borrowing priced at the closing price
function closedMoney(r) {
  const e = r.ledger.entry; const x = r.ledger.exit;
  if (!e || !x) return null;
  const gross = r.state.dir * e.qty * (x.price - e.price);
  return gross - e.feeUsd - x.feeUsd - interestUsd(r, x.price);
}
function openMoney(r, price) {
  const e = r.ledger.entry;
  if (!e) return null;
  return r.state.dir * e.qty * (price - e.price) - e.feeUsd - interestUsd(r, price);
}

module.exports = { Runner, closedMoney, openMoney };
