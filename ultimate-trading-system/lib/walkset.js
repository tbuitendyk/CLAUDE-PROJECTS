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

function idsOnDisk() {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
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

// THE LIST IS CHEAP ON PURPOSE. A set is megabytes -- the rows carry every
// window of every reading -- so the list reads each file once and keeps only
// the header, never the rows. Callers that want rows ask for one set by name.
function listWalks() {
  const out = [];
  for (const id of idsOnDisk()) {
    let doc = null; let bytes = 0;
    try { bytes = fs.statSync(walkFile(id)).size; } catch (_) { bytes = 0; }
    doc = readWalk(id);
    if (!doc) { out.push({ id, name: id, broken: true, bytes }); continue; }
    out.push({
      id: doc.id, name: doc.name, release: doc.release, bytes,
      startedAt: doc.startedAt, finishedAt: doc.finishedAt,
      rows: Array.isArray(doc.rows) ? doc.rows.length : 0,
      picked: Array.isArray(doc.picked) ? doc.picked.length : 0,
      asked: doc.asked || null,
    });
  }
  out.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  return out;
}

// ONE KEY PER ROW, and it is the same key the screen opens a row's windows
// with, so a pick made on one screen is the row the other screen means.
const rowKey = (r) => `${r.coin}|${r.geometry}|${r.lookback == null ? 'own' : r.lookback}|${r.band}`;

function saveWalk({ asked, shapes, collapse, rows, startedAt, finishedAt, name }) {
  ensureDir();
  const id = nextId();
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
    picked: [],
    rows: rows || [],
  };
  const tmp = `${walkFile(id)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  fs.renameSync(tmp, walkFile(id));
  let bytes = 0;
  try { bytes = fs.statSync(walkFile(id)).size; } catch (_) { bytes = 0; }
  return { id: doc.id, name: doc.name, rows: doc.rows.length, bytes };
}

function writeBack(doc) {
  ensureDir();
  const tmp = `${walkFile(doc.id)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  fs.renameSync(tmp, walkFile(doc.id));
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
function setPicked(id, key, on) {
  const doc = readWalk(id);
  if (!doc) throw new Error(`there is no walk ${JSON.stringify(id)} on this box`);
  if (typeof on !== 'boolean') throw new Error(`a row is picked or not — not ${JSON.stringify(on)}`);
  const k = String(key || '');
  if (!(doc.rows || []).some((r) => rowKey(r) === k)) throw new Error(`${JSON.stringify(k)} is not a row of ${doc.id}`);
  const have = new Set(doc.picked || []);
  if (on) have.add(k); else have.delete(k);
  doc.picked = [...have].sort();
  writeBack(doc);
  return { id: doc.id, picked: doc.picked.length };
}

// EVERY PICK, AS COIN AND SHAPE, deduplicated -- which is the shape every
// other part of the box already takes a selection in (lib/stages.js
// unitsForPassers), so a walk's picks need no new machinery downstream.
function pickedUnits(id) {
  const doc = readWalk(id);
  if (!doc) return [];
  const want = new Set(doc.picked || []);
  const seen = new Set();
  const out = [];
  for (const r of doc.rows || []) {
    if (!want.has(rowKey(r))) continue;
    const k = `${r.coin}|${r.geometry}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ coin: r.coin, geometry: r.geometry });
  }
  return out;
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
  const picked = (doc.picked || []).length;
  if (String(confirm || '') !== doc.id) {
    return { preview: true, id: doc.id, name: doc.name, rows, bytes, picked, confirmWith: doc.id };
  }
  try { fs.unlinkSync(walkFile(id)); } catch (err) { throw new Error(`${doc.id} could not be removed: ${err.message}`); }
  return { deleted: true, id: doc.id, name: doc.name, rows, bytes, picked };
}

module.exports = { V, DIR, walkFile, rowKey, nextId, nextName, saveWalk, listWalks, readWalk, renameWalk, setPicked, pickedUnits, deleteWalk };
