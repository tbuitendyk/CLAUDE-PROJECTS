// The web box's side of the new trading engine (LOOP-2026-09-25-ENGINE.md):
// the engine's record on Setup > Compute, the size of a plan (S4), the engine's
// words written again in the words the Trade tab reads, and a whole loop -- an
// engine on this machine, linked over its own link, drawn by the one path both
// books share.
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
const { linkedEngine, until } = require('./engine-linked');

module.exports = {
  // S7: THE ENGINE'S RECORD is the owner's: changed and taken away through the
  // service, refused in words when it is not whole, never written into code. A
  // NEW engine is not made here -- it is installed and its record made when it
  // first calls in (owner, 2026-09-25) -- and the form changes only its names
  // and its tick, never how it is reached: every engine calls this system
  theEnginesRecordIsTheOwnersAndRefusedInWordsWhenNotWhole() {
    const hash = 'a'.repeat(64);
    const first = targets.saveCallingEngine({ id: 'mx-engine', name: 'Mexico engine', tokenHash: 'd'.repeat(64) });
    assert.deepStrictEqual({ id: first.id, kind: first.kind, link: first.link, isDefault: first.isDefault, symbols: first.symbols }, { id: 'mx-engine', kind: 'engine', link: 'calls-out', isDefault: true, symbols: null }, 'the first engine is the one new setups run on');
    assert.strictEqual(targets.defaultEngine().id, 'mx-engine');
    assert.ok(targets.getTarget('mx-1') && targets.getTarget('mx-1').kind === 'ssh-box', 'the old order program stays where it was');
    const bad = (rec, re) => { let e = null; try { targets.saveEngine(rec); } catch (x) { e = x; } assert.ok(e && e.code === 'BAD_ENGINE' && re.test(e.message), e && e.message); };
    bad({ id: 'x2', name: 'X' }, /^no platform called x2: a new platform is added by installing it, with Set up a trading platform$/);
    bad({ id: 'mx-engine', name: '' }, /^descriptive name: 1 to 60 characters$/);
    assert.ok(targets.engineProblems({ id: 'mx-1', name: 'X', link: 'calls-out', tokenHash: hash }).includes('short name: mx-1 is already taken'), 'no engine record takes the old order program\'s name');
    // an engine calls this system, and that is the only way there is
    assert.deepStrictEqual(targets.LINKS, ['calls-out']);
    assert.deepStrictEqual(targets.engineProblems({ id: 'x3', name: 'X', link: 'tunnel', tokenHash: hash }), ['the link: a platform calls this system']);
    assert.deepStrictEqual(targets.engineProblems({ id: 'x3', name: 'X', link: 'calls-out' }), ['the platform\'s token fingerprint is missing']);
    // AN ENGINE THAT CALLS OUT: made when it first calls; its token's fingerprint and its lock are its own, never the form's
    const out = targets.saveCallingEngine({ id: 'cdmx-engine', name: 'CDMX engine', tokenHash: hash, lock: { publicKey: 'x', fingerprint: 'abcd-ef01-2345-6789-abcd' }, machine: { platform: 'linux' }, release: '3.266.0' });
    assert.deepStrictEqual([out.link, out.tokenHash, out.isDefault], ['calls-out', hash, false]);
    // a second engine ticked for new setups takes the tick from the first
    targets.saveEngine({ id: 'cdmx-engine', name: 'CDMX engine', isDefault: true });
    assert.deepStrictEqual(targets.listEngines().map((t) => [t.id, t.isDefault]).sort(), [['cdmx-engine', true], ['mx-engine', false]]);
    const changed = targets.saveEngine({ id: 'cdmx-engine', name: 'CDMX engine 2', isDefault: false, tokenHash: 'b'.repeat(64), link: 'tunnel', host: 'evil', localPort: 9999 });
    assert.deepStrictEqual([changed.name, changed.tokenHash, changed.link, changed.host, changed.localPort], ['CDMX engine 2', hash, 'calls-out', undefined, undefined], 'the form changes its names and tick, and nothing about how it is reached');
    targets.saveEngine({ id: 'mx-engine', name: 'Mexico engine', isDefault: true });
    // a short name kept by a record of another kind is never taken by an engine calling in
    fs.writeFileSync(targets.targetsFile(), JSON.stringify({ ...JSON.parse(fs.readFileSync(targets.targetsFile(), 'utf8')), 'box-2': { id: 'box-2', kind: 'ssh-box', host: 'h', user: 'u' } }));
    assert.throws(() => targets.saveCallingEngine({ id: 'box-2', name: 'Taken', tokenHash: hash }), /the short name box-2 already belongs to another platform/);
    // what it says of itself when it calls, and nothing else
    targets.noteEngine('cdmx-engine', { release: '3.266.1', lastSeenUtc: '2026-09-26T01:00:00.000Z', tokenHash: 'c'.repeat(64) });
    assert.deepStrictEqual([targets.getTarget('cdmx-engine').release, targets.getTarget('cdmx-engine').tokenHash], ['3.266.1', hash]);
    // an engine a setup runs on cannot be taken away
    let e = null;
    try { targets.deleteEngine('cdmx-engine', [{ id: 's1', name: 'LTC paper', executionTargetRef: 'cdmx-engine', state: 'paper' }]); } catch (x) { e = x; }
    assert.ok(e && e.code === 'IN_USE' && /1 setup\(s\) run on cdmx-engine \(LTC paper\)/.test(e.message), e && e.message);
    targets.deleteEngine('cdmx-engine', []);
    const all = JSON.parse(fs.readFileSync(targets.targetsFile(), 'utf8'));
    delete all['box-2'];
    fs.writeFileSync(targets.targetsFile(), JSON.stringify(all));
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
  // its real handler), linked over its own link, its record kept by the mirror,
  // read by the Trade tab's path
  async anEngineOnThisMachineIsFollowedAndDrawnByTheOnePath() {
    const { Journal } = require('../engine/journal');
    const { Runner } = require('../engine/runner');
    const { SimulatedExchange } = require('../engine/venues/simulated');
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
    const eng = await linkedEngine({ id: 'loop-engine', deps: { runner, journal, health: () => ({ ok: true, realOrders: 'off' }) } });
    const target = eng.target;
    const m = new link.Mirror(target);
    try {
      m.start();
      assert.strictEqual(m.linkStatus().following, false, 'before the engine calls in, the link says it is not up');
      await eng.start();
      const plan = { planId: 'setup-loop|2026-09-22T00:00:00.000Z', setupId: 'setup-loop', mode: 'simulated', symbol: 'LTCUSDT', chunkStart: '2026-09-22T00:00:00.000Z', entryTs: t0, call: 1, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 }, bandPct: 5, size: { quoteUsd: 100 }, feePerLeg: 0.001 };
      const posted = await link.postPlan(target, plan);
      assert.ok(posted.ok && posted.json.phase === 'waiting', JSON.stringify(posted));
      now = t0;
      runner.onKline({ symbol: 'LTCUSDT', openTime: t0, open: 70 });
      market.books.set('LTCUSDT', { bids: [[72.6, 5]], asks: [[72.7, 5]], ts: now });
      market.trades.set('LTCUSDT', { price: 72.7, ts: now });
      runner.onTrade({ symbol: 'LTCUSDT', price: 72.7, ts: now });
      await until(() => runner.plans.get(plan.planId).state.phase === 'open');
      runner.sendMarks(now);
      const view = require('../lib/live/view');
      await until(() => fs.existsSync(m.eventsFile) && view.readJournal(m.eventsFile).events.some((e) => e.event === 'PAPER_ENTRY_FILL') && m.marksOf('setup-loop').length);
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
      assert.deepStrictEqual([m.linkStatus().following, m.linkStatus().why], [true, null], 'the link says it is up');
    } finally {
      eng.stop();
      m.stop();
      targets.deleteEngine('loop-engine', []);
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
    const eng = await linkedEngine({ id: 'draw-engine', name: 'Draw engine', deps: { runner, journal, health: () => ({ ok: true, realOrders: 'off' }) } });
    const target = eng.target;
    const m = link.mirrorFor(target);
    const cell = { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 };
    const setup = { id: 'setup-draw', name: 'LTC on the engine', state: 'paper', executionTargetRef: 'draw-engine', tradedPair: 'LTCUSDT', clipUsd: 100, trainPolicy: { mode: 'rolling' },
      configSnapshot: { branch: { geometry: 'daily-4d', band: 5 }, cell, combo: { trade: 'LTCUSDT' } } };
    const plan = (chunk, entryTs) => ({ planId: `setup-draw|${chunk}`, setupId: 'setup-draw', mode: 'simulated', symbol: 'LTCUSDT', chunkStart: chunk, entryTs, call: 1, cell, bandPct: 5, size: { quoteUsd: 100 }, feePerLeg: 0.001 });
    try {
      m.start();
      await eng.start();
      assert.ok((await link.postPlan(target, plan('2026-09-22T00:00:00.000Z', t0))).ok);
      assert.ok((await link.postPlan(target, plan('2026-09-23T00:00:00.000Z', t0 + 24 * 3600000))).ok);
      now = t0;
      runner.onKline({ symbol: 'LTCUSDT', openTime: t0, open: 70 });
      market.books.set('LTCUSDT', { bids: [[72.6, 5]], asks: [[72.7, 5]], ts: now });
      market.trades.set('LTCUSDT', { price: 72.7, ts: now });
      runner.onTrade({ symbol: 'LTCUSDT', price: 72.7, ts: now });
      for (let i = 0; i < 50 && runner.plans.get('setup-draw|2026-09-22T00:00:00.000Z').state.phase !== 'open'; i++) await new Promise((r) => setTimeout(r, 20));
      runner.sendMarks(now);
      await until(() => m.plansOf('setup-draw').some((x) => x.state && x.state.phase === 'open') && m.marksOf('setup-draw').length);
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
      eng.stop();
      m.stop();
      targets.deleteEngine('draw-engine', []);
      if (oldDecisions === undefined) delete process.env.GC_LIVE_DECISIONS; else process.env.GC_LIVE_DECISIONS = oldDecisions;
      fs.rmSync(edir, { recursive: true, force: true });
    }
  },

  // VERBOSE (item 6, 3.262.0): the tick on Setup detail reaches the engine,
  // which then writes down every hourly check of the trail -- the hour, its
  // best, the best so far, where it arms, where the trail would put the stop,
  // the stop after and why -- and the Trade tab's one path shows them; with the
  // tick off, the checks are not written and the trail trades exactly the same
  async verboseWritesDownEveryHourlyCheckOfTheTrailAndOnlyWhenTicked() {
    const { Journal } = require('../engine/journal');
    const { Runner } = require('../engine/runner');
    const { SimulatedExchange } = require('../engine/venues/simulated');
    const view = require('../lib/live/view');
    const H = 3600000;
    const edir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-v-'));
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
    const eng = await linkedEngine({ id: 'verbose-engine', name: 'Verbose engine', deps: { runner, journal, health: () => ({ ok: true, realOrders: 'off' }) } });
    const target = eng.target;
    const m = link.mirrorFor(target);
    const cell = { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1, armMult: 0.5 };
    const setup = { id: 'setup-v', name: 'LTC verbose', state: 'paper', executionTargetRef: 'verbose-engine', tradedPair: 'LTCUSDT', clipUsd: 100, trainPolicy: { mode: 'rolling' }, verbose: true,
      configSnapshot: { branch: { geometry: 'daily-4d', band: 5 }, cell, combo: { trade: 'LTCUSDT' } } };
    const plan = { planId: 'setup-v|2026-09-22T00:00:00.000Z', setupId: 'setup-v', mode: 'simulated', symbol: 'LTCUSDT', chunkStart: '2026-09-22T00:00:00.000Z', entryTs: t0, call: 1, cell, bandPct: 5, size: { quoteUsd: 100 }, feePerLeg: 0.001 };
    const waitFor = (fn) => until(fn);
    const print = (price, ts) => { now = ts; market.books.set('LTCUSDT', { bids: [[price - 0.05, 50]], asks: [[price, 50]], ts }); market.trades.set('LTCUSDT', { price, ts }); runner.onTrade({ symbol: 'LTCUSDT', price, ts }); };
    try {
      m.start();
      await eng.start();
      // the tick reaches the engine, once
      const asked = new Map();
      const sent = await link.syncVerbose([target], [setup], asked, now);
      assert.deepStrictEqual(sent.map((x) => [x.setup, x.on, x.ok]), [['setup-v', true, true]]);
      assert.strictEqual(runner.verbose.get('setup-v'), true);
      await waitFor(() => (m.verbose.get('setup-v') || {}).on === true);
      assert.deepStrictEqual(await link.syncVerbose([target], [setup], asked, now), [], 'the engine has it: nothing asked again');
      // a position opens at the buying level and the trail is checked at the end of every whole hour
      assert.ok((await link.postPlan(target, plan)).ok);
      runner.onKline({ symbol: 'LTCUSDT', openTime: t0, open: 70 });
      print(72.7, t0 + 60000);
      await waitFor(() => runner.plans.get(plan.planId).state.phase === 'open');
      const entry = runner.plans.get(plan.planId).state.entry;
      print(75, t0 + H + 60000);          // hour 1: best 75, past where the trail arms (2.5% above the fill)
      print(74.8, t0 + 2 * H + 60000);    // hour 2 begins: hour 1 is checked
      now = t0 + 4 * H + 60000; runner.tick(); // hour 2 checked; hour 3 saw no trade
      now = t0 + 5 * H + 60000; runner.tick();
      await waitFor(() => view.setupStatus(setup).engine.trailChecks.length >= 3);
      const st = view.setupStatus(setup);
      assert.deepStrictEqual(st.engine.verbose, { on: true, engineHas: true, since: st.engine.verbose.since });
      const [h3, h2, h1] = st.engine.trailChecks;
      assert.strictEqual(h1.hour_utc, new Date(t0 + H).toISOString());
      assert.deepStrictEqual([h1.hourBest, h1.best, h1.armed, h1.moved, h1.why], [75, 75, true, true, 'armed this hour, and the stop moved to where the trail puts it']);
      assert.ok(Math.abs(h1.armAt - entry * 1.025) < 1e-9 && Math.abs(h1.want - 75 * 0.95) < 1e-9 && Math.abs(h1.stop - 75 * 0.95) < 1e-9, JSON.stringify(h1));
      assert.ok(Math.abs(h1.was - 70 * (1 - 0.0375)) < 1e-9, 'the stop before was the level on the other side');
      assert.deepStrictEqual([h2.hourBest, h2.best, h2.moved, h2.why], [74.8, 75, false, 'not moved: where the trail would put the stop is not tighter than the stop already is']);
      assert.deepStrictEqual([h3.hourBest, h3.moved, h3.why], [null, false, 'no printed trade in this hour, so there was nothing to check']);
      assert.deepStrictEqual([h1.plan_entry_utc, h1.side], [new Date(t0).toISOString(), 'LONG']);
      // off: the tick is carried the same way, and nothing more is written
      const off = { ...setup, verbose: false };
      assert.deepStrictEqual((await link.syncVerbose([target], [off], asked, now)).map((x) => [x.on, x.ok]), [[false, true]]);
      const before = journal.readAll ? [...journal.readAll()].filter((r) => r.what === 'trail check').length : null;
      now = t0 + 6 * H + 60000; runner.tick();
      const afterN = journal.readAll ? [...journal.readAll()].filter((r) => r.what === 'trail check').length : null;
      assert.strictEqual(afterN, before, 'with Verbose off the checks are not written');
      await waitFor(() => (m.verbose.get('setup-v') || {}).on === false);
      assert.deepStrictEqual(view.setupStatus(off).engine.verbose.on, false);
      // a restart remembers it
      const again = new Runner({ journal, market, venues: { simulated: new SimulatedExchange({ market, feePerLeg: 0.001, now: () => now }) }, now: () => now });
      again.recover();
      assert.strictEqual(again.verbose.get('setup-v'), false);
    } finally {
      eng.stop();
      m.stop();
      targets.deleteEngine('verbose-engine', []);
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
    assert.ok(quiet.length === 1 && /the trading platform Mexico engine does not answer through its link yet/.test(quiet[0]), quiet.join(' | '));
    m.lastHealth = { at: new Date().toISOString(), health: { realOrders: 'off' } };
    assert.deepStrictEqual(reg.liveGateErrors(s, 'paper'), [], 'the breakout shape goes to paper on the engine');
    const live = reg.liveGateErrors(s, 'live');
    assert.ok(live.some((x) => /real orders are switched off on the trading platform Mexico engine/.test(x)), live.join(' | '));
    m.lastHealth = null;
  },
};

// THE ENGINE CARD'S PRICE LINE (3.262.2): no coin followed is said as such and
// not painted as a fault; red only when a coin is followed and prices stop
module.exports.theEngineCardSaysWhatItsPricesMean = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  const fn = src.slice(src.indexOf('function engineCard('), src.indexOf('const said =', src.indexOf('function engineCard(')));
  const feedsOf = new Function('h', 'esc', `${fn.slice(fn.indexOf('const feeds ='))}; return feeds;`);
  const esc = (t) => String(t);
  assert.strictEqual(feedsOf({ feeds: [{ connected: false, symbols: [] }] }, esc), '<span class="muted">no coin followed — no plan waiting or open</span>');
  assert.strictEqual(feedsOf({ feeds: [{ connected: true, symbols: ['LTCUSDT'] }] }, esc), '<span class="pos">arriving for LTCUSDT</span>');
  assert.strictEqual(feedsOf({ feeds: [{ connected: false, symbols: ['LTCUSDT'] }] }, esc), '<span class="neg">not arriving for LTCUSDT</span>');
  assert.ok(!/prices arriving|prices not arriving/.test(fn), 'the caption says prices; the value does not say it again');
};

// THE ENGINE RECORD'S TWO NAMES SAY WHICH IS WHICH ON THE SCREEN (3.263.1):
// visible labels and an example in each box, never hover text alone
module.exports.theEngineRecordFormSaysWhichNameIsWhich = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  // the checklist asks for both when an engine's setup starts; the record's form changes the descriptive one
  assert.ok(/<span class="muted">short name — letters, digits, dashes<\/span><input id="esShort"[^>]*placeholder="platform-2"/.test(src), 'the short name says so, with an example');
  assert.ok(/<span class="muted">descriptive name — what you see on screen<\/span><input id="esName"[^>]*placeholder="Platform 2"/.test(src), 'the descriptive name says so, with an example');
  assert.ok(/<span class="muted">descriptive name — what you see on screen<\/span><input id="engName"[^>]*placeholder="Platform 2"/.test(src), 'and the record\'s form says the same');
  assert.ok(/>Changing ' \+ esc\(ed\.name\) \+ ' <span class="muted">\(' \+ esc\(ed\.id\) \+ '\)<\/span>/.test(src), 'the record being changed is headed with both names');
  assert.ok(!/>record id</.test(src) && !/id="engId"/.test(src), 'the old label and the short name box are gone from the form: a record keeps its short name');
  assert.deepStrictEqual(targets.engineProblems({ id: '', name: '', link: 'calls-out', tokenHash: 'a'.repeat(64) }), ['short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit', 'descriptive name: 1 to 60 characters'], 'a refusal names the two fields the same way');
};
