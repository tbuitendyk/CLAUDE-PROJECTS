#!/usr/bin/env node
'use strict';
// engine-produce.js -- THE DECISIONS FOR SETUPS ON THE NEW TRADING ENGINE (loop
// of 2026-09-25, LOOP-2026-09-25-ENGINE.md).
//
// Run by the web service as a child of its own (the committee is trained here,
// which takes time the service's pages must not wait on). For every setup in
// paper or live state whose execution target is an engine record:
//   1. the candles its coin and the two read alongside it need are brought up to
//      the last closed hour;
//   2. the decision is made for the newest period whose features have closed and
//      whose hold is not over -- before its entry hour when it can be, so the
//      plan is on the trading box when the hour opens;
//   3. the decision is written down (data/live/decisions/<setup>.jsonl) BEFORE
//      anything is sent (fail closed, the old producer's rule), a day the
//      committee stood aside included;
//   4. a call with a size becomes a plan and is sent to the engine; the engine's
//      answer is written down beside the decision.
// A period already sent is never sent again: the engine takes the same plan
// twice as the same plan, and this does not ask twice.
// No AI anywhere: deterministic arithmetic over candles.
const fs = require('fs');
const path = require('path');
const reg = require('./lib/live/setups');
const signal = require('./lib/live/signal');
const targets = require('./lib/live/targets');
const link = require('./lib/live/enginelink');
const { planFor } = require('./lib/live/engineplan');

const HOUR_MS = 3600000;
const DECISIONS = path.join(__dirname, 'data', 'live', 'decisions');

function appendDecision(setupId, rec) {
  fs.mkdirSync(DECISIONS, { recursive: true });
  fs.appendFileSync(path.join(DECISIONS, `${setupId}.jsonl`), `${JSON.stringify(rec)}\n`);
}
function sentAlready(setupId, chunkStart) {
  return require('./lib/live/mirror').loadDecisions(setupId).some((d) => d.chunk_start === chunkStart && d.engine && d.engine.ok);
}

// the newest period whose features have closed and whose hold is still open
function periodToDecide(chunks, geo, tHours, now) {
  const featMs = geo.featureHours * HOUR_MS;
  const entryMs = (geo.entryOffsetH || 0) * HOUR_MS;
  let best = null;
  for (const c of chunks) {
    const closed = c.startTs + featMs <= now;
    const open = now < c.startTs + entryMs + tHours * HOUR_MS;
    if (closed && open && (!best || c.startTs > best.startTs)) best = c;
  }
  return best;
}

async function decideOne(setup, now) {
  const target = targets.resolveForSetup(setup);
  if (!targets.isEngine(target)) return { setup: setup.id, skipped: 'not on an engine' };
  const cfg = setup.configSnapshot;
  // 1. the candles, up to the last closed hour, for the coin and the two alongside it
  for (const sym of [cfg.combo.trade, cfg.combo.ctx1, cfg.combo.ctx2].filter(Boolean)) {
    // eslint-disable-next-line no-await-in-loop
    try { await require('./lib/datarefresh').fillRecent(sym, { now }); } catch (e) { process.stderr.write(`engine-produce(${setup.id}): ${sym} not refreshed: ${e.message}\n`); }
  }
  const prep = await signal.prepare(setup);
  const period = periodToDecide(prep.chunks, prep.geo, cfg.cell.tHours, now);
  if (!period) return { setup: setup.id, skipped: 'no period whose features have closed and whose hold is still open' };
  const chunkStart = new Date(period.startTs).toISOString();
  if (sentAlready(setup.id, chunkStart)) return { setup: setup.id, chunkStart, skipped: 'already sent' };
  const miss = signal.missingFeatureCandle(period, prep.geo, prep.maps);
  if (miss) return { setup: setup.id, chunkStart, waiting: `${miss.name} is missing its last feature candle (${new Date(miss.lastFeatureTs).toISOString()})` };
  // 2. the decision, exactly as the live path makes it (lib/live/stagesignal.js)
  const d = await signal.decideFor(prep.cfg, period, prep.trainChunks, prep.chunks, prep.maps, prep.geo, prep.views, prep.bandPct, prep.freeze.throughMs, prep.fee);
  const gl = setup.provenanceRef ? require('./lib/live/greenlight').getGreenlight(setup.provenanceRef) : null;
  const plan = planFor({ setup, greenlight: gl, target: period, geo: prep.geo, decision: { ...d, trainThrough: prep.freeze.throughMs }, feePerLeg: prep.fee, now });
  const traded = plan.call !== 0 && plan.size.quoteUsd > 0;
  const why = traded ? null : (d.membersCall !== 0 && d.call === 0 ? 'the field blocked the call' : (plan.call === 0 ? 'the committee stood aside' : 'sized to nothing'));
  // 3. written down before anything is sent
  const rec = {
    chunk_start: chunkStart, side: d.side, per_member: d.perMember, quorum: null, band_pct: prep.bandPct, decision_price: null,
    input_hash: d.inputHash, config_version: cfg.configVersion, train_through: prep.freeze.throughMs, produced_utc: new Date(now).toISOString(),
    paper: setup.state === 'paper', field: d.field || null, clip_usd: plan.size.quoteUsd, window_complete: true,
    engine: { target: target.id, planId: plan.planId, size: plan.size, traded, why, ok: false },
  };
  appendDecision(setup.id, rec);
  if (!traded) { appendDecision(setup.id, { ...rec, engine: { ...rec.engine, ok: true, answer: 'nothing to send' } }); return { setup: setup.id, chunkStart, side: d.side, sent: false, why }; }
  // 4. the plan to the engine, and its answer written down
  const r = await link.postPlan(target, plan);
  appendDecision(setup.id, { ...rec, engine: { ...rec.engine, ok: !!r.ok, answer: r.json || r.why || null } });
  return { setup: setup.id, chunkStart, side: d.side, sent: !!r.ok, answer: r.json || r.why };
}

(async () => {
  const now = Date.now();
  const only = process.argv.includes('--setup') ? process.argv[process.argv.indexOf('--setup') + 1] : null;
  const setups = reg.listSetups().filter((s) => (s.state === 'paper' || s.state === 'live') && (!only || s.id === only));
  const results = [];
  for (const s of setups) {
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push(await decideOne(s, now));
    } catch (e) { results.push({ setup: s.id, error: e.message }); }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, at: new Date(now).toISOString(), results })}\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write(`engine-produce FAILED: ${e.message}\n`); process.exit(1); });
