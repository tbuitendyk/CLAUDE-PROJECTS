// DATA MANIFEST (owner order, 2026-08-04, QC 77): every run stamps exactly
// which candle files it read, so "did the data change between these two
// runs?" is a one-glance digest comparison instead of forensics.
//
// Why this exists: 'all loaded' reads the whole cache AS OF FIRE TIME, and
// the cache moves on its own — the 6-hour bundle refresher banks newly
// published months, and the live paper books' half-hour heartbeat falls back
// to daily zips (which are always saved) when the keyless mirror is down.
// Two runs a day apart read different UNI data and the board reshuffled with
// no one having touched anything. The manifest makes that drift VISIBLE.
//
// Shape: the summary (small, rides in the batch doc served over HTTP) holds
// one content digest per symbol plus one overall digest; the per-file detail
// (name, bytes, sha256) goes to data/manifests/<stamp>.json, atomic write,
// referenced from the summary. Digests hash file CONTENT, so a bundle
// re-delivered with identical candles does not read as a change.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const MANIFEST_DIR = path.join(__dirname, '..', 'data', 'manifests');
let tmpSeq = 0;

// THE HASH OF A FILE THAT HAS NOT CHANGED IS KNOWN ALREADY (owner order,
// 2026-09-02: a stage 3 press "went away and did nothing for a minute"). Every
// launch fingerprinted every candle file of its universe twice -- read whole,
// hashed -- and on the owner's cache that is hundreds of megabytes a time. A
// file's hash is kept beside its size and modified time, in memory and in a
// side file the manifest never lists, and a file is read again only when its
// size or its modified time has moved.
const HASHES_FILE = path.join(CACHE_DIR, '.sha256-cache.json');
let hashes = null;                       // file -> { size, mtimeMs, sha256 }
function loadHashes() {
  if (hashes) return hashes;
  try { hashes = JSON.parse(fs.readFileSync(HASHES_FILE, 'utf8')) || {}; } catch { hashes = {}; }
  return hashes;
}
function saveHashes() {
  try {
    const tmp = `${HASHES_FILE}.tmp${process.pid}-${++tmpSeq}`;
    fs.writeFileSync(tmp, JSON.stringify(hashes));
    fs.renameSync(tmp, HASHES_FILE);
  } catch { /* a convenience only: the next call hashes again */ }
}
function hashOfFile(f) {
  const full = path.join(CACHE_DIR, f);
  const st = fs.statSync(full);
  const known = loadHashes()[f];
  if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) return { bytes: st.size, sha256: known.sha256, fresh: false };
  const buf = fs.readFileSync(full);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  hashes[f] = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
  return { bytes: buf.length, sha256, fresh: true };
}

// `onlyFiles`: stamp exactly these files (a child pinned to its parent's
// files); otherwise every file of the symbol on disk, as a launch reads.
function symbolManifest(symbol, onlyFiles = null) {
  let files = [];
  if (Array.isArray(onlyFiles)) {
    files = onlyFiles.slice().sort();
  } else {
    try {
      files = fs.readdirSync(CACHE_DIR)
        .filter((f) => f.startsWith(`${symbol}-1h-`) && f.endsWith('.json'))
        .sort();
    } catch {
      files = [];
    }
  }
  const detail = [];
  let learned = false;
  for (const f of files) {
    try {
      const h = hashOfFile(f);
      detail.push({ file: f, bytes: h.bytes, sha256: h.sha256 });
      if (h.fresh) learned = true;
    } catch {
      // a file that vanishes mid-scan is itself worth recording
      detail.push({ file: f, bytes: null, sha256: null, unreadable: true });
    }
  }
  if (learned) saveHashes();
  const roll = crypto.createHash('sha256');
  for (const d of detail) roll.update(`${d.file}|${d.bytes}|${d.sha256}\n`);
  return {
    symbol,
    files: detail.length,
    bytes: detail.reduce((s, d) => s + (d.bytes || 0), 0),
    digest: detail.length ? roll.digest('hex') : null,
    detail,
  };
}

// Stamp a manifest for `symbols`, writing per-file detail to a side file
// named by `stampId` (job id, or job id + phase for re-fired tools). Returns
// the SUMMARY to store on the doc. Never throws — a manifest failure must
// not kill a launch; it returns { error } instead so the absence is loud.
function stampManifest(stampId, symbols, { onlyFiles = null } = {}) {
  try {
    const per = [...new Set(symbols.filter(Boolean))].sort().map((s) => symbolManifest(s, onlyFiles ? (onlyFiles[s] || []) : null));
    const overall = crypto.createHash('sha256');
    for (const p of per) overall.update(`${p.symbol}:${p.digest}\n`);
    const safe = String(stampId).replace(/[^A-Za-z0-9._-]+/g, '_');
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    const file = path.join(MANIFEST_DIR, `${safe}.json`);
    const tmp = `${file}.tmp${process.pid}-${++tmpSeq}`;
    fs.writeFileSync(tmp, JSON.stringify({
      stampId,
      at: new Date().toISOString(),
      detail: Object.fromEntries(per.map((p) => [p.symbol, p.detail])),
    }));
    fs.renameSync(tmp, file);
    return {
      at: new Date().toISOString(),
      overallDigest: overall.digest('hex'),
      detailFile: `manifests/${safe}.json`,
      symbols: Object.fromEntries(per.map((p) => [p.symbol, { files: p.files, bytes: p.bytes, digest: p.digest }])),
    };
  } catch (err) {
    return { error: `manifest failed: ${err.message}` };
  }
}

// THE STAMP IS THE PIN (3.84.0, owner report 2026-09-07: "the price files
// changed since S3 #1c was written (LTCUSDT) ... that is false").
//
// It was true of the files and false of the prices. The service's own refresh
// had consolidated August 2026 into one month bundle for every coin; LTCUSDT's
// August had been day files when the run was launched, so its file list moved
// while its candles did not -- except for seventeen hours on one day, eleven
// months inside the sealed window, that the day files had never held. A
// fingerprint of files cannot tell that apart from a real change, and worse,
// a run that goes on for forty hours reads whatever is on disk when each unit
// comes up, so the refresh can put two histories inside ONE run.
//
// So a run reads the price files it was launched on. The per-file detail the
// stamp writes beside the set is exactly that list; the loader reads those
// files and no others (the bundle when one is pinned, else the pinned day
// files), and a start-again, a fill, or a child launch asks only whether the
// pinned files are still there with the same bytes. A bundle that appears, a
// day that gets filled, a new day of data: none of it is this run's.
// the readers live in lib/pin.js, which holds no state, because the pricing
// workers need them and may not reach this module
const { readDetail, pinnedFilesOf } = require('./pin');
// Are the pinned files still there with the same bytes? Never throws. A set
// whose detail is gone cannot be proved intact, and says so.
function pinnedIntact(summary) {
  if (!summary || summary.error || !summary.symbols) return { intact: true, pinned: false, checked: 0, gone: [], changed: [] };
  const d = readDetail(summary);
  if (!d || !d.detail) return { intact: false, pinned: false, checked: 0, gone: [], changed: [], why: 'the record of which price files it read is gone' };
  const gone = [];
  const changed = [];
  let checked = 0;
  let learned = false;
  for (const list of Object.values(d.detail)) {
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      if (!x || typeof x.file !== 'string' || !x.sha256) continue;
      checked++;
      let h;
      try { h = hashOfFile(x.file); } catch { gone.push(x.file); continue; }
      if (h.fresh) learned = true;
      if (h.sha256 !== x.sha256) changed.push(x.file);
    }
  }
  if (learned) saveHashes();
  return { intact: !gone.length && !changed.length, pinned: true, checked, gone, changed };
}

// Compare two summaries: null if either is absent (old runs), else the list
// of symbols whose data differed plus symbols only one side read.
function manifestDiff(a, b) {
  if (!a || !b || a.error || b.error || !a.symbols || !b.symbols) return null;
  if (a.overallDigest === b.overallDigest) return { same: true, changed: [], onlyA: [], onlyB: [] };
  const changed = [];
  const onlyA = [];
  const onlyB = [];
  for (const s of Object.keys(a.symbols)) {
    if (!(s in b.symbols)) onlyA.push(s);
    else if (a.symbols[s].digest !== b.symbols[s].digest) changed.push(s);
  }
  for (const s of Object.keys(b.symbols)) if (!(s in a.symbols)) onlyB.push(s);
  return { same: false, changed, onlyA, onlyB };
}

module.exports = { symbolManifest, stampManifest, manifestDiff, pinnedFilesOf, pinnedIntact, readDetail, MANIFEST_DIR, CACHE_DIR, HASHES_FILE };
