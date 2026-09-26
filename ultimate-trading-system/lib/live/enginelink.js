'use strict';
// lib/live/enginelink.js -- THE WEB BOX'S END OF THE LINK TO THE NEW TRADING
// ENGINE (loop of 2026-09-25, LOOP-2026-09-25-ENGINE.md).
//
// Every engine calls this system and keeps its link open (lib/live/enginehub.js);
// every question here goes down that link. Nothing here reaches into the
// engine's machine.
//
// THE MIRROR. The engine writes every event to its own record and sends each
// line over its link as it is written. This keeps the lines it received
// (raw.jsonl, byte for byte what the engine sent), and writes each one again in
// the words the Trade tab already reads (journal.jsonl) -- so Paper Books and
// Live Trading are drawn by the one path they already share (RULE TWO), from a
// record, never from memory. The live figures of open positions (price now,
// money open, stop, best price) arrive beside the lines and are held in memory
// only, exactly as the engine holds them.
const fs = require('fs');
const path = require('path');

const MIRROR_DIR = () => process.env.GC_ENGINE_MIRROR || path.join(__dirname, '..', '..', 'data', 'live', 'engine');

function call(target, method, p, body = null, timeoutMs = 4000) {
  return require('./enginehub').call(target.id, method, p, body, timeoutMs);
}

async function health(target) {
  const r = await call(target, 'GET', '/health', null, 3000);
  return r.ok ? { answers: true, ms: r.ms, health: r.json } : { answers: false, ms: r.ms, why: r.why || `the engine answered ${r.status}` };
}
async function postPlan(target, plan) { return call(target, 'POST', '/plans', plan, 8000); }
async function cancelPlan(target, planId, why, { entriesOnly = false } = {}) { return call(target, 'POST', `/plans/${encodeURIComponent(planId)}/cancel`, { why, entriesOnly }, 8000); }
async function engineState(target) { return call(target, 'GET', '/state', null, 8000); }
async function setVerbose(target, setupId, on) { return call(target, 'POST', `/setups/${encodeURIComponent(setupId)}/verbose`, { on: on === true }, 8000); }

// ---- THE ENGINE'S WORDS, AGAIN IN THE WORDS THE TRADE TAB READS -------------
const sideOf = (call) => (call === 1 ? 'LONG' : call === -1 ? 'SHORT' : 'FLAT');
function translate(rec, plans) {
  // Verbose on or off for a setup, as the engine recorded it
  if (rec.type === 'verbose' && rec.setupId) return [{ event: 'VERBOSE_SET', setup_id: rec.setupId, on: rec.on === true, utc: rec.utc, ts: rec.ts / 1000, engine: true }];
  const plan = rec.planId ? plans.get(rec.planId) : null;
  const base = plan ? { setup_id: plan.setupId, chunk_start: plan.chunkStart || new Date(plan.entryTs).toISOString(), utc: rec.utc, ts: rec.ts / 1000, engine: true, plan_id: rec.planId } : null;
  if (rec.type === 'plan' && rec.plan) {
    const p = rec.plan;
    const d = p.decision || {};
    return [{
      event: 'INTENT_SEEN', setup_id: p.setupId, chunk_start: p.chunkStart || new Date(p.entryTs).toISOString(), utc: rec.utc, ts: rec.ts / 1000, engine: true, plan_id: p.planId,
      side: sideOf(p.call), per_member: d.perMember || null, quorum: null, decision_price: null, input_hash: d.inputHash || null, field: d.field || null,
      shape: { entry: p.cell.entry, gate: p.cell.gate || null, dMult: p.cell.dMult ?? null, tHours: p.cell.tHours, trailMult: p.cell.trailMult ?? null, armMult: p.cell.armMult ?? null, bandPct: p.bandPct ?? null },
      size: p.size || null,
    }];
  }
  if (!base) return [];
  if (rec.type === 'note') {
    const map = { 'levels set': 'LEVELS_SET', 'level reached': 'LEVEL_REACHED', 'stop moved': 'STOP_MOVED', 'trail armed': 'TRAIL_ARMED', expired: 'PLAN_EXPIRED', skipped: 'PLAN_SKIPPED', failed: 'PLAN_FAILED', cancelled: 'PLAN_CANCELLED', 'trail check': 'TRAIL_CHECK' };
    const ev = map[rec.what];
    if (!ev) return [];
    const keep = {};
    for (const k of ['ref', 'buy', 'sell', 'level', 'side', 'stop', 'best', 'reason', 'price']) if (rec[k] !== undefined) keep[k] = rec[k];
    // every hourly check of the trail, for a setup with Verbose ticked
    if (ev === 'TRAIL_CHECK') for (const k of ['hour', 'hourBest', 'armAt', 'armed', 'armedBefore', 'want', 'was', 'moved', 'why']) if (rec[k] !== undefined) keep[k] = rec[k];
    if (ev === 'LEVELS_SET' && plan) keep.end_utc = new Date(plan.entryTs + plan.cell.tHours * 3600000).toISOString();
    return [{ event: ev, ...base, ...keep }];
  }
  if (rec.type === 'fill') {
    const paper = rec.mode === 'simulated';
    if (rec.purpose === 'enter') {
      const lvl = rec.against && rec.against.atLevel != null ? rec.against.atLevel : null;
      return [{
        event: paper ? 'PAPER_ENTRY_FILL' : 'ENTRY_FILL', ...base, side: rec.side === 'BUY' ? 'LONG' : 'SHORT', qty: rec.qty, price: rec.price,
        decision_price: lvl, fill_deviation: lvl ? (rec.price - lvl) / lvl : null, fee_quote: rec.feeUsd,
        clip_usd: plan && plan.size ? plan.size.quoteUsd : null, hold_hours: plan ? plan.cell.tHours : null,
        exit_due_ts: plan ? (plan.entryTs + plan.cell.tHours * 3600000) / 1000 : null, against: rec.against || null,
      }];
    }
    return [{
      event: paper ? 'PAPER_EXIT_FILL' : 'EXIT_FILL', ...base, side: rec.side === 'SELL' ? 'LONG' : 'SHORT', qty: rec.qty, price: rec.price,
      reason: rec.why || null, pnl: Number.isFinite(rec.pnlUsd) ? rec.pnlUsd : null, fee_quote: rec.feeUsd, against: rec.against || null,
    }];
  }
  if (rec.type === 'refused') return [{ event: 'ORDER_REJECT', ...base, detail: rec.why || '', purpose: rec.purpose }];
  if (rec.type === 'interest') return [{ event: 'INTEREST_HOUR', ...base, rate: rec.rate, owed_base: rec.owedBase, why: rec.why || null }];
  return [];
}

// ---- THE MIRROR --------------------------------------------------------------
class Mirror {
  constructor(target) {
    this.target = target;
    this.dir = path.join(MIRROR_DIR(), target.id);
    this.rawFile = path.join(this.dir, 'raw.jsonl');
    this.eventsFile = path.join(this.dir, 'journal.jsonl');
    this.n = 0;
    this.plans = new Map();
    this.states = new Map();
    this.marks = new Map();
    this.verbose = new Map();       // setupId -> { on, utc }: Verbose as the engine last recorded it
    this.lastHealth = null;
    this.status = { following: false, since: null, lastRecordAt: null, why: 'not started' };
    this.stopped = false;
    fs.mkdirSync(this.dir, { recursive: true });
    if (fs.existsSync(this.rawFile)) {
      for (const line of fs.readFileSync(this.rawFile, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch (_) { continue; }
        this.n = Math.max(this.n, rec.n || 0);
        this.take(rec, false);
      }
    }
  }

  // the engine's record arriving over its link: a line already kept is never kept twice
  takeFromLink(recs) {
    for (const rec of recs) {
      if (!rec || !(rec.n > this.n)) continue;
      this.n = rec.n;
      this.status.lastRecordAt = new Date().toISOString();
      this.take(rec);
    }
  }

  take(rec, write = true) {
    if (rec.type === 'plan' && rec.plan) this.plans.set(rec.plan.planId, rec.plan);
    if (rec.type === 'state' && rec.planId) this.states.set(rec.planId, { state: rec.state, ledger: rec.ledger, utc: rec.utc });
    if (rec.type === 'verbose' && rec.setupId) this.verbose.set(rec.setupId, { on: rec.on === true, utc: rec.utc || null });
    if (!write) return;
    fs.appendFileSync(this.rawFile, `${JSON.stringify(rec)}\n`);
    for (const ev of translate(rec, this.plans)) fs.appendFileSync(this.eventsFile, `${JSON.stringify(ev)}\n`);
  }

  // the engine brings its record to this system itself, over its link
  start() {
    if (this.stopped) return;
    require('./enginehub').watch(this.target.id, this);
    this.status = { ...this.status, following: true, since: this.status.since || new Date().toISOString(), why: null };
  }

  stop() {
    this.stopped = true;
    require('./enginehub').unwatch(this.target.id);
  }

  // whether the engine's record is reaching this system, in the shape the screens read
  linkStatus() {
    const h = require('./enginehub').status(this.target.id);
    return { following: h.linked, since: h.since, lastRecordAt: this.status.lastRecordAt, why: h.why };
  }

  // the live figures of a setup's open positions, newest first
  marksOf(setupId) { return [...this.marks.values()].filter((m) => m.setupId === setupId); }
  // every plan of a setup with where it stands, from the engine's own snapshots
  plansOf(setupId) {
    return [...this.plans.values()].filter((p) => p.setupId === setupId).map((p) => ({ plan: p, ...(this.states.get(p.planId) || {}) }));
  }
}

// ---- A SETUP THAT STOPPED TAKES NO NEW ENTRY ------------------------------
//
// The old order program's rule, kept on the engine: a setup that is stopped or
// retired opens nothing, and a position it already holds still closes by its
// own rules. A plan still waiting on the engine -- for its entry hour, or for a
// printed trade to reach a level -- is a new entry, so it is taken back; an
// open position is left alone (entriesOnly: a take-back that arrives just
// after the entry leaves the position to close by its stop or its hold).
// Asked each minute until the engine's own record says the plan is cancelled,
// so an engine that was not answering at the moment of the stop is caught up
// the moment it answers; never asked twice inside five minutes.
const ASK_AGAIN_MS = 5 * 60000;
async function cancelLeftovers(engines, setups, asked = new Map(), now = Date.now()) {
  const out = [];
  for (const t of engines) {
    const m = mirrorFor(t);
    for (const s of setups.filter((x) => x.executionTargetRef === t.id && x.state !== 'paper' && x.state !== 'live')) {
      for (const x of m.plansOf(s.id)) {
        const phase = x.state ? x.state.phase : 'waiting';
        if (phase !== 'waiting' && phase !== 'armed') continue;
        const id = x.plan.planId;
        if (asked.has(id) && now - asked.get(id) < ASK_AGAIN_MS) continue;
        asked.set(id, now);
        // eslint-disable-next-line no-await-in-loop
        const r = await cancelPlan(t, id, `the setup is ${s.state}: it takes no new entry`, { entriesOnly: true });
        out.push({ engine: t.id, setup: s.id, planId: id, ok: !!r.ok, why: r.ok ? null : (r.why || (r.json && (r.json.problems || []).join('; ')) || `the engine answered ${r.status}`) });
      }
    }
  }
  return out;
}

// ---- VERBOSE, AS THE OWNER TICKED IT --------------------------------------
//
// Verbose is ticked on Setup detail and kept on the setup; the engine keeps its
// own copy, because it is the engine that writes the checks down. Each minute
// every setup on an engine whose tick differs from the engine's record is sent
// again -- so a tick made while the engine was not answering reaches it the
// moment it answers -- and never asked twice inside a minute. A stopped setup
// is included: its open positions still trail.
const VERBOSE_AGAIN_MS = 60000;
async function syncVerbose(engines, setups, asked = new Map(), now = Date.now()) {
  const out = [];
  for (const t of engines) {
    const m = mirrorFor(t);
    for (const s of setups.filter((x) => x.executionTargetRef === t.id)) {
      const want = s.verbose === true;
      const has = (m.verbose.get(s.id) || {}).on === true;
      if (want === has) continue;
      const key = `${t.id}|${s.id}|${want}`;
      if (asked.has(key) && now - asked.get(key) < VERBOSE_AGAIN_MS) continue;
      asked.set(key, now);
      // eslint-disable-next-line no-await-in-loop
      const r = await setVerbose(t, s.id, want);
      out.push({ engine: t.id, setup: s.id, on: want, ok: !!r.ok, why: r.ok ? null : (r.why || (r.json && (r.json.problems || []).join('; ')) || `the engine answered ${r.status}`) });
    }
  }
  return out;
}

const mirrors = new Map();
// A DIFFERENT MACHINE UNDER THE SAME SHORT NAME (an engine installed afresh
// elsewhere): its record starts again at line 1, so this machine's copy of the
// old one is set aside beside it -- kept, never deleted -- and a new copy begins
function restartMirror(engineId) {
  const m = mirrors.get(engineId);
  if (m) { m.stop(); mirrors.delete(engineId); }
  const dir = path.join(MIRROR_DIR(), engineId);
  if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.before-${new Date().toISOString().replace(/[:.]/g, '-')}`);
}
function mirrorFor(target) {
  if (!mirrors.has(target.id)) mirrors.set(target.id, new Mirror(target));
  const m = mirrors.get(target.id);
  m.target = target;
  return m;
}
// follow every engine on record; called at start and whenever an engine record changes
function followAll(list) {
  const ids = new Set(list.map((t) => t.id));
  for (const [id, m] of mirrors) if (!ids.has(id)) { m.stop(); mirrors.delete(id); }
  for (const t of list) mirrorFor(t).start();
}

module.exports = { call, health, postPlan, cancelPlan, cancelLeftovers, engineState, setVerbose, syncVerbose, translate, Mirror, mirrorFor, followAll, restartMirror, MIRROR_DIR };
