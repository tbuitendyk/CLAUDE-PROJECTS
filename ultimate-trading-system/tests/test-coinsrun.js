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


// A CLAIM ABOUT MONEY CARRIES THE COST IT WAS MEASURED AGAINST (3.166.0, owner
// order: "make sure that your new column that makes an earnings claim is
// referencing the user value").
//
// windows paid and the early/late reading both say what cleared the cost of
// trading. Until this release that cost was a constant in lib/paper.js that
// nothing on any screen could move. It is the account's now, and the guard is
// that the SERVER decides it -- not the page. An opts.cost arriving from a
// browser would be a second way to set the same thing.
const theFeeRidesWithEveryAnswerAndTheServerDecidesIt = () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
  // both answers the Coins screen reads carry it
  const carries = src.match(/fee: \(\(\) => \{ try \{ return require\('\.\/account'\)\.systemFee\(\); \} catch \(_\) \{ return null; \} \}\)\(\),/g) || [];
  assert.ok(carries.length >= 3,
    `the records answer and BOTH branches of the walk status carry the fee — found ${carries.length}`);
  // and the early/late reading is priced against it, on the saved set and the
  // one in hand alike
  const split = src.slice(src.indexOf('function coinsWalkSplit('), src.indexOf('function coinsWalkOpen('));
  const priced = split.match(/chooseThenRead\([^,]+, splitOpts\(opts\)\)/g) || [];
  assert.strictEqual(priced.length, 2, 'a saved set and the walk in hand are both priced against the account\'s cost');
  assert.ok(/function splitOpts\(opts\) \{[\s\S]*?cost: f \? f\.roundTripPct : undefined/.test(src),
    'and the cost comes from the account, never from the request body');
  assert.ok(!/opts\.cost/.test(split), 'the page does not get to name the cost — one setting, one place');

  // IT IS READ FRESH, never stored on the run: change it on Account and the
  // table says so on the next draw, with no walk being run again
  const status = src.slice(src.indexOf('function coinsWalkStatus('), src.indexOf('// THE CHOICE, PUT TO THE TEST'));
  assert.ok(!/fee: r\.fee/.test(status), 'the status never serves a fee remembered from when the walk ran');

  // AND THE ARITHMETIC HONOURS A COST IT IS HANDED. Without this the wiring
  // above would be a setting nothing reads.
  const scan = require('../lib/coinscan');
  const win = (perTrade) => ({ n: 50, perTrade, thin: false });
  const rows = [
    { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: 'own', band: 100, scan: [win(9), win(9), win(0.5), win(0.5)] },
    { coin: 'AAAUSDT', geometry: 'daily-1d', lookback: '48', band: 200, scan: [win(1), win(1), win(0.5), win(0.5)] },
  ];
  const cheap = scan.chooseThenRead(rows, { minTrades: 10, cost: 0.25 }).pairs[0];
  const dear = scan.chooseThenRead(rows, { minTrades: 10, cost: 1 }).pairs[0];
  assert.strictEqual(cheap.lateWindowsPaid, 2, 'at a 0.25% round trip both late windows paid');
  assert.strictEqual(dear.lateWindowsPaid, 0, 'at a 1% round trip neither did — the same rows, the owner\'s cost');
  assert.strictEqual(cheap.latePerTrade, dear.latePerTrade, 'and the money itself is untouched: only what counts as paid moved');
};

module.exports = {
  // SWEEP'S TICK RUNS BOTH LISTS (3.170.0, owner order 2026-09-18: "we have, at
  // the very top of the coins screen, an area where we have coins that we're
  // possibly promoting ... broken into the top section as it is now, coins and
  // shapes that pass, and into a bottom section, which is basically a
  // subsection for each walk set").
  //
  // The reading's passers as always, and every TICKED row promoted out of a
  // walk set. A coin and shape arriving from both is not a clash -- the owner's
  // call, "they become different units" -- and until the lean rides on the unit
  // they fold to one coin and shape here, which is the shape unitsForPassers
  // has always taken.
  theTickAtTheTopRunsBothListsAndTheScreenSaysSo() {
    const run = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
    const fn = run.slice(run.indexOf('function passingUnits()'), run.indexOf('function passerLeans()'));
    assert.ok(/passersCached\(\)\.filter\(\(r\) => r\.ticked\)/.test(fn), 'the passers, as always');
    assert.ok(/require\('\.\/walkset'\)\.promotedUnits\(\)/.test(fn), 'and every ticked promoted row');
    assert.ok(/if \(seen\.has\(k\)\) continue;/.test(fn), 'a coin and shape in both lists is one unit, not two entries');
    assert.ok(/promoted: \(\(\) => \{ try \{ return require\('\.\/walkset'\)\.promoted\(\); \}/.test(run),
      'and the answer carries the promoted rows, grouped per walk set, for the screen to draw');

    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    // one box per walk set, headed by the set — the provenance the owner asked for
    assert.ok(/function cPromotedPanel\(sets\) \{/.test(src), 'the screen draws the promoted rows');
    assert.ok(/<div class="passname">from <b>\$\{esc\(g\.name\)\}<\/b>/.test(src), 'one box per walk set, headed by the set it came from');
    assert.ok(/delete that set and its rows here go with it/.test(src), 'and says plainly that they are a reference, not a copy');
    assert.ok(/class="cprom"/.test(src) && /class="cunprom"/.test(src), 'with a tick and a way back off the list on every row');
    // ONE PROMOTION DOOR (owner's decision), and it is the walk table
    assert.ok(/id="wPromote"/.test(src), 'the one promotion press is on the walk table');
    assert.strictEqual((src.match(/id="wPromote"/g) || []).length, 1, 'and there is exactly one of it — two doors into one list drift apart');
    assert.ok(/a walk has to be saved before a row of it can be promoted/.test(src),
      'a walk with no set behind it cannot be promoted from, and the line says why');
    assert.ok(/class="cwpick"/.test(src), 'the rows are ticked in the walk table itself');
  },

  // A CHECK TAKEN ON ANOTHER BAND GRID DOES NOT ADMIT A PASSER (3.169.0, owner
  // decision: "yes, grid should reach").
  //
  // The plateau is searched on a fixed grid. It stopped at 300 while `bands to
  // try` on Walk it forward takes anything and the owner has been running up to
  // 500, so a band the walk could walk was one the plateau could never choose.
  // Widening it moves where a plateau is found -- but the deals a record was
  // checked against were plateaued over the OLD grid and are sitting on disk.
  // Grading the new plateau against the old deals is two measurements read as
  // one, and nothing on the screen would have said so.
  //
  // So the check records its grid, a reading whose grid does not match is NOT
  // called a passer, and the panel names it and says to read the coins again.
  // That is a refusal to guess, not a translation of an old record (RULE NINE).
  async aCheckTakenOnAnotherBandGridDoesNotAdmitAPasser() {
    const sig = require('../lib/coinsignal');
    assert.strictEqual(sig.BAND_GRID.to, 500, 'the grid reaches the bands the walk can try');
    assert.strictEqual(sig.BAND_GRID.from, 0);
    assert.strictEqual(sig.BAND_GRID.step, 10);

    const plateau = { points: 3, meanRatio: 1.2 };
    const base = { trials: 50, found: 1, strengths: [1.0] };
    const worth = (lc) => sig.linkCutWorth(plateau, lc);
    assert.strictEqual(worth({ ...base, grid: { ...sig.BAND_GRID } }).onGrid, true,
      'a check taken on this grid is this plateau\'s check');
    assert.strictEqual(worth({ ...base, grid: { from: 0, to: 300, step: 10 } }).onGrid, false,
      'one taken on the narrower grid is not');
    assert.strictEqual(worth({ ...base, grid: { from: 0, to: 500, step: 25 } }).onGrid, false,
      'nor one at a different step, even reaching the same distance');
    assert.strictEqual(worth(base).onGrid, false,
      'and a record from before the grid was stamped carries none, which is named the same way rather than assumed');
    assert.ok(worth(base).wantGrid.to === 500, 'the reading says which grid it wanted, so the screen can explain itself');

    // and the screen says so where the passers are listed, with what to press
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(/pass\.behindGrid/.test(src), 'the panel reads the list of readings left out');
    assert.ok(/their check was taken on a different band grid/.test(src), 'and says why they are left out');
    assert.ok(/Press <b>Read these coins<\/b> to take the check again/.test(src), 'and what to press about it');
    const run = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
    assert.ok(/lc && lc\.onGrid !== false && lc\.asStrong != null/.test(run),
      'and no passer is admitted on a check taken elsewhere');
    assert.ok(/if \(lc && lc\.onGrid === false\) behindGrid\.push/.test(run),
      'while every one left out is counted rather than vanishing silently');
  },

  theFeeRidesWithEveryAnswerAndTheServerDecidesIt,
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

  // THE PASSERS (owner GO NOW! 2026-09-14): a coin and shape whose check
  // matched its plateau in at most `bar` of the deals is listed with its
  // numbers at its own sweet spot, ticked by default; the bar and the ticks
  // have one home beside the band; the ticked rows are the units Sweep runs.
  async thePassersAreListedAtTheBarAndTickedUntilUnticked() {
    const S = require('../lib/coinsignal');
    // a shape with a built-in reversion (a plateau) and a stored check: one
    // record passes at the default bar, the other's check is above it
    const mk = (coin, asStrongCount) => {
      let s = 99; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const move = []; const out = []; const ts = [];
      for (let i = 0; i < 1800; i++) { const m = (rnd() - 0.5) * 6; move.push(Number(m.toFixed(4))); out.push(Number((-0.35 * Math.sign(m) * Math.min(3, Math.abs(m)) + (rnd() - 0.5) * 4).toFixed(4))); ts.push(Date.UTC(2020, 0, 1) + i * 86400000); }
      const shapes = {};
      for (const sh of coins.shapes()) shapes[sh.key] = { periods: 0, why: 'not in this fixture' };
      const real = S.signalSummary({ move, out }, 'daily-3d', runner.layouts(), 50);
      assert.ok(real.plateau, 'the fixture must carry a plateau');
      const strength = S.plateauStrength(real.plateau);
      // `asStrongCount` dealt plateaus at least this strong, the rest weaker
      const strengths = [...Array(asStrongCount).fill(strength + 1), ...Array(6).fill(strength / 4)];
      shapes['daily-3d'] = { periods: 1800, span: { fromTs: ts[0], toTs: ts[1799] }, skipped: 0, ts, move, out, // A CHECK CARRIES THE BAND GRID IT WAS TAKEN ON (3.169.0), the way a real
      // reading writes it. Without it this record is one from before the grid
      // reached 500 and is correctly NOT called a passer -- which is what
      // aCheckTakenOnAnotherBandGridDoesNotAdmitAPasser proves next door.
      linkCut: { trials: 50, found: strengths.length, strengths, meanRatioWhenFound: null, grid: { ...require('../lib/coinsignal').BAND_GRID } } };
      return { v: runner.RECORD_V, coin, read: true, why: null, provenance: { release: require('../package.json').version, capturedAt: '2026-09-14T00:00:00Z', cachedMonths: 60, candles: 1800 * 24 }, shapes };
    };
    const files = { ZZZPASSAUSDT: runner.recordFile('ZZZPASSAUSDT'), ZZZPASSBUSDT: runner.recordFile('ZZZPASSBUSDT') };
    Object.values(files).forEach(rm);
    await withBandRestored(async () => {
      try {
        fs.mkdirSync(path.dirname(files.ZZZPASSAUSDT), { recursive: true });
        fs.writeFileSync(files.ZZZPASSAUSDT, JSON.stringify(mk('ZZZPASSAUSDT', 0)));
        fs.writeFileSync(files.ZZZPASSBUSDT, JSON.stringify(mk('ZZZPASSBUSDT', 4)));
        assert.strictEqual(runner.passBar(), runner.DEFAULTS.passBar, 'the bar is the default until set');
        assert.throws(() => runner.setPassBar(-1), /whole number from 0 to 50/);
        assert.throws(() => runner.setPassBar(2.5), /whole number/);
        assert.throws(() => runner.setPassBar(51), /whole number/);
        let served = runner.coinsRecords();
        assert.deepStrictEqual({ bar: served.passers.bar, trials: served.passers.trials }, { bar: 2, trials: runner.LINK_CUT_TRIALS });
        const mine = served.passers.rows.filter((r) => r.coin.startsWith('ZZZPASS'));
        assert.deepStrictEqual(mine.map((r) => [r.coin, r.geometry, r.check.asStrong, r.ticked]), [['ZZZPASSAUSDT', 'daily-3d', 0, true]], `at bar 2 only the 0-of-50 record passes, ticked: ${JSON.stringify(mine)}`);
        const row = mine[0];
        const sig = served.records.find((r) => r.coin === 'ZZZPASSAUSDT').shapes['daily-3d'].signal;
        assert.strictEqual(row.band, sig.sweetSpot.band, 'the row is read at its own sweet spot');
        assert.strictEqual(row.shape, coins.shapes().find((s) => s.key === 'daily-3d').label, 'the shape is named as the screen names it');
        assert.ok(row.called > 0 && row.called <= 1 && row.edge != null && row.perDecision != null && row.ratio > 1 && row.judged > 0, `the numbers are there: ${JSON.stringify(row)}`);
        assert.deepStrictEqual(Object.keys(row.lean).sort(), ['falling', 'rising'], 'the lean after each colour');
        assert.ok(Math.abs(row.tradesAMonth - (365.25 / 12) * row.called) < 1e-9, 'trades a month is decisions a month times the share called');
        assert.ok(Array.isArray(row.traits) && row.traits.length >= 1);
        // THE LEANS STAGE 3 PRICES CONFIRM WITH (3.130.0): one per passer at
        // the bar, keyed by coin and shape, carrying the band it was read at
        // and the lean after each colour -- ticked or not, because the tick
        // says what Sweep runs and the lean is a fact about the coin
        const leans = runner.passerLeans();
        assert.ok(row.yardstick > 0, 'the row carries the median window move the band is a share of');
        // 3.171.0: AND IT SAYS WHICH LOOK-BACK IT IS AT. A passer's is always
        // the shape's own span -- its band comes off the plateau, which is
        // searched on the shape's own window move. Saying so rather than
        // leaving it unsaid is what lets a promoted row say something else.
        assert.deepStrictEqual(leans['ZZZPASSAUSDT|daily-3d'], {
          band: row.band, yardstick: row.yardstick, rising: row.lean.rising, falling: row.lean.falling,
          lookback: 'own', from: { source: 'passer' },
        }, 'the passer\'s lean, as the row carries it, with the yardstick and the look-back it is read at');
        assert.strictEqual(leans['ZZZPASSBUSDT|daily-3d'], undefined, 'a coin and shape above the bar carries none');
        runner.setPasserTicked('ZZZPASSAUSDT', 'daily-3d', false);
        assert.ok(runner.passerLeans()['ZZZPASSAUSDT|daily-3d'], 'un-ticking changes what Sweep runs, not the lean');
        runner.setPasserTicked('ZZZPASSAUSDT', 'daily-3d', true);
        // the bar moves the list: at 4 both pass, at 0 only the perfect one
        assert.deepStrictEqual(runner.setPassBar(4), { bar: 4 });
        assert.strictEqual(readSettings()[runner.PASS_BAR_KEY], 4, 'the bar lives beside the band');
        served = runner.coinsRecords();
        assert.deepStrictEqual(served.passers.rows.filter((r) => r.coin.startsWith('ZZZPASS')).map((r) => `${r.coin}:${r.check.asStrong}`), ['ZZZPASSAUSDT:0', 'ZZZPASSBUSDT:4'], 'sorted by the check');
        runner.setPassBar(0);
        assert.deepStrictEqual(runner.coinsRecords().passers.rows.filter((r) => r.coin.startsWith('ZZZPASS')).map((r) => r.coin), ['ZZZPASSAUSDT']);
        // un-ticking a row: it stays listed, un-ticked, and leaves the units
        runner.setPassBar(4);
        assert.throws(() => runner.setPasserTicked('ZZZPASSAUSDT', 'no-such-shape', false), /not a chunk shape/);
        assert.throws(() => runner.setPasserTicked('ZZZPASSAUSDT', 'daily-3d', 'no'), /ticked or not/);
        assert.deepStrictEqual(runner.setPasserTicked('zzzpassausdt', 'daily-3d', false), { coin: 'ZZZPASSAUSDT', geometry: 'daily-3d', ticked: false });
        assert.deepStrictEqual(readSettings()[runner.PASS_OFF_KEY], ['ZZZPASSAUSDT|daily-3d'], 'the un-ticked rows live beside the band');
        served = runner.coinsRecords();
        assert.deepStrictEqual(served.passers.rows.filter((r) => r.coin.startsWith('ZZZPASS')).map((r) => [r.coin, r.ticked]), [['ZZZPASSAUSDT', false], ['ZZZPASSBUSDT', true]]);
        const units = runner.passingUnits().filter((u) => u.coin.startsWith('ZZZPASS'));
        assert.deepStrictEqual(units, [{ coin: 'ZZZPASSBUSDT', geometry: 'daily-3d' }], 'the units Sweep runs are the ticked passers');
        runner.setPasserTicked('ZZZPASSAUSDT', 'daily-3d', true);
        assert.deepStrictEqual(readSettings()[runner.PASS_OFF_KEY], []);
        assert.deepStrictEqual(runner.passingUnits().filter((u) => u.coin.startsWith('ZZZPASS')).map((u) => u.coin), ['ZZZPASSAUSDT', 'ZZZPASSBUSDT']);
      } finally { Object.values(files).forEach(rm); }
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

  // THE PASSERS ON BOTH SCREENS (3.129.0): the table between the controls and
  // the first coin with its bar box and row ticks, through the passers' door;
  // Sweep's tick, greying the three boxes it replaces, in both launch bodies.
  theScreensDrawThePassersAndSweepsTick() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    // 3.157.0: Walk it forward sits between them, so the adjacency this used
    // to check is now passers -> walk -> the first coin. Checked as two links
    // rather than one, so neither can be moved without this failing.
    // 3.168.0, owner order: every control beside the thing it changes, and the
    // bars in a window two units tall rather than eighteen coins of page. The
    // order down the screen is now: the passers, the bars and their own two
    // controls, then Walk it forward -- which is why the walk no longer sits
    // above the first coin.
    // 3.170.0: and the rows promoted out of a walk set sit between them, so the
    // list at the top of Coins is BOTH sources one under the other.
    assert.ok(/\$\{cPassersPanel\(d && d\.passers\)\}\n  \$\{cPromotedPanel\(d && d\.promoted\)\}\n  <div class="panel">\n    <h3 style="margin-top:0">How each coin reads<\/h3>/.test(src),
      'the passers panel, then the promoted rows, then the bars and their own two controls');
    assert.ok(/<div class="cbarwrap">\n  \$\{!recs\.length \?/.test(src), 'the coins are drawn inside the window');
    assert.ok(/\n  <\/div>\n  <div id="cWalkWrap">\$\{cWalkPanel\(\)\}<\/div>`;/.test(src),
      'and Walk it forward sits under the window, a short scroll away rather than a mile');
    assert.ok(/<b>coins and shapes that pass<\/b>/.test(src) && /<input id="cPassBar" type="number" min="0" max="\$\{pass\.trials\}"/.test(src), 'the bar box sits in the sentence');
    assert.ok(/no coin and shape passes at this bar/.test(src), 'and an empty list says so');
    assert.ok(/<input type="checkbox" class="cpass" data-coin="\$\{esc\(r\.coin\)\}" data-shape="\$\{esc\(r\.geometry\)\}"\$\{r\.ticked \? ' checked' : ''\}/.test(src), 'one tick per row, showing what the service holds');
    assert.ok(/post\('api\/coins\/passers', \{ bar: Number\(\$\('#cPassBar'\)\.value\) \}\)/.test(src), 'the bar goes through the passers\' door');
    assert.ok(/post\('api\/coins\/passers', \{ coin: el\.dataset\.coin, shape: el\.dataset\.shape, ticked: el\.checked \}\)/.test(src), 'and so does a row\'s tick');
    // ITS LABEL MOVED WITH THE FEATURE (3.170.0). What is ticked on Coins is no
    // longer only coins and shapes: a promoted row carries a look-back and a
    // band of its own, and a label that still said otherwise would be false.
    assert.ok(/<input type="checkbox" id="swPassers"> only what is ticked on Coins<\/label>/.test(src), 'Sweep\'s tick, labelled for what it now runs');
    assert.strictEqual((src.match(/passers: !!\(\$\('#swPassers'\) && \$\('#swPassers'\)\.checked\),/g) || []).length, 2, 'the tick rides both the count and the launch');
    assert.ok(/for \(const id of \['swUni', 'swGeom', 'swPermGeom'\]\) if \(\$\(`#\$\{id\}`\)\) \$\(`#\$\{id\}`\)\.disabled = on;/.test(src), 'with it on, trade coins, chunk shape and permute are greyed');
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

  // ONE HEAVY JOB AT A TIME MEANS ANY HEAVY JOB (3.163.0, owner order:
  // "making sure ALL of the long-run process buttons are blocked with the Walk
  // it forward process is active").
  //
  // Every heavy press on this box is gated on ONE predicate, stages.stageBusy().
  // It did not know that Coins had two jobs of its own, so while Walk it
  // forward had four workers flat out, Start stage 1, Start stage 2, Start
  // stage 3, the half-life run, the capture and the rest all stayed live -- and
  // a stage pressed there would have STARTED, putting a second pool on the same
  // cores and quietly wrecking its own timing.
  //
  // This drives the real functions: the one predicate is stood in for, and
  // stageBusy has to pass it through.
  theOnePredicateNamesTheWalkAndTheCoinReading() {
    const stages = require('../lib/stages');
    const cr = require('../lib/coinsrun');
    assert.strictEqual(cr.coinsOwnBusy(), null, 'with nothing going, Coins holds nothing');
    const was = cr.coinsOwnBusy;
    try {
      cr.coinsOwnBusy = () => 'Walk it forward is going';
      assert.strictEqual(stages.stageBusy(), 'Walk it forward is going',
        'the one predicate every other refusal is built on has to name the walk');
      cr.coinsOwnBusy = () => 'a Coins reading is going';
      assert.strictEqual(stages.stageBusy(), 'a Coins reading is going',
        'and the coin reading');
      cr.coinsOwnBusy = () => null;
      assert.strictEqual(stages.stageBusy(), null, 'and nothing when Coins holds nothing');
    } finally { cr.coinsOwnBusy = was; }
    // and it survives the predicate throwing rather than taking the box down
    const was2 = cr.coinsOwnBusy;
    try {
      cr.coinsOwnBusy = () => { throw new Error('nope'); };
      assert.strictEqual(stages.stageBusy(), null, 'a predicate that throws is not a busy box');
    } finally { cr.coinsOwnBusy = was2; }
  },

  // AND THE SAME HOLE POINTING THE OTHER WAY. Blocking the stage presses during
  // a walk while leaving the walk free to start on top of a stage run would
  // leave exactly the situation the block is for.
  theWalkRefusesWhenSomethingElseHoldsTheBox() {
    const stages = require('../lib/stages');
    const cr = require('../lib/coinsrun');
    const was = stages.stageBusy;
    try {
      stages.stageBusy = () => 'stage run S3-1';
      const got = cr.coinsWalkStart({ windowMonths: 6 });
      assert.strictEqual(got.started, false, 'a walk does not start on top of a stage run');
      assert.ok(/stage run S3-1/.test(String(got.why)), `and it says what is holding the box, got ${got.why}`);
    } finally { stages.stageBusy = was; }
  },

  // AND THE SCREEN SAYS IT BEFORE THE PRESS, never by a refusal after it.
  everyLongRunPressSleepsWhileTheBoxIsHeld() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const run = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
    assert.ok(/busy: \(\(\) => \{ try \{ return stages\.stageBusy\(\); \} catch \(_\) \{ return null; \} \}\)\(\),/.test(srv),
      'the record-set answer carries what holds the box');
    assert.ok(/busy: \(\(\) => \{ try \{ return require\('\.\/stages'\)\.stageBusy\(\); \} catch \(_\) \{ return null; \} \}\)\(\),/.test(run),
      'and so does the Coins answer');
    assert.ok(/const held = st\.busy \? String\(st\.busy\) : \(going \? 'a stage run' : null\);/.test(src),
      'the sweep poll reads it');
    assert.ok(/for \(const bid of \['swGo1', 'swGo2', 'swGo3'\]\) \{\s*const b = \$\(`#\$\{bid\}`\);\s*if \(b\) \{ b\.disabled = !!held;/.test(src),
      'and all three stage starts sleep on it, not on a stage run alone');
    assert.ok(/if \(held\) \{ if \(!swPoll\) swPoll = setInterval\(swProgress, 4000\); return; \}/.test(src),
      'and the poll keeps watch while something holds the box, or the buttons would never wake');
    assert.ok(/cBusyNow = \(d && d\.busy\) \|\| null;/.test(src), 'the Coins screen keeps it too');
    assert.ok(/id="cRun" class="pri"\$\{off \|\| \(cBusyNow \? ' disabled' : ''\)\}/.test(src),
      'Read these coins sleeps on it');
    assert.ok(/const off = walking \|\| heldBy \? ' disabled' : '';/.test(src),
      'and so does Walk it forward');
  },

  // THE PROGRESS LINE THAT WENT STALE IS GONE (3.163.0, owner report: it "does
  // not update the text underneath the button ... while running (only updates
  // randomly when leaving and revisiting the Coins tab)").
  //
  // There were two counts of the same thing. The poll rewrote the one beside
  // the button every second and left the paragraph below it frozen at whatever
  // the last full repaint had drawn, so the number the owner was reading was
  // minutes old. Two copies is how one of them ends up lying, so the paragraph
  // is deleted rather than taught to update: the line beside the button says
  // strictly more -- how far through, across how many workers, and how busy the
  // box is -- and the poll writes it every second.
  theWalkHasOneProgressLineAndThePollWritesIt() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(!/walking — the table appears when it lands/.test(src),
      'the second count of the same thing is gone, not left to go stale');
    assert.ok(/walking · \$\{st\.done\} of \$\{st\.of\}/.test(src), 'the one line counts the walks off');
    assert.ok(/out\.textContent = cWalkLine\(\)/.test(src), 'and the poll writes that line');
    assert.ok(/cWalkPoll = setTimeout\(cWalkTick, 1000\)/.test(src), 'once a second while it runs');
  },
};
