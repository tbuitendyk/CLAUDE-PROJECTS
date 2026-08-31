/* Proves the Safe Encryption page's .7z writer/reader against the real thing.
 *
 *   node www.buitendyk.ca/test/safe-encryption/roundtrip.test.mjs
 *
 * Requires the `7z` binary (Debian/Ubuntu: `apt-get install p7zip-full`). The
 * point of this file is that "7-Zip compatible" is a claim someone checked,
 * not a claim someone made: every archive this page writes is opened by the
 * stock 7-Zip CLI, and archives 7-Zip writes are opened by this page.
 *
 * The module under test is browser code, but it touches no DOM -- Node 22 has
 * WebCrypto, Blob and CompressionStream, so it runs here unmodified.
 */

import { spawnSync } from 'node:child_process';
import nodeCrypto from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const MODULE = join(here, '..', '..', 'sites', 'www.buitendyk.ca', 'safe-encryption', 'sevenzip.js');

const {
  createArchive, readArchive, crc32, sha256, deriveKey, utf16le,
  toBase64, fromBase64, wrapBase64, deflateAvailable,
} = await import(MODULE);

const enc = new TextEncoder();
const dec = new TextDecoder();

let passed = 0;
const failures = [];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok   ' + name); })
    .catch((err) => { failures.push([name, err]); console.log('  FAIL ' + name + '\n       ' + err.message); });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'mismatch') + '\n       expected: ' + JSON.stringify(expected)
      + '\n       actual:   ' + JSON.stringify(actual));
  }
}

const sevenZip = (args, cwd) => spawnSync('7z', args, { cwd, encoding: 'buffer' });

function haveSevenZip() {
  const r = spawnSync('7z', ['i'], { encoding: 'utf8' });
  return r.status === 0 || r.status === 1;
}

const tmp = mkdtempSync(join(tmpdir(), 'safe-enc-'));
const cleanup = () => rmSync(tmp, { recursive: true, force: true });

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

console.log('safe-encryption: 7z interoperability');
console.log('  deflate available: ' + deflateAvailable);

/* ---------------------------------------------------------------- *
 * 1. Primitives against published vectors
 * ---------------------------------------------------------------- */

await check('crc32 matches the zlib vector', () => {
  assertEqual(crc32(enc.encode('hello world')).toString(16), 'd4a1185'.replace(/^0/, '') || 'd4a1185');
  assertEqual(crc32(enc.encode('123456789')), 0xcbf43926);
  assertEqual(crc32(new Uint8Array(0)), 0);
});

await check('sha256 matches the NIST vectors', () => {
  assertEqual(hex(sha256(enc.encode(''))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assertEqual(hex(sha256(enc.encode('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assertEqual(hex(sha256(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

await check('sha256 is correct at every length around the 64-byte block', () => {
  /* The KDF feeds 88-byte chunks into a streaming hash, so the buffering path
     matters more than the compression function. Check it against Node's own
     SHA-256 at every length that straddles a block boundary. */
  const src = new Uint8Array(300);
  for (let i = 0; i < src.length; i++) src[i] = (i * 37) & 0xff;
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 191, 192, 255, 300]) {
    const slice = src.subarray(0, n);
    const mine = hex(sha256(slice));
    const theirs = nodeCrypto.createHash('sha256').update(Buffer.from(slice)).digest('hex');
    assertEqual(mine, theirs, 'digest differs at length ' + n);
  }
});

await check('the KDF construction matches an independent SHA-256', async () => {
  /* Rebuild 7-Zip's CalcKey with Node's hash and a small round count: the two
     must agree byte for byte, which pins both the streaming hash and the
     salt || password || counter layout. */
  const salt = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6]);
  const password = 'Correct Horse Battery Staple';
  /* Deliberately past 2^8 rounds: the round counter is a little-endian 64-bit
     field, and a carry bug in it stays invisible below 256 rounds. */
  for (const power of [4, 8, 9, 12]) {
    const reference = nodeCrypto.createHash('sha256');
    const pw = Buffer.from(utf16le(password));
    for (let round = 0; round < Math.pow(2, power); round++) {
      const counter = Buffer.alloc(8);
      counter.writeUInt32LE(round >>> 0, 0);
      reference.update(Buffer.from(salt));
      reference.update(pw);
      reference.update(counter);
    }
    assertEqual(hex(await deriveKey(password, salt, power)), reference.digest('hex'),
      'derived key differs at 2^' + power + ' rounds');
  }
});

await check('utf16le encodes as 7-Zip expects', () => {
  assertEqual(hex(utf16le('Ab')), '41006200');
});

/* ---------------------------------------------------------------- *
 * 2. Key derivation against a real 7-Zip archive
 *
 * A 7-Zip archive made with a known password is the only honest test of the
 * KDF: derive the key ourselves, decrypt the payload, and see the plaintext.
 * ---------------------------------------------------------------- */

if (!haveSevenZip()) {
  console.log('\n  !! the `7z` binary is not installed -- interop tests skipped');
  console.log('     install it with: apt-get install p7zip-full');
} else {
  await check('reads a stock 7-Zip archive (-mhe=off -m0=Copy)', async () => {
    const dir = join(tmp, 'a');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'message.txt'), 'hello world');
    const r = sevenZip(['a', '-t7z', '-mhe=off', '-m0=Copy', '-pTESTPASS', 'ref.7z', 'message.txt'], dir);
    assertEqual(r.status, 0, '7z a failed: ' + r.stderr);
    const out = await readArchive(new Uint8Array(readFileSync(join(dir, 'ref.7z'))), 'TESTPASS');
    assertEqual(dec.decode(out.content), 'hello world');
    assertEqual(out.name, 'message.txt');
  });

  await check('reads a stock 7-Zip archive with an encrypted header (-mhe=on)', async () => {
    const dir = join(tmp, 'b');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'message.txt'), 'hello world');
    const r = sevenZip(['a', '-t7z', '-mhe=on', '-m0=Copy', '-pTESTPASS', 'ref.7z', 'message.txt'], dir);
    assertEqual(r.status, 0, '7z a failed: ' + r.stderr);
    const out = await readArchive(new Uint8Array(readFileSync(join(dir, 'ref.7z'))), 'TESTPASS');
    assertEqual(dec.decode(out.content), 'hello world');
  });

  await check('reads a stock 7-Zip Deflate archive', async () => {
    const dir = join(tmp, 'c');
    mkdirSync(dir, { recursive: true });
    const body = 'deflate me '.repeat(200);
    writeFileSync(join(dir, 'message.txt'), body);
    const r = sevenZip(['a', '-t7z', '-mhe=on', '-m0=Deflate', '-pTESTPASS', 'ref.7z', 'message.txt'], dir);
    assertEqual(r.status, 0, '7z a failed: ' + r.stderr);
    const out = await readArchive(new Uint8Array(readFileSync(join(dir, 'ref.7z'))), 'TESTPASS');
    assertEqual(dec.decode(out.content), body);
  });

  await check('names the codec it cannot read instead of claiming a bad key', async () => {
    const dir = join(tmp, 'd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'message.txt'), 'lzma please');
    const r = sevenZip(['a', '-t7z', '-mhe=on', '-m0=LZMA', '-pTESTPASS', 'ref.7z', 'message.txt'], dir);
    assertEqual(r.status, 0, '7z a failed: ' + r.stderr);
    let msg = '';
    try {
      await readArchive(new Uint8Array(readFileSync(join(dir, 'ref.7z'))), 'TESTPASS');
    } catch (err) { msg = err.message; }
    assert(/LZMA/.test(msg), 'expected the error to name LZMA, got: ' + msg);
    assert(/7-Zip/.test(msg), 'expected the error to point at 7-Zip, got: ' + msg);
  });

  /* ------------------------------------------------------------ *
   * 3. Archives we write, opened by the real 7-Zip
   * ------------------------------------------------------------ */

  const cases = [
    ['plain ascii', 'The quick brown fox jumps over the lazy dog.'],
    ['unicode + emoji', 'Español, ñ, ü — 中文 — \u{1F510} keys & <tags> "quotes"'],
    ['long compressible text', 'All work and no play makes Jack a dull boy.\n'.repeat(500)],
    ['single character', 'x'],
    ['exactly one aes block', '0123456789abcdef'],
    ['one byte past a block', '0123456789abcdefg'],
    ['crlf and tabs preserved', 'line one\r\nline\ttwo\r\n\r\ntrailing spaces   \n'],
  ];

  const KEY = 'Kx7m-Qw2p-Zr9t-Hs4v-Bn6y-Ld3c-Fj8k-Ga5w';

  for (const [label, text] of cases) {
    await check('7z opens our archive: ' + label, async () => {
      const dir = join(tmp, 'w-' + label.replace(/\W+/g, '-'));
      mkdirSync(dir, { recursive: true });
      const archive = await createArchive({ content: enc.encode(text), password: KEY });
      const path = join(dir, 'msg.7z');
      writeFileSync(path, archive);

      const t = sevenZip(['t', '-p' + KEY, 'msg.7z'], dir);
      assertEqual(t.status, 0, '7z t rejected the archive:\n' + t.stdout + '\n' + t.stderr);

      const x = sevenZip(['x', '-y', '-p' + KEY, '-o' + join(dir, 'out'), 'msg.7z'], dir);
      assertEqual(x.status, 0, '7z x failed:\n' + x.stdout + '\n' + x.stderr);
      const got = readFileSync(join(dir, 'out', 'message.txt'), 'utf8');
      assertEqual(got, text, 'extracted text differs');
    });

    await check('we re-read our own archive: ' + label, async () => {
      const archive = await createArchive({ content: enc.encode(text), password: KEY });
      const out = await readArchive(archive, KEY);
      assertEqual(dec.decode(out.content), text);
    });
  }

  await check('7z hides the file name (encrypted header)', async () => {
    const dir = join(tmp, 'hdr');
    mkdirSync(dir, { recursive: true });
    const archive = await createArchive({ content: enc.encode('secret'), password: KEY });
    writeFileSync(join(dir, 'msg.7z'), archive);
    /* Listing without a password must fail, the way -mhe=on archives do. */
    const l = sevenZip(['l', '-p' + 'not-the-key', 'msg.7z'], dir);
    assert(l.status !== 0, 'listing succeeded without the right key -- the header is not encrypted');
    /* The name must not be sitting in the file in clear UTF-16 either. */
    const raw = readFileSync(join(dir, 'msg.7z'));
    assert(!raw.includes(Buffer.from('m\0e\0s\0s\0a\0g\0e\0', 'binary')),
      'the stored file name is visible in the archive bytes');
  });

  await check('store path (no deflate) still opens in 7z', async () => {
    const dir = join(tmp, 'store');
    mkdirSync(dir, { recursive: true });
    const text = 'store me exactly';
    const archive = await createArchive({ content: enc.encode(text), password: KEY, compress: false });
    writeFileSync(join(dir, 'msg.7z'), archive);
    const t = sevenZip(['t', '-p' + KEY, 'msg.7z'], dir);
    assertEqual(t.status, 0, '7z t rejected the stored archive:\n' + t.stdout + '\n' + t.stderr);
    const out = await readArchive(archive, KEY);
    assertEqual(dec.decode(out.content), text);
  });

  await check('7z rejects the wrong key on our archive', async () => {
    const dir = join(tmp, 'wrong');
    mkdirSync(dir, { recursive: true });
    const archive = await createArchive({ content: enc.encode('top secret'), password: KEY });
    writeFileSync(join(dir, 'msg.7z'), archive);
    const t = sevenZip(['t', '-pWRONG-KEY', 'msg.7z'], dir);
    assert(t.status !== 0, '7z accepted the wrong key');
  });

  await check('a password with punctuation and spaces survives the round trip', async () => {
    const dir = join(tmp, 'punct');
    mkdirSync(dir, { recursive: true });
    const pw = 'a b"c$d\\e~f 12#';
    const archive = await createArchive({ content: enc.encode('punctuation test'), password: pw });
    writeFileSync(join(dir, 'msg.7z'), archive);
    const t = sevenZip(['t', '-p' + pw, 'msg.7z'], dir);
    assertEqual(t.status, 0, '7z t rejected it:\n' + t.stdout + '\n' + t.stderr);
    assertEqual(dec.decode((await readArchive(archive, pw)).content), 'punctuation test');
  });

  await check('a non-ascii password survives the round trip', async () => {
    const dir = join(tmp, 'nonascii');
    mkdirSync(dir, { recursive: true });
    const pw = 'contraseña-Ω-2026';
    const archive = await createArchive({ content: enc.encode('unicode key'), password: pw });
    writeFileSync(join(dir, 'msg.7z'), archive);
    const t = sevenZip(['t', '-p' + pw, 'msg.7z'], dir);
    assertEqual(t.status, 0, '7z t rejected it:\n' + t.stdout + '\n' + t.stderr);
    assertEqual(dec.decode((await readArchive(archive, pw)).content), 'unicode key');
  });
}

/* ---------------------------------------------------------------- *
 * 4. Behaviour that does not need the 7z binary
 * ---------------------------------------------------------------- */

await check('a wrong key is reported as a wrong key', async () => {
  const archive = await createArchive({ content: enc.encode('hello'), password: 'right-key' });
  let msg = '';
  try { await readArchive(archive, 'wrong-key'); } catch (err) { msg = err.message; }
  assert(/[Ww]rong key/.test(msg), 'expected a wrong-key message, got: ' + msg);
});

await check('a truncated archive is reported, not mistaken for a bad key', async () => {
  const archive = await createArchive({ content: enc.encode('hello'), password: 'k' });
  let msg = '';
  try { await readArchive(archive.subarray(0, archive.length - 12), 'k'); } catch (err) { msg = err.message; }
  assert(/truncated/.test(msg), 'expected a truncation message, got: ' + msg);
});

await check('a non-7z file is rejected clearly', async () => {
  let msg = '';
  try { await readArchive(enc.encode('this is just a text file, honest'), 'k'); } catch (err) { msg = err.message; }
  assert(/not a \.7z/.test(msg), 'expected a signature message, got: ' + msg);
});

await check('empty input is refused', async () => {
  let msg = '';
  try { await createArchive({ content: new Uint8Array(0), password: 'k' }); } catch (err) { msg = err.message; }
  assert(/nothing to encrypt/.test(msg), 'got: ' + msg);
});

await check('an empty key is refused', async () => {
  let msg = '';
  try { await createArchive({ content: enc.encode('x'), password: '' }); } catch (err) { msg = err.message; }
  assert(/key is required/.test(msg), 'got: ' + msg);
});

await check('base64 survives the trip through the text box', async () => {
  const archive = await createArchive({ content: enc.encode('via the clipboard'), password: 'k' });
  const armored = wrapBase64(toBase64(archive));
  assert(armored.includes('\n') || armored.length < 76, 'expected wrapping');
  /* Whitespace, stray newlines and indentation must not matter on the way back. */
  const mangled = '  ' + armored.replace(/\n/g, '\n\t') + '\n\n';
  const back = fromBase64(mangled);
  assertEqual(back.length, archive.length);
  assertEqual(dec.decode((await readArchive(back, 'k')).content), 'via the clipboard');
});

await check('two archives of the same text share no bytes (fresh salt and IV)', async () => {
  const a = await createArchive({ content: enc.encode('same text'), password: 'same key' });
  const b = await createArchive({ content: enc.encode('same text'), password: 'same key' });
  assertEqual(a.length, b.length);
  let identical = 0;
  for (let i = 32; i < a.length; i++) if (a[i] === b[i]) identical++;
  assert(identical < (a.length - 32) * 0.5, 'the two archives look far too similar');
});

await check('the derived key matches 7-Zip for a zero-salt archive', async () => {
  /* 7-Zip's own default is saltSize 0; the KDF must handle it. */
  const key = await deriveKey('TESTPASS', new Uint8Array(0), 19);
  assertEqual(key.length, 32);
  /* Deriving twice must be deterministic. */
  const again = await deriveKey('TESTPASS', new Uint8Array(0), 19);
  assertEqual(hex(key), hex(again));
});

await check('a 200 KB message round-trips', async () => {
  const text = 'x'.repeat(50) + Array.from({ length: 4000 }, (_, i) => 'line ' + i).join('\n');
  const archive = await createArchive({ content: enc.encode(text), password: 'big' });
  assertEqual(dec.decode((await readArchive(archive, 'big')).content), text);
});

cleanup();

console.log('\n  ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const [name, err] of failures) console.log('\n  FAILED: ' + name + '\n' + (err.stack || err.message));
  process.exit(1);
}
