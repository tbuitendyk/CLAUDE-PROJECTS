// THE HOURS A RUN READS, KEPT WITH IT (3.271.0, owner order 2026-09-26: "we need
// to redesign the sweeping process to FIX the data dates by the exact dates every
// coin HAD at the time of starting sweep 1 so there's never any constraint due to
// newer data").
//
// Until 3.270 a run recorded WHICH PRICE FILES it was launched on, and every unit,
// every start-again and every child read those files back. The files kept moving
// under it: today's file gains an hour every hour; a day written early is fetched
// again whole; a month's day files become one bundle with its holes filled; Purge
// and Trim delete. Each of those refused a set, and 3.269.0 taught the reader
// about the first one only. A record of files can never stop moving, because the
// files are the box's and not the run's.
//
// So at Start stage 1 each coin's hours -- every hour the box held for it, from
// its first to its last -- are copied beside the set, and from then on the run,
// its start-agains, its children and everything that prices any of them again
// read that copy and nothing else. The dates are fixed because the hours are. A
// refresh, a new day, a new bundle, a Purge: none of it reaches a run. The copy is
// checked against its own fingerprint every time it is read, so a damaged copy
// refuses in a sentence instead of being read.
//
// ONE COPY PER COIN PER CONTENT. A copy is named by its fingerprint, so a child, a
// second launch on the same hours and every set brought forward from the same
// files share one file; it is deleted with the last set that names it.
//
// THIS IS THE READING HALF, and the pricing workers read through it: it holds
// nothing but a note of which copies it has already proved, and writes nothing.
// The copies are made and deleted in lib/keephours.js, which no worker reaches.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HOURS_DIR = path.join(DATA_DIR, 'hours');
const FILE_RE = /^hours\/[A-Z0-9]+-[0-9a-f]{32}\.json\.gz$/;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// the fingerprint of a whole set of kept hours: one line per coin, in coin order
function digestOf(coins) {
  const roll = crypto.createHash('sha256');
  for (const sym of Object.keys(coins || {}).sort()) roll.update(`${sym}:${coins[sym].sha256}\n`);
  return roll.digest('hex');
}
// Read one coin's kept hours back, proved against the fingerprint the set
// recorded, or refuse in a sentence. Nothing here ever falls back to the box.
function readCoin(symbol, entry) {
  if (!entry || typeof entry.file !== 'string' || !FILE_RE.test(entry.file) || typeof entry.sha256 !== 'string') {
    throw new Error(`the record of the hours kept for ${symbol} is not whole`);
  }
  let text;
  try {
    text = zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, entry.file))).toString('utf8');
  } catch (err) {
    throw new Error(`the hours kept for ${symbol} cannot be read: ${err && err.code === 'ENOENT' ? 'the copy is gone' : err.message}`);
  }
  if (sha(text) !== entry.sha256) throw new Error(`the hours kept for ${symbol} are damaged: the copy no longer matches what was kept`);
  return JSON.parse(text);
}

// IS EVERY COPY A SET NAMES THERE AND WHOLE? Never throws. Each copy is proved
// once per process while its file stays the same size and age, so a second check
// in the same hour costs a stat per coin.
const proved = new Map();   // file -> 'size:mtimeMs'
function checkKept(hours) {
  if (!hours || typeof hours !== 'object') return { intact: false, why: 'it keeps no hours of its own', missing: [], damaged: [] };
  if (hours.lost) return { intact: false, why: String(hours.lost), missing: [], damaged: [] };
  const coins = hours.coins && typeof hours.coins === 'object' ? hours.coins : {};
  if (!Object.keys(coins).length) return { intact: false, why: 'it keeps no hours of its own', missing: [], damaged: [] };
  const missing = [];
  const damaged = [];
  for (const sym of Object.keys(coins).sort()) {
    const e = coins[sym] || {};
    let st;
    try { st = fs.statSync(path.join(DATA_DIR, String(e.file || ''))); } catch (_) { missing.push(sym); continue; }
    const key = `${st.size}:${st.mtimeMs}`;
    if (proved.get(e.file) === key) continue;
    try { readCoin(sym, e); proved.set(e.file, key); } catch (_) { damaged.push(sym); }
  }
  return { intact: !missing.length && !damaged.length, missing, damaged };
}

// the copies a set names
function filesOf(hours) {
  return Object.values((hours && hours.coins) || {}).map((e) => e && e.file).filter((f) => typeof f === 'string' && FILE_RE.test(f));
}
// a copy that was deleted is proved again if it ever comes back
function forget(file) { proved.delete(file); }

module.exports = { readCoin, checkKept, filesOf, digestOf, forget, HOURS_DIR, DATA_DIR, FILE_RE };
