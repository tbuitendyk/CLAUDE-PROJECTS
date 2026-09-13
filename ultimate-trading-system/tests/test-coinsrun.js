// THE COINS RUN, END TO END -- the file that did not exist while the tab did
// not work (2026-09-12).
//
// WHY THIS FILE EXISTS. Nineteen tests covered the arithmetic in lib/coins.js
// and every one of them passed while the tab read NOTHING: the runner took the
// wrapper forwardFill hands back and passed it on as the price map, so every
// coin threw on the first period built and landed in the refused list. Not one
// test in the suite loaded lib/coinsrun.js. A green suite was read as a working
// tab, and the tab had never been run.
//
// So every test here goes through readOneCoin with candles in and a record out.
// The arithmetic is checked next door; what is checked here is the plumbing.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');
const runner = require('../lib/coinsrun');

// CANDLES IN THE SHAPE THE LOADER REALLY PRODUCES -- open/high/low/close and a
// timestamp per hour. Getting this shape wrong is how a stub test passes while
// the real path fails, so it is read off lib/dataset.js's own filled candle.
function candles(hours, { start = 100, seed = 12345 } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = [];
  let p = start;
  const t0 = Date.UTC(2024, 0, 1);
  for (let h = 0; h < hours; h++) {
    p *= 1 + Math.sin(h / 290) * 0.004 + (rnd() - 0.5) * 0.004;
    rows.push({ ts: t0 + h * 3600000, open: p, high: p * 1.002, low: p * 0.998, close: p, quoteVolume: 1000 });
  }
  return rows;
}

// The loader is replaced for the length of one test and put back afterwards,
// so nothing here depends on what happens to be cached on the machine.
async function withPrices(rows, months, fn) {
  const pipeline = require('../lib/pipeline');
  const was = pipeline.loadSymbolAll;
  pipeline.loadSymbolAll = async () => ({ rows, cachedMonthCount: months });
  try { return await fn(); } finally { pipeline.loadSymbolAll = was; }
}

const PARAMS = {
  target: 6, from: 1, to: 30, step: 0.5, cap: 20, driftParts: 8,
  // few shuffles on purpose: these tests are about the plumbing, and the
  // arithmetic they would sharpen is checked next door
  shuffles: 20,
};

module.exports = {
  // THE ONE THAT WOULD HAVE CAUGHT IT. Candles in, a reading out, for every
  // window layout the screen offers.
  async aCoinWithCachedPricesActuallyGetsARead() {
    await withPrices(candles(24 * 500), 17, async () => {
      const rec = await runner.readOneCoin('LTCUSDT', PARAMS);
      assert.strictEqual(rec.read, true, `the coin must actually be read — instead: ${rec.why}`);
      assert.strictEqual(rec.why, null, 'and nothing to explain');

      // EVERY HOLD, WITH NOTHING ASKED FOR (3.122.0). A coin's history offers a
      // different set of trades at each hold, so every one is read; the owner
      // no longer picks a treatment before the screen will say anything.
      const holds = require('../lib/dataset').holdTypes();
      assert.deepStrictEqual(Object.keys(rec.holds).sort(), holds.map((h) => h.key).sort(),
        'there must be a reading for every hold the engine offers');
      const offered = runner.layouts();
      for (const h of holds) {
        const hr = rec.holds[h.key];
        assert.strictEqual(hr.hold.hours, h.hours, `${h.key}: the reading must know how long its trade is`);
        assert.strictEqual(hr.hold.at, h.at, `${h.key}: and when one can start`);
        assert.ok(hr.periods > 50, `${h.key}: a year and a bit of hourly candles is more than 50 trades, got ${hr.periods}`);
        assert.ok(hr.span.fromTs && hr.span.toTs > hr.span.fromTs, `${h.key}: and the span it covered`);
        assert.deepStrictEqual(Object.keys(hr.readings).sort(), offered.slice().sort(),
          `${h.key}: there must be a reading for every window layout the screen offers`);
        for (const layout of offered) {
          const rd = hr.readings[layout];
          assert.strictEqual(rd.layout, layout, `${h.key}/${layout}: the reading must know which layout it is`);
          assert.ok(rd.search, `${h.key}/${layout}: the search must have run`);
          assert.ok(rd.split && rd.split.length >= 3, `${h.key}/${layout}: the split of time per part must be there`);
          assert.ok(rd.weight && rd.weight.mean != null, `${h.key}/${layout}: the training weight must be there`);
          if (rd.search.reached) {
            assert.ok(rd.perPart && rd.perPart.length >= 3, `${h.key}/${layout}: the per-part typing must be there`);
            assert.ok(rd.typed.turns > 0, `${h.key}/${layout}: a real price path has changes of direction`);
          }
          // ONE COPY OF THE TRADITIONAL SCORE PER HOLD, not one per layout
          assert.strictEqual(rd.traditional, undefined,
            `${h.key}/${layout} carries its own copy of the traditional score — two copies of one fact`);
        }
        assert.ok(hr.traditional && hr.traditional.whole && hr.traditional.drift,
          `${h.key}: the traditional score is on the hold`);
        assert.strictEqual(hr.traditional.periods, hr.periods,
          `${h.key}: and it names how many trades it was worked out over, because both its numbers move with that`);
      }
      // AND THE HOLDS REALLY DIFFER. A weekly trade starts once a week and a
      // daily one every day, so the counts cannot be the same -- if they were,
      // the three rows would be three copies of one reading.
      const counts = holds.map((h) => rec.holds[h.key].periods);
      assert.ok(new Set(counts).size > 1, `the holds must offer different numbers of trades, got ${counts.join(', ')}`);
      // AND EVERY START DAY COUNTS (owner, 2026-09-13: "hold the anchors as
      // they are"). Weekdays are not filtered here, so each hold must offer
      // exactly what its shape offers with every day allowed -- filtered, the
      // two daily holds would lose most of their trades and the screen would be
      // describing a rule we chose rather than the history.
      const { toHourlyMap, forwardFill } = require('../lib/dataset');
      const map = forwardFill(toHourlyMap(candles(24 * 500))).map;
      const bracket = require('../lib/bracket');
      for (const h of holds) {
        const all = runner.seriesOf(bracket.buildComboChunks({ trade: map }, h.geometry, false).chunks).prices.length;
        assert.strictEqual(rec.holds[h.key].periods, all,
          `${h.key}: the trades read must be every one the history offers, with no start day filtered out`);
      }
    });
  },

  // WHAT A HISTORY OFFERS IS A HOLD, NOT A CHUNK SHAPE (owner order,
  // 2026-09-13). This is the measurement the whole redesign rests on: two
  // shapes with the same hold and the same entry anchor offer the SAME trades,
  // so the five shapes are three readings and not five.
  theFiveChunkShapesAreReallyThreeSetsOfTrades() {
    const bracket = require('../lib/bracket');
    const { toHourlyMap, forwardFill, GEOMETRIES, holdTypes } = require('../lib/dataset');
    const map = forwardFill(toHourlyMap(candles(24 * 400))).map;
    const HOUR = 3600000;
    const entriesOf = (g) => new Set(bracket.buildComboChunks({ trade: map }, g, false).chunks
      .filter((c) => c.c1 != null).map((c) => c.startTs + GEOMETRIES[g].entryOffsetH * HOUR));
    const shared = (a, b) => {
      const A = entriesOf(a);
      const B = entriesOf(b);
      return [...A].filter((x) => B.has(x)).length;
    };
    // the pairs that share a hold share their trades bar the edge of the span
    for (const [a, b] of [['daily-1d', 'daily-2d'], ['daily-3d', 'daily-4d']]) {
      const A = entriesOf(a);
      const both = shared(a, b);
      assert.ok(both >= A.size - 2,
        `${a} and ${b} hold for the same time at the same anchor, so they must offer the same trades — ${both} of ${A.size} shared`);
      assert.strictEqual(GEOMETRIES[a].exitOffsetH - GEOMETRIES[a].entryOffsetH,
        GEOMETRIES[b].exitOffsetH - GEOMETRIES[b].entryOffsetH, `${a} and ${b} must hold for the same time`);
    }
    // and the holds offered are worked out from the geometries, never typed
    const holds = holdTypes();
    assert.deepStrictEqual(holds.map((h) => h.hours), [...new Set(Object.values(GEOMETRIES)
      .map((g) => g.exitOffsetH - g.entryOffsetH))].sort((x, y) => x - y),
      'the holds offered must be exactly the distinct holds the geometries carry');
    // THE ANCHORS ARE HELD WHERE THEY ARE (owner, 2026-09-13), and read off the
    // geometry rather than restated here
    for (const h of holds) {
      const g = GEOMETRIES[h.geometry];
      assert.strictEqual(h.at.slice(-5), `${String(g.entryOffsetH % 24).padStart(2, '0')}:00`,
        `${h.key}: the entry hour must be the geometry's own`);
      assert.strictEqual(h.startsPerWeek, Math.round((7 * 24) / g.stepHours), `${h.key}: starts a week`);
    }
    assert.strictEqual(holds.reduce((n, h) => n + h.startsPerWeek, 0), 15,
      'seven starts a week on each daily hold and one on the weekly one is fifteen');
    // AND EACH HOLD IS BUILT FROM THE SHAPE THAT OFFERS THE MOST OF IT. Two
    // shapes with one hold differ only in look-back, and the shorter look-back
    // starts earlier, so it gives a trade the other cannot.
    for (const h of holds) {
      for (const [name, g] of Object.entries(GEOMETRIES)) {
        if (g.exitOffsetH - g.entryOffsetH !== h.hours) continue;
        assert.ok(GEOMETRIES[h.geometry].featureHours <= g.featureHours,
          `${h.key} is built from ${h.geometry}, and ${name} shares its hold with a shorter look-back — it would offer more trades`);
      }
      const n = entriesOf(h.geometry).size;
      for (const [name, g] of Object.entries(GEOMETRIES)) {
        if (g.exitOffsetH - g.entryOffsetH !== h.hours || name === h.geometry) continue;
        assert.ok(n >= entriesOf(name).size, `${h.key}: ${name} offers more trades than the shape this hold is read from`);
      }
    }
    // and neither treatment is a setting on this tab any more
    assert.strictEqual(runner.normalise({ weekdaysOnly: true }).weekdaysOnly, undefined,
      '24/5 is not something a history has an opinion about — it must not be a setting here');
    assert.strictEqual(runner.normalise({ geometry: 'daily-4d' }).geometry, undefined,
      'a chunk shape is a look-back, which only feeds training — it must not be a setting here');
    assert.strictEqual(runner.DEFAULTS.weekdaysOnly, undefined, 'and no box starts with one');
  },

  async theRecordSaysWhatItWasReadAtAndOverWhat() {
    const rows = candles(24 * 400);
    await withPrices(rows, 14, async () => {
      const rec = await runner.readOneCoin('XRPUSDT', { ...PARAMS, target: 4, cap: 12, shuffles: 200 });
      assert.deepStrictEqual(rec.params, {
        target: 4, from: 1, to: 30, step: 0.5, cap: 12, driftParts: 8, shuffles: 200,
      }, 'the record must carry every value it was read at, not the defaults');
      assert.strictEqual(rec.provenance.candles, rows.length, 'and how many candles were behind it');
      assert.strictEqual(rec.provenance.cachedMonths, 14, 'and how many months were cached at the time');
      assert.strictEqual(rec.provenance.release, require('../package.json').version,
        'and the release that took it');
      // THE SPAN BELONGS TO THE HOLD, not to the coin: a weekly trade and a
      // daily one do not start or end on the same day, so one span at the top
      // would be right for at most one of them.
      for (const h of Object.values(rec.holds)) {
        assert.ok(h.span.fromTs && h.span.toTs && h.span.toTs > h.span.fromTs,
          `${h.hold.key}: the span of history this hold was worked out from`);
        // the ceiling it was read at really reached the reading
        for (const layout of runner.layouts()) assert.strictEqual(h.readings[layout].weight.cap, 12,
          `${h.hold.key}/${layout}: the weight ceiling on the record is not the one it was read at`);
      }
    });
  },

  // NOTHING HERE REFUSES A COIN (COINS.md section 8). Every one of these used to
  // throw, and a thrown coin vanished from the screen with its reason held in
  // memory until the next press wiped it.
  async aCoinThatCannotBeReadStillGetsARecordSayingWhy() {
    await withPrices([], 0, async () => {
      const rec = await runner.readOneCoin('NOTHINGUSDT', PARAMS);
      assert.strictEqual(rec.read, false, 'a coin with no cached prices cannot be read');
      assert.ok(/no cached prices/.test(rec.why), `and the record says so: ${rec.why}`);
      assert.strictEqual(rec.v, runner.RECORD_V, 'and it is still a record of this shape');
      assert.ok(rec.provenance.capturedAt, 'and it still says when the attempt was made');
    });
    // a coin with a handful of trades: read, and each hold and layout says for
    // itself. A hold that offered nothing must not take the other two down.
    await withPrices(candles(24 * 40), 2, async () => {
      const rec = await runner.readOneCoin('TINYUSDT', PARAMS);
      assert.strictEqual(rec.read, true, 'a handful of trades is still something to read');
      for (const h of Object.values(rec.holds)) {
        assert.ok(h.hold && h.hold.hours, 'every hold must say how long its trade is');
        if (!h.read) { assert.ok(h.why && h.why.length > 10, `${h.hold.key}: nothing read means a sentence saying why`); continue; }
        assert.ok(h.traditional, `${h.hold.key}: the traditional score is worked out from its trades`);
        for (const layout of runner.layouts()) {
          const rd = h.readings[layout];
          assert.ok(rd, `${h.hold.key}/${layout} must still have an entry`);
          if (!rd.search) assert.ok(rd.why && rd.why.length > 10, `${h.hold.key}/${layout}: no reading means a sentence saying why`);
        }
      }
    });
    // AND THE SOURCE CARRIES NO PERIOD FLOOR AT ALL. Comments are stripped
    // first: a scan that a comment can trigger, or that a comment can hide a
    // line from, proves nothing either way.
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/prices\.length\s*<\s*\d/.test(src),
      'the runner has grown a minimum period count — this tab reports and never refuses');
    const readBody = src.slice(src.indexOf('function readOneHold('), src.indexOf('let run = null;'));
    assert.ok(readBody.length > 400 && readBody.length < src.length, 'the slice being scanned is not the reading path');
    assert.ok(!/\bthrow\b/.test(readBody),
      'the runner throws somewhere between loading a coin and returning its record — a thrown coin leaves the screen');
  },

  // STOPPED IS NOT FINISHED. A run halted at coin 4 of 17 used to read word for
  // word like a completed 4-coin run.
  async stoppingIsToldApartFromFinishing() {
    const dir = path.dirname(runner.recordFile('AAA'));
    const made = [];
    await withPrices(candles(24 * 200), 7, async () => {
      const before = runner.coinsRunStop();
      assert.strictEqual(before.stopping, false, 'with nothing running there is nothing to stop');
      assert.ok(/nothing is running/.test(before.why), 'and it says so rather than answering in silence');

      const coins = ['ZQAUSDT', 'ZQBUSDT', 'ZQCUSDT', 'ZQDUSDT'];
      for (const c of coins) made.push(runner.recordFile(c));
      runner.coinsRunStart({ coins: coins.join(',') });
      runner.coinsRunStop();
      for (let i = 0; i < 400 && runner.coinsRunStatus().running; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      const st = runner.coinsRunStatus();
      assert.strictEqual(st.running, false, 'the run must actually have ended');
      assert.strictEqual(st.stopped, true, 'and it must say it was stopped');
      assert.ok(st.stoppedAt != null && st.stoppedAt < coins.length,
        `and say where it got to (${st.stoppedAt} of ${coins.length})`);
      assert.ok(st.finishedAt, 'and when it ended');
      // a finished run says the opposite
      runner.coinsRunStart({ coins: 'ZQAUSDT' });
      for (let i = 0; i < 400 && runner.coinsRunStatus().running; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      const fin = runner.coinsRunStatus();
      assert.strictEqual(fin.stopped, false, 'a run nobody stopped must not read as stopped');
      assert.strictEqual(fin.stoppedAt, null, 'and must not name a point it stopped at');
      assert.strictEqual(fin.done, 1, 'and must have read what it was asked for');
    });
    for (const f of made) { try { fs.unlinkSync(f); } catch (_) { /* never written */ } }
  },

  // EVERY COIN THE RUN TOUCHED IS ON DISK, read or not, so the screen shows it
  // after a restart. The refusals used to live in memory, on the latest press
  // only: read seventeen coins, two fail, press again for one, and the two were
  // gone with nothing said.
  async everyCoinTheRunTouchedIsOnDiskAfterwards() {
    const coins = ['ZQEUSDT', 'ZQFUSDT'];
    const made = coins.map((c) => runner.recordFile(c));
    try {
      await withPrices([], 0, async () => {
        runner.coinsRunStart({ coins: coins.join(',') });
        for (let i = 0; i < 400 && runner.coinsRunStatus().running; i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
      });
      const st = runner.coinsRunStatus();
      assert.strictEqual(st.wrote.length, 0, 'neither coin had prices to read');
      assert.deepStrictEqual(st.couldNotRead.map((c) => c.coin), coins, 'and both are named as unread');
      for (const c of coins) {
        const rec = runner.readRecord(c);
        assert.ok(rec, `${c} must have a record on disk even though it could not be read`);
        assert.strictEqual(rec.read, false, `${c}'s record must say it could not be read`);
        assert.ok(rec.why && /no cached prices/.test(rec.why), `${c}'s record must say why: ${rec.why}`);
      }
      const served = runner.coinsRecords();
      const names = served.records.map((r) => r.coin);
      for (const c of coins) assert.ok(names.includes(c), `${c} must be served to the screen, not left out`);
    } finally {
      for (const f of made) { try { fs.unlinkSync(f); } catch (_) { /* never written */ } }
    }
  },

  // The values the owner types are the values that run, and a value that cannot
  // work is refused with a sentence rather than quietly replaced.
  theValuesTheOwnerTypesAreTheValuesThatRun() {
    const p = runner.normalise({ target: '9', from: '2', to: '18', step: '0.25', cap: '7', driftParts: '5' });
    assert.deepStrictEqual(
      { target: p.target, from: p.from, to: p.to, step: p.step, cap: p.cap, driftParts: p.driftParts },
      { target: 9, from: 2, to: 18, step: 0.25, cap: 7, driftParts: 5 },
      'the run must use what was typed');
    const d = runner.normalise({});
    for (const k of ['target', 'from', 'to', 'step', 'cap', 'driftParts']) {
      assert.strictEqual(d[k], runner.DEFAULTS[k], `an empty box must fall back to the server's own default for ${k}`);
    }
    for (const [body, says] of [
      [{ from: 20, to: 5 }, /must run upwards/],
      [{ cap: 1 }, /above 1/],
    ]) {
      let threw = null;
      try { runner.normalise(body); } catch (err) { threw = err.message; }
      assert.ok(threw && says.test(threw), `${JSON.stringify(body)} must be refused with a sentence, got ${threw}`);
    }
    // the coin list is the owner's, and blank means the default list
    assert.deepStrictEqual(runner.normalise({ coins: 'ltcusdt, xrpusdt ,LTCUSDT' }).coins, ['LTCUSDT', 'XRPUSDT'],
      'the coin list is tidied and de-duplicated, never re-ordered or added to');
    // A BLANK BOX IS EVERY COIN DOWNLOADED (owner order, 2026-09-13), read from
    // the cache rather than from a list somebody keeps in step by hand. What is
    // downloaded is STOOD IN FOR, because a test that read this machine's cache
    // would pass with an empty answer on a machine with an empty cache -- which
    // is exactly the machine the suite runs on.
    const dataset = require('../lib/dataset');
    const was = dataset.defaultCoins;
    try {
      dataset.defaultCoins = () => ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'];
      assert.deepStrictEqual(runner.normalise({ coins: '   ' }).coins, ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'],
        'a blank box means every coin downloaded, which is what a blank box on Sweep resolves to as well');
      dataset.defaultCoins = () => [];
      let threw = '';
      try { runner.normalise({ coins: '' }); } catch (err) { threw = String(err.message); }
      assert.match(threw, /no coins are downloaded/,
        'a blank box on a box with nothing downloaded must say so, not start a run that reads nothing');
      assert.match(threw, /download some on Data first/, 'and say what to do about it');
    } finally { dataset.defaultCoins = was; }
    // AND A FABRICATED COIN IS NEVER ONE OF THEM. The stage-engine check writes
    // its two into the same cache a blank box reads, and a blank box that swept
    // them up would train and trade on invented prices.
    const { isRealCoin } = dataset;
    const binance = require('../lib/binance');
    const wasCache = binance.cacheState;
    try {
      binance.cacheState = () => [
        { symbol: 'XRPUSDT' }, { symbol: 'PLANTEDSTAGEAUSDT' }, { symbol: 'BTCUSDT' },
        { symbol: 'ZZZPAUSEAUSDT' }, { symbol: 'ADAUSDT' }, { symbol: 'PLANTEDSTAGEBUSDT' },
      ];
      assert.deepStrictEqual(dataset.defaultCoins(), ['ADAUSDT', 'BTCUSDT', 'XRPUSDT'],
        'every coin downloaded, in name order, and not one fabricated coin among them');
    } finally { binance.cacheState = wasCache; }
    for (const c of dataset.defaultCoins()) {
      assert.ok(isRealCoin(c), `${c} is a fabricated coin and a blank box would have traded it`);
    }
    const G = require('../lib/stagegate');
    for (const c of G.SYMBOLS) assert.strictEqual(isRealCoin(c), false, `${c} must never be a real coin`);
    assert.strictEqual(isRealCoin('ZZZPAUSEAUSDT'), false, 'nor a coin a test wrote');
    assert.strictEqual(isRealCoin('LTCUSDT'), true, 'and a real coin must not be swept out with them');
  },
};
