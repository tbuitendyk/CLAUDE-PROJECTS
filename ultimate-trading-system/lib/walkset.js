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
// MANY ROWS IN ONE ASK (3.178.0). Tick every row shown can tick thousands, and
// one request each would be thousands of reads and thousands of writes of a
// file that runs to tens of megabytes. One ask reads the set once, checks every
// key against it, and writes once. setPicked is the same thing for one row, so
// there is one implementation and not two that can drift.
function setPickedMany(id, keys, on) {
  const doc = readWalk(id);
  if (!doc) throw new Error(`there is no walk ${JSON.stringify(id)} on this box`);
  if (typeof on !== 'boolean') throw new Error(`a row is picked or not — not ${JSON.stringify(on)}`);
  const want = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k || ''));
  if (!want.length) throw new Error('no row was named');
  const mine = new Set((doc.rows || []).map(rowKey));
  // EVERY KEY IS CHECKED BEFORE ANY IS WRITTEN. Half a list applied and the
  // rest refused leaves the owner unable to say what happened.
  const strangers = want.filter((k) => !mine.has(k));
  if (strangers.length) {
    throw new Error(`${JSON.stringify(strangers[0])} is not a row of ${doc.id}${strangers.length > 1 ? ` (and ${strangers.length - 1} other(s))` : ''}`);
  }
  const have = new Set(doc.picked || []);
  for (const k of want) { if (on) have.add(k); else have.delete(k); }
  doc.picked = [...have].sort();
  writeBack(doc);
  return { id: doc.id, picked: doc.picked.length, changed: want.length };
}
function setPicked(id, key, on) { return setPickedMany(id, [key], on); }

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

// PROMOTED AND TICKED ARE TWO DIFFERENT THINGS (3.170.0, owner order
// 2026-09-18: "select records that look promising, bring them up into that set
// at the top ... and just select the ones we want").
//
// `picked` is promoted -- the owner said this row is worth carrying. `off` is
// which of those are not to run just now. A promoted row is TICKED until it is
// unticked, the same way a passer is, so promoting something does not then
// require a second press to use it.
function setRowOff(id, key, off) {
  const doc = readWalk(id);
  if (!doc) throw new Error(`there is no walk ${JSON.stringify(id)} on this box`);
  if (typeof off !== 'boolean') throw new Error(`a row is ticked or not — not ${JSON.stringify(off)}`);
  const k = String(key || '');
  if (!(doc.picked || []).includes(k)) throw new Error(`${JSON.stringify(k)} is not promoted from ${doc.id}`);
  const have = new Set(doc.off || []);
  if (off) have.add(k); else have.delete(k);
  doc.off = [...have].sort();
  writeBack(doc);
  return { id: doc.id, off: doc.off.length };
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
    const doc = readWalk(head.id);
    if (!doc || !(doc.picked || []).length) continue;
    const want = new Set(doc.picked);
    const off = new Set(doc.off || []);
    const rows = [];
    for (const r of doc.rows || []) {
      const k = rowKey(r);
      if (!want.has(k)) continue;
      rows.push({
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
        ticked: !off.has(k),
      });
    }
    if (rows.length) out.push({ id: doc.id, name: doc.name, release: doc.release, finishedAt: doc.finishedAt, rows });
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
  const picked = (doc.picked || []).length;
  if (String(confirm || '') !== doc.id) {
    return { preview: true, id: doc.id, name: doc.name, rows, bytes, picked, confirmWith: doc.id };
  }
  try { fs.unlinkSync(walkFile(id)); } catch (err) { throw new Error(`${doc.id} could not be removed: ${err.message}`); }
  return { deleted: true, id: doc.id, name: doc.name, rows, bytes, picked };
}

module.exports = {
  V, DIR, walkFile, rowKey, nextId, nextName, saveWalk, listWalks, readWalk, renameWalk,
  setPicked, setPickedMany, setRowOff, pickedUnits, promoted, promotedUnits, promotedLeans, deleteWalk,
};
