// The web box's side of the new trading engine (LOOP-2026-09-25-ENGINE.md):
// the engine's record on Setup > Compute, the size of a plan (S4), the engine's
// words written again in the words the Trade tab reads, and a whole loop -- an
// engine on this machine, followed over HTTP, drawn by the one path both books
// share.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-engine-'));
process.env.GC_TARGETS_FILE = path.join(TDIR, 'targets.json');
process.env.GC_ENGINE_MIRROR = path.join(TDIR, 'mirror');
const targets = require('../lib/live/targets');
const link = require('../lib/live/enginelink');
const { sizeOf, agreeingOf } = require('../lib/live/engineplan');

const ENGINE = { id: 'mx-engine', name: 'Mexico engine', host: 'ec2-78-13-103-81.mx-central-1.compute.amazonaws.com', user: 'admin', enginePort: 18095, localPort: 18095, isDefault: true };

module.exports = {
  // S7: THE ENGINE'S RECORD is the owner's: created, changed and taken away through
  // the service, refused in words when it is not whole, never written into code
  theEnginesRecordIsTheOwnersAndRefusedInWordsWhenNotWhole() {
    const saved = targets.saveEngine(ENGINE);
    assert.deepStrictEqual({ id: saved.id, kind: saved.kind, isDefault: saved.isDefault, symbols: saved.symbols }, { id: 'mx-engine', kind: 'engine', isDefault: true, symbols: null });
    assert.strictEqual(targets.defaultEngine().id, 'mx-engine');
    assert.ok(targets.getTarget('mx-1') && targets.getTarget('mx-1').kind === 'ssh-box', 'the old order program stays where it was');
    const bad = (rec, re) => { let e = null; try { targets.saveEngine(rec); } catch (x) { e = x; } assert.ok(e && e.code === 'BAD_ENGINE' && re.test(e.message), e && e.message); };
    bad({ ...ENGINE, id: 'mx-1' }, /mx-1 is the old order program and is not an engine/);
    bad({ ...ENGINE, id: 'x2', host: 'no spaces allowed' }, /host: the trading box's address/);
    bad({ ...ENGINE, id: 'x2', localPort: 8094 }, /8094 and 8095 are this system's own services/);
    bad({ ...ENGINE, id: 'x2' }, /localPort: 18095 is already the tunnel port of mx-engine/);
    // a second engine ticked default takes the tick from the first
    targets.saveEngine({ ...ENGINE, id: 'second', name: 'Second', localPort: 18096, isDefault: true });
    assert.deepStrictEqual(targets.listEngines().map((t) => [t.id, t.isDefault]).sort(), [['mx-engine', false], ['second', true]]);
    // an engine a setup runs on cannot be taken away
    let e = null;
    try { targets.deleteEngine('second', [{ id: 's1', name: 'LTC paper', executionTargetRef: 'second', state: 'paper' }]); } catch (x) { e = x; }
    assert.ok(e && e.code === 'IN_USE' && /1 setup\(s\) run on second \(LTC paper\)/.test(e.message), e && e.message);
    assert.deepStrictEqual(targets.deleteEngine('second', []), { deleted: 'second' });
    targets.saveEngine(ENGINE);
  },

  // S4: THE SIZE -- clip x the field's size x the multiplier for how many members
  // agreed with the committee's call, from the frozen ladder
  aPlansSizeIsClipTimesFieldTimesConviction() {
    const ladder = [0.55, 0.65, 0.75, 0.85, 0.95, 1.05, 1.15, 1.25, 1.35, 1.45];
    const per = [1, 1, 1, 1, 1, 1, 1, -1, 0, 0];     // seven of ten agree with a long
    assert.strictEqual(agreeingOf(per, 1), 7);
    assert.strictEqual(agreeingOf(per, -1), 1);
    const s = sizeOf({ clipUsd: 100, field: { size: 1.25 }, sizing: { on: true, ladder }, perMember: per, membersCall: 1 });
    assert.deepStrictEqual({ fieldSize: s.fieldSize, agree: s.agree, multiplier: s.multiplier }, { fieldSize: 1.25, agree: 7, multiplier: 1.15 });
    assert.ok(Math.abs(s.quoteUsd - 100 * 1.25 * 1.15) < 1e-12, `${s.quoteUsd}`);
    assert.strictEqual(sizeOf({ clipUsd: 100, field: null, sizing: null, perMember: per, membersCall: 1 }).quoteUsd, 100, 'no field and no sizing: the clip');
    assert.strictEqual(sizeOf({ clipUsd: 100, field: { size: 0 }, sizing: { on: true, ladder }, perMember: per, membersCall: 1 }).quoteUsd, 0, 'a call the field blocks or leaves silent at 0 is sized to nothing');
    assert.strictEqual(sizeOf({ clipUsd: 100, field: null, sizing: { on: false, ladder }, perMember: per, membersCall: 1 }).multiplier, 1, 'a ladder switched off multiplies by one');
    // the same arithmetic Held prices a captured trade with (lib/convictionsweep.js multFor)
    const { multFor } = require('../lib/convictionsweep');
    for (let a = 0; a <= 12; a++) assert.strictEqual(sizeOf({ clipUsd: 1, field: null, sizing: { on: true, ladder }, perMember: Array(a).fill(-1), membersCall: -1 }).multiplier, multFor(ladder, a));
  },

  // THE ENGINE'S WORDS in the words the Trade tab already reads, one path for both books
  theEnginesRecordIsWrittenAgainInTheTradeTabsWords() {
    const plan = { planId: 'setup-a|2026-09-22T00:00:00.000Z', setupId: 'setup-a', mode: 'simulated', symbol: 'LTCUSDT', chunkStart: '2026-09-22T00:00:00.000Z', entryTs: Date.UTC(2026, 8, 26, 1), call: 1, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 }, bandPct: 5, size: { quoteUsd: 143.75 }, decision: { perMember: [1, 1, -1], inputHash: 'abc' } };
    const plans = new Map([[plan.planId, plan]]);
    const [seen] = link.translate({ n: 1, ts: 1000, utc: 'u', type: 'plan', plan }, plans);
    assert.deepStrictEqual({ e: seen.event, side: seen.side, setup: seen.setup_id, chunk: seen.chunk_start, votes: seen.per_member }, { e: 'INTENT_SEEN', side: 'LONG', setup: 'setup-a', chunk: plan.chunkStart, votes: [1, 1, -1] });
    const [lv] = link.translate({ n: 2, ts: 2000, utc: 'u', type: 'note', planId: plan.planId, what: 'levels set', ref: 70, buy: 72.625, sell: 67.375 }, plans);
    assert.deepStrictEqual([lv.event, lv.buy, lv.sell, lv.end_utc], ['LEVELS_SET', 72.625, 67.375, new Date(plan.entryTs + 65 * 3600000).toISOString()]);
    const [en] = link.translate({ n: 3, ts: 3000, utc: 'u', type: 'fill', planId: plan.planId, mode: 'simulated', purpose: 'enter', side: 'BUY', price: 72.75, qty: 1.375, feeUsd: 0.1, against: { atLevel: 72.625 } }, plans);
    assert.deepStrictEqual([en.event, en.side, en.qty, en.price, en.decision_price], ['PAPER_ENTRY_FILL', 'LONG', 1.375, 72.75, 72.625]);
    assert.ok(Math.abs(en.fill_deviation - (72.75 - 72.625) / 72.625) < 1e-15, 'how far the fill landed from the level');
    const [ex] = link.translate({ n: 4, ts: 4000, utc: 'u', type: 'fill', planId: plan.planId, mode: 'simulated', purpose: 'exit', side: 'SELL', price: 70.6, qty: 1.375, feeUsd: 0.1, why: 'trailing stop', pnlUsd: -3.2 }, plans);
    assert.deepStrictEqual([ex.event, ex.side, ex.pnl, ex.reason], ['PAPER_EXIT_FILL', 'LONG', -3.2, 'trailing stop'], 'the position\'s side, never the closing order\'s');
    const [liveEntry] = link.translate({ n: 5, ts: 5000, utc: 'u', type: 'fill', planId: plan.planId, mode: 'live', purpose: 'enter', side: 'SELL', price: 67.3, qty: 1, feeUsd: 0.07, against: { atLevel: 67.375 } }, plans);
    assert.deepStrictEqual([liveEntry.event, liveEntry.side], ['ENTRY_FILL', 'SHORT'], 'a live fill is written as a live fill');
  },

  // A WHOLE LOOP: an engine on this machine (fake market, simulated exchange,
  // its real API), followed over HTTP by the mirror, read by the Trade tab's path
  async anEngineOnThisMachineIsFollowedAndDrawnByTheOnePath() {
    const { Journal } = require('../engine/journal');
    const { Runner } = require('../engine/runner');
    const { SimulatedExchange } = require('../engine/venues/simulated');
    const { makeServer } = require('../engine/api');
    const edir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
    const t0 = Date.UTC(2026, 8, 26, 1);
    let now = t0 - 60000;
    const market = {
      followed: new Set(), books: new Map(), trades: new Map(),
      follow(s) { market.followed = new Set(s); }, book: (s) => market.books.get(s) || null, trade: (s) => market.trades.get(s) || null,
      filtersOf: async () => ({ tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5 }), hourOpenOf: async () => null, minutes: async () => [], status: () => ({ connected: true }),
    };
    const journal = new Journal(path.join(edir, 'journal.jsonl'));
    const runner = new Runner({ journal, market, venues: { simulated: new SimulatedExchange({ market, feePerLeg: 0.001, now: () => now }) }, now: () => now });
    const server = makeServer({ runner, journal, health: () => ({ ok: true, realOrders: 'off' }) });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const target = { ...ENGINE, id: 'loop-engine', localPort: server.address().port };
    const m = new link.Mirror(target);
    try {
      m.start();
      const plan = { planId: 'setup-loop|2026-09-22T00:00:00.000Z', setupId: 'setup-loop', mode: 'simulated', symbol: 'LTCUSDT', chunkStart: '2026-09-22T00:00:00.000Z', entryTs: t0, call: 1, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 }, bandPct: 5, size: { quoteUsd: 100 }, feePerLeg: 0.001 };
      const posted = await link.postPlan(target, plan);
      assert.ok(posted.ok && posted.json.phase === 'waiting', JSON.stringify(posted.json));
      now = t0;
      runner.onKline({ symbol: 'LTCUSDT', openTime: t0, open: 70 });
      market.books.set('LTCUSDT', { bids: [[72.6, 5]], asks: [[72.7, 5]], ts: now });
      market.trades.set('LTCUSDT', { price: 72.7, ts: now });
      runner.onTrade({ symbol: 'LTCUSDT', price: 72.7, ts: now });
      for (let i = 0; i < 50 && runner.plans.get(plan.planId).state.phase !== 'open'; i++) await new Promise((r) => setTimeout(r, 20));
      runner.sendMarks(now);
      for (let i = 0; i < 50 && !fs.existsSync(m.eventsFile); i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 150));
      const view = require('../lib/live/view');
      const events = view.readJournal(m.eventsFile).events;
      assert.ok(events.some((e) => e.event === 'PAPER_ENTRY_FILL'), `the fill reached this machine: ${events.map((e) => e.event).join(' ')}`);
      const book = view.deriveSetup(events, 'setup-loop');
      assert.strictEqual(book.openPositions.length, 1, 'the open paper position, drawn by the path both books share');
      assert.deepStrictEqual([book.openPositions[0].side, book.openPositions[0].paper, book.openPositions[0].qty], ['LONG', true, 1.375]);
      const x = m.plansOf('setup-loop')[0];
      assert.deepStrictEqual([x.state.phase, x.state.stop], ['open', 70 * 0.9625], 'where the engine says it stands');
      assert.ok(m.marksOf('setup-loop').length === 1 && m.marksOf('setup-loop')[0].price === 72.7, 'the live figure arrived beside the record');
      // what the mirror kept is exactly what the engine wrote, in order
      const raw = fs.readFileSync(m.rawFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.deepStrictEqual(raw.map((r) => r.n), journal.since(1, 1000).map((r) => r.n), 'every line, once, in order');
    } finally {
      m.stop();
      server.close();
      fs.rmSync(edir, { recursive: true, force: true });
    }
  },

  // THE ENGINE'S PLANS SAY WHAT EVERY COLUMN HOLDS (the owner's standing
  // rule: every table gets a key, and the key says what each heading holds,
  // units included). The page's th() helper attaches a heading's description
  // from the key only when the key has an entry, so a heading drawn through the
  // helper with no entry is bare on screen and invisible to test-columnkeys.js,
  // which trusts the helper -- 3.254.0 shipped all ten this way.
  theEnginesPlansTableSaysWhatEveryColumnHolds() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'trade.html'), 'utf8');
    const fn = src.slice(src.indexOf('function enginePlansHtml(e){'), src.indexOf('\n}\n', src.indexOf('function enginePlansHtml(e){')));
    const keys = [...fn.matchAll(/\bth\('[^']*','([^']+)'/g)].map((m) => m[1]);
    assert.strictEqual(keys.length, 10, `the engine's plans table has ten headings drawn through th(): ${keys.join(' ')}`);
    const block = src.slice(src.indexOf('const TH={'), src.indexOf('\n};', src.indexOf('const TH={')) + 3);
    // eslint-disable-next-line no-new-func
    const TH = new Function(`${block}; return TH;`)();
    for (const k of keys) {
      assert.ok(typeof TH[k] === 'string' && TH[k].length > 25, `the heading keyed ${k} has no description on screen`);
    }
    assert.ok(/dollar/i.test(TH.engMoney) && /dollar/i.test(TH.engSize), 'the two money columns say dollars');
    for (const k of ['engBuy', 'engSell', 'engStop', 'engBest']) assert.ok(/USDT/.test(TH[k]), `${k} says the price is in the quote currency`);
  },

  // A SETUP ON THE ENGINE, READ BY THE TRADE TAB'S ONE PATH: its plans where the
  // engine says they stand, and what happens next in the engine's own terms --
  // not the old order program's hourly recompute and entry window. Then the
  // setup stops: the plan still waiting for a level is taken back, the open
  // position is left to close by its own rules, and nothing is asked twice.
  async aSetupOnTheEngineIsDrawnInItsOwnTermsAndStoppingTakesBackOnlyWhatHasNotOpened() {
    const { Journal } = require('../engine/journal');
    const { Runner } = require('../engine/runner');
    const { SimulatedExchange } = require('../engine/venues/simulated');
    const { makeServer } = require('../engine/api');
    const view = require('../lib/live/view');
    const edir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
    const oldDecisions = process.env.GC_LIVE_DECISIONS;
    process.env.GC_LIVE_DECISIONS = path.join(edir, 'decisions');
    const t0 = Date.UTC(2026, 8, 26, 1);
    let now = t0 - 60000;
    const market = {
      followed: new Set(), books: new Map(), trades: new Map(),
      follow(x) { market.followed = new Set(x); }, book: (x) => market.books.get(x) || null, trade: (x) => market.trades.get(x) || null,
      filtersOf: async () => ({ tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5 }), hourOpenOf: async () => null, minutes: async () => [], status: () => ({ connected: true }),
    };
    const journal = new Journal(path.join(edir, 'journal.jsonl'));
    const runner = new Runner({ journal, market, venues: { simulated: new SimulatedExchange({ market, feePerLeg: 0.001, now: () => now }) }, now: () => now });
    const server = makeServer({ runner, journal, health: () => ({ ok: true, realOrders: 'off' }) });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const target = targets.saveEngine({ ...ENGINE, id: 'draw-engine', name: 'Draw engine', localPort: server.address().port, isDefault: false });
    const m = link.mirrorFor(target);
    const cell = { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 };
    const setup = { id: 'setup-draw', name: 'LTC on the engine', state: 'paper', executionTargetRef: 'draw-engine', tradedPair: 'LTCUSDT', clipUsd: 100, trainPolicy: { mode: 'rolling' },
      configSnapshot: { branch: { geometry: 'daily-4d', band: 5 }, cell, combo: { trade: 'LTCUSDT' } } };
    const plan = (chunk, entryTs) => ({ planId: `setup-draw|${chunk}`, setupId: 'setup-draw', mode: 'simulated', symbol: 'LTCUSDT', chunkStart: chunk, entryTs, call: 1, cell, bandPct: 5, size: { quoteUsd: 100 }, feePerLeg: 0.001 });
    try {
      m.start();
      assert.ok((await link.postPlan(target, plan('2026-09-22T00:00:00.000Z', t0))).ok);
      assert.ok((await link.postPlan(target, plan('2026-09-23T00:00:00.000Z', t0 + 24 * 3600000))).ok);
      now = t0;
      runner.onKline({ symbol: 'LTCUSDT', openTime: t0, open: 70 });
      market.books.set('LTCUSDT', { bids: [[72.6, 5]], asks: [[72.7, 5]], ts: now });
      market.trades.set('LTCUSDT', { price: 72.7, ts: now });
      runner.onTrade({ symbol: 'LTCUSDT', price: 72.7, ts: now });
      for (let i = 0; i < 50 && runner.plans.get('setup-draw|2026-09-22T00:00:00.000Z').state.phase !== 'open'; i++) await new Promise((r) => setTimeout(r, 20));
      runner.sendMarks(now);
      for (let i = 0; i < 100 && !(m.plansOf('setup-draw').some((x) => x.state && x.state.phase === 'open') && m.marksOf('setup-draw').length); i++) await new Promise((r) => setTimeout(r, 20));
      const st = view.setupStatus(setup);
      assert.deepStrictEqual(st.engine.plans.map((p) => [p.chunk_start.slice(0, 10), p.phase, p.side]), [['2026-09-23', 'waiting', null], ['2026-09-22', 'open', 'LONG']]);
      assert.strictEqual(st.engine.plans[1].best, 72.7, 'a trailed plan shows its best price');
      const whats = st.liveStatus.items.map((it) => it.what);
      assert.ok(!whats.some((w) => /Recompute this profile/.test(w)), `the old order program's schedule is not this setup's: ${whats.join(' | ')}`);
      assert.strictEqual(whats[0], 'Decide the next period (LONG / SHORT / no call)');
      assert.ok(/before 01:00 UTC/.test(st.liveStatus.items[0].why) && /Draw engine/.test(st.liveStatus.items[0].why), st.liveStatus.items[0].why);
      // until Members train is chosen, the book says it is waiting for it, and why nothing is decided
      const unset = view.setupStatus({ ...setup, trainPolicy: undefined });
      assert.ok(/^waiting for Members train: choose rolling or frozen at in the Config editor on Setup detail/.test(unset.liveStatus.items[0].why), unset.liveStatus.items[0].why);
      const lv = st.liveStatus.items.find((it) => /^Set the levels for the LONG call of 2026-09-23/.test(it.what));
      assert.ok(lv && lv.whenUtc === new Date(t0 + 24 * 3600000).toISOString() && / 3\.75% either side of that hour's opening price/.test(lv.why), JSON.stringify(lv));
      const close = st.liveStatus.items.find((it) => /^Close the LONG position of 2026-09-26 01:00/.test(it.what));
      assert.ok(close && close.whenUtc === new Date(t0 + 65 * 3600000).toISOString() && /unless a printed trade reaches the stop first \(now 67\.375\)/.test(close.why), JSON.stringify(close));
      assert.strictEqual(st.liveStatus.nextExitUtc, new Date(t0 + 65 * 3600000).toISOString());
      assert.deepStrictEqual(await link.cancelLeftovers([target], [setup], new Map(), now), [], 'a setup on paper keeps its plans');
      // the setup stops: only the plan that has not opened is taken back
      const stopped = { ...setup, state: 'stopped' };
      const asked = new Map();
      const done = await link.cancelLeftovers([target], [stopped, { id: 'other', executionTargetRef: 'draw-engine', state: 'paper' }], asked, now);
      assert.deepStrictEqual(done.map((d) => [d.planId, d.ok]), [['setup-draw|2026-09-23T00:00:00.000Z', true]], JSON.stringify(done));
      assert.strictEqual(runner.plans.get('setup-draw|2026-09-23T00:00:00.000Z').state.phase, 'cancelled');
      assert.strictEqual(runner.plans.get('setup-draw|2026-09-23T00:00:00.000Z').state.reason, 'the setup is stopped: it takes no new entry');
      assert.strictEqual(runner.plans.get('setup-draw|2026-09-22T00:00:00.000Z').state.phase, 'open', 'the open position is left to its stop and its hold');
      assert.deepStrictEqual(await link.cancelLeftovers([target], [stopped], asked, now + 60000), [], 'not asked twice inside five minutes');
      const after = view.setupStatus(stopped);
      assert.ok(/this setup is stopped: nothing is sent to Draw engine/.test(after.liveStatus.items[0].why), after.liveStatus.items[0].why);
    } finally {
      m.stop();
      server.close();
      targets.deleteEngine('draw-engine', []);
      if (oldDecisions === undefined) delete process.env.GC_LIVE_DECISIONS; else process.env.GC_LIVE_DECISIONS = oldDecisions;
      fs.rmSync(edir, { recursive: true, force: true });
    }
  },

  // S5 AND THE LINK: a setup on an engine goes to paper only while the engine
  // answers through its link, and never to live while real orders are off
  aSetupOnTheEngineIsGatedOnTheLinkAndOnRealOrders() {
    const reg = require('../lib/live/setups');
    const m = link.mirrorFor(targets.getTarget('mx-engine'));
    const s = { id: 'setup-gate', executionTargetRef: 'mx-engine', configSnapshot: { cell: { entry: 'breakout' } }, tradedPair: 'LTCUSDT', keyRef: 'k' };
    m.lastHealth = null;
    const quiet = reg.liveGateErrors(s, 'paper');
    assert.ok(quiet.length === 1 && /the trading engine Mexico engine does not answer through its link yet/.test(quiet[0]), quiet.join(' | '));
    m.lastHealth = { at: new Date().toISOString(), health: { realOrders: 'off' } };
    assert.deepStrictEqual(reg.liveGateErrors(s, 'paper'), [], 'the breakout shape goes to paper on the engine');
    const live = reg.liveGateErrors(s, 'live');
    assert.ok(live.some((x) => /real orders are switched off on the trading engine Mexico engine/.test(x)), live.join(' | '));
    m.lastHealth = null;
  },
};
