// The decisions for setups on the new trading engine (lib/live/engineproduce.js,
// LOOP-2026-09-25-ENGINE.md): which period is decided, that a decision is
// written down before anything is sent, that a period is sent once, that a day
// the committee stands aside is written down and nothing is sent, and that a
// plan the engine did not take is asked again.
const { assert } = require('./helpers');
const { periodToDecide, makeProducer } = require('../lib/live/engineproduce');
const { planFor } = require('../lib/live/engineplan');

const H = 3600000;
const GEO = { featureHours: 96, stepHours: 24, entryOffsetH: 97, exitOffsetH: 138 };
const day = (d) => Date.UTC(2026, 8, d);

function fixture({ decide = { call: 1, side: 'LONG', perMember: [1, 1, 1, -1], membersCall: 1, inputHash: 'h1', field: null }, miss = null, answer = { ok: true, json: { ok: true, phase: 'waiting' } }, engine = true } = {}) {
  const log = [];
  const decisions = new Map();
  const sent = [];
  const chunks = [day(20), day(21), day(22), day(23)].map((startTs) => ({ startTs }));
  const setup = {
    id: 'setup-e', name: 'LTC on the engine', state: 'paper', executionTargetRef: 'e1', provenanceRef: 'gl-1', clipUsd: 100, keyRef: 'ltc-1',
    configSnapshot: { combo: { trade: 'LTCUSDT', ctx1: 'DOGEUSDT', ctx2: 'LINKUSDT' }, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 }, branch: { band: 5, geometry: 'daily-4d' }, configVersion: 'v1' },
  };
  const deps = {
    listSetups: () => [setup, { ...setup, id: 'setup-draft', state: 'draft' }],
    targets: { resolveForSetup: () => (engine ? { id: 'e1', kind: 'engine' } : { id: 'mx-1', kind: 'ssh-box' }), isEngine: (t) => !!t && t.kind === 'engine' },
    signal: {
      prepare: async () => ({ chunks, geo: GEO, maps: {}, cfg: {}, trainChunks: [], views: [], bandPct: 5, freeze: { throughMs: day(1) }, fee: 0.00125 }),
      missingFeatureCandle: () => miss,
      decideFor: async () => { log.push('decided'); return decide; },
    },
    planFor,
    greenlight: () => ({ frozen: { sizing: { on: true, ladder: [0.5, 0.75, 1.25, 1.5] } } }),
    refresh: async (sym) => { log.push(`refreshed ${sym}`); },
    link: { postPlan: async (t, plan) => { log.push(`sent ${plan.planId}`); sent.push({ t, plan }); return typeof answer === 'function' ? answer() : answer; } },
    loadDecisions: (id) => decisions.get(id) || [],
    appendDecision: (id, rec) => { log.push(`written ${rec.engine.ok ? 'ok' : 'not yet'}`); decisions.set(id, [...(decisions.get(id) || []), rec]); },
    warn: () => {},
  };
  return { log, decisions, sent, setup, producer: makeProducer(deps) };
}

module.exports = {
  // THE PERIOD: the newest whose features have closed and whose hold is open --
  // decided before its entry hour, so the plan waits on the engine when it opens
  theNewestPeriodWhoseFeaturesHaveClosedIsDecidedBeforeItsEntryHour() {
    const chunks = [day(20), day(21), day(22), day(23)].map((startTs) => ({ startTs }));
    // 00:30 on the 26th: the window of the 22nd closed at 00:00; its entry is 01:00
    assert.strictEqual(periodToDecide(chunks, GEO, 65, day(26) + 30 * 60000).startTs, day(22));
    // 23:30 on the 25th: the 22nd's window is still open; the 21st's hold is still open
    assert.strictEqual(periodToDecide(chunks, GEO, 65, day(25) + 23.5 * H).startTs, day(21));
    // long after every hold ended: nothing to decide
    assert.strictEqual(periodToDecide(chunks, GEO, 65, day(30) + 12 * H), null);
  },

  // FAIL CLOSED: the decision is written down before the plan leaves, the plan
  // carries the size the greenlight's ladder gives it, and a period is sent once
  async aCallIsWrittenDownBeforeItIsSentAndSentOnlyOnce() {
    const f = fixture();
    const now = day(26) + 30 * 60000;
    const out = await f.producer.decideOne(f.setup, now);
    assert.deepStrictEqual([out.chunkStart, out.side, out.sent], [new Date(day(22)).toISOString(), 'LONG', true]);
    assert.deepStrictEqual(f.log.filter((l) => !/^refreshed/.test(l)), ['decided', 'written not yet', `sent setup-e|${new Date(day(22)).toISOString()}`, 'written ok']);
    assert.deepStrictEqual(f.log.filter((l) => /^refreshed/.test(l)), ['refreshed LTCUSDT', 'refreshed DOGEUSDT', 'refreshed LINKUSDT'], 'the candles of the coin and the two read alongside it');
    const [first, second] = f.decisions.get('setup-e');
    assert.strictEqual(first.engine.ok, false, 'written down before anything was sent');
    assert.strictEqual(first.clip_usd, 100 * 1 * 1.25, 'clip x field (none: 1) x the ladder\'s third rung, for three members agreeing');
    assert.deepStrictEqual([second.engine.ok, second.engine.planId, second.engine.answer.phase], [true, `setup-e|${new Date(day(22)).toISOString()}`, 'waiting']);
    // the plan: this setup's engine, its trading account (whose fee and borrowing rate the engine reads), paper's mode
    const { t, plan } = f.sent[0];
    assert.deepStrictEqual([t.id, plan.account, plan.mode, plan.symbol, plan.entryTs, plan.size.quoteUsd], ['e1', 'ltc-1', 'simulated', 'LTCUSDT', day(22) + 97 * H, 125]);
    const again = await f.producer.decideOne(f.setup, now + 60000);
    assert.deepStrictEqual([again.skipped, f.log.filter((l) => /^sent/.test(l)).length], ['already sent', 1], 'the same period is never sent twice');
  },

  // A DAY THE COMMITTEE STANDS ASIDE is a decision: written down, nothing sent
  async aDayTheCommitteeStandsAsideIsWrittenDownAndNothingIsSent() {
    const f = fixture({ decide: { call: 0, side: 'FLAT', perMember: [1, -1, 0, 0], membersCall: 0, inputHash: 'h2', field: null } });
    const out = await f.producer.decideOne(f.setup, day(26) + 30 * 60000);
    assert.deepStrictEqual([out.sent, out.why], [false, 'the committee stood aside']);
    assert.ok(!f.log.some((l) => /^sent/.test(l)), 'nothing was sent');
    assert.deepStrictEqual(f.decisions.get('setup-e').map((r) => [r.side, r.engine.ok, r.engine.answer || null]), [['FLAT', false, null], ['FLAT', true, 'nothing to send']]);
    // and a call the field blocked says so
    const g = fixture({ decide: { call: 0, side: 'FLAT', perMember: [1, 1, 1, 1], membersCall: 1, inputHash: 'h3', field: { size: 0 } } });
    assert.strictEqual((await g.producer.decideOne(g.setup, day(26) + 30 * 60000)).why, 'the field blocked the call');
  },

  // A PLAN THE ENGINE DID NOT TAKE is asked again on the next run, and one that
  // cannot be decided yet waits in words
  async aPlanTheEngineDidNotTakeIsAskedAgainAndAMissingCandleWaits() {
    let n = 0;
    const f = fixture({ answer: () => (++n === 1 ? { ok: false, why: 'nothing answers on the tunnel\'s port on this machine' } : { ok: true, json: { ok: true, phase: 'waiting' } }) });
    const now = day(26) + 30 * 60000;
    assert.strictEqual((await f.producer.decideOne(f.setup, now)).sent, false);
    assert.strictEqual((await f.producer.decideOne(f.setup, now + 60000)).sent, true, 'asked again, and taken');
    const w = fixture({ miss: { name: 'DOGEUSDT', lastFeatureTs: day(25) + 23 * H } });
    const out = await w.producer.decideOne(w.setup, now);
    assert.strictEqual(out.waiting, 'DOGEUSDT is missing its last feature candle (2026-09-25T23:00:00.000Z)');
    assert.ok(!w.log.includes('decided') && !w.decisions.has('setup-e'), 'nothing decided or written on a window with a hole in it');
    const off = fixture({ engine: false });
    assert.deepStrictEqual(await off.producer.decideOne(off.setup, now), { setup: 'setup-e', skipped: 'not on an engine' });
    // only setups in paper or live state are decided
    const all = await fixture().producer.run(now);
    assert.deepStrictEqual(all.results.map((r) => r.setup), ['setup-e']);
  },
};

// A MARKET ENTRY'S PLAN CARRIES THE SETUP'S STOP % (item 5, 3.259.0); a
// breakout's carries none, its stop being the level on the other side
module.exports.aMarketEntrysPlanCarriesTheSetupsStopPct = function () {
  const target = { startTs: day(22) };
  const decision = { call: 1, perMember: [1, 1, 1, -1], membersCall: 1, field: null };
  const setupOf = (entry, stopPct) => ({ id: 's', state: 'paper', clipUsd: 100, stopPct,
    configSnapshot: { combo: { trade: 'LTCUSDT' }, cell: { entry, gate: 'directional', dMult: entry === 'breakout' ? 0.75 : null, tHours: 65, trailMult: null, armMult: null }, branch: { band: 5, geometry: 'daily-4d' }, configVersion: 'v1' } });
  const plan = (entry, stopPct) => planFor({ setup: setupOf(entry, stopPct), greenlight: null, target, geo: GEO, decision, feePerLeg: 0.00125, now: day(26) });
  assert.strictEqual(plan('market', 0.11).stopPct, 0.11);
  assert.strictEqual(plan('market', null).stopPct, null);
  assert.strictEqual(plan('breakout', 0.11).stopPct, null);
};
