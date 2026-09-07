// Data manifest (QC 77): a run's stamp of exactly which candle files it read.
// The whole value is that "did the data change?" becomes digest arithmetic,
// so the tests pin: stability on identical bytes, sensitivity to ONE changed
// byte, and the diff naming the symbol that moved.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { symbolManifest, stampManifest, manifestDiff, pinnedFilesOf, pinnedIntact, MANIFEST_DIR, HASHES_FILE } = require('../lib/manifest');
const { loadSymbolPinned, loadSymbolAll } = require('../lib/pipeline');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const SYM = 'ZZQATESTUSDT'; // never a real Binance pair; never collides with real cache
const f1 = path.join(CACHE, `${SYM}-1h-2020-01.json`);
const f2 = path.join(CACHE, `${SYM}-1h-2020-02.json`);
const d1 = path.join(CACHE, `${SYM}-1h-2020-03-01.json`);
const d2 = path.join(CACHE, `${SYM}-1h-2020-03-02.json`);
const d3 = path.join(CACHE, `${SYM}-1h-2020-03-03.json`);
const b3 = path.join(CACHE, `${SYM}-1h-2020-03.json`);
const candle = (ts, open) => ({ ts, open, high: open + 1, low: open - 1, close: open, quoteVolume: 1 });
const hours = (dayIso, n, open) => Array.from({ length: n }, (_, h) => candle(Date.parse(`${dayIso}T00:00:00Z`) + h * 3600000, open + h));

function cleanup() {
  for (const f of [f1, f2, d1, d2, d3, b3]) fs.rmSync(f, { force: true });
  try {
    for (const f of fs.readdirSync(MANIFEST_DIR)) if (f.includes('zzqa-manifest-test')) fs.rmSync(path.join(MANIFEST_DIR, f), { force: true });
  } catch {}
}

module.exports = {
  async identicalBytesGiveIdenticalDigests() {
    fs.mkdirSync(CACHE, { recursive: true });
    try {
      fs.writeFileSync(f1, '[{"ts":1,"open":2}]');
      fs.writeFileSync(f2, '[{"ts":2,"open":3}]');
      const a = symbolManifest(SYM);
      const b = symbolManifest(SYM);
      assert.strictEqual(a.files, 2);
      assert.strictEqual(a.digest, b.digest, 'same bytes must give the same digest');
      const s1 = stampManifest('zzqa-manifest-test-1', [SYM]);
      const s2 = stampManifest('zzqa-manifest-test-2', [SYM]);
      assert.strictEqual(s1.overallDigest, s2.overallDigest);
      assert.ok(s1.symbols[SYM].digest);
      // per-file detail landed in the side file
      const detail = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, 'zzqa-manifest-test-1.json'), 'utf8'));
      assert.strictEqual(detail.detail[SYM].length, 2);
      assert.ok(detail.detail[SYM][0].sha256);
      const d = manifestDiff(s1, s2);
      assert.strictEqual(d.same, true);
    } finally {
      cleanup();
    }
  },

  async oneChangedByteChangesTheDigestAndNamesTheSymbol() {
    fs.mkdirSync(CACHE, { recursive: true });
    try {
      fs.writeFileSync(f1, '[{"ts":1,"open":2}]');
      const before = stampManifest('zzqa-manifest-test-3', [SYM]);
      fs.writeFileSync(f1, '[{"ts":1,"open":3}]'); // one byte of one candle
      const after = stampManifest('zzqa-manifest-test-4', [SYM]);
      assert.notStrictEqual(before.overallDigest, after.overallDigest, 'a changed candle byte must change the fingerprint');
      const d = manifestDiff(before, after);
      assert.strictEqual(d.same, false);
      assert.deepStrictEqual(d.changed, [SYM], 'the diff must NAME the symbol whose data moved');
    } finally {
      cleanup();
    }
  },

  // AN UNCHANGED FILE IS NOT READ AGAIN, A CHANGED ONE IS (owner order,
  // 2026-09-02: a stage 3 press "went away and did nothing for a minute" --
  // every launch read and hashed every candle file of its universe twice).
  // The hash is kept beside the file's size and modified time; the same size
  // with a later time is a changed file, whatever the bytes look like.
  async anUnchangedFileIsNotHashedAgainAndAChangedOneIs() {
    fs.mkdirSync(CACHE, { recursive: true });
    const realRead = fs.readFileSync;
    try {
      fs.writeFileSync(f1, '[{"ts":1,"open":2}]');
      const first = symbolManifest(SYM);
      assert.strictEqual(first.files, 1);
      const side = JSON.parse(realRead(HASHES_FILE, 'utf8'));
      const entry = side[path.basename(f1)];
      assert.ok(entry && entry.sha256 === first.detail[0].sha256 && entry.size === first.detail[0].bytes && Number.isFinite(entry.mtimeMs),
        'the hash is written beside the file\'s size and modified time');
      // untouched: the file is not read again
      let reads = 0;
      fs.readFileSync = (...a) => { if (String(a[0]) === f1) reads++; return realRead(...a); };
      const again = symbolManifest(SYM);
      fs.readFileSync = realRead;
      assert.strictEqual(reads, 0, 'an unchanged file was read and hashed again');
      assert.strictEqual(again.digest, first.digest);
      // rewritten to the SAME length with a later modified time: read again,
      // and the digest moves with the bytes
      fs.writeFileSync(f1, '[{"ts":1,"open":9}]');
      const st = fs.statSync(f1);
      fs.utimesSync(f1, st.atime, new Date(st.mtimeMs + 5000));
      const changed = symbolManifest(SYM);
      assert.strictEqual(changed.detail[0].bytes, first.detail[0].bytes, 'the fixture must keep the length');
      assert.notStrictEqual(changed.digest, first.digest, 'a file rewritten to the same length kept its old hash');
    } finally {
      fs.readFileSync = realRead;
      cleanup();
    }
  },

  // A RUN READS THE PRICE FILES IT WAS LAUNCHED ON (3.84.0). The stamp's
  // detail is the pin; the pinned loader reads those files and no others; and
  // a pinned set is intact, or the files that changed or went are named.
  async thePinnedLoaderReadsExactlyTheFilesTheStampLists() {
    fs.mkdirSync(CACHE, { recursive: true });
    try {
      // March 2020 as three day files, the second with a seventeen-hour hole
      fs.writeFileSync(d1, JSON.stringify(hours('2020-03-01', 24, 100)));
      fs.writeFileSync(d2, JSON.stringify(hours('2020-03-02', 7, 200)));
      fs.writeFileSync(d3, JSON.stringify(hours('2020-03-03', 24, 300)));
      const stamp = stampManifest('zzqa-manifest-test-pin', [SYM]);
      const pin = pinnedFilesOf(stamp);
      assert.deepStrictEqual(pin[SYM], [path.basename(d1), path.basename(d2), path.basename(d3)], 'the pin is the three day files');
      const before = loadSymbolPinned(SYM, pin[SYM]);
      assert.strictEqual(before.rows.length, 24 + 7 + 24, 'the pinned load reads the three day files, hole and all');
      assert.strictEqual(before.pinned, true);
      // then the refresh consolidates the month into a bundle, hole filled, and adds a fourth day
      const bundle = [...hours('2020-03-01', 24, 100), ...hours('2020-03-02', 24, 200), ...hours('2020-03-03', 24, 300)];
      fs.writeFileSync(b3, JSON.stringify(bundle));
      fs.writeFileSync(path.join(CACHE, `${SYM}-1h-2020-03-04.json`), JSON.stringify(hours('2020-03-04', 24, 400)));
      try {
        const unpinned = await loadSymbolAll(SYM, () => {});
        assert.strictEqual(unpinned.rows.length, 72, 'what is on disk now reads the bundle (hole filled) for the whole month, day files of that month ignored');
        const after = loadSymbolPinned(SYM, pin[SYM]);
        assert.strictEqual(after.rows.length, 24 + 7 + 24, 'the pinned load still reads the three day files: the bundle and the new day are not this run\'s');
        assert.deepStrictEqual(after.rows.map((r) => r.ts), before.rows.map((r) => r.ts), 'candle for candle');
        const check = pinnedIntact(stamp);
        assert.deepStrictEqual({ intact: check.intact, pinned: check.pinned, checked: check.checked, gone: check.gone, changed: check.changed },
          { intact: true, pinned: true, checked: 3, gone: [], changed: [] }, 'files that appeared beside the pinned ones do not make the set un-intact');
        // a bundle that IS pinned wins over day files pinned beside it, as the loader reads
        const stamp2 = stampManifest('zzqa-manifest-test-pin2', [SYM]);
        const pin2 = pinnedFilesOf(stamp2)[SYM];
        assert.ok(pin2.includes(path.basename(b3)) && pin2.includes(path.basename(d2)), 'both forms are on disk and both are listed');
        assert.strictEqual(loadSymbolPinned(SYM, pin2).rows.length, 72, 'the pinned bundle is read for its month, and the pinned day files beside it are not read too');
        // a stamp over a NAMED list of files is exactly that list
        const child = stampManifest('zzqa-manifest-test-pin3', [SYM], { onlyFiles: pin });
        assert.deepStrictEqual(pinnedFilesOf(child)[SYM], pin[SYM], 'a child stamped over its parent\'s pin lists the parent\'s files and nothing that appeared since');
        assert.strictEqual(child.symbols[SYM].digest, stamp.symbols[SYM].digest, 'and carries the same digest, because the files have the same bytes');
      } finally {
        fs.rmSync(path.join(CACHE, `${SYM}-1h-2020-03-04.json`), { force: true });
      }
      // a pinned file that changes is named; one that goes is named; a set with no detail cannot be proved
      fs.writeFileSync(d2, JSON.stringify(hours('2020-03-02', 7, 999)));
      let check = pinnedIntact(stamp);
      assert.deepStrictEqual({ intact: check.intact, changed: check.changed, gone: check.gone }, { intact: false, changed: [path.basename(d2)], gone: [] }, 'a changed pinned file is named');
      fs.rmSync(d3, { force: true });
      check = pinnedIntact(stamp);
      assert.deepStrictEqual({ intact: check.intact, changed: check.changed, gone: check.gone }, { intact: false, changed: [path.basename(d2)], gone: [path.basename(d3)] }, 'a gone pinned file is named too');
      assert.throws(() => loadSymbolPinned(SYM, pin[SYM]), /a price file this run was launched on cannot be read/, 'the pinned loader never fetches what is gone');
      const noDetail = pinnedIntact({ overallDigest: 'x', symbols: { [SYM]: { digest: 'x' } } });
      assert.strictEqual(noDetail.intact, false);
      assert.ok(/record of which price files it read is gone/.test(noDetail.why));
      assert.strictEqual(pinnedFilesOf({ overallDigest: 'x', symbols: {} }), null, 'no detail, no pin');
      const never = pinnedIntact(null);
      assert.deepStrictEqual({ intact: never.intact, pinned: never.pinned }, { intact: true, pinned: false }, 'a set that was never stamped has nothing to check');
    } finally {
      cleanup();
    }
  },

  async oldRunsWithoutManifestsCompareSilently() {
    assert.strictEqual(manifestDiff(null, { overallDigest: 'x', symbols: {} }), null);
    assert.strictEqual(manifestDiff(undefined, undefined), null);
    assert.strictEqual(manifestDiff({ error: 'boom' }, { overallDigest: 'x', symbols: {} }), null);
  },
};
