/* Safe Encryption -- a dependency-free .7z writer/reader that speaks 7-Zip's
   AES-256 encryption exactly as 7-Zip itself writes it.

   Why hand-rolled rather than a wasm build of p7zip: this page's whole promise
   is that the plaintext never leaves the browser, and that promise is worth
   only as much as the code you can read. This file is the entire crypto and
   container path, in plain ES modules, with no imports.

   The byte layout below was not guessed -- it was read out of archives made by
   7-Zip 23.01 (`7z a -t7z -mhe=on -m0=Copy`) and matched field for field. See
   ../../../test/safe-encryption/roundtrip.test.mjs, which encrypts here and
   decrypts with the real `7z` binary, and back again.

   What we write, for one pasted message:

     signature header (32 bytes)
     [pack stream 0] AES-256-CBC( deflate-raw(message) )   <- the payload
     [pack stream 1] AES-256-CBC( the real header )        <- encrypted header
     kEncodedHeader ...                                    <- points at both

   The real header (file name, sizes, CRC) is itself encrypted -- the same
   thing 7-Zip's "Encrypt file names" (-mhe=on) does -- so an archive sitting
   on a disk leaks nothing but its length.

   Key derivation is 7-Zip's own: SHA-256 run 2^19 times over
   salt || UTF-16LE(password) || little-endian round counter; the final digest
   is the AES-256 key. */

/* ------------------------------------------------------------------ *
 * Method IDs and header property IDs (7zFormat.txt)
 * ------------------------------------------------------------------ */

const METHOD_COPY = [0x00];
const METHOD_DEFLATE = [0x04, 0x01, 0x08];
const METHOD_AES = [0x06, 0xf1, 0x07, 0x01];

const kEnd = 0x00;
const kHeader = 0x01;
const kMainStreamsInfo = 0x04;
const kFilesInfo = 0x05;
const kPackInfo = 0x06;
const kUnPackInfo = 0x07;
const kSubStreamsInfo = 0x08;
const kSize = 0x09;
const kCRC = 0x0a;
const kFolder = 0x0b;
const kCodersUnPackSize = 0x0c;
const kNumUnPackStream = 0x0d;
const kEmptyStream = 0x0e;
const kEmptyFile = 0x0f;
const kName = 0x11;
const kEncodedHeader = 0x17;

const SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

/* 7-Zip's default work factor: 2^19 = 524,288 SHA-256 rounds. Left at the
   default so archives open in a stock 7-Zip with no surprises. */
export const NUM_CYCLES_POWER = 19;
const SALT_SIZE = 16;
const IV_SIZE = 16;

/* Refuse absurd values from a corrupt (or wrongly decrypted) header rather
   than trying to allocate them. 256 MB is far past anything you would paste. */
const MAX_SANE_SIZE = 256 * 1024 * 1024;
const MAX_SANE_COUNT = 4096;

/* ------------------------------------------------------------------ *
 * CRC-32 (the zlib polynomial, which is what 7z headers use)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ *
 * SHA-256 -- streaming, because the KDF hashes ~46 MB in 524,288 small
 * updates and WebCrypto's digest() cannot be fed incrementally.
 * ------------------------------------------------------------------ */

const SHA_K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256 {
  constructor() {
    this.h = new Int32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.w = new Int32Array(64);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0;
  }

  _block(b, off) {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    const h = this.h;
    let a = h[0], b1 = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA_K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b1) ^ (a & c) ^ (b1 & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b1; b1 = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b1) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  update(data) {
    const len = data.length;
    this.total += len;
    let i = 0;
    if (this.bufLen > 0) {
      const need = 64 - this.bufLen;
      if (len < need) {
        this.buf.set(data, this.bufLen);
        this.bufLen += len;
        return this;
      }
      this.buf.set(data.subarray(0, need), this.bufLen);
      this._block(this.buf, 0);
      this.bufLen = 0;
      i = need;
    }
    for (; i + 64 <= len; i += 64) this._block(data, i);
    if (i < len) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = len - i;
    }
    return this;
  }

  digest() {
    const bitLen = this.total * 8;
    const pad = new Uint8Array(this.bufLen < 56 ? 64 : 128);
    pad.set(this.buf.subarray(0, this.bufLen), 0);
    pad[this.bufLen] = 0x80;
    /* A 64-bit big-endian bit count, split so it stays exact past 2^32. */
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    const end = pad.length;
    pad[end - 8] = (hi >>> 24) & 0xff; pad[end - 7] = (hi >>> 16) & 0xff;
    pad[end - 6] = (hi >>> 8) & 0xff; pad[end - 5] = hi & 0xff;
    pad[end - 4] = (lo >>> 24) & 0xff; pad[end - 3] = (lo >>> 16) & 0xff;
    pad[end - 2] = (lo >>> 8) & 0xff; pad[end - 1] = lo & 0xff;
    for (let off = 0; off < end; off += 64) this._block(pad, off);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = (this.h[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (this.h[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (this.h[i] >>> 8) & 0xff;
      out[i * 4 + 3] = this.h[i] & 0xff;
    }
    return out;
  }
}

export function sha256(bytes) {
  return new Sha256().update(bytes).digest();
}

/* ------------------------------------------------------------------ *
 * 7-Zip's AES key derivation
 * ------------------------------------------------------------------ */

export function utf16le(str) {
  const out = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >>> 8;
  }
  return out;
}

const yieldToHost = () => new Promise((resolve) => setTimeout(resolve, 0));

/* key = SHA256( for round in 0 .. 2^power-1: salt || pw || uint64le(round) )
   -- one continuous hash, exactly as 7zAes.cpp's CKeyInfo::CalcKey does it.
   Yields to the event loop periodically so the page stays responsive and can
   draw a progress bar; the hash state is untouched by the pause. */
export async function deriveKey(password, salt, numCyclesPower = NUM_CYCLES_POWER, onProgress) {
  const pw = utf16le(password);
  const block = new Uint8Array(salt.length + pw.length + 8);
  block.set(salt, 0);
  block.set(pw, salt.length);
  const counterAt = salt.length + pw.length;

  const sha = new Sha256();
  const rounds = Math.pow(2, numCyclesPower);
  const chunk = 16384;
  for (let done = 0; done < rounds;) {
    const stop = Math.min(rounds, done + chunk);
    for (; done < stop; done++) {
      sha.update(block);
      /* Increment the counter with an explicit wrap. Note `++block[i]` will
         NOT do: on a Uint8Array it evaluates to the untruncated 256 while
         storing 0, so a carry test written that way never fires and the
         counter silently repeats every 256 rounds. */
      for (let i = counterAt; i < block.length; i++) {
        block[i] = (block[i] + 1) & 0xff;
        if (block[i] !== 0) break;
      }
    }
    if (onProgress) onProgress(done / rounds);
    if (done < rounds) await yieldToHost();
  }
  return sha.digest();
}

/* ------------------------------------------------------------------ *
 * AES-256-CBC without PKCS#7 -- 7z pads the last block with zeros and relies
 * on the header's size field, so we need raw CBC. WebCrypto offers only the
 * padded mode, so both directions are bent into shape below.
 * ------------------------------------------------------------------ */

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WebCrypto is unavailable -- this page needs a secure (https) context.');
  return c.subtle;
};

async function importKey(keyBytes) {
  return subtle().importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

/* Encrypting n bytes (n a multiple of 16) yields n+16: the tail block is the
   encrypted all-padding block, which raw CBC does not have. Drop it. */
async function cbcEncryptRaw(key, iv, data) {
  if (data.length % 16 !== 0) throw new Error('internal: raw CBC input must be block-aligned');
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, data));
  return out.subarray(0, out.length - 16);
}

/* The mirror image: append a block that decrypts to valid full padding, so
   WebCrypto strips exactly that block and hands back the raw plaintext.
   E_k(0x10 * 16 XOR C_last) comes from a one-block zero-IV encrypt, so the
   padding is valid whatever the key -- a wrong password yields garbage
   plaintext rather than a padding-oracle style failure. */
async function cbcDecryptRaw(key, iv, data) {
  if (data.length === 0) return new Uint8Array(0);
  if (data.length % 16 !== 0) {
    throw new Error('Encrypted stream is not a whole number of AES blocks -- the archive is truncated or corrupt.');
  }
  const last = data.subarray(data.length - 16);
  const probe = new Uint8Array(16);
  for (let i = 0; i < 16; i++) probe[i] = 0x10 ^ last[i];
  const enc = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, probe));
  const padded = new Uint8Array(data.length + 16);
  padded.set(data, 0);
  padded.set(enc.subarray(0, 16), data.length);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, key, padded));
}

/* ------------------------------------------------------------------ *
 * deflate-raw, which 7-Zip knows as method 040108
 * ------------------------------------------------------------------ */

export const deflateAvailable = typeof globalThis.CompressionStream === 'function'
  && typeof globalThis.DecompressionStream === 'function';

async function streamThrough(transform, bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const deflateRaw = (bytes) => streamThrough(new CompressionStream('deflate-raw'), bytes);
const inflateRaw = (bytes) => streamThrough(new DecompressionStream('deflate-raw'), bytes);

/* ------------------------------------------------------------------ *
 * Header writer / reader primitives
 * ------------------------------------------------------------------ */

class Writer {
  constructor() { this.parts = []; this.len = 0; }

  byte(b) { this.parts.push(new Uint8Array([b & 0xff])); this.len += 1; return this; }

  bytes(a) {
    const u = a instanceof Uint8Array ? a : new Uint8Array(a);
    this.parts.push(u);
    this.len += u.length;
    return this;
  }

  u32(v) { return this.bytes([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]); }

  u64(v) {
    const out = new Uint8Array(8);
    let rest = v;
    for (let i = 0; i < 8; i++) { out[i] = rest % 256; rest = Math.floor(rest / 256); }
    return this.bytes(out);
  }

  /* 7z's variable-length number: leading 1-bits in the first byte say how many
     little-endian bytes follow (COutArchive::WriteNumber). */
  num(value) {
    let first = 0, mask = 0x80, i = 0;
    for (; i < 8; i++) {
      if (value < Math.pow(2, 7 * (i + 1))) {
        first |= Math.floor(value / Math.pow(2, 8 * i)) & 0xff;
        break;
      }
      first |= mask;
      mask >>= 1;
    }
    this.byte(first);
    let rest = value;
    for (; i > 0; i--) { this.byte(rest % 256); rest = Math.floor(rest / 256); }
    return this;
  }

  finish() {
    const out = new Uint8Array(this.len);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }

  need(n) {
    if (!(n >= 0) || this.i + n > this.b.length) throw new Error('Archive header ends unexpectedly.');
  }

  byte() { this.need(1); return this.b[this.i++]; }

  take(n) { this.need(n); const s = this.b.subarray(this.i, this.i + n); this.i += n; return s; }

  skip(n) { this.need(n); this.i += n; }

  u32() { const s = this.take(4); return (s[0] | (s[1] << 8) | (s[2] << 16) | (s[3] << 24)) >>> 0; }

  num() {
    const first = this.byte();
    let mask = 0x80, value = 0;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) return value + (first & (mask - 1)) * Math.pow(2, i * 8);
      value += this.byte() * Math.pow(2, 8 * i);
      mask >>= 1;
    }
    return value;
  }

  size() {
    const v = this.num();
    if (!(v >= 0) || v > MAX_SANE_SIZE) throw new Error('Archive header declares an implausible size.');
    return v;
  }

  count() {
    const v = this.num();
    if (!(v >= 0) || v > MAX_SANE_COUNT) throw new Error('Archive header declares an implausible count.');
    return v;
  }
}

/* ------------------------------------------------------------------ *
 * Coder descriptions
 * ------------------------------------------------------------------ */

/* props layout is 7zAes.cpp's CEncoder::WriteCoderProperties:
     [0] = cycles | 0x80 (a salt follows) | 0x40 (an IV follows)
     [1] = ((saltSize - 1) << 4) | (ivSize - 1)
     then salt, then IV.
   7-Zip itself ships saltSize 0; a real 16-byte salt is still spec-legal and
   means two archives made with one passphrase share no derived key. */
function aesProps(salt, iv, cycles) {
  const w = new Writer();
  w.byte(cycles | (salt.length ? 0x80 : 0) | (iv.length ? 0x40 : 0));
  w.byte(((salt.length ? salt.length - 1 : 0) << 4) | (iv.length ? iv.length - 1 : 0));
  w.bytes(salt);
  w.bytes(iv);
  return w.finish();
}

function parseAesProps(props) {
  if (props.length < 1) throw new Error('AES coder has no properties.');
  const b0 = props[0];
  const cycles = b0 & 0x3f;
  if ((b0 & 0xc0) === 0) return { cycles, salt: new Uint8Array(0), iv: new Uint8Array(16) };
  if (props.length < 2) throw new Error('AES coder properties are truncated.');
  const b1 = props[1];
  const saltSize = ((b0 >> 7) & 1) + (b1 >> 4);
  const ivSize = ((b0 >> 6) & 1) + (b1 & 0x0f);
  if (props.length < 2 + saltSize + ivSize) throw new Error('AES coder properties are truncated.');
  const salt = props.subarray(2, 2 + saltSize);
  const iv = new Uint8Array(16);
  iv.set(props.subarray(2 + saltSize, 2 + saltSize + ivSize), 0);
  return { cycles, salt, iv };
}

function writeCoder(w, id, props) {
  let flags = id.length & 0x0f;
  if (props && props.length) flags |= 0x20;
  w.byte(flags);
  w.bytes(id);
  if (props && props.length) { w.num(props.length); w.bytes(props); }
}

/* A folder is the coder chain for one packed stream. Coder 0 sits closest to
   the packed bytes (so: AES first), and each later coder consumes the previous
   coder's output through a bind pair -- the shape 7-Zip writes. */
function writeFolder(w, coders) {
  w.num(coders.length);
  for (const c of coders) writeCoder(w, c.id, c.props);
  for (let i = 1; i < coders.length; i++) { w.num(i); w.num(i - 1); }
}

function writePackInfo(w, packPos, packSizes) {
  w.byte(kPackInfo);
  w.num(packPos);
  w.num(packSizes.length);
  w.byte(kSize);
  for (const s of packSizes) w.num(s);
  w.byte(kEnd);
}

function writeUnpackInfo(w, folders, folderCRCs) {
  w.byte(kUnPackInfo);
  w.byte(kFolder);
  w.num(folders.length);
  w.byte(0); /* not external */
  for (const f of folders) writeFolder(w, f.coders);
  w.byte(kCodersUnPackSize);
  for (const f of folders) for (const s of f.unpackSizes) w.num(s);
  if (folderCRCs) {
    w.byte(kCRC);
    w.byte(1); /* all defined */
    for (const c of folderCRCs) w.u32(c);
  }
  w.byte(kEnd);
}

/* ------------------------------------------------------------------ *
 * Writing an archive
 * ------------------------------------------------------------------ */

function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

function padTo16(bytes) {
  const padded = new Uint8Array(Math.ceil(bytes.length / 16) * 16);
  padded.set(bytes, 0);
  return padded;
}

/**
 * Build a password-protected .7z holding a single file.
 *
 * @param {Object} opts
 * @param {Uint8Array} opts.content     file bytes (the message, UTF-8 encoded)
 * @param {string} opts.password
 * @param {string} [opts.fileName]      stored name; hidden inside the encrypted header
 * @param {boolean} [opts.compress]     use deflate where supported (default true)
 * @param {function} [opts.onProgress]  receives ({ stage, fraction })
 * @returns {Promise<Uint8Array>} the complete .7z
 */
export async function createArchive({ content, password, fileName = 'message.txt', compress = true, onProgress }) {
  if (!password) throw new Error('A key is required.');
  if (!content || content.length === 0) throw new Error('There is nothing to encrypt.');

  const report = (stage, fraction) => { if (onProgress) onProgress({ stage, fraction }); };
  const salt = randomBytes(SALT_SIZE);

  report('deriving', 0);
  const keyBytes = await deriveKey(password, salt, NUM_CYCLES_POWER, (f) => report('deriving', f));
  const key = await importKey(keyBytes);

  report('packing', 0);
  let inner = content;
  let useDeflate = false;
  if (compress && deflateAvailable) {
    const squeezed = await deflateRaw(content);
    /* Storing wins for tiny or already-dense input; take whichever is smaller. */
    if (squeezed.length < content.length) { inner = squeezed; useDeflate = true; }
  }

  const dataIv = randomBytes(IV_SIZE);
  const headerIv = randomBytes(IV_SIZE);

  report('encrypting', 0.4);
  const packedData = await cbcEncryptRaw(key, dataIv, padTo16(inner));

  /* --- the real header, which we then encrypt whole --- */
  const h = new Writer();
  h.byte(kHeader);
  h.byte(kMainStreamsInfo);
  writePackInfo(h, 0, [packedData.length]);
  writeUnpackInfo(h, [{
    coders: useDeflate
      ? [{ id: METHOD_AES, props: aesProps(salt, dataIv, NUM_CYCLES_POWER) }, { id: METHOD_DEFLATE }]
      : [{ id: METHOD_AES, props: aesProps(salt, dataIv, NUM_CYCLES_POWER) }],
    unpackSizes: useDeflate ? [inner.length, content.length] : [content.length],
  }], null);
  h.byte(kSubStreamsInfo);
  h.byte(kCRC);
  h.byte(1); /* all defined */
  h.u32(crc32(content));
  h.byte(kEnd); /* end of SubStreamsInfo */
  h.byte(kEnd); /* end of StreamsInfo */

  const nameBytes = utf16le(fileName + '\0');
  h.byte(kFilesInfo);
  h.num(1);
  h.byte(kName);
  h.num(1 + nameBytes.length);
  h.byte(0); /* not external */
  h.bytes(nameBytes);
  h.byte(kEnd); /* end of FilesInfo */
  h.byte(kEnd); /* end of Header */
  const headerBytes = h.finish();

  report('encrypting', 0.7);
  const packedHeader = await cbcEncryptRaw(key, headerIv, padTo16(headerBytes));

  /* --- the outer, cleartext header: only a pointer to the encrypted one --- */
  const o = new Writer();
  o.byte(kEncodedHeader);
  writePackInfo(o, packedData.length, [packedHeader.length]);
  writeUnpackInfo(o, [{
    coders: [{ id: METHOD_AES, props: aesProps(salt, headerIv, NUM_CYCLES_POWER) }],
    unpackSizes: [headerBytes.length],
  }], [crc32(headerBytes)]);
  o.byte(kEnd); /* end of StreamsInfo */
  const outerHeader = o.finish();

  /* --- signature header --- */
  const start = new Writer();
  start.u64(packedData.length + packedHeader.length);
  start.u64(outerHeader.length);
  start.u32(crc32(outerHeader));
  const startHeader = start.finish();

  const out = new Writer();
  out.bytes(SIGNATURE);
  out.bytes([0x00, 0x04]);
  out.u32(crc32(startHeader));
  out.bytes(startHeader);
  out.bytes(packedData);
  out.bytes(packedHeader);
  out.bytes(outerHeader);

  report('done', 1);
  return out.finish();
}

/* ------------------------------------------------------------------ *
 * Reading an archive
 * ------------------------------------------------------------------ */

function sameId(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function describeMethod(id) {
  const hex = Array.from(id, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex === '030101') return 'LZMA';
  if (hex === '21') return 'LZMA2';
  if (hex === '040108') return 'Deflate';
  if (hex === '040202') return 'BZip2';
  if (hex === '030401') return 'PPMd';
  return 'method 0x' + hex;
}

function readFolder(r) {
  const numCoders = r.count();
  if (numCoders < 1) throw new Error('Archive folder has no coders.');
  const coders = [];
  let totalIn = 0, totalOut = 0;
  for (let i = 0; i < numCoders; i++) {
    const flags = r.byte();
    if (flags & 0x80) throw new Error('Archive uses alternative coder methods, which this page does not read.');
    const id = r.take(flags & 0x0f);
    let inStreams = 1, outStreams = 1;
    if (flags & 0x10) { inStreams = r.count(); outStreams = r.count(); }
    let props = null;
    if (flags & 0x20) props = r.take(r.size());
    coders.push({ id, props, inStreams, outStreams });
    totalIn += inStreams;
    totalOut += outStreams;
  }
  const numBindPairs = totalOut - 1;
  const bindPairs = [];
  for (let i = 0; i < numBindPairs; i++) bindPairs.push({ inIndex: r.count(), outIndex: r.count() });
  const numPacked = totalIn - numBindPairs;
  const packedIndices = [];
  if (numPacked === 1) {
    let found = 0;
    for (let i = 0; i < totalIn; i++) if (!bindPairs.some((bp) => bp.inIndex === i)) { found = i; break; }
    packedIndices.push(found);
  } else {
    for (let i = 0; i < numPacked; i++) packedIndices.push(r.count());
  }
  return { coders, bindPairs, packedIndices, totalIn, totalOut, unpackSizes: [] };
}

function readDigests(r, count) {
  const allDefined = r.byte();
  const defined = [];
  if (allDefined) {
    for (let i = 0; i < count; i++) defined.push(true);
  } else {
    let mask = 0, cur = 0;
    for (let i = 0; i < count; i++) {
      if (mask === 0) { cur = r.byte(); mask = 0x80; }
      defined.push((cur & mask) !== 0);
      mask >>= 1;
    }
  }
  const crcs = [];
  for (let i = 0; i < count; i++) crcs.push(defined[i] ? r.u32() : null);
  return crcs;
}

function folderUnpackSize(folder) {
  for (let i = folder.unpackSizes.length - 1; i >= 0; i--) {
    if (!folder.bindPairs.some((bp) => bp.outIndex === i)) return folder.unpackSizes[i];
  }
  return 0;
}

function readStreamsInfo(r) {
  const info = {
    packPos: 0, packSizes: [], folders: [],
    folderCRCs: null, subSizes: null, subCRCs: null,
  };
  for (;;) {
    const id = r.byte();
    if (id === kEnd) break;
    if (id === kPackInfo) {
      info.packPos = r.size();
      const n = r.count();
      for (;;) {
        const t = r.byte();
        if (t === kEnd) break;
        if (t === kSize) { for (let i = 0; i < n; i++) info.packSizes.push(r.size()); }
        else if (t === kCRC) readDigests(r, n);
        else throw new Error('Unexpected field in the archive pack info.');
      }
    } else if (id === kUnPackInfo) {
      for (;;) {
        const t = r.byte();
        if (t === kEnd) break;
        if (t === kFolder) {
          const n = r.count();
          if (r.byte() !== 0) throw new Error('Archive stores its folders externally, which this page does not read.');
          for (let i = 0; i < n; i++) info.folders.push(readFolder(r));
        } else if (t === kCodersUnPackSize) {
          for (const f of info.folders) {
            f.unpackSizes = [];
            for (let i = 0; i < f.totalOut; i++) f.unpackSizes.push(r.size());
          }
        } else if (t === kCRC) {
          info.folderCRCs = readDigests(r, info.folders.length);
        } else throw new Error('Unexpected field in the archive unpack info.');
      }
    } else if (id === kSubStreamsInfo) {
      let counts = info.folders.map(() => 1);
      for (;;) {
        const t = r.byte();
        if (t === kEnd) break;
        if (t === kNumUnPackStream) {
          counts = info.folders.map(() => r.count());
        } else if (t === kSize) {
          const sizes = [];
          for (let fi = 0; fi < info.folders.length; fi++) {
            if (counts[fi] === 0) continue;
            let sum = 0;
            for (let i = 0; i < counts[fi] - 1; i++) { const s = r.size(); sizes.push(s); sum += s; }
            sizes.push(folderUnpackSize(info.folders[fi]) - sum);
          }
          info.subSizes = sizes;
        } else if (t === kCRC) {
          info.subCRCs = readDigests(r, counts.reduce((a, b) => a + b, 0));
        } else {
          r.skip(r.size());
        }
      }
    } else throw new Error('Unexpected section in the archive header.');
  }
  return info;
}

/* Run one folder's coder chain over its packed bytes. Only the chains this
   page can produce (AES, optionally feeding deflate or copy) are supported;
   anything else gets a message naming the real method. */
async function decodeFolder(folder, packed, password, keyCache, onProgress) {
  for (const c of folder.coders) {
    if (c.inStreams !== 1 || c.outStreams !== 1) {
      throw new Error('Archive uses a multi-stream coder, which this page does not read.');
    }
  }

  let stream = packed;
  let idx = folder.packedIndices[0];
  for (let step = 0; step < folder.coders.length; step++) {
    const coder = folder.coders[idx];
    if (!coder) throw new Error('Archive coder chain is malformed.');
    if (sameId(coder.id, METHOD_AES)) {
      const { cycles, salt, iv } = parseAesProps(coder.props || new Uint8Array(0));
      const cacheKey = cycles + ':' + Array.from(salt).join(',');
      let keyBytes = keyCache.get(cacheKey);
      if (!keyBytes) {
        keyBytes = await deriveKey(password, salt, cycles, onProgress);
        keyCache.set(cacheKey, keyBytes);
      }
      stream = await cbcDecryptRaw(await importKey(keyBytes), iv, stream);
    } else if (sameId(coder.id, METHOD_COPY)) {
      /* nothing to do */
    } else if (sameId(coder.id, METHOD_DEFLATE)) {
      if (!deflateAvailable) {
        throw new Error('This browser cannot inflate deflate streams; open the archive with 7-Zip instead.');
      }
      stream = await inflateRaw(stream);
    } else {
      throw new Error('This archive is compressed with ' + describeMethod(coder.id)
        + '. This page reads only its own archives (deflate or store) -- open it with 7-Zip.');
    }
    /* Trim to this coder's declared output: AES output carries zero padding. */
    const declared = folder.unpackSizes[idx];
    if (declared !== undefined && stream.length > declared) stream = stream.subarray(0, declared);

    const next = folder.bindPairs.find((bp) => bp.outIndex === idx);
    if (!next) break;
    idx = next.inIndex;
  }
  return stream;
}

/* A wrong key turns the header into noise, and noise fails in a hundred
   different ways. Anything that is not a real capability limit is reported as
   the far likelier cause. */
function wrongKeyIfPlausible(err) {
  const msg = String((err && err.message) || err);
  if (/does not read|7-Zip|damaged/.test(msg)) return err;
  return new Error('Wrong key -- the archive header did not decrypt.');
}

/**
 * Open a .7z and return its single file.
 *
 * @param {Uint8Array} bytes
 * @param {string} password
 * @param {function} [onProgress] receives a 0..1 fraction while deriving the key
 * @returns {Promise<{ name: string, content: Uint8Array }>}
 */
export async function readArchive(bytes, password, onProgress) {
  if (!password) throw new Error('A key is required.');
  if (bytes.length < 32) throw new Error('That is too short to be a .7z archive.');
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('That is not a .7z archive (the file signature does not match).');
  }

  const sh = new Reader(bytes.subarray(12, 32));
  const offLo = sh.u32(), offHi = sh.u32();
  const sizeLo = sh.u32(), sizeHi = sh.u32();
  const nextOffset = offHi * 0x100000000 + offLo;
  const nextSize = sizeHi * 0x100000000 + sizeLo;
  if (nextSize > MAX_SANE_SIZE || 32 + nextOffset + nextSize > bytes.length) {
    throw new Error('The archive is truncated -- its header is not all there.');
  }

  const keyCache = new Map();
  let headerBytes = bytes.subarray(32 + nextOffset, 32 + nextOffset + nextSize);
  let r = new Reader(headerBytes);
  let id = r.byte();

  if (id === kEncodedHeader) {
    const info = readStreamsInfo(r);
    if (info.folders.length !== 1 || info.packSizes.length !== 1) {
      throw new Error('The encrypted header is stored in an unexpected shape.');
    }
    const base = 32 + info.packPos;
    if (base + info.packSizes[0] > bytes.length) {
      throw new Error('The archive is truncated -- its header is not all there.');
    }
    const packed = bytes.subarray(base, base + info.packSizes[0]);
    let plain;
    try {
      plain = await decodeFolder(info.folders[0], packed, password, keyCache, onProgress);
    } catch (err) {
      throw wrongKeyIfPlausible(err);
    }
    if (info.folderCRCs && info.folderCRCs[0] !== null && crc32(plain) !== info.folderCRCs[0]) {
      throw new Error('Wrong key -- the archive header did not decrypt.');
    }
    headerBytes = plain;
    r = new Reader(headerBytes);
    try { id = r.byte(); } catch { throw new Error('Wrong key -- the archive header did not decrypt.'); }
  }

  if (id !== kHeader) throw new Error('Wrong key -- the archive header did not decrypt.');

  let streams = null;
  let names = [];
  let numFiles = 1;
  try {
    for (;;) {
      const t = r.byte();
      if (t === kEnd) break;
      if (t === kMainStreamsInfo) {
        streams = readStreamsInfo(r);
      } else if (t === kFilesInfo) {
        numFiles = r.count();
        for (;;) {
          const p = r.byte();
          if (p === kEnd) break;
          const size = r.size();
          if (p === kName) {
            const block = r.take(size);
            if (block[0] !== 0) throw new Error('Archive stores its names externally, which this page does not read.');
            names = decodeNames(block.subarray(1));
          } else if (p === kEmptyStream || p === kEmptyFile) {
            throw new Error('The archive contains empty files or folders -- open it with 7-Zip.');
          } else {
            r.skip(size);
          }
        }
      } else {
        r.skip(r.size());
      }
    }
  } catch (err) {
    throw wrongKeyIfPlausible(err);
  }

  if (!streams || streams.folders.length === 0 || streams.packSizes.length === 0) {
    throw new Error('The archive contains no data.');
  }
  if (numFiles !== 1) throw new Error('This page handles single-message archives -- open this one with 7-Zip.');

  const folder = streams.folders[0];
  const base = 32 + streams.packPos;
  if (base + streams.packSizes[0] > bytes.length) {
    throw new Error('The archive is truncated -- its payload is not all there.');
  }
  const packed = bytes.subarray(base, base + streams.packSizes[0]);
  const decoded = await decodeFolder(folder, packed, password, keyCache, onProgress);

  const expected = streams.subSizes ? streams.subSizes[0] : folderUnpackSize(folder);
  const content = decoded.length > expected ? decoded.subarray(0, expected) : decoded;

  const crc = streams.subCRCs && streams.subCRCs[0] != null ? streams.subCRCs[0]
    : streams.folderCRCs && streams.folderCRCs[0] != null ? streams.folderCRCs[0]
      : null;
  if (crc !== null && crc32(content) !== crc) {
    throw new Error('The archive decrypted but failed its checksum -- the file is damaged.');
  }

  return { name: names[0] || 'message.txt', content };
}

function decodeNames(block) {
  const names = [];
  let cur = '';
  for (let i = 0; i + 1 < block.length; i += 2) {
    const c = block[i] | (block[i + 1] << 8);
    if (c === 0) { names.push(cur); cur = ''; } else cur += String.fromCharCode(c);
  }
  if (cur) names.push(cur);
  return names;
}

/* ------------------------------------------------------------------ *
 * Base64 (chunked so a big message does not blow the argument limit)
 * ------------------------------------------------------------------ */

export function toBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(s);
}

export function fromBase64(text) {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) throw new Error('There is no encrypted text to decrypt.');
  let bin;
  try {
    bin = atob(clean);
  } catch {
    throw new Error('That does not look like the encrypted text this page produces.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function wrapBase64(s, width = 76) {
  const lines = [];
  for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width));
  return lines.join('\n');
}
