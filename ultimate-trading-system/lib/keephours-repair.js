// ---- REPAIR (RULE TEN): the price record of a set written before 3.271.0 ----
//
// DELETE THIS FILE, AND THE BLOCK IN lib/stages.js THAT CALLS IT, once no record
// set on the box carries `dataManifest`: that is the day every set has been
// through it. Count them with vps-access/scripts/uts-hours-survey.sh.
//
// Until 3.271.0 a set recorded WHICH PRICE FILES it was launched on (a
// `dataManifest` on the set, and beside it a detail file under data/manifests
// listing each file with its size and fingerprint at launch). 3.271.0 keeps the
// hours themselves instead (lib/hours.js). This is the one reader of the old
// record left: it reads a set's hours exactly as the old code did -- each month
// from the bundle when one was pinned, else from that month's pinned day files,
// each file cut back to the size it had at launch -- and PROVES every file it
// reads against the fingerprint recorded at launch before handing a single hour
// over. A file that is gone, or that no longer holds what it held at launch,
// refuses: those hours can never be kept, and the set says so from then on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

// the detail file the old record names, read; null when it cannot be
function oldEntriesOf(dm) {
  const rel = dm && typeof dm.detailFile === 'string' ? dm.detailFile : null;
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf8')); } catch (_) { return null; }
  if (!d || !d.detail || typeof d.detail !== 'object') return null;
  const out = {};
  for (const [symbol, list] of Object.entries(d.detail)) {
    if (!Array.isArray(list)) continue;
    out[symbol] = list.filter((x) => x && typeof x.file === 'string' && x.sha256)
      .map((x) => ({ file: x.file, bytes: Number.isFinite(x.bytes) ? x.bytes : null, sha256: x.sha256 }));
  }
  return out;
}
// the bytes a file held at launch, cut out of it as it is now (3.269.0): the file
// itself at the same size; a longer one cut at the end of the last hour the
// launch saw and closed again with ']'; anything else is not the launch's
function launchBytesOf(raw, bytes) {
  if (!Number.isFinite(bytes) || raw.length === bytes) return raw;
  if (raw.length < bytes) return null;
  if (bytes < 2 || raw[bytes - 2] !== 0x7d || raw[bytes - 1] !== 0x2c) return null;
  return Buffer.concat([raw.subarray(0, bytes - 1), Buffer.from(']')]);
}
// ONE COIN'S HOURS AS ITS OLD RECORD READ THEM, every file proved; throws a
// sentence naming the first file that cannot be
function oldPinnedRows(symbol, entries) {
  const byMonth = new Map();
  for (const x of entries || []) {
    let m = new RegExp(`^${symbol}-1h-(\\d{4}-\\d{2})\\.json$`).exec(x.file);
    if (m) { const e = byMonth.get(m[1]) || { bundle: null, days: [] }; e.bundle = x; byMonth.set(m[1], e); continue; }
    m = new RegExp(`^${symbol}-1h-(\\d{4}-\\d{2})-\\d{2}\\.json$`).exec(x.file);
    if (m) { const e = byMonth.get(m[1]) || { bundle: null, days: [] }; e.days.push(x); byMonth.set(m[1], e); }
  }
  const read = (x) => {
    let raw;
    try { raw = fs.readFileSync(path.join(CACHE_DIR, x.file)); } catch (_) { throw new Error(`${x.file}, which it was launched on, is gone`); }
    const buf = launchBytesOf(raw, x.bytes);
    if (!buf || crypto.createHash('sha256').update(buf).digest('hex') !== x.sha256) {
      throw new Error(`${x.file} no longer holds what it held when the set was launched`);
    }
    const got = JSON.parse(buf.toString('utf8'));
    if (!Array.isArray(got)) throw new Error(`${x.file} does not hold a list of hours`);
    return got;
  };
  const rows = [];
  for (const mm of [...byMonth.keys()].sort()) {
    const e = byMonth.get(mm);
    const files = e.bundle ? [e.bundle] : e.days.slice().sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    for (const x of files) for (const r of read(x)) rows.push(r);
  }
  return rows;
}
// a coin's old record, as one string: two sets whose records say the same thing
// for a coin read the same hours, so the hours are read and kept once
function signatureOf(symbol, entries) {
  return `${symbol}|${(entries || []).map((x) => `${x.file}:${x.bytes}:${x.sha256}`).sort().join(',')}`;
}

module.exports = { oldEntriesOf, oldPinnedRows, signatureOf, launchBytesOf };
