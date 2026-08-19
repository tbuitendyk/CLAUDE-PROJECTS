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

function symbolManifest(symbol) {
  let files = [];
  try {
    files = fs.readdirSync(CACHE_DIR)
      .filter((f) => f.startsWith(`${symbol}-1h-`) && f.endsWith('.json'))
      .sort();
  } catch {
    files = [];
  }
  const detail = [];
  for (const f of files) {
    try {
      const buf = fs.readFileSync(path.join(CACHE_DIR, f));
      detail.push({ file: f, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    } catch {
      // a file that vanishes mid-scan is itself worth recording
      detail.push({ file: f, bytes: null, sha256: null, unreadable: true });
    }
  }
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
function stampManifest(stampId, symbols) {
  try {
    const per = [...new Set(symbols.filter(Boolean))].sort().map(symbolManifest);
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

module.exports = { symbolManifest, stampManifest, manifestDiff, MANIFEST_DIR };
