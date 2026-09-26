// THE PIN, READ WITHOUT STATE (3.84.0). A run reads the price files it was
// launched on; the list is the per-file detail its stamp wrote beside it
// (lib/manifest.js). Reading that list back is a plain file read, and it is
// needed inside the pricing workers -- which may reach no module that holds
// state or writes to disk (tests/test-pool.js), and lib/manifest.js does both.
// So the reader lives here, alone, and manifest.js uses it too.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// the detail file a summary names, resolved under data/; null for anything
// that is not a plain relative path there
function detailPathOf(summary) {
  const rel = summary && typeof summary.detailFile === 'string' ? summary.detailFile : null;
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
  return path.join(DATA_DIR, rel);
}
function readDetail(summary) {
  const file = detailPathOf(summary);
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
// the pinned files per symbol, sorted, or null when the set was never stamped
// (an old run) -- nothing to pin to, so it reads what is on disk, as it did
function pinnedFilesOf(summary) {
  const got = pinnedEntriesOf(summary);
  if (!got) return null;
  const out = {};
  for (const [symbol, list] of Object.entries(got)) out[symbol] = list.map((x) => x.file);
  return out;
}

// THE PIN IS WHAT EACH FILE HELD AT LAUNCH, NOT ITS NAME ALONE (3.269.0, found on
// the box 2026-09-26). Today's day file is partial when a run is launched and
// gains one finished hour every hour after it: its name stays put and its bytes
// do not. So a run read hours its launch never saw, and every check afterwards
// -- a start-again, a fill, a child launch -- refused the set, because the file
// no longer hashed to what the launch recorded. The stamp has always recorded
// each file's size as well as its fingerprint, and a price file only ever gains
// hours at its end, so what the launch read is the file's first that-many
// bytes, closed with the ']' that ended it then. Everything that reads a pinned
// file reads exactly that, and everything that checks one checks exactly that.
function pinnedEntriesOf(summary) {
  const d = readDetail(summary);
  if (!d || !d.detail || typeof d.detail !== 'object') return null;
  const out = {};
  for (const [symbol, list] of Object.entries(d.detail)) {
    if (!Array.isArray(list)) continue;
    out[symbol] = list.filter((x) => x && typeof x.file === 'string' && x.sha256)
      .map((x) => ({ file: x.file, bytes: Number.isFinite(x.bytes) ? x.bytes : null }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  }
  return out;
}
// The bytes a pinned file held at launch, cut out of the file as it is now:
// { buf } when they can be, { why } when they cannot. Equal in size is the file
// itself. Longer is a file that gained hours: its first `bytes` bytes, less the
// separator that followed the last hour the launch saw, closed again with ']'.
// Anything else -- shorter, or not cut at the end of an hour -- is a file whose
// earlier hours changed, and that is never read as the launch's.
function launchBytesOf(raw, bytes) {
  if (!Number.isFinite(bytes) || raw.length === bytes) return { buf: raw };
  if (raw.length < bytes) return { why: `it is shorter than the ${bytes} bytes it held at launch` };
  if (bytes < 2 || raw[bytes - 2] !== 0x7d || raw[bytes - 1] !== 0x2c) {
    return { why: `its first ${bytes} bytes are no longer the hours it held at launch` };
  }
  return { buf: Buffer.concat([raw.subarray(0, bytes - 1), Buffer.from(']')]) };
}

module.exports = { detailPathOf, readDetail, pinnedFilesOf, pinnedEntriesOf, launchBytesOf, DATA_DIR };
