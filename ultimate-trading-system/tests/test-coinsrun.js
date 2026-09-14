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
const signalLib = require('../lib/coinsignal');

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
        assert.strictEqual(s.out.length, s.periods, `${key}: an outcome per decision on the record`);
        assert.ok(s.span && s.span.fromTs <= s.span.toTs);
        // 3.127.0: the instrument's own check is worked out once, on the record
        assert.ok(s.linkCut && s.linkCut.trials === runner.LINK_CUT_TRIALS && s.linkCut.found >= 0 && s.linkCut.found <= s.linkCut.trials, `${key}: the link-cut check is on the record`);
        assert.ok(Array.isArray(s.linkCut.strengths) && s.linkCut.strengths.length === s.linkCut.found, `${key}: one strength per dealt plateau`);
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
        assert.ok(sum.whole && sum.whole.gap && 'gapShare' in sum.whole.gap, `${s.key} carries the gap`);
        assert.ok(sum.layouts && Object.keys(sum.layouts).length === served.layouts.length, `${s.key} is divided under every layout`);
        // 3.127.0: the signal reading rides on the reply, read at the band the box holds
        assert.ok(sum.signal && Array.isArray(sum.signal.sweep) && sum.signal.sweep.length === signalLib.bandGrid().length, `${s.key} carries the band sweep`);
        assert.strictEqual(sum.signal.atCurrent && sum.signal.atCurrent.band, served.band.value, `${s.key}: the signal is read at the band the box holds`);
        assert.ok(sum.signal.linkCut && sum.signal.linkCut.trials === runner.LINK_CUT_TRIALS && 'asStrong' in sum.signal.linkCut, `${s.key}: the instrument's own check reaches the screen`);
      }
    } finally { files.forEach(rm); }
  },

  // A READ REPLACES EVERY OLDER FILE FOR THAT COIN, by name or by the coin the
  // file's contents say, and touches no other coin's files (owner order,
  // 2026-09-13: "the code should never leave old data lying around").
  async aReadReplacesEveryOlderFileForThatCoin() {
    const dir = path.dirname(runner.recordFile('AAA'));
    fs.mkdirSync(dir, { recursive: true });
    const mine = ['ZZZREPUSDT__daily-4d.json', 'ZZZREPUSDT__weekly-8d.json', 'zzzrepusdt-old-name.json'];
    const theirs = ['ZZZOTHERUSDT__daily-4d.json', 'ZZZOTHERUSDT.json'];
    const all = [...mine, ...theirs].map((f) => path.join(dir, f));
    all.forEach(rm); rm(runner.recordFile('ZZZREPUSDT'));
    try {
      fs.writeFileSync(path.join(dir, mine[0]), JSON.stringify({ v: 3, coin: 'ZZZREPUSDT' }));
      fs.writeFileSync(path.join(dir, mine[1]), '{not json at all');
      fs.writeFileSync(path.join(dir, mine[2]), JSON.stringify({ v: 2, coin: 'zzzrepusdt' }));
      fs.writeFileSync(path.join(dir, theirs[0]), JSON.stringify({ v: 3, coin: 'ZZZOTHERUSDT' }));
      fs.writeFileSync(path.join(dir, theirs[1]), JSON.stringify({ v: 4, coin: 'ZZZOTHERUSDT' }));
      await withPrices({ ZZZREPUSDT: { rows: candles(24 * 200), cachedMonthCount: 7 } }, async () => {
        runner.coinsRunStart({ coins: 'ZZZREPUSDT' });
        await until(() => !runner.coinsRunStatus().running);
      });
      const st = runner.coinsRunStatus();
      assert.strictEqual(st.error, null, st.error);
      assert.ok(fs.existsSync(runner.recordFile('ZZZREPUSDT')), 'the new record is on disk');
      for (const f of mine) assert.ok(!fs.existsSync(path.join(dir, f)), `${f} is still lying around after the coin was read`);
      for (const f of theirs) assert.ok(fs.existsSync(path.join(dir, f)), `${f} belongs to another coin and was removed`);
      assert.deepStrictEqual(st.replaced.sort(), mine.slice().sort(), 'the status says exactly which files were replaced');
      assert.deepStrictEqual(runner.removeOlderFilesFor('ZZZREPUSDT'), [], 'a second pass finds nothing to replace');
    } finally { all.forEach(rm); rm(runner.recordFile('ZZZREPUSDT')); }
  },

  // THE CLEANUP THE OWNER CAN REACH removes exactly what the screen names as
  // undrawable, and never a record this release can draw.
  async theCleanupRemovesExactlyWhatCannotBeDrawnAndNothingElse() {
    const dir = path.dirname(runner.recordFile('AAA'));
    fs.mkdirSync(dir, { recursive: true });
    const old1 = path.join(dir, 'ZZZCLNAUSDT__daily-4d.json');
    const old2 = path.join(dir, 'ZZZCLNBUSDT.json');
    const junk = path.join(dir, 'ZZZCLNCUSDT.json');
    const good = runner.recordFile('ZZZCLNDUSDT');
    [old1, old2, junk, good].forEach(rm);
    try {
      fs.writeFileSync(old1, JSON.stringify({ v: 3, coin: 'ZZZCLNAUSDT' }));
      fs.writeFileSync(old2, JSON.stringify({ v: 6, coin: 'ZZZCLNBUSDT', shapes: {} }));
      fs.writeFileSync(junk, 'nope');
      await withPrices({ ZZZCLNDUSDT: { rows: candles(24 * 150), cachedMonthCount: 5 } }, async () => {
        fs.writeFileSync(good, JSON.stringify(await runner.readOneCoin('ZZZCLNDUSDT')));
      });
      const before = runner.coinsRecords();
      assert.deepStrictEqual(before.unreadable.map((u) => u.file).filter((f) => /ZZZCLN/.test(f)).sort(), [path.basename(old1), path.basename(old2), path.basename(junk)].sort());
      assert.ok(before.unreadable.every((u) => /or remove it below/.test(u.why)), 'every named file says the control removes it');
      const ans = runner.coinsCleanup();
      assert.deepStrictEqual(ans.failed, []);
      for (const f of [old1, old2, junk]) assert.ok(!fs.existsSync(f), `${path.basename(f)} was named as undrawable and is still there`);
      assert.ok(fs.existsSync(good), 'a record this release can draw was removed');
      assert.ok(ans.removed.includes(path.basename(old1)) && ans.removed.includes(path.basename(junk)), 'the answer names what went');
      const after = runner.coinsRecords();
      assert.ok(!after.unreadable.some((u) => /ZZZCLN/.test(u.file)), 'nothing undrawable is left for these coins');
      assert.ok(after.records.some((r) => r.coin === 'ZZZCLNDUSDT'), 'and the drawable one is still served');
    } finally { [old1, old2, junk, good].forEach(rm); }
  },

  // and it refuses while a reading runs, rather than deleting under a writer
  async theCleanupWaitsForARunningRead() {
    const coinsIn = ['ZZZCLNRUSDT'];
    const files = coinsIn.map((c) => runner.recordFile(c));
    files.forEach(rm);
    try {
      let handed = 0;
      await withPrices(async () => { handed++; await new Promise((r) => setTimeout(r, 150)); return { rows: candles(24 * 100), cachedMonthCount: 3 }; }, async () => {
        runner.coinsRunStart({ coins: coinsIn.join(',') });
        await until(() => handed >= 1);
        assert.throws(() => runner.coinsCleanup(), /wait for it to finish/);
        await until(() => !runner.coinsRunStatus().running);
      });
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
      // a shape-6 record has moves and no outcomes, so it cannot be drawn either
      fs.writeFileSync(f, JSON.stringify({ v: 6, coin: 'ZZZOLDUSDT', read: true, provenance: { release: '3.124.0', capturedAt: '2026-09-13T00:00:00Z' }, shapes: {} }));
      fs.writeFileSync(junk, '{not json');
      const served = runner.coinsRecords();
      assert.ok(!served.records.some((r) => r.coin === 'ZZZOLDUSDT'), 'an old-shape record is not drawn as though current');
      const named = served.unreadable.find((u) => u.coin === 'ZZZOLDUSDT');
      assert.ok(named && /record shape 6/.test(named.why) && new RegExp(`shape ${runner.RECORD_V}`).test(named.why) && /or remove it below/.test(named.why), `named with both shapes and the way out: ${named && named.why}`);
      assert.strictEqual(named.release, '3.124.0');
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
        // 3.127.0: the signal line is read at the band the box holds, not the default
        assert.strictEqual(atHuge.records.find((r) => r.coin === 'ZZZBANDUSDT').shapes['daily-2d'].signal.atCurrent.band, 100000, 'the signal is read at the band the box holds');
        assert.strictEqual(at0.records.find((r) => r.coin === 'ZZZBANDUSDT').shapes['daily-2d'].signal.atCurrent.band, 0);
        // 3.128.0: with the tick off every shape is drawn at the typed band and says so
        assert.strictEqual(atHuge.band.auto, false, 'the tick is off unless set');
        for (const [k, sh] of Object.entries(atHuge.records.find((r) => r.coin === 'ZZZBANDUSDT').shapes)) {
          if (!(sh.periods > 0)) continue;
          assert.deepStrictEqual(sh.band, { value: 100000, source: 'typed' }, `${k}: drawn at the typed band, and says so`);
        }
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
  // EACH SHAPE AT ITS OWN SWEET SPOT (owner GO NOW! 2026-09-14). The tick has
  // one home beside the band; on, a shape with a plateau is drawn at the band
  // inside it that keeps the most edge per decision, its numbers, its bars and
  // its line's own reading all at that band; a shape with no plateau is drawn
  // at the typed band and says so.
  async theTickDrawsEachShapeAtItsOwnSweetSpot() {
    const f = runner.recordFile('ZZZAUTOUSDT');
    rm(f);
    await withBandRestored(async () => {
      await withPrices({ ZZZAUTOUSDT: { rows: candles(24 * 400), cachedMonthCount: 14 } }, async () => {
        const rec = await runner.readOneCoin('ZZZAUTOUSDT');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(rec));
      });
      try {
        assert.strictEqual(runner.bandAuto(), false);
        assert.throws(() => runner.setBandAuto('yes'), /on or off/);
        assert.deepStrictEqual(runner.setBandAuto(true), { auto: true });
        assert.strictEqual(runner.bandAuto(), true);
        assert.strictEqual(readSettings()[runner.AUTO_KEY], true, 'the tick lives beside the band in the settings file');
        runner.setSitOutBand(50);
        const on = runner.coinsRecords();
        assert.strictEqual(on.band.auto, true);
        assert.strictEqual(on.band.value, 50, 'the typed band is still served');
        const shapes = on.records.find((r) => r.coin === 'ZZZAUTOUSDT').shapes;
        let sweet = 0; let typed = 0;
        for (const [k, sh] of Object.entries(shapes)) {
          if (!(sh.periods > 0)) continue;
          const g = sh.signal;
          if (g.sweetSpot) {
            sweet++;
            assert.deepStrictEqual(sh.band, { value: g.sweetSpot.band, source: 'sweet spot' }, `${k}: drawn at its own sweet spot`);
            assert.strictEqual(g.atCurrent.band, g.sweetSpot.band, `${k}: the line's own reading is at that band too`);
            // the bars really are recoloured at that band: same reading as the summary taken there
            const again = coins.shapeSummary(JSON.parse(fs.readFileSync(f, 'utf8')).shapes[k], g.sweetSpot.band, runner.layouts());
            assert.strictEqual(sh.reading, again.reading, `${k}: the reading is the one at the sweet spot`);
            assert.strictEqual(sh.threshold, again.threshold);
          } else {
            typed++;
            assert.deepStrictEqual(sh.band, { value: 50, source: 'typed' }, `${k}: no plateau, so the typed band applies and it says so`);
            assert.strictEqual(g.atCurrent.band, 50);
          }
        }
        assert.ok(sweet + typed > 0, 'something was drawn');
        // and off again: everything at the typed band
        assert.deepStrictEqual(runner.setBandAuto(false), { auto: false });
        const off = runner.coinsRecords();
        assert.strictEqual(off.band.auto, false);
        for (const sh of Object.values(off.records.find((r) => r.coin === 'ZZZAUTOUSDT').shapes)) {
          if (sh.periods > 0) assert.deepStrictEqual(sh.band, { value: 50, source: 'typed' });
        }
      } finally { rm(f); }
    });
  },

  // THE READ HANDS CONTROL BACK (B16). A coin's read used to hold the service
  // for the whole of its fifty deals on five shapes; the screen's own asks
  // timed out at the front door and it declared itself incomplete. A timer
  // set to fire every few milliseconds must keep firing while a coin is read:
  // the longest gap between two firings is how long an ask would wait.
  async aReadHandsControlBackBetweenDeals() {
    await withPrices({ ZZZYIELDUSDT: { rows: candles(24 * 1500), cachedMonthCount: 50 } }, async () => {
      let last = Date.now(); let longest = 0;
      const tick = setInterval(() => { const now = Date.now(); longest = Math.max(longest, now - last); last = now; }, 2);
      const t0 = Date.now();
      const rec = await runner.readOneCoin('ZZZYIELDUSDT');
      const took = Date.now() - t0;
      clearInterval(tick);
      assert.strictEqual(rec.read, true);
      assert.ok(took > 200, `a read of 1500 decisions on five shapes with fifty deals each cannot be this quick (${took} ms) — is the check still being made?`);
      assert.ok(longest < Math.max(400, took / 4), `an ask must wait for one deal, not the whole read: longest gap ${longest} ms in a read of ${took} ms`);
    });
  },

  // THE SCREEN'S OWN SOURCE: the tick is drawn beside the band, the line goes
  // green when the sweet spot beats chance, and the heading says which band
  // a shape is drawn at (guards on public/ name this test; RULE EIGHT).
  theScreenDrawsTheTickTheGreenLineAndTheBandInUse() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.html'), 'utf8');
    assert.ok(/<input id="cAuto" type="checkbox"\$\{band\.auto \? ' checked' : ''\}> each shape at its own sweet spot<\/label>/.test(src), 'the tick, labelled, showing what the service holds');
    assert.ok(/post\('api\/coins\/band', \{ auto: \$\('#cAuto'\)\.checked \}\)/.test(src), 'the tick is set through the band\'s one door');
    assert.ok(/const on = sig\.sweetSpot && sig\.sweetSpot\.ratio > 1;/.test(src), 'green means the sweet spot\'s edge is above 1.0× chance');
    assert.ok(/<div class="csig\$\{on \? ' on' : ''\}">/.test(src), 'and the whole line carries it');
    assert.ok(/\.cshape \.csig\.on, \.cshape \.csig\.on \.muted, \.cshape \.csig\.on b \{ color:#1a9c3a; \}/.test(css), 'green, the rising green');
    assert.ok(/· band \$\{esc\(String\(s\.band\.value\)\)\}\$\{s\.band\.source === 'sweet spot' \? `<span> \(its own sweet spot\)<\/span>` : ''\}/.test(src), 'the heading names the band in use and whether it is the shape\'s own sweet spot');
    assert.ok(/cSignalLine\(s\.signal, s\.band \? s\.band\.value : cBandNow\)/.test(src), 'the line reads at the band the shape is drawn at');
  },

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
