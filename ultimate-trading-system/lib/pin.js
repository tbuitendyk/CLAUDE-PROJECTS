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
  const d = readDetail(summary);
  if (!d || !d.detail || typeof d.detail !== 'object') return null;
  const out = {};
  for (const [symbol, list] of Object.entries(d.detail)) {
    if (!Array.isArray(list)) continue;
    out[symbol] = list.filter((x) => x && typeof x.file === 'string' && x.sha256).map((x) => x.file).sort();
  }
  return out;
}

module.exports = { detailPathOf, readDetail, pinnedFilesOf, DATA_DIR };
