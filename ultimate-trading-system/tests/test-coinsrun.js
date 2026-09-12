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
  geometry: 'daily-4d', target: 6, from: 1, to: 30, step: 0.5, cap: 20, driftParts: 8, weekdaysOnly: false,
};

module.exports = {
  // THE ONE THAT WOULD HAVE CAUGHT IT. Candles in, a reading out, for every
  // window layout the screen offers.
  async aCoinWithCachedPricesActuallyGetsARead() {
    await withPrices(candles(24 * 500), 17, async () => {
      const rec = await runner.readOneCoin('LTCUSDT', PARAMS);
      assert.strictEqual(rec.read, true, `the coin must actually be read — instead: ${rec.why}`);
      assert.ok(rec.periods > 100, `a year and a bit of hourly candles is more than 100 four-day periods, got ${rec.periods}`);
      assert.strictEqual(rec.why, null, 'and nothing to explain');

      const offered = runner.layouts();
      assert.deepStrictEqual(Object.keys(rec.readings).sort(), offered.slice().sort(),
        'there must be a reading for every window layout the screen offers');
      for (const layout of offered) {
        const rd = rec.readings[layout];
        assert.strictEqual(rd.layout, layout, `${layout}: the reading must know which layout it is`);
        assert.ok(rd.search, `${layout}: the search must have run`);
        assert.ok(rd.split && rd.split.length >= 3, `${layout}: the split of time per part must be there`);
        assert.ok(rd.weight && rd.weight.mean != null, `${layout}: the training weight must be there`);
        if (rd.search.reached) {
          assert.ok(rd.perPart && rd.perPart.length >= 3, `${layout}: the per-part typing must be there`);
          assert.ok(rd.typed.turns > 0, `${layout}: a real price path has changes of direction`);
        }
      }
      assert.ok(rec.traditional && rec.traditional.whole && rec.traditional.drift,
        'the traditional score is on the record');
      assert.strictEqual(rec.traditional.periods, rec.periods,
        'and it names how many periods it was worked out over, because both its numbers move with that');
      // ONE COPY OF IT, not one per layout (COINS.md section 11).
      for (const layout of runner.layouts()) {
        assert.strictEqual(rec.readings[layout].traditional, undefined,
          `${layout} carries its own copy of the traditional score — two copies of one fact`);
      }
    });
  },

  // THE PERIODS ARE THE SWEEP'S OWN PERIODS, including the weekday setting. The
  // file's own header claims a reading here lines up with the run it is vetting
  // for, and with that setting pinned off it did not: the same coin gives seven
  // times as many periods one way as the other.
  theWeekdaySettingIsTheOwnersAndItReallyChangesThePeriods() {
    const bracket = require('../lib/bracket');
    const { toHourlyMap, forwardFill } = require('../lib/dataset');
    const map = forwardFill(toHourlyMap(candles(24 * 730))).map;
    const off = runner.seriesOf(bracket.buildComboChunks({ trade: map }, 'daily-4d', false).chunks).prices.length;
    const on = runner.seriesOf(bracket.buildComboChunks({ trade: map }, 'daily-4d', true).chunks).prices.length;
    assert.ok(off > on * 2, `the weekday setting must really change the period count, got ${off} against ${on}`);
    // and it is a value the caller sets, with both answers reachable
    assert.strictEqual(runner.normalise({ weekdaysOnly: true }).weekdaysOnly, true, 'the setting must be settable on');
    assert.strictEqual(runner.normalise({ weekdaysOnly: 'true' }).weekdaysOnly, true, 'including as the text a form sends');
    assert.strictEqual(runner.normalise({}).weekdaysOnly, false, 'and unset means off');
    assert.strictEqual(runner.DEFAULTS.weekdaysOnly, false, 'and the box starts unticked');
  },

  async theRecordSaysWhatItWasReadAtAndOverWhat() {
    const rows = candles(24 * 400);
    await withPrices(rows, 14, async () => {
      const rec = await runner.readOneCoin('XRPUSDT', { ...PARAMS, target: 4, cap: 12, weekdaysOnly: true });
      assert.deepStrictEqual(rec.params, {
        target: 4, from: 1, to: 30, step: 0.5, cap: 12, driftParts: 8, weekdaysOnly: true,
      }, 'the record must carry every value it was read at, not the defaults');
      assert.strictEqual(rec.provenance.candles, rows.length, 'and how many candles were behind it');
      assert.strictEqual(rec.provenance.cachedMonths, 14, 'and how many months were cached at the time');
      assert.ok(rec.provenance.fromTs && rec.provenance.toTs && rec.provenance.toTs > rec.provenance.fromTs,
        'and the span of history it was worked out from');
      assert.strictEqual(rec.provenance.release, require('../package.json').version,
        'and the release that took it');
      // the ceiling it was read at really reached the reading
      for (const layout of runner.layouts()) assert.strictEqual(rec.readings[layout].weight.cap, 12,
        `${layout}: the weight ceiling on the record is not the one it was read at`);
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
    // a coin with a handful of periods: read, and each layout says for itself
    await withPrices(candles(24 * 40), 2, async () => {
      const rec = await runner.readOneCoin('TINYUSDT', PARAMS);
      assert.strictEqual(rec.read, true, 'ten periods is still something to read');
      assert.ok(rec.traditional, 'and the traditional score is worked out from them');
      for (const layout of runner.layouts()) {
        const rd = rec.readings[layout];
        assert.ok(rd, `${layout} must still have an entry`);
        if (!rd.search) assert.ok(rd.why && rd.why.length > 10, `${layout}: no reading means a sentence saying why`);
      }
    });
    // AND THE SOURCE CARRIES NO PERIOD FLOOR AT ALL. Comments are stripped
    // first: a scan that a comment can trigger, or that a comment can hide a
    // line from, proves nothing either way.
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/prices\.length\s*<\s*\d/.test(src),
      'the runner has grown a minimum period count — this tab reports and never refuses');
    const readBody = src.slice(src.indexOf('const map = forwardFill'), src.indexOf('let run = null;'));
    assert.ok(readBody.length > 400 && readBody.length < src.length, 'the slice being scanned is not the reading path');
    assert.ok(!/\bthrow\b/.test(readBody),
      'the runner throws somewhere between loading a coin and returning its record — a thrown coin leaves the screen');
  },

  // STOPPED IS NOT FINISHED. A run halted at coin 4 of 17 used to read word for
  // word like a completed 4-coin run.
  async stoppingIsToldApartFromFinishing() {
    const dir = path.dirname(runner.recordFile('AAA', 'x'));
    const made = [];
    await withPrices(candles(24 * 200), 7, async () => {
      const before = runner.coinsRunStop();
      assert.strictEqual(before.stopping, false, 'with nothing running there is nothing to stop');
      assert.ok(/nothing is running/.test(before.why), 'and it says so rather than answering in silence');

      const coins = ['ZQAUSDT', 'ZQBUSDT', 'ZQCUSDT', 'ZQDUSDT'];
      for (const c of coins) made.push(runner.recordFile(c, 'daily-4d'));
      runner.coinsRunStart({ coins: coins.join(','), geometry: 'daily-4d' });
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
      runner.coinsRunStart({ coins: 'ZQAUSDT', geometry: 'daily-4d' });
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
    const made = coins.map((c) => runner.recordFile(c, 'daily-4d'));
    try {
      await withPrices([], 0, async () => {
        runner.coinsRunStart({ coins: coins.join(','), geometry: 'daily-4d' });
        for (let i = 0; i < 400 && runner.coinsRunStatus().running; i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
      });
      const st = runner.coinsRunStatus();
      assert.strictEqual(st.wrote.length, 0, 'neither coin had prices to read');
      assert.deepStrictEqual(st.couldNotRead.map((c) => c.coin), coins, 'and both are named as unread');
      for (const c of coins) {
        const rec = runner.readRecord(c, 'daily-4d');
        assert.ok(rec, `${c} must have a record on disk even though it could not be read`);
        assert.strictEqual(rec.read, false, `${c}'s record must say it could not be read`);
        assert.ok(rec.why && /no cached prices/.test(rec.why), `${c}'s record must say why: ${rec.why}`);
      }
      const served = runner.coinsRecords({ geometry: 'daily-4d' });
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
      [{ geometry: 'not-a-shape' }, /unknown chunk shape/],
    ]) {
      let threw = null;
      try { runner.normalise(body); } catch (err) { threw = err.message; }
      assert.ok(threw && says.test(threw), `${JSON.stringify(body)} must be refused with a sentence, got ${threw}`);
    }
    // the coin list is the owner's, and blank means the default list
    assert.deepStrictEqual(runner.normalise({ coins: 'ltcusdt, xrpusdt ,LTCUSDT' }).coins, ['LTCUSDT', 'XRPUSDT'],
      'the coin list is tidied and de-duplicated, never re-ordered or added to');
    assert.deepStrictEqual(runner.normalise({ coins: '   ' }).coins, require('../lib/dataset').DEFAULT_PAIRS.slice(),
      'a blank box means the default list, which is the same list a blank box on Sweep resolves to');
  },
};
