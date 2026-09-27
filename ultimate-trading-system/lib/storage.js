// THE SWEEP PROCESSOR'S STORAGE, AND WHAT CAN BE RECLAIMED (3.272.0, owner order
// 2026-09-26: "a section on the top of the Compute tab called 'The sweep
// processor' which has a real time report of Construct storage allocated by the
// account and a maintenance option that reports space that can be reclaimed and
// that actually does the reclaim. that's in place of all the types of
// maintenance deletes that are suggested now -- the software should be able to
// determine these issues and resolve them").
//
// ONE SURVEY OF THE DATA FOLDER, TWO USES. The Compute tab draws it every time it
// refreshes, and a reclaim takes a fresh one at the moment of the press -- never
// the page's copy -- and deletes only what that survey names.
//
// WHAT COUNTS AS LEFT BEHIND is only what the software can prove belongs to
// nothing that reads it:
//   * the stage-engine check's own sets, when no check is running: the check
//     deletes everything it makes, and a set of it still here was missed;
//   * price-file records no record set names (data/manifests): since 3.271.0 a
//     set keeps its hours, and nothing reads those records at all;
//   * kept hours no record set names (data/hours);
//   * files named after a record set that is gone, beside the sets or among the
//     record stores;
//   * files half-written when the service stopped (a `.tmp` beside the file it
//     was about to become);
//   * readings on Coins this release cannot read (lib/coinsrun.js decides which,
//     as it always has; its own button on Coins is folded into this one).
// A file is only ever counted left behind once it is more than an hour old, and
// a folder only once nothing in it has been written for an hour, so nothing
// written in the last moments -- a set's files a breath before its own record --
// is ever mistaken for it.
//
// AND TWO KINDS KEPT ON PURPOSE, which the software cannot know are unwanted:
// the copies kept beside a set before a repair (`.before-...`), and the backups
// under data/backups. They are listed with their size so they can be reclaimed
// too, but never by default.
//
// A RECLAIM REFUSES WHILE ANYTHING HEAVY IS RUNNING, because a run may be
// writing a set's files at that moment.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const HOUR_MS = 3600 * 1000;
const TMP_RE = /\.tmp\d/;              // what every atomic write in this service writes first
const BEFORE_RE = /\.before-/;         // a copy kept beside a set before a repair
const SET_NAME_RE = /^s\d-/;           // every record set's id, and so every file named after one

// what the reclaim list offers, in the order it is drawn; `ticked` is whether
// the box starts ticked -- only the kinds the software can prove are left behind
const KINDS = Object.freeze([
  { key: 'checkSets', label: 'stage-engine check sets left behind', ticked: true },
  { key: 'priceFileRecords', label: 'price-file records no record set uses', ticked: true },
  { key: 'unreadHours', label: 'hours kept that no record set reads', ticked: true },
  { key: 'goneSetFiles', label: 'files of record sets that are gone', ticked: true },
  { key: 'halfWritten', label: 'files half-written when the service stopped', ticked: true },
  { key: 'coinsUnreadable', label: 'readings on Coins this release cannot read', ticked: true },
  { key: 'repairCopies', label: 'copies kept beside record sets before a repair', ticked: false },
  { key: 'backups', label: 'backups', ticked: false },
]);

function statOr(p) { try { return fs.statSync(p); } catch (_) { return null; } }
// a file's or a folder's size on disk, and how many files it holds
function sizeOf(p) {
  const st = statOr(p);
  if (!st) return { bytes: 0, files: 0 };
  if (!st.isDirectory()) return { bytes: st.size, files: 1 };
  let bytes = 0;
  let files = 0;
  let names = [];
  try { names = fs.readdirSync(p); } catch (_) { names = []; }
  for (const f of names) { const s = sizeOf(path.join(p, f)); bytes += s.bytes; files += s.files; }
  return { bytes, files };
}
const readdir = (p) => { try { return fs.readdirSync(p); } catch (_) { return []; } };
// when anything in it was last written: a folder is as new as the newest thing
// in it, itself included -- a record store a run is still filling is never old
function newestMs(p) {
  const st = statOr(p);
  if (!st) return null;
  if (!st.isDirectory()) return st.mtimeMs;
  let n = st.mtimeMs;
  for (const f of readdir(p)) { const m = newestMs(path.join(p, f)); if (m !== null && m > n) n = m; }
  return n;
}
const isSetDocument = (f) => f.endsWith('.json') && !f.slice(0, -'.json'.length).includes('.');

// Every set document, read once and kept while its file stays the same size and
// age: a refresh every thirty seconds must not parse the largest set on the box
// thirty times a quarter of an hour.
const docCache = new Map();   // path -> { key, doc }
function readDocs(setsDir) {
  const docs = new Map();
  for (const f of readdir(setsDir)) {
    if (!isSetDocument(f)) continue;
    const p = path.join(setsDir, f);
    const st = statOr(p);
    if (!st || !st.isFile()) continue;
    const key = `${st.size}:${st.mtimeMs}`;
    let hit = docCache.get(p);
    if (!hit || hit.key !== key) {
      let doc = null;
      try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { doc = null; }
      hit = { key, doc };
      docCache.set(p, hit);
    }
    if (hit.doc && typeof hit.doc === 'object' && 'stage' in hit.doc) docs.set(f.slice(0, -'.json'.length), hit.doc);
  }
  return docs;
}

// The readings Coins cannot read, asked of Coins itself -- and asked again only
// when a file in its folder has changed, because the answer means reading every
// one of them.
let coinsCache = { key: null, list: [] };
function coinsUnreadable(dataDir) {
  if (dataDir !== DATA) return [];   // Coins reads only the live folder
  const dir = path.join(dataDir, 'coins');
  const key = readdir(dir).map((f) => { const st = statOr(path.join(dir, f)); return st ? `${f}:${st.size}:${st.mtimeMs}` : f; }).sort().join('|');
  if (coinsCache.key !== key) {
    let list = [];
    try { list = require('./coinsrun').scanRecords().unreadable.map((u) => path.join('coins', u.file)); } catch (_) { list = []; }
    coinsCache = { key, list };
  }
  return coinsCache.list;
}

// THE SURVEY. `now` and `dataDir` are the tests' to set; nothing else passes them.
function survey({ dataDir = DATA, now = Date.now() } = {}) {
  const setsDir = path.join(dataDir, 'stagesets');
  const batchesDir = path.join(dataDir, 'batches');
  const docs = readDocs(setsDir);
  const ids = [...docs.keys()];
  // A SET WHOSE DOCUMENT CANNOT BE READ IS STILL A SET: its files are never
  // counted as left behind, because a document that will not parse today may be
  // one somebody can mend. Owners are every document-shaped file, read or not,
  // longest first so s4-x-10's files are never taken for s4-x-1's.
  const stems = readdir(setsDir).filter(isSetDocument).map((f) => f.slice(0, -'.json'.length)).sort((a, b) => b.length - a.length);
  const stemSet = new Set(stems);
  const ownerOf = (name) => stems.find((i) => name.startsWith(`${i}-`) || name.startsWith(`${i}.`)) || null;
  const old = (p) => { const m = newestMs(p); return m !== null && now - m > HOUR_MS; };
  const exam = new Set(ids.filter((i) => docs.get(i).exam));
  const perSet = new Map(ids.map((i) => [i, 0]));
  const add = (id, bytes) => perSet.set(id, (perSet.get(id) || 0) + bytes);
  const found = Object.fromEntries(KINDS.map((k) => [k.key, []]));   // key -> [{ rel, bytes }]
  const put = (key, abs) => found[key].push({ rel: path.relative(dataDir, abs), bytes: sizeOf(abs).bytes });

  // beside the sets: each set's document and every file named after it
  for (const f of readdir(setsDir)) {
    const p = path.join(setsDir, f);
    if (f === 'checkpoints') {
      for (const c of readdir(p)) {
        const cp = path.join(p, c);
        const id = c.replace(/\.json$/, '');
        if (docs.has(id)) add(id, sizeOf(cp).bytes);
        else if (TMP_RE.test(c)) { if (old(cp)) put('halfWritten', cp); }
        else if (!stemSet.has(id) && SET_NAME_RE.test(c) && old(cp)) put('goneSetFiles', cp);
      }
      continue;
    }
    if (isSetDocument(f)) { if (docs.has(f.slice(0, -'.json'.length))) add(f.slice(0, -'.json'.length), sizeOf(p).bytes); continue; }
    if (TMP_RE.test(f)) { if (old(p)) put('halfWritten', p); continue; }
    if (BEFORE_RE.test(f)) { put('repairCopies', p); continue; }
    const owner = ownerOf(f);
    if (owner) { if (docs.has(owner)) add(owner, sizeOf(p).bytes); continue; }
    if (SET_NAME_RE.test(f) && old(p)) put('goneSetFiles', p);
  }
  // among the record stores: <id>.rows, and the fills' working folders <id>__...
  for (const f of readdir(batchesDir)) {
    const p = path.join(batchesDir, f);
    const id = f.includes('__') ? f.split('__')[0] : f.endsWith('.rows') ? f.slice(0, -'.rows'.length) : null;
    if (id && docs.has(id)) { add(id, sizeOf(p).bytes); continue; }
    if (id && !stemSet.has(id) && SET_NAME_RE.test(id) && old(p)) put('goneSetFiles', p);
  }
  // the price-file records and the kept hours, against what the sets name
  const namedRecords = new Set();
  const namedHours = new Set();
  for (const d of docs.values()) {
    const dm = d.dataManifest;
    if (dm && typeof dm.detailFile === 'string') namedRecords.add(dm.detailFile);
    for (const e of Object.values(((d.hours || {}).coins) || {})) if (e && typeof e.file === 'string') namedHours.add(e.file);
  }
  // the prices a greenlight keeps for "as trained by Construct" are read too (3.283.0)
  for (const g of require('./live/greenlight').listGreenlights()) {
    for (const e of Object.values((((g.construct || {}).hours || {}).coins) || {})) if (e && typeof e.file === 'string') namedHours.add(e.file);
  }
  for (const f of readdir(path.join(dataDir, 'manifests'))) {
    if (TMP_RE.test(f)) continue;   // counted with the half-written files below
    const rel = `manifests/${f}`;
    if (!namedRecords.has(rel)) put('priceFileRecords', path.join(dataDir, rel));
  }
  for (const f of readdir(path.join(dataDir, 'hours'))) {
    const p = path.join(dataDir, 'hours', f);
    if (TMP_RE.test(f)) { if (old(p)) put('halfWritten', p); continue; }
    if (!namedHours.has(`hours/${f}`) && old(p)) put('unreadHours', p);
  }
  // half-written files anywhere else, and the readings Coins cannot read
  for (const top of ['cache', 'walks', 'fields', 'coins', 'live', 'manifests']) {
    const walk = (dir) => {
      for (const f of readdir(dir)) {
        const p = path.join(dir, f);
        const st = statOr(p);
        if (st && st.isDirectory()) walk(p);
        else if (TMP_RE.test(f) && old(p)) put('halfWritten', p);
      }
    };
    walk(path.join(dataDir, top));
  }
  for (const rel of coinsUnreadable(dataDir)) put('coinsUnreadable', path.join(dataDir, rel));
  for (const f of readdir(path.join(dataDir, 'backups'))) put('backups', path.join(dataDir, 'backups', f));
  // the check's own sets: their bytes come off the sets' tally and go here
  for (const id of exam) found.checkSets.push({ rel: `stagesets/${id}.json`, id, stage: docs.get(id).stage, bytes: perSet.get(id) || 0 });

  // THE REPORT: every byte in the folder, once, in the row that says what it is
  const total = sizeOf(dataDir).bytes;
  const byStage = [1, 2, 3, 4].map((stage) => {
    const mine = ids.filter((i) => docs.get(i).stage === stage && !exam.has(i));
    return { stage, count: mine.length, bytes: mine.reduce((n, i) => n + (perSet.get(i) || 0), 0) };
  });
  const sum = (key) => found[key].reduce((n, x) => n + x.bytes, 0);
  const leftBehind = KINDS.filter((k) => k.ticked).reduce((n, k) => n + sum(k.key), 0);
  const hoursKept = sizeOf(path.join(dataDir, 'hours')).bytes - sum('unreadHours') - found.halfWritten.filter((x) => x.rel.startsWith('hours/')).reduce((n, x) => n + x.bytes, 0);
  const cacheHalf = found.halfWritten.filter((x) => x.rel.startsWith('cache/')).reduce((n, x) => n + x.bytes, 0);
  const coinsHalf = found.halfWritten.filter((x) => /^(walks|fields|coins)\//.test(x.rel)).reduce((n, x) => n + x.bytes, 0);
  const rows = [
    ...byStage.map((s) => ({ key: `stage${s.stage}`, label: `stage ${s.stage} record sets`, count: s.count, bytes: s.bytes })),
    { key: 'hoursKept', label: 'hours kept with record sets', bytes: hoursKept },
    { key: 'priceHistory', label: 'price history', bytes: sizeOf(path.join(dataDir, 'cache')).bytes - cacheHalf },
    { key: 'coins', label: 'walk sets, fields and readings on Coins', bytes: ['walks', 'fields', 'coins'].reduce((n, t) => n + sizeOf(path.join(dataDir, t)).bytes, 0) - coinsHalf - sum('coinsUnreadable') },
    { key: 'backups', label: 'backups', bytes: sum('backups') },
    { key: 'leftBehind', label: 'left behind, and can be reclaimed', bytes: leftBehind },
  ];
  const named = rows.reduce((n, r) => n + r.bytes, 0);
  rows.push({ key: 'else', label: 'everything else', bytes: Math.max(0, total - named) });
  let free = null;
  try {
    const fsst = fs.statfsSync(dataDir);
    free = { bytes: fsst.bavail * fsst.bsize, of: fsst.blocks * fsst.bsize };
  } catch (_) { free = null; }
  const reclaim = KINDS.map((k) => ({ key: k.key, label: k.label, ticked: k.ticked, count: found[k.key].length, bytes: sum(k.key) }));
  return { at: new Date(now).toISOString(), total, rows, free, reclaim, found };
}

// what the page is sent: the report without the file lists, which can run to
// thousands of names and are only the reclaim's business
function report(opts) {
  const s = survey(opts);
  return { at: s.at, total: s.total, rows: s.rows, free: s.free, reclaim: s.reclaim };
}

// THE RECLAIM. A fresh survey, taken now; only the kinds asked for; refused while
// anything heavy is running. Each file is checked to lie inside the data folder
// before it is removed, and every one that could not be is said, never skipped
// in silence.
function reclaim(keys, { dataDir = DATA, now = Date.now(), busy = null, deleteSet = null } = {}) {
  const want = new Set((Array.isArray(keys) ? keys : []).map(String));
  const unknown = [...want].filter((k) => !KINDS.some((x) => x.key === k));
  if (unknown.length) throw new Error(`nothing is called ${unknown.map((k) => JSON.stringify(k)).join(', ')} here — nothing was reclaimed`);
  if (!want.size) throw new Error('nothing is ticked, so nothing was reclaimed');
  const stages = busy && deleteSet ? null : require('./stages');
  const busyNow = (busy || stages.stageBusy)();
  if (busyNow) throw new Error(`${busyNow} is running — nothing is reclaimed while anything heavy runs, because it may be writing these very files`);
  const del = deleteSet || ((id) => stages.deleteSet(id, id));
  const s = survey({ dataDir, now });
  const root = path.resolve(dataDir);
  const inside = (rel) => { const abs = path.resolve(root, rel); return abs.startsWith(root + path.sep) ? abs : null; };
  const done = [];
  const failed = [];
  for (const k of KINDS) {
    if (!want.has(k.key)) continue;
    let count = 0;
    let bytes = 0;
    if (k.key === 'checkSets') {
      // a set another set names as its parent is never deleted, so the deepest go first
      for (const x of s.found.checkSets.slice().sort((a, b) => b.stage - a.stage)) {
        try { del(x.id); count++; bytes += x.bytes; } catch (err) { failed.push({ what: x.id, why: String((err && err.message) || err) }); }
      }
    } else if (k.key === 'coinsUnreadable') {
      if (s.found.coinsUnreadable.length) {
        try {
          const ans = require('./coinsrun').coinsCleanup();
          count = ans.removed.length;
          bytes = s.found.coinsUnreadable.filter((x) => ans.removed.includes(path.basename(x.rel))).reduce((n, x) => n + x.bytes, 0);
          for (const f of ans.failed) failed.push({ what: `coins/${f.file}`, why: f.why });
        } catch (err) { failed.push({ what: 'readings on Coins', why: String((err && err.message) || err) }); }
      }
    } else {
      for (const x of s.found[k.key]) {
        const abs = inside(x.rel);
        if (!abs) { failed.push({ what: x.rel, why: 'it does not lie inside the data folder' }); continue; }
        try { fs.rmSync(abs, { recursive: true, force: true }); count++; bytes += x.bytes; } catch (err) { failed.push({ what: x.rel, why: String((err && err.message) || err) }); }
      }
    }
    done.push({ key: k.key, label: k.label, count, bytes });
  }
  coinsCache = { key: null, list: [] };
  return { at: new Date(now).toISOString(), reclaimed: done.reduce((n, d) => n + d.bytes, 0), done, failed };
}

module.exports = { survey, report, reclaim, KINDS, HOUR_MS, DATA };
