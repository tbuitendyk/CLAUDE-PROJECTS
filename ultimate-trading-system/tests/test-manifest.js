// Data manifest (QC 77): a run's stamp of exactly which candle files it read.
// The whole value is that "did the data change?" becomes digest arithmetic,
// so the tests pin: stability on identical bytes, sensitivity to ONE changed
// byte, and the diff naming the symbol that moved.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { symbolManifest, stampManifest, manifestDiff, MANIFEST_DIR, HASHES_FILE } = require('../lib/manifest');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const SYM = 'ZZQATESTUSDT'; // never a real Binance pair; never collides with real cache
const f1 = path.join(CACHE, `${SYM}-1h-2020-01.json`);
const f2 = path.join(CACHE, `${SYM}-1h-2020-02.json`);

function cleanup() {
  for (const f of [f1, f2]) fs.rmSync(f, { force: true });
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

  async oldRunsWithoutManifestsCompareSilently() {
    assert.strictEqual(manifestDiff(null, { overallDigest: 'x', symbols: {} }), null);
    assert.strictEqual(manifestDiff(undefined, undefined), null);
    assert.strictEqual(manifestDiff({ error: 'boom' }, { overallDigest: 'x', symbols: {} }), null);
  },
};
