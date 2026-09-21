// fieldset.js -- THE DECISION FIELD'S SETS ON DISK (FIELD-DESIGN.md section
// E; owner LOOP NOW! 2026-09-21). Modelled on lib/walkset.js, the walk's
// store, because a built field is the same kind of thing a walk set is: hours
// of compute the owner names, opens, renames and deletes from the screen.
//
// A set is `data/fields/F-3.json`: one document, written temp-and-rename,
// holding the dials it was built under, the cap it was held to, and one
// record per coin and chunk shape -- the per-day series (columns, so a pair
// of two thousand days is a few kilobytes of numbers and not two thousand
// objects), the state at the last day, the grid, and the two counts at fill.
//
// A BUILD WRITES ITSELF DOWN AS IT GOES. The part `data/fields/parts/F-3.jsonl`
// takes the head line at the start and one line per pair the moment it
// lands, so a restart costs the pairs in flight and nothing else; the part
// becomes a set only when every pair has landed, and a stopped build is not
// a set but is not thrown away either -- pressing again runs what is missing.
//
// THE LIST IS CHEAP: one parse per file, memoised on mtime and size, exactly
// as the walk's is.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'fields');
const PARTS = path.join(DIR, 'parts');
const V = 1;

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) { /* already there */ } }
function ensureParts() { try { fs.mkdirSync(PARTS, { recursive: true }); } catch (_) { /* already there */ } }
const clean = (id) => String(id).replace(/[^\w.-]/g, '');
const setFile = (id) => path.join(DIR, `${clean(id)}.json`);
const partFile = (id) => path.join(PARTS, `${clean(id)}.jsonl`);
// a set is `F-3.json` and nothing else: one dot in the name, no second extension
const isSetFile = (f) => f.endsWith('.json') && !f.slice(0, -'.json'.length).includes('.');
function idsOnDisk() {
  try { return fs.readdirSync(DIR).filter(isSetFile).map((f) => f.replace(/\.json$/, '')); } catch (_) { return []; }
}
// F-1, F-2, ... never reusing a number a file still holds
function nextId() {
  const taken = new Set(idsOnDisk());
  for (let n = 1; ; n++) { const id = `F-${n}`; if (!taken.has(id)) return id; }
}
function nextName() {
  const names = new Set(listFields().map((w) => String(w.name || '').toLowerCase()));
  for (let n = 1; ; n++) { const nm = `field ${n}`; if (!names.has(nm)) return nm; }
}
// one key per coin and chunk shape, the one every reader joins on
const pairKey = (coin, geometry) => `${String(coin).toUpperCase()}|${geometry}`;

function readField(id) {
  try {
    const doc = JSON.parse(fs.readFileSync(setFile(id), 'utf8'));
    if (!doc || doc.v !== V) return null;
    return doc;
  } catch (_) { return null; }
}

// ---- the brief cache, one parse per file ----------------------------------
const brief = new Map();
function statOf(id) { try { return fs.statSync(setFile(id)); } catch (_) { return null; } }
// WHAT THE LIST AND THE STATUS SAY ABOUT A PAIR without the days: the state
// at the last day, the fill, the range. The grid and the series stay on disk
// until one pair is asked for by name.
function pairBrief(p) {
  return {
    key: p.key, coin: p.coin, geometry: p.geometry, standsFor: p.standsFor || [],
    decisions: p.decisions, firstTs: p.firstTs, lastTs: p.lastTs,
    windowDays: p.windowDays, capDays: p.capDays ?? null,
    fullAt: p.fullAt, now: p.now || null, state: p.state || null, range: p.range || null,
    error: p.error || null,
  };
}
function headOf(doc, bytes) {
  return {
    id: doc.id, name: doc.name, release: doc.release, bytes,
    startedAt: doc.startedAt, finishedAt: doc.finishedAt,
    pairs: Array.isArray(doc.pairs) ? doc.pairs.length : 0,
    dials: doc.dials || null, cap: doc.cap || null, asked: doc.asked || null,
    collapse: doc.collapse || null,
    briefs: Array.isArray(doc.pairs) ? doc.pairs.map(pairBrief) : [],
  };
}
function briefOf(id) {
  const st = statOf(id);
  if (!st) { brief.delete(id); return null; }
  const had = brief.get(id);
  if (had && had.mtimeMs === st.mtimeMs && had.size === st.size) return had;
  const doc = readField(id);
  const made = doc
    ? { mtimeMs: st.mtimeMs, size: st.size, head: headOf(doc, st.size) }
    : { mtimeMs: st.mtimeMs, size: st.size, head: { id, name: id, broken: true, bytes: st.size } };
  brief.set(id, made);
  return made;
}
function keepBrief(doc) {
  const st = statOf(doc.id);
  if (!st) { brief.delete(doc.id); return; }
  brief.set(doc.id, { mtimeMs: st.mtimeMs, size: st.size, head: headOf(doc, st.size) });
}
function forgetBrief(id) { brief.delete(id); }

// every set on the box, newest finished first, without their series
function listFields() {
  const out = [];
  for (const id of idsOnDisk()) {
    const b = briefOf(id);
    if (!b) continue;
    out.push(b.head);
  }
  out.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  return out;
}

// ---- parts: written as the build goes -------------------------------------
function startPart(id, head) {
  ensureParts();
  fs.writeFileSync(partFile(id), `${JSON.stringify({ part: 1, ...head })}\n`);
  return id;
}
function appendPart(id, pairs) {
  if (!pairs || !pairs.length) return 0;
  ensureParts();
  fs.appendFileSync(partFile(id), `${pairs.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return pairs.length;
}
// a torn last line is a pair not yet done, never guessed at
function readPart(id) {
  let raw = '';
  try { raw = fs.readFileSync(partFile(id), 'utf8'); } catch (_) { return null; }
  const lines = raw.split('\n').filter(Boolean);
  if (!lines.length) return null;
  let head = null;
  try { head = JSON.parse(lines[0]); } catch (_) { return null; }
  if (!head || head.part !== 1) return null;
  const pairs = [];
  for (let i = 1; i < lines.length; i++) {
    try { pairs.push(JSON.parse(lines[i])); } catch (_) { /* torn */ }
  }
  return { head, pairs };
}
function removePart(id) { try { fs.rmSync(partFile(id), { force: true }); } catch (_) { /* gone */ } }
function partKeys(id) {
  const got = readPart(id);
  return got ? new Set(got.pairs.map((p) => p.key)) : new Set();
}
// every build that started and did not finish: a part with no set beside it
function unfinishedFields() {
  let files = [];
  try { files = fs.readdirSync(PARTS).filter((f) => f.endsWith('.jsonl')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    const sealed = briefOf(id);
    if (sealed && !sealed.head.broken) continue;
    const got = readPart(id);
    if (!got) continue;
    let bytes = 0;
    try { bytes = fs.statSync(partFile(id)).size; } catch (_) { bytes = 0; }
    out.push({
      id, name: got.head.name || id, startedAt: got.head.startedAt || null,
      pairs: got.pairs.length, of: got.head.of ?? null, bytes, asked: got.head.asked || null, release: got.head.release || null,
    });
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return out;
}
// the part becomes a set, only when the caller says every pair landed
function sealPart(id, { finishedAt, name } = {}) {
  const got = readPart(id);
  if (!got) throw new Error(`field ${JSON.stringify(String(id))} has nothing saved to seal`);
  const out = saveFieldAs(id, {
    asked: got.head.asked, dials: got.head.dials, cap: got.head.cap, collapse: got.head.collapse,
    pairs: got.pairs, startedAt: got.head.startedAt, finishedAt: finishedAt || Date.now(), name: name || got.head.name,
  });
  removePart(id);
  return out;
}

// ---- the set itself ---------------------------------------------------------
function saveField(args) { return saveFieldAs(nextId(), args); }
function saveFieldAs(id, { asked, dials, cap, collapse, pairs, startedAt, finishedAt, name }) {
  ensureDir();
  const doc = {
    v: V,
    id,
    name: String(name || '').trim() || nextName(),
    release: require('../package.json').version,
    startedAt: startedAt || null,
    finishedAt: finishedAt || Date.now(),
    asked: asked || null,
    dials: dials || null,
    cap: cap || null,
    collapse: collapse || null,
    pairs: (pairs || []).slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
  const tmp = `${setFile(id)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  fs.renameSync(tmp, setFile(id));
  keepBrief(doc);
  let bytes = 0;
  try { bytes = fs.statSync(setFile(id)).size; } catch (_) { bytes = 0; }
  return { id: doc.id, name: doc.name, pairs: doc.pairs.length, bytes };
}
function writeBack(doc) {
  ensureDir();
  const tmp = `${setFile(doc.id)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  fs.renameSync(tmp, setFile(doc.id));
  keepBrief(doc);
}
function renameField(id, name) {
  const doc = readField(id);
  if (!doc) throw new Error(`there is no field ${JSON.stringify(String(id))} on this box`);
  const nm = String(name || '').trim();
  if (!nm) throw new Error('a field needs a name');
  if (nm.length > 80) throw new Error('a name is 80 characters or fewer');
  const clash = listFields().find((w) => w.id !== doc.id && String(w.name).toLowerCase() === nm.toLowerCase());
  if (clash) throw new Error(`${JSON.stringify(nm)} is already the name of ${clash.id}`);
  doc.name = nm;
  writeBack(doc);
  return { id: doc.id, name: doc.name };
}
// two steps, as a walk set and a record set: the first press says what would
// go, and only the set's own id typed back does it
function deleteField(id, confirm) {
  const doc = readField(id);
  if (!doc) throw new Error(`there is no field ${JSON.stringify(String(id))} on this box`);
  let bytes = 0;
  try { bytes = fs.statSync(setFile(id)).size; } catch (_) { bytes = 0; }
  const pairs = (doc.pairs || []).length;
  if (String(confirm || '') !== doc.id) {
    return { preview: true, id: doc.id, name: doc.name, pairs, bytes, confirmWith: doc.id };
  }
  try { fs.unlinkSync(setFile(id)); } catch (err) { throw new Error(`${doc.id} could not be removed: ${err.message}`); }
  forgetBrief(id);
  return { deleted: true, id: doc.id, name: doc.name, pairs, bytes };
}

// ---- reading one pair ---------------------------------------------------------
// the record that covers a coin and chunk shape: built for it, or built for
// the shape that stands for it (one field per forward time, as the walk)
function pairFor(doc, coin, geometry) {
  if (!doc || !Array.isArray(doc.pairs)) return null;
  const want = pairKey(coin, geometry);
  const direct = doc.pairs.find((p) => p.key === want);
  if (direct) return direct;
  const up = String(coin).toUpperCase();
  return doc.pairs.find((p) => p.coin === up && Array.isArray(p.standsFor) && p.standsFor.includes(geometry)) || null;
}
// the per-day series as objects, for readAt and the screen
function daysOf(pair) {
  const c = pair && pair.days;
  if (!c || !Array.isArray(c.ts)) return [];
  const out = new Array(c.ts.length);
  for (let i = 0; i < c.ts.length; i++) {
    out[i] = {
      ts: c.ts[i], sign: c.sign[i], agreement: c.agreement[i], size: c.size[i],
      certainty: c.certainty ? c.certainty[i] : null, speaking: c.speaking[i], evidence: c.evidence[i], full: !!c.full[i],
    };
  }
  return out;
}

module.exports = {
  DIR, PARTS, V, setFile, partFile, pairKey,
  nextId, nextName, readField, listFields, saveField, saveFieldAs, renameField, deleteField,
  startPart, appendPart, readPart, removePart, partKeys, unfinishedFields, sealPart,
  pairFor, daysOf, pairBrief, forgetBrief,
};
