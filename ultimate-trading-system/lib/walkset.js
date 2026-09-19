// walkset.js -- WALK IT FORWARD'S SETS, ON DISK (3.164.0, owner order:
// "build the saved walk set").
//
// Until this file existed, Walk it forward wrote nothing at all. Nineteen
// minutes of compute lived in the service's memory and went the moment it
// restarted -- a deploy, an out-of-memory kill, a reboot -- with nothing on
// screen to say so. Every other long job on this box writes a set that can be
// reopened, and this is that, in the same spirit: one file per set, named,
// listed, openable, deletable, carrying the parameters it was run under so a
// set can never be read as though it had been run some other way.
//
// WHAT IT IS NOT. It is not a stage record set and it does not pretend to be
// one: nothing is trained here, nothing is priced, and no rule comes out of
// it. It is a table of readings and the windows behind them.
//
// A STOPPED WALK IS NOT SAVED, which is the behaviour Stop already had and the
// reason it had it: a table missing the coins it had not got to yet would read
// as a comparison and is not one.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'walks');
const V = 1;

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) { /* already there */ } }
const walkFile = (id) => path.join(DIR, `${String(id).replace(/[^\w.-]/g, '')}.json`);

// A SET IS `W-4.json` AND NOTHING ELSE (3.194.0). The picks now live in
// `W-4.picks.json` beside it, and a reader that took any `.json` in this folder
// for a set would invent one called `W-4.picks` and then parse it on every draw
// -- which is exactly the fault that took the service down on 2026-09-19, where
// `<id>.funnelrich.json` was read as a record set. One dot in the name, no
// second extension: that is the whole rule, and it is written here rather than
// remembered because this folder now holds two kinds of file.
const isSetFile = (f) => f.endsWith('.json') && !f.slice(0, -'.json'.length).includes('.');
function idsOnDisk() {
  try {
    return fs.readdirSync(DIR).filter(isSetFile).map((f) => f.replace(/\.json$/, ''));
  } catch (_) { return []; }
}

// W-1, W-2, ... never reusing a number a file still holds
function nextId() {
  const taken = new Set(idsOnDisk());
  for (let n = 1; ; n++) { const id = `W-${n}`; if (!taken.has(id)) return id; }
}
// and the name the box offers, which the owner can type over
function nextName() {
  const names = new Set(listWalks().map((w) => String(w.name || '').toLowerCase()));
  for (let n = 1; ; n++) { const nm = `walk ${n}`; if (!names.has(nm)) return nm; }
}

function readWalk(id) {
  try {
    const doc = JSON.parse(fs.readFileSync(walkFile(id), 'utf8'));
    if (!doc || doc.v !== V) return null;
    return doc;
  } catch (_) { return null; }
}

// ---- ONE PARSE PER FILE, AND ONLY WHEN THE FILE CHANGES (3.191.0, owner
// ---- order: "each 'Remove' button ... takes about 30 seconds ... FIX THAT") --
//
// The list said it was cheap and it was not. It called readWalk, which parses
// the WHOLE set -- every window of every reading -- and then kept the header
// and threw the rows away. On the owner's 141MB set that is three seconds, and
// nothing asked for it once: promoted() called listWalks and then parsed every
// file a SECOND time; the status the screen polls called listWalks and then
// nextName, which calls listWalks again. One press of Remove walked that file
// eight or nine times over.
//
// This is the same defect as the one that took the service down on 2026-09-19,
// wearing different clothes: a full parse on a path that runs on every draw.
//
// So the file is parsed once, when it changes, and what the cheap callers need
// is kept: the header, and the rows the owner has promoted. Both are small --
// a header is a dozen fields and a set's promoted rows are the handful the
// owner ticked out of tens of thousands. The rows themselves are NOT kept.
// Change detection is the file's own modification time and size, so a set
// written by anything at all -- this process or a future one -- is re-read.
// ---- THE PICKS LIVE BESIDE THE SET, NOT INSIDE IT (3.194.0, owner order:
// ---- "the remove buttons are still very slow") ------------------------------
//
// 3.191.0 made the DRAW free and left the press at 6.7 seconds, because the
// press still read and rewrote the whole set document to flip one key. On the
// owner's set that is 3.2s to parse 146MB and 3.5s to write it back, to change
// a string in a list of thirty-one. Nothing about the rows changed either time.
//
// So the picks are their own file: `W-4.picks.json`, a few hundred bytes, read
// and written in under a millisecond. The set document holds the walk -- the
// rows, and what it was asked for -- and nothing that the owner can change by
// pressing something. A press now costs one small write.
//
// THE SET IS STILL WHAT OWNS THEM. Delete the set and its picks file goes too,
// which is the behaviour the owner chose (2026-09-18: "reference the walk set,
// not copy") and the reason a promoted row can never go stale against a
// re-walk.
const PICKS_V = 1;
const picksFile = (id) => path.join(DIR, `${String(id).replace(/[^\w.-]/g, '')}.picks.json`);
function readPicks(id) {
  try {
    const p = JSON.parse(fs.readFileSync(picksFile(id), 'utf8'));
    if (!p || p.v !== PICKS_V) return null;
    return { picked: Array.isArray(p.picked) ? p.picked : [], off: Array.isArray(p.off) ? p.off : [] };
  } catch (_) { return null; }
}
function writePicks(id, picked, off) {
  ensureDir();
  const doc = {
    v: PICKS_V, id: String(id),
    picked: [...new Set(picked || [])].sort(),
    off: [...new Set(off || [])].sort(),
  };
  const tmp = `${picksFile(id)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  fs.renameSync(tmp, picksFile(id));
  return doc;
}
// A SET WITH NO PICKS FILE HAS NOT BEEN THROUGH THE REPAIR BELOW. It is not
// read as "nothing picked", because that would quietly hide the owner's
// promotions; every caller asks readPicks and decides for itself.
const picksOrNone = (id) => readPicks(id);

// ---- ONE PARSE PER FILE, AND ONLY WHEN THE FILE CHANGES (3.191.0, owner
// ---- order: "each 'Remove' button ... takes about 30 seconds ... FIX THAT") --
//
// The list said it was cheap and it was not. It called readWalk, which parses
// the WHOLE set -- every window of every reading -- and then kept the header
// and threw the rows away. On the owner's 141MB set that is three seconds, and
// nothing asked for it once: promoted() called listWalks and then parsed every
// file a SECOND time; the status the screen polls called listWalks and then
// nextName, which calls listWalks again.
//
// This is the same defect as the one that took the service down on 2026-09-19,
// wearing different clothes: a full parse on a path that runs on every draw.
//
// WHAT IS KEPT, AND WHY IT IS SMALL. The header, and a map from row key to the
// shaped row -- filled ONLY for keys something has asked for, which in practice
// is the handful the owner has promoted out of tens of thousands. Keeping every
// row would be keeping the file, which is the thing being avoided.
//
// AND IT IS WHAT MAKES Remove INSTANT. Taking a promotion off only ever REMOVES
// a key, so every key still wanted is already in the map and the set document
// is not read at all. Promoting asks for keys the map has not seen, which costs
// one parse -- and promoting is a deliberate bulk press, not a repeated click.
const brief = new Map();
function statOf(id) { try { return fs.statSync(walkFile(id)); } catch (_) { return null; } }

function headOf(doc, bytes) {
  return {
    id: doc.id, name: doc.name, release: doc.release, bytes,
    startedAt: doc.startedAt, finishedAt: doc.finishedAt,
    rows: Array.isArray(doc.rows) ? doc.rows.length : 0,
    picked: 0,                          // filled from the picks file by listWalks
    asked: doc.asked || null,
  };
}

// WHAT A PROMOTED ROW IS, worked out at the one parse. It carries what the row
// IS, never what a reading said about it -- see promoted(), which this serves.
// `ticked` is NOT here: it comes off the picks file, which changes without the
// set changing, so baking it in would cache an answer that had moved.
const shapeRow = (r, k) => ({
  key: k,
  coin: r.coin,
  geometry: r.geometry,
  lookback: r.lookback == null ? 'own' : r.lookback,
  band: r.band,
  trades: r.trades,
  perTrade: r.perTrade,
  windows: r.windows,
  windowsUp: r.windowsUp,
  best: r.best,
  worst: r.worst,
  copies: r.copies,
  asGood: r.asGood,
  asGoodSlid: r.asGoodSlid,
  // the two signs this row's whole history gives, at its own look-back
  // and band -- null on a set walked before 3.171.0 kept them
  lean: r.lean || null,
  scan: r.scan || [],
});

function briefOf(id) {
  const st = statOf(id);
  if (!st) { brief.delete(id); return null; }
  const had = brief.get(id);
  if (had && had.mtimeMs === st.mtimeMs && had.size === st.size) return had;
  const doc = readWalk(id);
  if (!doc) {
    const bad = { mtimeMs: st.mtimeMs, size: st.size, head: { id, name: id, broken: true, bytes: st.size }, rowsByKey: new Map(), allKeys: new Set() };
    brief.set(id, bad);
    return bad;
  }
  // THE KEYS COME FREE HERE. The rows are in memory at this moment to count
  // them for the header, so collecting their keys costs one loop and saves the
  // whole file being parsed a second time the next time something asks whether
  // a key is a row of this set.
  const all = new Set();
  for (const r of doc.rows || []) all.add(rowKey(r));
  const made = { mtimeMs: st.mtimeMs, size: st.size, head: headOf(doc, st.size), rowsByKey: new Map(), allKeys: all };
  brief.set(id, made);
  return made;
}

// THE ONE PARSE THAT FILLS THE MAP, taken only when a key is asked for that is
// not in it. It fills EVERY key of the set's rows into `allKeys` at the same
// time, so the next "is this a row of this set" costs nothing either.
function fillRows(id, b, want) {
  const doc = readWalk(id);
  if (!doc) { b.allKeys = new Set(); return; }
  const need = new Set(want || []);
  const all = new Set();
  for (const r of doc.rows || []) {
    const k = rowKey(r);
    all.add(k);
    if (!need.size || need.has(k)) b.rowsByKey.set(k, shapeRow(r, k));
  }
  b.allKeys = all;
}
// and the two questions the callers actually ask
function rowsFor(id, keys) {
  const b = briefOf(id);
  if (!b || b.head.broken) return null;
  const missing = (keys || []).filter((k) => !b.rowsByKey.has(k));
  if (missing.length) fillRows(id, b, keys);
  return b;
}
function keysOf(id) {
  const b = briefOf(id);
  if (!b || b.head.broken) return null;
  if (!b.allKeys) fillRows(id, b, null);
  return b.allKeys;
}

// AND A WRITER HANDS OVER WHAT IT ALREADY HAS. Every write path here has the
// whole document in memory at the moment it writes it, so re-reading 146MB off
// the disk to learn what we just put there is the same waste one layer down.
function keepBrief(doc) {
  const st = statOf(doc.id);
  if (!st) { brief.delete(doc.id); return; }
  const b = { mtimeMs: st.mtimeMs, size: st.size, head: headOf(doc, st.size), rowsByKey: new Map(), allKeys: new Set() };
  for (const r of doc.rows || []) { const k = rowKey(r); b.allKeys.add(k); }
  brief.set(doc.id, b);
}
function forgetBrief(id) { brief.delete(id); }

// THE LIST IS CHEAP ON PURPOSE, and now it is. Callers that want rows ask for
// one set by name with readWalk, which still parses the lot.
function listWalks() {
  const out = [];
  for (const id of idsOnDisk()) {
    const b = briefOf(id);
    if (!b) continue;
    if (b.head.broken) { out.push(b.head); continue; }
    const p = picksOrNone(id);
    // A SET WITH NO PICKS FILE SAYS SO rather than reading as none picked
    // (3.194.0). Its promotions are still in the set document and the repair
    // has not lifted them out yet; calling that nought would hide the owner's
    // work behind a number.
    out.push({ ...b.head, picked: p ? p.picked.length : null, picksUnread: !p });
  }
  out.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  return out;
}

// ONE KEY PER ROW, and it is the same key the screen opens a row's windows
// with, so a pick made on one screen is the row the other screen means.
const rowKey = (r) => `${r.coin}|${r.geometry}|${r.lookback == null ? 'own' : r.lookback}|${r.band}`;

// ---- A WALK KEEPS WHAT IT HAS DONE (3.189.0, owner order, after a walk was
// ---- lost to a restart three hours in) -------------------------------------
//
// A walk used to live entirely in memory and write itself down once, at the
// end. Anything that stopped the service -- a deploy, a crash, a wedge, the
// owner pressing restart -- threw away every hour of it, and there was nothing
// on disk to say it had ever run. That happened on 2026-09-19 and cost an
// evening.
//
// So each row is appended to a PART file the moment it lands. A part is
// JSON-per-line because that is the only shape that can be appended without
// rewriting what is already there; a set is one JSON object and cannot be.
//
// IT LIVES IN ITS OWN DIRECTORY, not beside the sets. `idsOnDisk` lists
// `<id>.json` in DIR, so a part named `W-3.part.json` there would be listed as
// a walk called `W-3.part` -- which is precisely the fault that cost the
// evening this was written in (lib/stages.js isSetDocument). A separate
// directory cannot make that mistake.
//
// A PART IS NOT A SET, and is never read as one. A walk that has not finished
// is a table missing the coins it never got to, and reading that as a
// comparison is the thing Stop has always refused to allow. It becomes a set
// only when it is sealed, which happens only when every task has landed.
const PARTS = path.join(DIR, 'parts');
const partFile = (id) => path.join(PARTS, `${String(id).replace(/[^\w.-]/g, '')}.jsonl`);
function ensureParts() { try { fs.mkdirSync(PARTS, { recursive: true }); } catch (_) { /* already there */ } }

// the first line is what the walk was asked for; every line after it is a row
function startPart(id, head) {
  ensureParts();
  fs.writeFileSync(partFile(id), `${JSON.stringify({ part: 1, ...head })}\n`);
  return id;
}
// APPENDED, NEVER REWRITTEN. The cost of keeping a walk safe is one append per
// row, not a re-serialising of everything it has done so far.
function appendPart(id, rows) {
  if (!rows || !rows.length) return 0;
  ensureParts();
  fs.appendFileSync(partFile(id), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return rows.length;
}
// A TORN LAST LINE IS DROPPED, not guessed at. A service killed mid-append
// leaves half a row; that row is simply one the walk has not done yet, and it
// will be done again on the next press.
function readPart(id) {
  let raw = '';
  try { raw = fs.readFileSync(partFile(id), 'utf8'); } catch (_) { return null; }
  const lines = raw.split('\n').filter(Boolean);
  if (!lines.length) return null;
  let head = null;
  try { head = JSON.parse(lines[0]); } catch (_) { return null; }
  if (!head || head.part !== 1) return null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    try { rows.push(JSON.parse(lines[i])); } catch (_) { /* a torn last line is a row not yet done */ }
  }
  return { head, rows };
}
function removePart(id) { try { fs.rmSync(partFile(id), { force: true }); } catch (_) { /* gone */ } }

// EVERY WALK THAT STARTED AND DID NOT FINISH. A part whose set exists was
// sealed and the part simply outlived it; that is not unfinished.
function unfinishedWalks() {
  let files = [];
  try { files = fs.readdirSync(PARTS).filter((f) => f.endsWith('.jsonl')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    // WAS THIS PART SEALED? That is one bit, and it used to be answered by
    // parsing the whole set (3.191.0). briefOf answers it from the one parse.
    const sealed = briefOf(id);
    if (sealed && !sealed.head.broken) continue;
    const got = readPart(id);
    if (!got) continue;
    let bytes = 0;
    try { bytes = fs.statSync(partFile(id)).size; } catch (_) { bytes = 0; }
    out.push({
      id, name: got.head.name || id, startedAt: got.head.startedAt || null,
      rows: got.rows.length, of: got.head.of ?? null, bytes, asked: got.head.asked || null,
      release: got.head.release || null,
    });
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return out;
}

// THE ROWS ALREADY DONE, by the key the walk identifies a row with. This is
// what lets a carried-on walk run only what is missing.
function partKeys(id) {
  const got = readPart(id);
  if (!got) return new Set();
  return new Set(got.rows.map(rowKey));
}

// AND THE PART BECOMES A SET. Only here, and only when the caller says every
// task has landed -- a walk that is short of rows is not a comparison.
function sealPart(id, { finishedAt, name } = {}) {
  const got = readPart(id);
  if (!got) throw new Error(`walk ${JSON.stringify(String(id))} has nothing saved to seal`);
  const out = saveWalkAs(id, {
    asked: got.head.asked, shapes: got.head.shapes, collapse: got.head.collapse,
    rows: got.rows, startedAt: got.head.startedAt, finishedAt: finishedAt || Date.now(),
    name: name || got.head.name,
  });
  removePart(id);
  return out;
}

function saveWalk(args) { return saveWalkAs(nextId(), args); }
// THE SAME WRITE, UNDER AN ID ALREADY CLAIMED. A walk claims its id when it
// STARTS now, so the part it appends to and the set it becomes are one name.
function saveWalkAs(id, { asked, shapes, collapse, rows, startedAt, finishedAt, name }) {
  ensureDir();
  const doc = {
    v: V,
    id,
    name: String(name || '').trim() || nextName(),
    release: require('../package.json').version,
    startedAt: startedAt || null,
    finishedAt: finishedAt || Date.now(),
    asked: asked || null,
    shapes: shapes || null,
    collapse: collapse || null,
    // THE PICKS ARE NOT IN HERE (3.194.0). They live in `<id>.picks.json`, so
    // taking a promotion off costs a few hundred bytes and not 146 megabytes.
    rows: rows || [],
  };
  const tmp = `${walkFile(id)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  fs.renameSync(tmp, walkFile(id));
  // and it is born with an empty picks file, so it is never mistaken for a set
  // the repair below has not reached
  if (!readPicks(id)) writePicks(id, [], []);
  keepBrief(doc);
  let bytes = 0;
  try { bytes = fs.statSync(walkFile(id)).size; } catch (_) { bytes = 0; }
  return { id: doc.id, name: doc.name, rows: doc.rows.length, bytes };
}

function writeBack(doc) {
  ensureDir();
  const tmp = `${walkFile(doc.id)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  fs.renameSync(tmp, walkFile(doc.id));
  keepBrief(doc);
}

function renameWalk(id, name) {
  const doc = readWalk(id);
  if (!doc) throw new Error(`there is no walk ${JSON.stringify(id)} on this box`);
  const nm = String(name || '').trim();
  if (!nm) throw new Error('a walk needs a name');
  if (nm.length > 80) throw new Error('a name is 80 characters or fewer');
  const clash = listWalks().find((w) => w.id !== doc.id && String(w.name).toLowerCase() === nm.toLowerCase());
  if (clash) throw new Error(`${JSON.stringify(nm)} is already the name of ${clash.id}`);
  doc.name = nm;
  writeBack(doc);
  return { id: doc.id, name: doc.name };
}

// THE PICKS ARE THE OWNER'S AND THEY LIVE ON THE SET (3.165.0's door, written
// here so the set carries them from the moment it exists). A pick names a row
// of this set and nothing else; what any other screen chooses to do with a
// picked row is that screen's business.
// MANY ROWS IN ONE ASK (3.178.0). Tick every row shown can tick thousands, and
// one request each would be thousands of reads and thousands of writes of a
// file that runs to tens of megabytes. One ask reads the set once, checks every
// key against it, and writes once. setPicked is the same thing for one row, so
// there is one implementation and not two that can drift.
function setPickedMany(id, keys, on) {
  const b = briefOf(id);
  if (!b || b.head.broken) throw new Error(`there is no walk ${JSON.stringify(id)} on this box`);
  if (typeof on !== 'boolean') throw new Error(`a row is picked or not — not ${JSON.stringify(on)}`);
  const p = picksOrNone(id);
  if (!p) throw new Error(`${id} is still being brought up to date — its promotions have not been moved into their own file yet`);
  const want = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k || ''));
  if (!want.length) throw new Error('no row was named');
  // EVERY KEY IS CHECKED BEFORE ANY IS WRITTEN. Half a list applied and the
  // rest refused leaves the owner unable to say what happened.
  //
  // AND ONLY PROMOTING NEEDS THE SET READ (3.194.0). "Is this a row of the
  // walk" is a question about the 146MB document; "is this already promoted"
  // is a question about a file of a few hundred bytes, and taking a promotion
  // off is the second question. That is why Remove is now instant and Promote
  // still costs the one parse it has always needed.
  const mine = on ? keysOf(id) : new Set(p.picked);
  if (!mine) throw new Error(`${id} could not be read`);
  const strangers = want.filter((k) => !mine.has(k));
  if (strangers.length) {
    const why = on ? `is not a row of ${id}` : `is not promoted from ${id}`;
    throw new Error(`${JSON.stringify(strangers[0])} ${why}${strangers.length > 1 ? ` (and ${strangers.length - 1} other(s))` : ''}`);
  }
  const have = new Set(p.picked);
  for (const k of want) { if (on) have.add(k); else have.delete(k); }
  // A ROW THAT IS NO LONGER PROMOTED CANNOT BE UNTICKED. Leaving its key in
  // `off` would bring it back unticked if it were ever promoted again, which
  // is a decision the owner never made.
  const off = [...p.off].filter((k) => have.has(k));
  const wrote = writePicks(id, [...have], off);
  return { id, picked: wrote.picked.length, changed: want.length };
}
// EVERY PROMOTION OFF ONE SET, IN ONE PRESS (3.194.0, owner order: "at least
// provide an option to delete the entire set with one button"). It is
// setPickedMany with every key the set holds, so there is one implementation
// and not two that can drift -- and it answers with what went, because a press
// that empties a list has to say how much it emptied.
function clearPicks(id) {
  const p = picksOrNone(id);
  if (!p) throw new Error(`${id} is still being brought up to date — its promotions have not been moved into their own file yet`);
  if (!p.picked.length) return { id, removed: 0, picked: 0 };
  const removed = p.picked.length;
  setPickedMany(id, p.picked, false);
  return { id, removed, picked: 0 };
}
function setPicked(id, key, on) { return setPickedMany(id, [key], on); }

// EVERY PICK, AS COIN AND SHAPE, deduplicated -- which is the shape every
// other part of the box already takes a selection in (lib/stages.js
// unitsForPassers), so a walk's picks need no new machinery downstream.
function pickedUnits(id) {
  const p = picksOrNone(id);
  if (!p || !p.picked.length) return [];
  const b = rowsFor(id, p.picked);
  if (!b) return [];
  const seen = new Set();
  const out = [];
  for (const k of p.picked) {
    const r = b.rowsByKey.get(k);
    if (!r) continue;
    const pair = `${r.coin}|${r.geometry}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    out.push({ coin: r.coin, geometry: r.geometry });
  }
  return out;
}

// PROMOTED AND TICKED ARE TWO DIFFERENT THINGS (3.170.0, owner order
// 2026-09-18: "select records that look promising, bring them up into that set
// at the top ... and just select the ones we want").
//
// `picked` is promoted -- the owner said this row is worth carrying. `off` is
// which of those are not to run just now. A promoted row is TICKED until it is
// unticked, the same way a passer is, so promoting something does not then
// require a second press to use it.
function setRowOff(id, key, off) {
  const p = picksOrNone(id);
  if (!p) throw new Error(`there is no walk ${JSON.stringify(id)} on this box, or it is still being brought up to date`);
  if (typeof off !== 'boolean') throw new Error(`a row is ticked or not — not ${JSON.stringify(off)}`);
  const k = String(key || '');
  if (!p.picked.includes(k)) throw new Error(`${JSON.stringify(k)} is not promoted from ${id}`);
  const have = new Set(p.off);
  if (off) have.add(k); else have.delete(k);
  const wrote = writePicks(id, p.picked, [...have]);
  return { id, off: wrote.off.length };
}

// EVERY PROMOTED ROW ON THE BOX, one group per walk set, for the list at the
// top of Coins.
//
// A PROMOTED ROW IS A REFERENCE, NOT A COPY (owner decision, 2026-09-18:
// "reference the walk set, not copy"). It lives on its set and it is read back
// off its set's own rows, so deleting the set takes its promoted rows with it
// and nothing can go stale against a re-walk. That is why this reads the rows
// rather than keeping a second store beside them.
//
// AND IT CARRIES WHAT THE ROW IS, NEVER WHAT A READING SAID ABOUT IT. late,
// lead and best on both halves are worked out on every draw of Choose early,
// read late and can change with its two boxes; writing them onto the list at
// the top would freeze one reading's answer and call it a property of the row.
function promoted() {
  const out = [];
  for (const head of listWalks()) {
    if (head.broken) continue;
    const p = picksOrNone(head.id);
    if (!p || !p.picked.length) continue;
    const b = rowsFor(head.id, p.picked);
    if (!b) continue;
    const off = new Set(p.off);
    const rows = [];
    for (const k of p.picked) {
      const r = b.rowsByKey.get(k);
      if (!r) continue;                 // a key naming no row of this set
      // A FRESH OBJECT PER ROW, so a caller that writes on what it is handed
      // cannot write on the kept copy. It is a handful of rows and it costs
      // nothing; sharing them would be a fault that showed up as a wrong
      // number on some other screen an hour later.
      rows.push({ ...r, ticked: !off.has(k) });
    }
    if (rows.length) out.push({ id: head.id, name: head.name, release: head.release, finishedAt: head.finishedAt, rows });
  }
  return out;
}

// THE LEAN EACH TICKED PROMOTED ROW CARRIES, keyed by coin and shape -- the
// shape stage 3's confirm dial already takes, with the row's own LOOK-BACK
// beside its band. A row from a set walked before 3.171.0 has no lean and is
// left out rather than given one.
//
// ONE KEY, ONE LEAN, FOR NOW. Two promoted rows on the same coin and chunk
// shape are two different readings of it and the owner's call is that they
// become two units -- but a unit is `trade|ctx1|ctx2|geometry` today
// (lib/stages.js:540) and that key is on disk in every stage 3 set. So until
// that changes the first ticked row of a coin and shape holds the key, and
// promotedLeans says how many were passed over so nothing is silent.
function promotedLeans() {
  const out = {};
  const passedOver = [];
  for (const set of promoted()) {
    for (const r of set.rows) {
      if (!r.ticked || !r.lean || !(r.lean.rising || r.lean.falling)) continue;
      const k = `${r.coin}|${r.geometry}`;
      if (out[k]) { passedOver.push({ ...r, set: set.id, setName: set.name }); continue; }
      out[k] = {
        band: r.band,
        yardstick: r.lean.yardstick ?? null,
        rising: r.lean.rising || 0,
        falling: r.lean.falling || 0,
        lookback: r.lookback == null ? 'own' : r.lookback,
        from: { set: set.id, name: set.name, key: r.key },
      };
    }
  }
  return { leans: out, passedOver };
}

// EVERY TICKED PROMOTED ROW AS COIN AND SHAPE, deduplicated across every set --
// the shape lib/stages.js unitsForPassers already takes.
// AND WHAT THE WALK FOUND RIDES WITH IT (3.184.0, ADDITIONAL-MEMBER-DESIGN.md).
// This is where the look-back and the band used to be dropped: the row carries
// both and only the coin and chunk shape came out. A promoted row is still ONE
// unit -- a coin and a chunk shape, as it has always been -- and what it brings
// in addition is an EXTRA, which the sweep turns into one more member.
//
// WHERE TWO TICKED ROWS SHARE A COIN AND CHUNK SHAPE they are one unit with two
// extras, in the order they are met. That is the list the design asks for, and
// it is why this collects rather than skipping the second.
function promotedUnits() {
  const at = new Map();
  for (const set of promoted()) {
    for (const r of set.rows) {
      if (!r.ticked) continue;
      const k = `${r.coin}|${r.geometry}`;
      if (!at.has(k)) at.set(k, { coin: r.coin, geometry: r.geometry, extras: [] });
      const back = r.lookback == null || r.lookback === 'own' ? null : Number(r.lookback);
      const band = Number(r.band);
      // A ROW WITH NO LOOK-BACK OF ITS OWN ADDS NO MEMBER. `own` means the
      // chunk shape's own span, which is exactly what the members already
      // read -- a second member on the same numbers would be the same member
      // twice. The unit still runs; it just runs as a plain one.
      if (!Number.isFinite(back) || !(back > 0) || !Number.isFinite(band) || !(band > 0)) continue;
      at.get(k).extras.push({
        lookbackHours: back, bandPct: Math.abs(band),
        from: { set: set.id, name: set.name, key: r.key },
      });
    }
  }
  return [...at.values()];
}

// DELETING ONE FOLLOWS THE SAME TWO STEPS AS A RECORD SET: the first press
// answers with what would go, and only the set's own id typed back does it.
// Hours of compute cannot be got back from a mis-click.
function deleteWalk(id, confirm) {
  const doc = readWalk(id);
  if (!doc) throw new Error(`there is no walk ${JSON.stringify(String(id))} on this box`);
  let bytes = 0;
  try { bytes = fs.statSync(walkFile(id)).size; } catch (_) { bytes = 0; }
  const rows = (doc.rows || []).length;
  const picked = (picksOrNone(id) || { picked: [] }).picked.length;
  if (String(confirm || '') !== doc.id) {
    return { preview: true, id: doc.id, name: doc.name, rows, bytes, picked, confirmWith: doc.id };
  }
  try { fs.unlinkSync(walkFile(id)); } catch (err) { throw new Error(`${doc.id} could not be removed: ${err.message}`); }
  try { fs.rmSync(picksFile(id), { force: true }); } catch (_) { /* gone with it */ }
  forgetBrief(id);
  return { deleted: true, id: doc.id, name: doc.name, rows, bytes, picked };
}

// ---- A REPAIR, WRITTEN TO BE DELETED (3.194.0, RULE NINE and RULE TEN) -----
//
// Until 3.194.0 a set document carried `picked` and `off` inside it. They live
// in `<id>.picks.json` now, and a record in a vocabulary no reader speaks is
// what RULE NINE forbids -- so the records move rather than the readers
// learning two eras.
//
// BESIDE, VERIFY, THEN SWAP. The picks file is written first and read back; the
// document is then written to a temporary name WITHOUT those two fields, parsed
// back and checked for the same row count, and only then renamed over. A crash
// at any point leaves the original document in place with its fields still in
// it, which is the state this reads as "not done yet" -- so it simply runs
// again. The owner's sets are hours of compute and cannot be re-derived.
//
// IT DIES WHEN EVERY SET ON THE BOX HAS BEEN THROUGH IT. Run it, see it report
// 0 of N on a box that has sets, and delete this block, its call in server.js,
// its export, its test and its guard. It calls writePicks and readWalk, which
// are not its own, and nothing calls it but the one line at startup -- so that
// is one cut.
function repairPicksIntoTheirOwnFile() {
  const done = { sets: 0, moved: 0, named: [], failed: [] };
  for (const id of idsOnDisk()) {
    done.sets++;
    if (readPicks(id)) continue;                 // already has one: nothing to do
    let doc = null;
    try { doc = readWalk(id); } catch (_) { doc = null; }
    if (!doc) { done.failed.push(id); continue; }
    const picked = Array.isArray(doc.picked) ? doc.picked : [];
    const off = Array.isArray(doc.off) ? doc.off : [];
    try {
      // 1. beside
      writePicks(id, picked, off);
      const back = readPicks(id);
      if (!back || back.picked.length !== new Set(picked).size) throw new Error('the picks file did not read back as it was written');
      // 2. the document without them, verified before it is swapped in
      const lean = { ...doc };
      delete lean.picked;
      delete lean.off;
      const tmp = `${walkFile(id)}.moving`;
      fs.writeFileSync(tmp, `${JSON.stringify(lean)}\n`);
      const check = JSON.parse(fs.readFileSync(tmp, 'utf8'));
      if (!check || check.v !== V || check.id !== doc.id
        || (check.rows || []).length !== (doc.rows || []).length
        || 'picked' in check || 'off' in check) {
        try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nothing to clear */ }
        throw new Error('the rewritten set did not read back with the same rows');
      }
      // 3. swap
      fs.renameSync(tmp, walkFile(id));
      forgetBrief(id);
      done.moved++;
      done.named.push(`${id} (${picked.length} promoted)`);
    } catch (err) {
      done.failed.push(`${id}: ${err.message}`);
    }
  }
  return done;
}
// ---- end of the repair ------------------------------------------------------

module.exports = {
  V, DIR, walkFile, rowKey, nextId, nextName, saveWalk, saveWalkAs, listWalks, readWalk, renameWalk,
  // a walk keeps what it has done, and can be carried on (3.189.0)
  PARTS, partFile, startPart, appendPart, readPart, removePart, unfinishedWalks, partKeys, sealPart,
  setPicked, setPickedMany, setRowOff, clearPicks, pickedUnits, promoted, promotedUnits, promotedLeans, deleteWalk,
  // one parse per file, and only when the file changes (3.191.0)
  briefOf, forgetBrief,
  // the picks beside the set, not inside it (3.194.0)
  PICKS_V, picksFile, readPicks, writePicks, isSetFile, repairPicksIntoTheirOwnFile,
};
