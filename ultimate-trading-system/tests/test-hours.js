// THE HOURS A RUN READS, KEPT WITH IT (3.271.0, owner order 2026-09-26: "FIX the
// data dates by the exact dates every coin HAD at the time of starting sweep 1
// so there's never any constraint due to newer data"). What these hold:
//   * a launch keeps every hour the box holds for each coin, first to last, and
//     the start and end months when all loaded data is not ticked;
//   * nothing the box does afterwards -- a grown day file, a bundle that fills a
//     hole, a new day, a purge, a day fetched again -- reaches what a run reads;
//   * a copy is proved every time it is read: gone or damaged refuses by coin;
//   * a unit reads the copy and never the box, and refuses a coin not kept;
//   * a set written before 3.271.0 is brought forward to exactly the hours its
//     units read, and one whose files moved says so instead;
//   * a copy is deleted with the last set that names it;
//   * Boards says each coin's first and last hour.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assert } = require('./helpers');
const { readCoin, checkKept, filesOf, digestOf, FILE_RE, DATA_DIR } = require('../lib/hours');
const { keepHours, keepCoin, recordOf, rowsOnDisk, removeUnused } = require('../lib/keephours');

const CACHE = path.join(DATA_DIR, 'cache');
const SETS_DIR = path.join(DATA_DIR, 'stagesets');
const MANIFESTS = path.join(DATA_DIR, 'manifests');
const SYM = 'ZZQAHOURSUSDT';   // never a real pair
const OTHER = 'ZZQAHOURSBUSDT';
const cf = (name) => path.join(CACHE, name);
const candle = (ts, open) => ({ ts, open, high: open + 1, low: open - 1, close: open + 0.5, quoteVolume: 1 });
const hoursOn = (dayIso, n, open) => Array.from({ length: n }, (_, h) => candle(Date.parse(`${dayIso}T00:00:00Z`) + h * 3600000, open + h));

function removeCacheFiles() {
  for (const f of fs.readdirSync(CACHE, { withFileTypes: true })) {
    if (f.isFile() && (f.name.startsWith(`${SYM}-1h-`) || f.name.startsWith(`${OTHER}-1h-`))) fs.rmSync(cf(f.name), { force: true });
  }
}
function cleanup() {
  removeCacheFiles();
  try {
    for (const f of fs.readdirSync(path.join(DATA_DIR, 'hours'))) {
      if (f.startsWith(`${SYM}-`) || f.startsWith(`${OTHER}-`)) fs.rmSync(path.join(DATA_DIR, 'hours', f), { force: true });
    }
  } catch (_) { /* none kept */ }
  try { for (const f of fs.readdirSync(SETS_DIR)) if (f.startsWith('s9-zzqahours-')) fs.rmSync(path.join(SETS_DIR, f), { force: true }); } catch (_) { /* none */ }
  try { for (const f of fs.readdirSync(MANIFESTS)) if (f.startsWith('zzqahours-')) fs.rmSync(path.join(MANIFESTS, f), { force: true }); } catch (_) { /* none */ }
}
function write(name, rows) {
  fs.mkdirSync(CACHE, { recursive: true });
  const text = JSON.stringify(rows);
  fs.writeFileSync(cf(name), text);
  return { file: name, bytes: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') };
}

module.exports = {
  // A LAUNCH KEEPS EVERY HOUR THE BOX HOLDS, AND NOTHING LATER REACHES IT
  async aLaunchKeepsEveryHourTheBoxHoldsAndNothingTheBoxDoesLaterReachesIt() {
    try {
      write(`${SYM}-1h-2020-01.json`, hoursOn('2020-01-01', 24, 100));
      write(`${SYM}-1h-2020-03-01.json`, hoursOn('2020-03-01', 24, 300));
      write(`${SYM}-1h-2020-03-02.json`, hoursOn('2020-03-02', 7, 400));   // today's file: seven hours in
      write(`${SYM}-1h-2020-03-03.json`, hoursOn('2020-03-03', 24, 500));
      const want = [...hoursOn('2020-01-01', 24, 100), ...hoursOn('2020-03-01', 24, 300), ...hoursOn('2020-03-02', 7, 400), ...hoursOn('2020-03-03', 24, 500)];
      const rec = keepHours([SYM, SYM], { allLoaded: true });
      const e = rec.coins[SYM];
      assert.deepStrictEqual(Object.keys(rec.coins), [SYM], 'one entry per coin');
      assert.ok(FILE_RE.test(e.file), `the copy is not where kept hours live: ${e.file}`);
      assert.strictEqual(e.count, want.length);
      assert.strictEqual(e.fromTs, want[0].ts, 'the first hour kept');
      assert.strictEqual(e.toTs, want[want.length - 1].ts, 'the last hour kept');
      assert.strictEqual(rec.digest, digestOf(rec.coins));
      assert.deepStrictEqual(readCoin(SYM, e), want, 'the copy reads back as every hour the box held, in order');
      // THEN THE BOX MOVES ON, every way it does
      write(`${SYM}-1h-2020-03-02.json`, hoursOn('2020-03-02', 24, 400));                     // the day fills in
      write(`${SYM}-1h-2020-03.json`, [...hoursOn('2020-03-01', 24, 300), ...hoursOn('2020-03-02', 24, 400), ...hoursOn('2020-03-03', 24, 500)]); // the bundle lands
      write(`${SYM}-1h-2020-03-04.json`, hoursOn('2020-03-04', 24, 600));                     // a new day
      fs.rmSync(cf(`${SYM}-1h-2020-01.json`));                                                 // a purge
      const moved = hoursOn('2020-03-03', 24, 500); moved[5] = { ...moved[5], close: 1 };
      write(`${SYM}-1h-2020-03-03.json`, moved);                                              // a day fetched again, different
      assert.notStrictEqual(rowsOnDisk(SYM, { allLoaded: true }).length, want.length, 'the box itself did move');
      assert.deepStrictEqual(readCoin(SYM, e), want, 'and what the run reads did not');
      assert.strictEqual(checkKept(rec).intact, true, 'nothing the box did makes the set less than whole');
    } finally {
      cleanup();
    }
  },

  // START AND END ARE WHAT IS KEPT WHEN ALL LOADED DATA IS NOT TICKED
  async startAndEndAreWhatIsKeptWhenAllLoadedDataIsNotTicked() {
    try {
      write(`${SYM}-1h-2020-01.json`, hoursOn('2020-01-01', 24, 100));
      write(`${SYM}-1h-2020-02.json`, hoursOn('2020-02-01', 24, 200));
      write(`${SYM}-1h-2020-03-01.json`, hoursOn('2020-03-01', 24, 300));
      const rec = keepHours([SYM], { allLoaded: false, startMonth: '2020-02', endMonth: '2020-02' });
      assert.deepStrictEqual(readCoin(SYM, rec.coins[SYM]), hoursOn('2020-02-01', 24, 200), 'only the months from start to end');
      const all = keepHours([SYM], { allLoaded: true });
      assert.strictEqual(all.coins[SYM].count, 72, 'ticked, every month held');
      assert.throws(() => keepHours([SYM], { allLoaded: false, startMonth: '2021-01', endMonth: '2021-02' }), /the box holds no hours of ZZQAHOURSUSDT/,
        'a coin with no hours in the range refuses the launch');
    } finally {
      cleanup();
    }
  },

  // ONE COPY PER CONTENT; A COPY THAT IS GONE OR DAMAGED REFUSES, BY COIN
  async aCopyIsSharedAndOneThatIsGoneOrDamagedRefusesByCoin() {
    try {
      const rows = hoursOn('2020-05-01', 24, 50);
      const a = keepCoin(SYM, rows);
      const b = keepCoin(SYM, rows.map((r) => ({ ...r })));
      assert.deepStrictEqual(a, b, 'the same hours kept twice are one copy');
      const rec = recordOf({ [SYM]: a });
      const full = path.join(DATA_DIR, a.file);
      fs.writeFileSync(full, 'not a copy at all');
      assert.throws(() => readCoin(SYM, a), /the hours kept for ZZQAHOURSUSDT cannot be read/, 'a copy that is not gzip refuses');
      let check = checkKept(rec);
      assert.deepStrictEqual({ intact: check.intact, damaged: check.damaged, missing: check.missing }, { intact: false, damaged: [SYM], missing: [] });
      const zlib = require('zlib');
      fs.writeFileSync(full, zlib.gzipSync(JSON.stringify(hoursOn('2020-05-01', 24, 51))));
      assert.throws(() => readCoin(SYM, a), /are damaged: the copy no longer matches what was kept/, 'a copy holding other hours refuses');
      fs.rmSync(full);
      check = checkKept(rec);
      assert.deepStrictEqual({ intact: check.intact, damaged: check.damaged, missing: check.missing }, { intact: false, damaged: [], missing: [SYM] });
      assert.throws(() => readCoin(SYM, a), /the copy is gone/);
      const again = keepCoin(SYM, rows);
      assert.deepStrictEqual(readCoin(SYM, again), rows, 'kept again, the copy is whole again');
      assert.strictEqual(checkKept({ lost: 'its files were gone' }).why, 'its files were gone', 'a set whose hours could not be kept says why');
      assert.strictEqual(checkKept(null).why, 'it keeps no hours of its own');
      assert.throws(() => readCoin(SYM, { ...a, file: '../cache/x.json' }), /is not whole/, 'a record naming a file outside the kept hours is refused');
    } finally {
      cleanup();
    }
  },

  // A UNIT READS THE COPY AND NEVER THE BOX
  async aUnitReadsTheCopyAndNeverTheBox() {
    const { buildCombo } = require('../lib/bracketwork');
    try {
      const days = [];
      for (let d = 0; d < 45; d++) {
        const iso = new Date(Date.UTC(2020, 5, 1) + d * 86400000).toISOString().slice(0, 10);
        const rows = hoursOn(iso, 24, 100 + ((d * 7) % 13) - (d % 5));
        days.push(...rows);
        write(`${SYM}-1h-${iso}.json`, rows);
      }
      const rec = keepHours([SYM], { allLoaded: true });
      const branch = { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
      const before = await buildCombo({ trade: SYM, ctx1: null, ctx2: null, size: 1 }, branch, { allLoaded: true });
      removeCacheFiles();   // the box no longer holds a single hour of the coin
      const after = await buildCombo({ trade: SYM, ctx1: null, ctx2: null, size: 1 }, branch, { hours: rec.coins });
      assert.ok(before.chunks.length >= 12, 'the series is too short to say anything');
      assert.deepStrictEqual(after.chunks.map((c) => c.startTs), before.chunks.map((c) => c.startTs), 'the same chunks from the copy alone');
      assert.strictEqual(after.maps.trade.size, before.maps.trade.size);
      await assert.rejects(buildCombo({ trade: OTHER, ctx1: null, ctx2: null, size: 1 }, branch, { hours: rec.coins }),
        /the hours kept with this set do not include ZZQAHOURSBUSDT/, 'a coin the set did not keep is refused, never read off the box');
    } finally {
      cleanup();
    }
  },

  // A SET WRITTEN BEFORE 3.271.0 IS BROUGHT FORWARD TO EXACTLY THE HOURS IT READ
  async anOlderSetIsBroughtForwardToExactlyTheHoursItsUnitsRead() {
    const stages = require('../lib/stages');
    fs.mkdirSync(SETS_DIR, { recursive: true });
    fs.mkdirSync(MANIFESTS, { recursive: true });
    const oldSet = (id, stage, detailName, detail) => {
      fs.writeFileSync(path.join(MANIFESTS, detailName), JSON.stringify({ stampId: id, at: '2026-09-26T06:57:00.000Z', detail }));
      fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify({
        id, stage, seq: 999900 + stage, name: `ZZQA ${id}`, status: 'done', createdAt: '2026-09-26T06:57:00.000Z',
        dataManifest: { at: '2026-09-26T06:57:00.000Z', overallDigest: 'x', detailFile: `manifests/${detailName}`, symbols: { [SYM]: {} } },
      }));
    };
    try {
      // at launch: January as a bundle; March as day files, the second seven hours in
      const jan = write(`${SYM}-1h-2020-01.json`, hoursOn('2020-01-01', 24, 100));
      const d1 = write(`${SYM}-1h-2020-03-01.json`, hoursOn('2020-03-01', 24, 300));
      const d2 = write(`${SYM}-1h-2020-03-02.json`, hoursOn('2020-03-02', 7, 400));
      const launch = [...hoursOn('2020-01-01', 24, 100), ...hoursOn('2020-03-01', 24, 300), ...hoursOn('2020-03-02', 7, 400)];
      const detail = { [SYM]: [jan, d1, d2] };
      oldSet('s9-zzqahours-1', 1, 'zzqahours-1.json', detail);
      oldSet('s9-zzqahours-2', 2, 'zzqahours-2.json', detail);                 // its child, the same entries
      const o1 = write(`${OTHER}-1h-2020-01.json`, hoursOn('2020-01-01', 24, 900));
      oldSet('s9-zzqahours-3', 1, 'zzqahours-3.json', { [OTHER]: [o1] });
      // since the launch: the day filled in (read only up to what it held), and OTHER's file changed
      write(`${SYM}-1h-2020-03-02.json`, hoursOn('2020-03-02', 24, 400));
      write(`${OTHER}-1h-2020-01.json`, hoursOn('2020-01-01', 24, 901));
      const done = stages.keepHoursOfOlderSets();
      const mine = (xs) => xs.filter((n) => String(n).includes('s9-zzqahours-'));
      assert.deepStrictEqual(mine(done.kept).sort(), ['ZZQA s9-zzqahours-1', 'ZZQA s9-zzqahours-2']);
      assert.strictEqual(mine(done.lost).length, 1);
      const s1 = stages.getSet('s9-zzqahours-1');
      const s2 = stages.getSet('s9-zzqahours-2');
      const s3 = stages.getSet('s9-zzqahours-3');
      assert.strictEqual(s1.dataManifest, undefined, 'the old record is gone from the set');
      assert.deepStrictEqual(readCoin(SYM, s1.hours.coins[SYM]), launch, 'the hours its units read: the grown day only up to the hours it held at launch');
      assert.strictEqual(s1.hours.at, '2026-09-26T06:57:00.000Z', 'kept at the time the set was launched');
      assert.strictEqual(s2.hours.coins[SYM].file, s1.hours.coins[SYM].file, 'a child that read the same hours shares the one copy');
      assert.match(String(s3.hours.lost), /could not be kept when it was brought forward to release 3\.271\.0: ZZQAHOURSBUSDT-1h-2020-01\.json no longer holds what it held when the set was launched/);
      assert.strictEqual(checkKept(s3.hours).intact, false);
      assert.throws(() => stages.hoursOf(s3), /keeps no hours of its own — its hours could not be kept/, 'and nothing prices it on the box instead');
      for (const n of [1, 2, 3]) assert.ok(!fs.existsSync(path.join(MANIFESTS, `zzqahours-${n}.json`)), `the old detail file ${n} was left behind`);
      assert.strictEqual(mine(stages.keepHoursOfOlderSets().kept).length, 0, 'a second pass finds nothing left to bring forward');
    } finally {
      cleanup();
    }
  },

  // A COPY GOES WITH THE LAST SET THAT NAMES IT
  async aCopyIsDeletedWithTheLastSetThatNamesIt() {
    const stages = require('../lib/stages');
    fs.mkdirSync(SETS_DIR, { recursive: true });
    try {
      const rec = recordOf({ [SYM]: keepCoin(SYM, hoursOn('2020-07-01', 24, 70)) });
      const full = path.join(DATA_DIR, rec.coins[SYM].file);
      for (const n of [1, 2]) {
        fs.writeFileSync(path.join(SETS_DIR, `s9-zzqahours-d${n}.json`), JSON.stringify({
          id: `s9-zzqahours-d${n}`, stage: 1, seq: 999950 + n, name: `ZZQA d${n}`, status: 'done', createdAt: new Date().toISOString(), hours: rec,
        }));
      }
      stages.deleteSet('s9-zzqahours-d1', 's9-zzqahours-d1');
      assert.ok(fs.existsSync(full), 'the copy went while another set still reads it');
      stages.deleteSet('s9-zzqahours-d2', 's9-zzqahours-d2');
      assert.ok(!fs.existsSync(full), 'the copy stayed after the last set that names it');
      assert.deepStrictEqual(filesOf({ coins: { A: { file: '../x' }, B: { file: rec.coins[SYM].file } } }), [rec.coins[SYM].file], 'only files where kept hours live are ever named');
      assert.strictEqual(removeUnused(['../../etc/passwd'], []), 0, 'and nothing outside them is ever deleted');
    } finally {
      cleanup();
    }
  },

  // THE ENGINE KEEPS AND HANDS DOWN THE HOURS, AND HANDS THEM TO EVERY TASK
  theEngineKeepsTheHoursAtTheLaunchAndHandsThemToEveryTask() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    const launch = src.slice(src.indexOf('function startStage1('), src.indexOf('// ---- ONE STAGE 1 UNIT'));
    const kept = launch.indexOf('doc.hours = keepHours(coinsOfUnits(units), p);');
    assert.ok(kept > 0, 'the stage 1 launch no longer keeps the hours its units read');
    assert.ok(kept < launch.indexOf('saveSet(doc);'), 'the set is written before its hours are kept');
    assert.strictEqual((src.match(/doc\.hours = childHoursFor\(parent\);/g) || []).length, 2, 'both child launches take their parent\'s hours through the one helper');
    assert.ok(src.includes('seed: doc.seed, unitKey: unitKeyOf(u), nullN, fee, hours: hoursOf(doc),'), 'a stage 1 unit is not handed its set\'s hours');
    assert.ok(src.includes("    hours: hoursOf(doc),\n    s1: {"), 'a stage 2 unit is not handed its set\'s hours');
    assert.ok(src.includes('doc.params, hours: hoursOf(doc),\n'), 'a stage 3 pricing is not handed its set\'s hours');
    assert.ok(!/dataManifest/.test(src.replace(/\/\/ ---- REPAIR \(3\.271\.0\)[\s\S]*?\n}\n/, '')), 'something outside the repair still reads the old price record');
    const parent = { hours: { at: 'x', digest: 'd', coins: { A: { file: 'hours/A-0.json.gz', sha256: 's' } } } };
    const child = require('../lib/stages').childHoursFor(parent);
    assert.deepStrictEqual(child, parent.hours, 'a child keeps exactly its parent\'s hours');
    assert.notStrictEqual(child.coins, parent.hours.coins, 'as its own copy of the record');
  },

  // BOARDS SAYS EACH COIN'S FIRST AND LAST HOUR
  theRunHeaderSaysEachCoinsFirstAndLastHour() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const a = src.indexOf('function hoursLinesHtml(h) {');
    const b = src.indexOf('\nfunction runIdentityPanelHtml(', a);
    assert.ok(a > 0 && b > a, 'the header lines are not drawn by hoursLinesHtml');
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const fn = new Function('esc', `${src.slice(a, b)}; return hoursLinesHtml;`)(esc);
    const html = fn({
      at: '2026-09-26T06:57:12.000Z', digest: 'abcdef0123456789abcdef0123456789',
      coins: { BTCUSDT: { fromTs: Date.UTC(2017, 7, 17, 4), toTs: Date.UTC(2026, 8, 26, 6), count: 79000 }, LTCUSDT: { fromTs: Date.UTC(2017, 11, 13, 3), toTs: Date.UTC(2026, 8, 26, 6), count: 76000 } },
    });
    assert.ok(html.includes('<b>Hours kept:</b> BTCUSDT 2017-08-17-04:00:00 → 2026-09-26-06:00:00 · LTCUSDT 2017-12-13-03:00:00 → 2026-09-26-06:00:00 (UTC)'), html);
    assert.ok(html.includes('2 coin(s), 155,000 hours · kept 2026-09-26T06:57'), html);
    assert.ok(html.includes('<b>Data fingerprint:</b> <code>abcdef0123456789abcdef01</code>'), html);
    const lost = fn({ lost: 'its files were gone' });
    assert.ok(lost.includes('no hours kept — its files were gone'), lost);
    assert.strictEqual(fn(null), '');
    assert.ok(src.includes(", doc.hours || null, got.windows || null)}"), 'Boards no longer hands the header the set\'s hours');
  },
};
