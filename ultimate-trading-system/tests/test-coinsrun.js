// THE COINS RUN, END TO END: candles in, a record out, served back under the
// band (COINS.md Part one; owner LOOP NOW! 2026-09-13).
//
// WHY THIS FILE GOES THROUGH THE PLUMBING. The first Coins tab shipped with
// nineteen green arithmetic tests while the runner could not read a single
// coin: it passed the wrapper forwardFill hands back as the price map. Every
// test here goes through readOneCoin with candles in and a record out, or
// through the run and the reader with files on disk. The arithmetic is checked
// next door.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');
const runner = require('../lib/coinsrun');
const coins = require('../lib/coins');

// CANDLES IN THE SHAPE THE LOADER REALLY PRODUCES -- open/high/low/close and a
// timestamp per hour.
function candles(hours, { start = 100, seed = 12345 } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = [];
  let p = start;
  const t0 = Date.UTC(2024, 0, 1);
  for (let h = 0; h < hours; h++) {
    const open = p;
    p *= 1 + Math.sin(h / 290) * 0.004 + (rnd() - 0.5) * 0.004;
    rows.push({ ts: t0 + h * 3600000, open, high: Math.max(open, p) * 1.002, low: Math.min(open, p) * 0.998, close: p, quoteVolume: 1000 });
  }
  return rows;
}

// The loader is replaced for the length of one test and put back afterwards,
// so nothing here depends on what happens to be cached on the machine.
async function withPrices(byCoin, fn) {
  const pipeline = require('../lib/pipeline');
  const was = pipeline.loadSymbolAll;
  pipeline.loadSymbolAll = async (coin) => {
    const v = typeof byCoin === 'function' ? await byCoin(coin) : byCoin[coin];
    return v || { rows: [], cachedMonthCount: 0 };
  };
  try { return await fn(); } finally { pipeline.loadSymbolAll = was; }
}
const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (_) { return null; }
}
// THE BAND'S HOME IS A REAL FILE; whatever it held before a test is put back.
async function withBandRestored(fn) {
  const before = readSettings();
  try { return await fn(); } finally {
    if (before == null) { try { fs.unlinkSync(SETTINGS); } catch (_) { /* never existed */ } } else fs.writeFileSync(SETTINGS, JSON.stringify(before, null, 1));
  }
}
const rm = (f) => { try { fs.unlinkSync(f); } catch (_) { /* gone */ } };
const until = async (pred, ms = 20000) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 25)); } };

module.exports = {
  // THE ONE THAT WOULD HAVE CAUGHT IT. Candles in, a reading out, at every
  // chunk shape, with nothing asked for to make that happen.
  async aCoinWithCachedPricesActuallyGetsARead() {
    await withPrices({ LTCUSDT: { rows: candles(24 * 400), cachedMonthCount: 14 } }, async () => {
      const rec = await runner.readOneCoin('LTCUSDT');
      assert.strictEqual(rec.read, true, `the coin must actually be read — instead: ${rec.why}`);
      assert.strictEqual(rec.why, null);
      assert.strictEqual(rec.v, runner.RECORD_V);
      assert.strictEqual(rec.coin, 'LTCUSDT');
      assert.deepStrictEqual(Object.keys(rec.shapes), coins.shapes().map((s) => s.key), 'a reading per chunk shape, every one');
      for (const [key, s] of Object.entries(rec.shapes)) {
        assert.ok(s.periods > 20, `${key} read only ${s.periods} decisions`);
        assert.strictEqual(s.ts.length, s.periods);
        assert.strictEqual(s.move.length, s.periods);
        assert.ok(s.span && s.span.fromTs <= s.span.toTs);
      }
      assert.strictEqual(rec.provenance.cachedMonths, 14);
      assert.strictEqual(rec.provenance.candles, 24 * 400);
      assert.strictEqual(rec.provenance.release, require('../package.json').version, 'the record names the release that took it');
      // no stretches, no percentages, no holds, no weights: none of that is on a record any more
      for (const gone of ['holds', 'params', 'readings', 'traditional']) assert.ok(!(gone in rec), `a record still carries '${gone}'`);
    });
  },

  // A coin with no prices gets a record too, saying why, and is never left off.
  async aCoinWithNoPricesGetsARecordThatSaysSo() {
    await withPrices({}, async () => {
      const rec = await runner.readOneCoin('NOPEUSDT');
      assert.strictEqual(rec.read, false);
      assert.ok(/no cached prices/.test(rec.why), rec.why);
      assert.strictEqual(rec.v, runner.RECORD_V);
      assert.deepStrictEqual(rec.shapes, {});
    });
  },

  // Every coin the run touched is on disk afterwards, read or not, and the
  // reader serves the ones it can draw and names the ones it cannot.
  async everyCoinTheRunTouchedIsOnDiskAfterwards() {
    const coinsIn = ['ZZZRUNAUSDT', 'ZZZRUNBUSDT'];
    const files = coinsIn.map((c) => runner.recordFile(c));
    files.forEach(rm);
    try {
      await withPrices({ ZZZRUNAUSDT: { rows: candles(24 * 300), cachedMonthCount: 10 } }, async () => {
        const started = runner.coinsRunStart({ coins: coinsIn.join(',') });
        assert.strictEqual(started.of, 2);
        assert.throws(() => runner.coinsRunStart({ coins: 'ZZZRUNAUSDT' }), /already running/, 'one at a time');
        await until(() => !runner.coinsRunStatus().running);
      });
      const st = runner.coinsRunStatus();
      assert.strictEqual(st.error, null, st.error);
      assert.deepStrictEqual(st.wrote, ['ZZZRUNAUSDT']);
      assert.deepStrictEqual(st.couldNotRead.map((c) => c.coin), ['ZZZRUNBUSDT']);
      assert.strictEqual(st.stopped, false);
      assert.strictEqual(st.stoppedAt, null);
      for (const f of files) assert.ok(fs.existsSync(f), `${path.basename(f)} is not on disk`);
      const served = runner.coinsRecords();
      const a = served.records.find((r) => r.coin === 'ZZZRUNAUSDT');
      const b = served.records.find((r) => r.coin === 'ZZZRUNBUSDT');
      assert.ok(a && a.read, 'the read coin is served');
      assert.ok(b && !b.read && /no cached prices/.test(b.why), 'the unread coin is served with its reason');
      for (const s of coins.shapes()) {
        const sum = a.shapes[s.key];
        assert.ok(sum.periods > 0 && /^[rfs]+$/.test(sum.reading), `${s.key} is summed up for drawing`);
        assert.ok(sum.layouts && Object.keys(sum.layouts).length === served.layouts.length, `${s.key} is divided under every layout`);
      }
    } finally { files.forEach(rm); }
  },

  // STOPPED IS NOT FINISHED, and the status tells them apart.
  async stoppingIsToldApartFromFinishing() {
    const coinsIn = ['ZZZSTOPAUSDT', 'ZZZSTOPBUSDT', 'ZZZSTOPCUSDT'];
    const files = coinsIn.map((c) => runner.recordFile(c));
    files.forEach(rm);
    try {
      let handed = 0;
      await withPrices(async () => { handed++; await new Promise((r) => setTimeout(r, 120)); return { rows: candles(24 * 120), cachedMonthCount: 4 }; }, async () => {
        runner.coinsRunStart({ coins: coinsIn.join(',') });
        await until(() => handed >= 1);
        const ans = runner.coinsRunStop();
        assert.strictEqual(ans.stopping, true);
        await until(() => !runner.coinsRunStatus().running);
      });
      const st = runner.coinsRunStatus();
      assert.strictEqual(st.stopped, true);
      assert.ok(st.stoppedAt >= 1 && st.stoppedAt < 3, `stopped after ${st.stoppedAt} of 3`);
      assert.strictEqual(st.done, st.stoppedAt);
      assert.deepStrictEqual(runner.coinsRunStop(), { stopping: false, why: 'nothing is running to stop' });
    } finally { files.forEach(rm); }
  },

  // A FILE THIS RELEASE CANNOT DRAW IS NAMED, NEVER HIDDEN (RULE NINE; owner:
  // "just code it right for this time", no migration).
  async aRecordThisReleaseCannotReadIsNamedRatherThanHidden() {
    const f = runner.recordFile('ZZZOLDUSDT');
    const junk = runner.recordFile('ZZZJUNKUSDT');
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ v: 5, coin: 'ZZZOLDUSDT', read: true, provenance: { release: '3.123.0', capturedAt: '2026-09-13T00:00:00Z' }, holds: {} }));
      fs.writeFileSync(junk, '{not json');
      const served = runner.coinsRecords();
      assert.ok(!served.records.some((r) => r.coin === 'ZZZOLDUSDT'), 'an old-shape record is not drawn as though current');
      const named = served.unreadable.find((u) => u.coin === 'ZZZOLDUSDT');
      assert.ok(named && /record shape 5/.test(named.why) && new RegExp(`shape ${runner.RECORD_V}`).test(named.why), `named with both shapes: ${named && named.why}`);
      assert.strictEqual(named.release, '3.123.0');
      const bad = served.unreadable.find((u) => u.coin === 'ZZZJUNKUSDT');
      assert.ok(bad && /could not be read back/.test(bad.why), 'an unparseable file is named too');
    } finally { rm(f); rm(junk); }
  },

  // THE BAND HAS ONE HOME, and changing it recolours what is served without a
  // single record being read or rewritten.
  async theBandHasOneHomeAndRecoloursWithoutAReRead() {
    const f = runner.recordFile('ZZZBANDUSDT');
    rm(f);
    await withBandRestored(async () => {
      await withPrices({ ZZZBANDUSDT: { rows: candles(24 * 300), cachedMonthCount: 10 } }, async () => {
        const rec = await runner.readOneCoin('ZZZBANDUSDT');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(rec));
      });
      try {
        const bytesBefore = fs.readFileSync(f);
        // the key lands beside whatever else the settings file holds
        const settings = readSettings() || {};
        settings.some_other_setting = 'kept';
        fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
        fs.writeFileSync(SETTINGS, JSON.stringify(settings));
        assert.deepStrictEqual(runner.setSitOutBand(0), { band: 0 });
        assert.strictEqual(readSettings()[runner.BAND_KEY], 0);
        assert.strictEqual(readSettings().some_other_setting, 'kept', 'setting the band must not lose the other settings');
        assert.strictEqual(runner.sitOutBand(), 0);
        const at0 = runner.coinsRecords();
        assert.strictEqual(at0.band.value, 0);
        const r0 = at0.records.find((r) => r.coin === 'ZZZBANDUSDT').shapes['daily-2d'].reading;
        runner.setSitOutBand(100000);
        const atHuge = runner.coinsRecords();
        assert.strictEqual(atHuge.band.value, 100000);
        const rHuge = atHuge.records.find((r) => r.coin === 'ZZZBANDUSDT').shapes['daily-2d'].reading;
        // at 0 only a move of exactly nothing sits out, and on these candles that is rare
        assert.ok((r0.match(/[rf]/g) || []).length > r0.length * 0.95, `at 0 nearly everything reads a direction: ${r0.slice(0, 40)}`);
        assert.ok(/^s+$/.test(rHuge), 'at a huge band everything sits out');
        assert.notStrictEqual(r0, rHuge, 'the band changed the reading');
        assert.ok(bytesBefore.equals(fs.readFileSync(f)), 'the record on disk was not rewritten to recolour it');
        // and what is served says where the number lives, so the screen can say so too
        assert.strictEqual(atHuge.band.home, 'data/settings.json');
        assert.strictEqual(atHuge.band.default, runner.DEFAULTS.band);
        assert.throws(() => runner.setSitOutBand(-5), /zero or more/);
        assert.throws(() => runner.setSitOutBand('abc'), /zero or more/);
      } finally { rm(f); }
    });
  },

  // A band nobody has set reads as the default, and a damaged one too.
  async anUnsetBandIsTheDefault() {
    await withBandRestored(async () => {
      const settings = readSettings() || {};
      delete settings[runner.BAND_KEY];
      fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
      fs.writeFileSync(SETTINGS, JSON.stringify(settings));
      assert.strictEqual(runner.sitOutBand(), runner.DEFAULTS.band);
      settings[runner.BAND_KEY] = 'garbage';
      fs.writeFileSync(SETTINGS, JSON.stringify(settings));
      assert.strictEqual(runner.sitOutBand(), runner.DEFAULTS.band);
    });
  },

  // The layouts the reader divides by are the ones the screens offer, read
  // from the vocabulary and never typed.
  theRunnerReadsEveryLayoutTheScreenOffers() {
    const { vocabulary } = require('../lib/vocabulary');
    const want = vocabulary().windowLayout.map((o) => String(o.value));
    assert.deepStrictEqual(runner.layouts(), want);
    assert.deepStrictEqual(runner.coinsRecords().layouts, want);
    assert.ok(want.length >= 2, 'two layouts to mark a bar with');
  },

  // A blank coin box means every real coin downloaded, and a typed list is
  // taken as typed, once each, upper-cased.
  theValuesTheOwnerTypesAreTheValuesThatRun() {
    // THE CACHE IS STOOD IN FOR, NOT defaultCoins ITSELF, so the rule that
    // keeps the fabricated coins out of a blank box is the line this test reads.
    const binance = require('../lib/binance');
    const was = binance.cacheState;
    binance.cacheState = () => [{ symbol: 'bbbusdt' }, { symbol: 'PLANTEDSTAGEUPUSDT' }, { symbol: 'AAAUSDT' }, { symbol: 'ZZZFAKEUSDT' }, { symbol: '' }];
    try {
      assert.deepStrictEqual(runner.normalise({ coins: '' }).coins, ['AAAUSDT', 'BBBUSDT'], 'a blank box is every real coin downloaded, sorted, and never a fabricated one');
      assert.deepStrictEqual(runner.normalise({ coins: ' ltcusdt, XRPUSDT ,ltcusdt' }).coins, ['LTCUSDT', 'XRPUSDT']);
      binance.cacheState = () => [{ symbol: 'ZZZFAKEUSDT' }];
      assert.throws(() => runner.normalise({ coins: '' }), /no coins are downloaded/);
    } finally { binance.cacheState = was; }
  },
};
