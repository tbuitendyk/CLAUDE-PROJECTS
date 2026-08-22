// ROWS THAT DO NOT HAVE TO FIT IN MEMORY (owner order, 2026-08-22).
//
// A run document used to carry every row it produced, and the whole document
// was rewritten after every unit. Three collections grow without bound:
// one row per unit scored, one per unit scored in full, and — the fatal one —
// one per unit per declared configuration. The owner's wide sweep would have
// produced 413 million of the last kind. Measured at 624 bytes each in memory
// and 611 as JSON, that is 240 GB of objects on a service allowed 1.8 GB of
// heap, and it dies long before that: turning the document into text throws
// past 512 MB, which is about 879,000 rows.
//
// So the rows live in a file per collection per run, appended a line at a
// time, and the document keeps only how many there are. Appending costs the
// same whether the file holds ten rows or ten million, and nothing is ever
// re-serialised.
//
// THE FORMAT is one JSON array per line under a header naming the columns.
// Field names repeat on every row of an object-per-line file and they are the
// bulk of it: the same rows measured 611 bytes as objects and 148 as arrays.
// The header carries the column order, so a file written today can be read by
// code that has since added a column — a row shorter than the header is read
// with the missing columns undefined, exactly as an old object would have been.
//
//   {"v":1,"cols":["trade","pnl","trades"]}
//   ["ETHUSDT",1234.56,88]
//   ["BNBUSDT",-12.5,14]
//
// COLUMNS GROW. These collections do not all have one shape: a unit that
// reached no cell records a reason where a unit that did records money. So a
// row carrying a column the file has not seen writes a NEW header line, and a
// reader takes the last header it passed as the shape of the lines after it.
// The alternative — refusing the row, or dropping the field — is how a record
// quietly stops meaning what its author thought it meant.
//
// A sidecar `.meta.json` holds the row count and the current columns, so
// "how many rows" is a read of forty bytes rather than a walk of ten million
// lines. It is rewritten on every flush and rebuilt by walking the file if it
// is ever missing or behind.
//
// WHAT THIS DOES NOT DO: make an unbounded number of rows fit. It moves the
// limit from 1.8 GB of heap to whatever the disk has, which on this box is
// about fifty times more. The Sweep section says what a run will cost before
// it is launched, because a limit you find out about in hour forty is not a
// limit, it is a loss.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

// One folder per run, beside the run's own file.
function storeDir(runId) {
  return path.join(DATA, 'batches', `${String(runId).replace(/[^A-Za-z0-9._-]+/g, '_')}.rows`);
}
function storeFile(runId, name) {
  return path.join(storeDir(runId), `${String(name).replace(/[^A-Za-z0-9._-]+/g, '_')}.jsonl`);
}

function metaFile(runId, name) {
  return `${storeFile(runId, name)}.meta.json`;
}

function readMeta(runId, name) {
  try { return JSON.parse(fs.readFileSync(metaFile(runId, name), 'utf8')); } catch (_) { return null; }
}

function writeMeta(runId, name, meta) {
  const f = metaFile(runId, name);
  const tmp = `${f}.tmp${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(meta));
    fs.renameSync(tmp, f);
  } catch (_) { /* the rows are the record; the sidecar is an index */ }
}

function exists(runId, name) {
  try { return fs.statSync(storeFile(runId, name)).size > 0; } catch (_) { return false; }
}

// A writer appends and never rewrites. Columns grow as rows need them: a row
// with a column the file has not seen writes a fresh header line first, so the
// field is kept rather than dropped, and a reader walking the file picks up the
// new shape when it passes that line.
function writer(runId, name) {
  const file = storeFile(runId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd = null;
  let buf = [];
  const prev = exists(runId, name) ? (readMeta(runId, name) || rebuildMeta(runId, name)) : null;
  let cols = prev ? prev.cols.slice() : null;
  let count = prev ? prev.rows : 0;

  const open = () => { if (fd === null) fd = fs.openSync(file, 'a'); return fd; };
  const header = () => { buf.push(JSON.stringify({ v: 1, cols })); };

  const api = {
    get count() { return count; },
    get columns() { return cols ? cols.slice() : null; },
    push(obj) {
      const keys = Object.keys(obj);
      if (!cols) { cols = keys.slice(); header(); }
      else {
        const added = keys.filter((k) => !cols.includes(k));
        if (added.length) { cols = cols.concat(added); header(); }
      }
      buf.push(JSON.stringify(cols.map((c) => (obj[c] === undefined ? null : obj[c]))));
      count += 1;
      // Batched because a sweep pushes thousands of rows per unit, and one
      // write syscall per row is the same mistake in a different place.
      if (buf.length >= 512) api.flush();
      return count;
    },
    flush() {
      if (buf.length) {
        fs.writeSync(open(), `${buf.join('\n')}\n`);
        buf = [];
      }
      writeMeta(runId, name, { rows: count, cols: cols || [] });
    },
    close() { api.flush(); if (fd !== null) { fs.closeSync(fd); fd = null; } },
  };
  return api;
}

// WALK the rows without holding them. `fn` gets one object at a time and may
// return false to stop early. This is what makes a ten-million-row collection
// readable at all: nothing but the current line is ever in memory.
function each(runId, name, fn) {
  const file = storeFile(runId, name);
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (_) { return 0; }
  const CHUNK = 1 << 20;
  const buf = Buffer.alloc(CHUNK);
  let rest = '';
  let cols = null;
  let seen = 0;
  let pos = 0;
  const line = (text) => {
    if (!text) return true;
    if (text[0] === '{') {
      try { cols = JSON.parse(text).cols; } catch (_) { /* a torn header ends the file */ }
      return true;
    }
    if (!cols) return true;
    let arr;
    try { arr = JSON.parse(text); } catch (_) { return true; }   // a line that was never finished
    const o = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = arr[i];
    seen++;
    return fn(o, seen - 1) !== false;
  };
  try {
    for (;;) {
      const read = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (read <= 0) break;
      pos += read;
      const text = rest + buf.slice(0, read).toString('utf8');
      const lines = text.split('\n');
      rest = lines.pop();
      for (const l of lines) if (!line(l)) return seen;
    }
    line(rest);
  } finally { try { fs.closeSync(fd); } catch (_) { /* already shut */ } }
  return seen;
}

// The sidecar is an index, not the record. When it is missing or behind, the
// file itself answers — slowly, once — and the sidecar is written back.
function rebuildMeta(runId, name) {
  let rows = 0;
  let cols = [];
  each(runId, name, (o) => { rows++; if (!cols.length) cols = Object.keys(o); });
  const meta = { rows, cols };
  writeMeta(runId, name, meta);
  return meta;
}

function count(runId, name) {
  if (!exists(runId, name)) return 0;
  const m = readMeta(runId, name);
  return m ? m.rows : rebuildMeta(runId, name).rows;
}

// EVERYTHING, as an array. Only for a collection known to be small, or a caller
// that has already decided it can afford it — the point of this file is `each`.
function readAll(runId, name) {
  const out = [];
  each(runId, name, (o) => { out.push(o); });
  return out;
}

// One page, for a screen. Never holds more than `n`.
function page(runId, name, from, n) {
  const out = [];
  const start = Math.max(0, Number(from) || 0);
  const want = Math.max(1, Math.min(5000, Number(n) || 100));
  each(runId, name, (o, i) => {
    if (i < start) return true;
    out.push(o);
    return out.length < want;
  });
  return { from: start, rows: out, total: count(runId, name) };
}

// Bytes on disk, so the cost of a run can be reported rather than discovered.
function bytes(runId) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(storeDir(runId))) {
      try { total += fs.statSync(path.join(storeDir(runId), f)).size; } catch (_) { /* gone */ }
    }
  } catch (_) { /* no store */ }
  return total;
}

function remove(runId) {
  try { fs.rmSync(storeDir(runId), { recursive: true, force: true }); } catch (_) { /* nothing there */ }
}

module.exports = { storeDir, storeFile, writer, each, readAll, page, count, exists, bytes, remove, rebuildMeta };
