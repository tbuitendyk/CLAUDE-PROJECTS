'use strict';
// lib/live/enginelink.js -- THE WEB BOX'S END OF THE LINK TO THE NEW TRADING
// ENGINE (loop of 2026-09-25, LOOP-2026-09-25-ENGINE.md).
//
// The engine runs on the trading box and listens on that box's own loopback
// address; this machine reaches it through an SSH tunnel whose local end is the
// engine record's localPort (Setup > Compute). Everything here speaks to
// 127.0.0.1:<localPort> and to nothing else.
//
// THE MIRROR. The engine writes every event to its own record and streams each
// line as it is written. This follows that stream, keeps the lines it received
// (raw.jsonl, byte for byte what the engine sent), and writes each one again in
// the words the Trade tab already reads (journal.jsonl) -- so Paper Books and
// Live Trading are drawn by the one path they already share (RULE TWO), from a
// record, never from memory. The live figures of open positions (price now,
// money open, stop, best price) arrive beside the lines and are held in memory
// only, exactly as the engine holds them.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIRROR_DIR = () => process.env.GC_ENGINE_MIRROR || path.join(__dirname, '..', '..', 'data', 'live', 'engine');

function call(target, method, p, body = null, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const data = body == null ? null : JSON.stringify(body);
    const started = Date.now();
    const req = http.request({
      host: '127.0.0.1', port: target.localPort, method, path: p, timeout: timeoutMs,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { json = null; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, ms: Date.now() - started });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, why: `the engine sent nothing for ${timeoutMs / 1000} seconds`, ms: Date.now() - started }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, why: e.code === 'ECONNREFUSED' ? 'nothing answers on the tunnel\'s port on this machine -- the tunnel is not up, or the engine is not on the trading box yet' : e.message, ms: Date.now() - started }));
    if (data) req.write(data);
    req.end();
  });
}

async function health(target) {
  const r = await call(target, 'GET', '/health', null, 3000);
  return r.ok ? { answers: true, ms: r.ms, health: r.json } : { answers: false, ms: r.ms, why: r.why || `the engine answered ${r.status}` };
}
async function postPlan(target, plan) { return call(target, 'POST', '/plans', plan, 8000); }
async function cancelPlan(target, planId, why) { return call(target, 'POST', `/plans/${encodeURIComponent(planId)}/cancel`, { why }, 8000); }
async function engineState(target) { return call(target, 'GET', '/state', null, 8000); }

// ---- THE ENGINE'S WORDS, AGAIN IN THE WORDS THE TRADE TAB READS -------------
const sideOf = (call) => (call === 1 ? 'LONG' : call === -1 ? 'SHORT' : 'FLAT');
function translate(rec, plans) {
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
    const map = { 'levels set': 'LEVELS_SET', 'level reached': 'LEVEL_REACHED', 'stop moved': 'STOP_MOVED', 'trail armed': 'TRAIL_ARMED', expired: 'PLAN_EXPIRED', skipped: 'PLAN_SKIPPED', failed: 'PLAN_FAILED', cancelled: 'PLAN_CANCELLED' };
    const ev = map[rec.what];
    if (!ev) return [];
    const keep = {};
    for (const k of ['ref', 'buy', 'sell', 'level', 'side', 'stop', 'best', 'reason', 'price']) if (rec[k] !== undefined) keep[k] = rec[k];
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
    this.lastHealth = null;
    this.status = { following: false, since: null, lastRecordAt: null, why: 'not started' };
    this.req = null;
    this.stopped = false;
    this.failures = 0;
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

  take(rec, write = true) {
    if (rec.type === 'plan' && rec.plan) this.plans.set(rec.plan.planId, rec.plan);
    if (rec.type === 'state' && rec.planId) this.states.set(rec.planId, { state: rec.state, ledger: rec.ledger, utc: rec.utc });
    if (!write) return;
    fs.appendFileSync(this.rawFile, `${JSON.stringify(rec)}\n`);
    for (const ev of translate(rec, this.plans)) fs.appendFileSync(this.eventsFile, `${JSON.stringify(ev)}\n`);
  }

  start() {
    if (this.stopped || this.req) return;
    const req = http.request({ host: '127.0.0.1', port: this.target.localPort, method: 'GET', path: `/events?since=${this.n + 1}`, headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); this.retry(`the engine answered ${res.statusCode}`); return; }
      this.failures = 0;
      this.status = { following: true, since: new Date().toISOString(), lastRecordAt: this.status.lastRecordAt, why: null };
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          this.frame(frame);
        }
      });
      res.on('end', () => this.retry('the engine closed the stream'));
      res.on('error', (e) => this.retry(e.message));
    });
    req.on('error', (e) => this.retry(e.code === 'ECONNREFUSED' ? 'nothing answers on the tunnel\'s port on this machine' : e.message));
    req.end();
    this.req = req;
  }

  frame(text) {
    let ev = 'message';
    const data = [];
    for (const line of text.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    let obj;
    try { obj = JSON.parse(data.join('\n')); } catch (_) { return; }
    if (ev === 'record') {
      if (!(obj.n > this.n)) return;   // a line already kept is never kept twice
      this.n = obj.n;
      this.status.lastRecordAt = new Date().toISOString();
      this.take(obj);
    } else if (ev === 'mark') this.marks.set(obj.planId, obj);
    else if (ev === 'beat') this.lastHealth = { at: new Date().toISOString(), health: obj };
  }

  retry(why) {
    this.req = null;
    this.failures += 1;
    this.status = { ...this.status, following: false, why };
    if (this.stopped) return;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(this.failures, 5));
    setTimeout(() => this.start(), wait).unref();
  }

  stop() { this.stopped = true; if (this.req) this.req.destroy(); }

  // the live figures of a setup's open positions, newest first
  marksOf(setupId) { return [...this.marks.values()].filter((m) => m.setupId === setupId); }
  // every plan of a setup with where it stands, from the engine's own snapshots
  plansOf(setupId) {
    return [...this.plans.values()].filter((p) => p.setupId === setupId).map((p) => ({ plan: p, ...(this.states.get(p.planId) || {}) }));
  }
}

const mirrors = new Map();
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

module.exports = { call, health, postPlan, cancelPlan, engineState, translate, Mirror, mirrorFor, followAll, MIRROR_DIR };
