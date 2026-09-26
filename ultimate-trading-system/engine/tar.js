'use strict';
// engine/tar.js -- THE ENGINE'S PACKAGE: plain ustar, gzipped, written and read
// with Node's own zlib and nothing else (the engine installs no packages). The
// web server writes one from its copy of the engine; the installer unpacks it
// with the machine's own tar, and the engine unpacks each new release itself.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLOCK = 512;
const octal = (n, width) => `${n.toString(8).padStart(width - 1, '0')}\0`;

function header(name, size, mode, mtime) {
  const h = Buffer.alloc(BLOCK, 0);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    // ustar's split: up to 155 bytes of folder in front, up to 100 of name
    const i = name.lastIndexOf('/', name.length - 1);
    prefix = name.slice(0, i);
    base = name.slice(i + 1);
    if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(base) > 100) throw new Error(`the name is too long for the package: ${name}`);
  }
  h.write(base, 0, 100, 'utf8');
  h.write(octal(mode, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(Math.floor(mtime / 1000), 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const x of h) sum += x;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return h;
}

// [{ name, data }] -> gzipped ustar; the time is fixed so the same files make the same package
function pack(files, mtime = Date.UTC(2026, 0, 1)) {
  const parts = [];
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    parts.push(header(f.name, data.length, f.mode || 0o644, mtime), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

// gzipped ustar -> [{ name, data }]; refuses anything that would land outside the folder
function unpack(gz) {
  const buf = zlib.gunzipSync(gz);
  const out = [];
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((x) => x === 0)) break;
    const str = (a, n) => h.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
    const base = str(0, 100);
    const prefix = str(345, 155);
    const name = prefix ? `${prefix}/${base}` : base;
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = str(156, 1) || '0';
    off += BLOCK;
    if (type === '0') {
      if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`the package names a file outside its folder: ${name}`);
      out.push({ name, data: Buffer.from(buf.subarray(off, off + size)) });
    }
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

// every file under a folder, as package entries with paths relative to it
function filesUnder(dir, keep = () => true, rel = '') {
  const out = [];
  for (const n of fs.readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    const st = fs.statSync(path.join(dir, r));
    if (st.isDirectory()) out.push(...filesUnder(dir, keep, r));
    else if (st.isFile() && keep(r)) out.push({ name: r, data: fs.readFileSync(path.join(dir, r)), mode: (st.mode & 0o111) ? 0o755 : 0o644 });
  }
  return out;
}

// THE ENGINE'S CODE, AS ONE FINGERPRINT: every .js file's path and bytes, in
// order. The web server works it out from the package it serves and the engine
// from its own folder, so "the engine is current" means the same code -- not the
// same release number, which moves with every change to the web service too
const crypto = require('crypto');
function codeFingerprint(files) {
  const h = crypto.createHash('sha256');
  for (const f of files.filter((x) => x.name.endsWith('.js') && !x.name.startsWith('install/')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    h.update(f.name); h.update('\0'); h.update(f.data); h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
const ENGINE_CODE = (rel) => rel.endsWith('.js') && !rel.startsWith('install/');

module.exports = { pack, unpack, filesUnder, codeFingerprint, ENGINE_CODE };
