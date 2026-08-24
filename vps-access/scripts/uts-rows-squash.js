// uts-rows-squash.js -- ONE-OFF. Turn an interrupted sweep's plainly-written
// rows into the SQUASHED BLOCK form the rows code writes today, so the run can
// be picked up from the interface and finish compressed instead of adding
// another fifty gigabytes of text.
//
// WHY THIS EXISTS. lib/rowstore.js picks a collection's format from which file
// is already there: "a plain one that already exists wins", so a run started
// before squashing goes on appending plain lines for ever. That rule is right —
// it stops a running job's record being rewritten underneath it — and it is
// exactly why an interrupted run cannot be resumed into the new format without
// a deliberate, one-off conversion. This is that conversion.
//
// NOTHING IS RECOMPUTED AND NOTHING IS RE-SERIALISED. Every row is carried
// across as the EXACT bytes it was written as. The squashed form is the same
// text the plain form holds, gzipped a block at a time with the column header
// repeated at the head of each block; so a converted file and a natively
// squashed one are the same thing, and a row's numbers cannot drift, because
// no number is ever turned back into text.
//
// WHAT IS DROPPED, AND ONLY THIS: a line that does not parse. The run died on a
// full disk, and lib/rowstore.js writes with fs.writeSync and discards the
// count -- write(2) is allowed to write fewer bytes than asked and say so, so a
// half-written line can sit at the end of the file, and can sit in the MIDDLE
// of it where a short write was followed by the next flush. Both are already
// skipped by the reader (`a line that was never finished`); this drops them for
// real and COUNTS them, so the loss is a number on the record rather than a
// silence.
//
// THE PLAIN FILE IS NOT REMOVED UNTIL THE SQUASHED ONE HAS BEEN READ BACK and
// found to hold the same number of rows, with the same last row, byte for byte.
// Until that passes, both exist and nothing has been lost.
//
// IT ALSO RECONCILES THE TWO PROMOTE COLLECTIONS. census and replication are
// written in the same callback -- census row first, then that unit's
// replication rows -- but they are buffered separately, so a crash can leave
// census ahead. Resume decides what is already done from CENSUS ALONE, so a
// unit whose census row landed and whose replication rows did not would be
// skipped for ever: a replication table short by a unit, with nothing saying
// so.
//
// HOW FAR THAT CAN HONESTLY BE TAKEN. A replication row does not carry the
// unit's name. It holds trade, ctx1, ctx2, geometry and nullDealSeed; the unit
// is all of those PLUS decision, band and weekdays. So the same five fields
// belong to many different units, and a first version of this check compared
// the set of those five from each file and reported a clean zero on a fixture
// built with four units deliberately missing. A check that cannot fail is
// worse than none, because it reads as an all-clear.
//
// WHAT IS ANSWERABLE EXACTLY, and it is not the five fields. Each promoted unit
// writes ONE replication row per declared configuration, in the same fixed
// order every time, and each carries that configuration's own label. So COUNT
// THE LABELS: if every label has been written the same number of times, that
// number IS the number of units replication holds, no matching required. If the
// file was cut in the middle of a unit, the labels written before the cut have
// exactly one more than those after -- which both names the cut and proves
// where it was. A spread wider than one means something other than a clean cut
// happened, and that is reported rather than averaged away.
//
// The five fields still get walked, as a second, independent read on the same
// question -- but only ever as a FLOOR, and it is said to be one. Taking the
// last census row that carries replication's last five is a guess about which
// unit the cut belongs to, and if that combination happens again later in the
// census the guess lands too late and the answer is short. The label count has
// no such hole, so where the two disagree the label count is the answer.
//
// INTERIOR LOSS is a different question and is answered by counting: a short
// write in the middle glues two lines into one unparseable one, so the number
// of unparseable lines and where they fell is the whole story. One, at the very
// end, means nothing was lost in the middle.
//
// This pass only REPORTS. Removing census rows so the resume redoes those units
// is a separate, named step.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');

const BLOCK_BYTES = 1 << 20;      // same as lib/rowstore.js
const GZIP_LEVEL = 1;             // same as lib/rowstore.js
const READ_CHUNK = 8 << 20;

const say = (s) => { process.stdout.write(`${s}\n`); };
const gb = (n) => `${(n / (1 << 30)).toFixed(2)} GB`;

// A SHORT WRITE IS THE BUG THAT CAUSED THIS. write(2) may write fewer bytes
// than asked and return the count rather than failing, which is how the run
// ended up with torn lines in the first place. Loop until every byte is down,
// and throw if it ever stops making progress.
function writeAll(fd, buf) {
  let off = 0;
  while (off < buf.length) {
    const n = fs.writeSync(fd, buf, off, buf.length - off);
    if (!(n > 0)) throw new Error(`write stalled with ${buf.length - off} bytes left`);
    off += n;
  }
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try { writeAll(fd, Buffer.from(text, 'utf8')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// Walk a plain rows file a line at a time without holding it. `onHeader` gets
// each column header as it is passed; `onRow` gets the raw line text and the
// parsed array. Returns what it found.
function walkPlain(file, onHeader, onRow) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(READ_CHUNK);
  const dec = new StringDecoder('utf8');
  let rest = '';
  let pos = 0;
  let rows = 0;
  let torn = 0;
  let headers = 0;
  const tornAfter = [];              // how many good rows preceded each bad line
  const bad = () => { torn++; if (tornAfter.length < 40) tornAfter.push(rows); };
  const line = (text) => {
    if (!text) return;
    if (text.charCodeAt(0) === 123 /* { */) {
      let h;
      try { h = JSON.parse(text); } catch (_) { bad(); return; }
      if (!h || !Array.isArray(h.cols)) { bad(); return; }
      headers++;
      onHeader(text, h.cols);
      return;
    }
    let arr;
    try { arr = JSON.parse(text); } catch (_) { bad(); return; }
    if (!Array.isArray(arr)) { bad(); return; }
    rows++;
    onRow(text, arr);
  };
  try {
    for (;;) {
      const read = fs.readSync(fd, buf, 0, READ_CHUNK, pos);
      if (read <= 0) break;
      pos += read;
      const text = rest + dec.write(buf.slice(0, read));
      const parts = text.split('\n');
      rest = parts.pop();
      for (const l of parts) line(l);
    }
    rest += dec.end();
    line(rest);
  } finally { try { fs.closeSync(fd); } catch (_) { /* already shut */ } }
  return { rows, torn, tornAfter, headers, bytes: pos };
}

// PLAIN -> SQUASHED BLOCKS. `tap(cols, arr)` sees every row that is carried
// across, so the caller can reconcile without a second walk of the file.
function squash(dir, name, tap) {
  const plain = path.join(dir, `${name}.jsonl`);
  const gzf = `${plain}.gz`;
  const metaf = `${gzf}.meta.json`;
  if (!fs.existsSync(plain)) return null;
  const srcBytes = fs.statSync(plain).size;
  say(`\n${name}: ${gb(srcBytes)} plain`);

  // A HALF-DONE CONVERSION IS STARTED AGAIN, NOT CONTINUED. Blocks have to sit
  // one after another with an index that matches; picking up in the middle of
  // one is how an index quietly stops pointing at the rows it names. The plain
  // file is still there, so starting again costs time and nothing else.
  for (const f of [gzf, metaf]) { try { fs.unlinkSync(f); } catch (_) { /* not there */ } }

  const out = fs.openSync(gzf, 'w');
  let curHeader = null;
  let cols = null;
  let idx = null;                 // column positions, recomputed when cols change
  let pendingHeader = false;
  let block = [];
  let blockBytes = 0;
  let blocks = [];
  let offset = 0;
  let rowsOut = 0;
  let blockFirstRow = 0;
  let lastLine = null;
  let ticked = 0;

  const flushBlock = () => {
    if (!block.length) return;
    const packed = zlib.gzipSync(Buffer.from(`${block.join('\n')}\n`, 'utf8'), { level: GZIP_LEVEL });
    writeAll(out, packed);
    blocks.push({ at: offset, bytes: packed.length, firstRow: blockFirstRow, rows: rowsOut - blockFirstRow });
    offset += packed.length;
    blockFirstRow = rowsOut;
    block = [];
    blockBytes = 0;
    pendingHeader = true;         // every block stands on its own
  };

  const found = walkPlain(plain,
    (text, c) => { curHeader = text; cols = c; idx = null; pendingHeader = true; },
    (text, arr) => {
      if (!curHeader) return;     // rows before any header have no shape
      if (pendingHeader) { block.push(curHeader); blockBytes += curHeader.length + 1; pendingHeader = false; }
      block.push(text);
      blockBytes += text.length + 1;
      rowsOut++;
      lastLine = text;
      if (tap) {
        if (!idx) { idx = {}; for (let i = 0; i < cols.length; i++) idx[cols[i]] = i; }
        tap(idx, arr);
      }
      if (blockBytes >= BLOCK_BYTES) flushBlock();
      if (rowsOut - ticked >= 2000000) { ticked = rowsOut; say(`  ...${rowsOut.toLocaleString()} rows, ${gb(offset)} written`); }
    });
  flushBlock();
  try { fs.fsyncSync(out); } finally { fs.closeSync(out); }
  atomicWrite(metaf, JSON.stringify({ rows: rowsOut, cols: cols || [], squashed: true, blocks }));

  const gzBytes = fs.statSync(gzf).size;
  say(`  ${found.rows.toLocaleString()} rows in, ${rowsOut.toLocaleString()} out, `
    + `${found.torn} unparseable line(s) dropped, ${found.headers} header(s)`);
  if (found.torn) {
    const tail = found.tornAfter.filter((n) => n >= rowsOut).length;
    say(`  unparseable after row(s): ${found.tornAfter.join(', ')}${found.torn > found.tornAfter.length ? ', ...' : ''}`
      + `  -- ${tail} of them at the very end, ${found.torn - tail} in the middle`);
  }
  say(`  ${gb(srcBytes)} -> ${gb(gzBytes)} in ${blocks.length.toLocaleString()} blocks `
    + `(${(100 * gzBytes / Math.max(1, srcBytes)).toFixed(1)}% of plain)`);
  return { plain, gzf, metaf, srcBytes, gzBytes, rowsOut, torn: found.torn, tornAfter: found.tornAfter, lastLine, cols };
}

// READ THE SQUASHED FILE BACK the way lib/rowstore.js reads it -- through the
// block index, one block unpacked at a time -- and check it says the same
// thing. Nothing is removed until this passes.
function verify(res, name) {
  const meta = JSON.parse(fs.readFileSync(res.metaf, 'utf8'));
  const fd = fs.openSync(res.gzf, 'r');
  let seen = 0;
  let last = null;
  let cols = null;
  try {
    for (const b of meta.blocks) {
      const buf = Buffer.alloc(b.bytes);
      let got = 0;
      while (got < b.bytes) {
        const n = fs.readSync(fd, buf, got, b.bytes - got, b.at + got);
        if (n <= 0) break;
        got += n;
      }
      if (got !== b.bytes) throw new Error(`block at ${b.at} is short: ${got}/${b.bytes}`);
      const text = zlib.gunzipSync(buf).toString('utf8');
      let firstOfBlock = true;
      for (const line of text.split('\n')) {
        if (!line) continue;
        if (line.charCodeAt(0) === 123) { cols = JSON.parse(line).cols; firstOfBlock = false; continue; }
        if (firstOfBlock) throw new Error(`block at ${b.at} does not start with a header`);
        if (!cols) throw new Error(`rows before any header in the block at ${b.at}`);
        JSON.parse(line);
        seen++;
        last = line;
      }
      if (seen !== b.firstRow + b.rows) {
        throw new Error(`block at ${b.at} says rows ${b.firstRow}..${b.firstRow + b.rows} but the count reached ${seen}`);
      }
    }
  } finally { try { fs.closeSync(fd); } catch (_) { /* already shut */ } }
  if (seen !== res.rowsOut) throw new Error(`${name}: wrote ${res.rowsOut} rows, read back ${seen}`);
  if (last !== res.lastLine) throw new Error(`${name}: the last row read back is not the last row written`);
  say(`  read back through the block index: ${seen.toLocaleString()} rows, last row identical`);
  return true;
}

function main() {
  const D = process.env.UTS_DATA || '/opt/ultimate-trading-system/data';
  const batches = path.join(D, 'batches');
  const runDirs = fs.readdirSync(batches).filter((f) => f.endsWith('.rows'));
  if (runDirs.length !== 1) { say(`expected exactly one row store, found ${runDirs.length}: ${runDirs.join(', ')}`); process.exit(1); }
  const dir = path.join(batches, runDirs[0]);
  const runId = runDirs[0].replace(/\.rows$/, '');
  const docFile = path.join(batches, `${runId}.json`);
  const doc = JSON.parse(fs.readFileSync(docFile, 'utf8'));
  say(`run  ${runId}`);
  say(`     status "${doc.status}", phase "${(doc.perf || {}).phase || '?'}"`);
  // NEVER OVER A LIVE RUN. Rewriting the record of a job that is writing it is
  // the one thing this must not do.
  if (doc.status === 'running') { say('this run is going right now -- refusing to touch its rows'); process.exit(1); }

  // ROOM TO LAND. The squashed twin is written BESIDE the plain file, so both
  // are on disk until the check passes -- that is the whole safety of this --
  // and the box is the one that just ran out of space. Measured, not assumed.
  const free = (() => {
    try { const s = fs.statfsSync('/'); return s.bavail * s.bsize; } catch (_) { return null; }
  })();
  let plainTotal = 0;
  for (const f of fs.readdirSync(dir)) { try { plainTotal += fs.statSync(path.join(dir, f)).size; } catch (_) { /* gone */ } }
  say(`     ${gb(plainTotal)} of rows on disk before`);
  if (free != null) {
    // Half the plain size is a generous ceiling: measured on rows of this shape
    // the squashed form is about a quarter of the text.
    const need = plainTotal / 2;
    say(`     ${gb(free)} free, and the squashed twin should need under ${gb(need)}`);
    if (free < need) { say(`REFUSING: ${gb(free)} free is not enough room to write the squashed copy beside the plain one`); process.exit(1); }
  } else {
    say('     could not read how much disk is free -- carrying on, and the write will fail loudly if there is none');
  }
  say(`     started ${new Date().toISOString()}`);

  // The five fields a replication row and a census row both carry. NOT a unit
  // name -- see the header. Enough to find where replication stops, and no more.
  const unitOf = (idx, arr) => [
    arr[idx.trade], arr[idx.ctx1] ?? '', arr[idx.ctx2] ?? '',
    arr[idx.geometry], arr[idx.nullDealSeed] == null ? 'real' : `n${arr[idx.nullDealSeed]}`,
  ].join('|');
  let repLastUnit = null;
  let repRows = 0;
  // ONE COUNT PER DECLARED CONFIGURATION -- the exact instrument, above.
  const repLabels = new Map();
  let labelOrder = [];

  const done = {};
  for (const name of ['slim', 'census', 'replication']) {
    const tap = name === 'replication'
      ? (idx, arr) => {
        repLastUnit = unitOf(idx, arr);
        repRows++;
        const lab = idx.declaredLabel != null ? String(arr[idx.declaredLabel]) : '(unlabelled)';
        if (!repLabels.has(lab)) { repLabels.set(lab, 0); labelOrder.push(lab); }
        repLabels.set(lab, repLabels.get(lab) + 1);
      }
      : null;
    const res = squash(dir, name, tap);
    if (!res) { say(`\n${name}: no plain file -- nothing to convert`); continue; }
    verify(res, name);
    done[name] = res;
  }

  // CENSUS AGAINST REPLICATION -- see the header for what this can and cannot
  // answer. Walked from the squashed census, in order, so the answer is about
  // what the resume will actually read.
  if (done.census && done.replication) {
    say('\ncensus against replication');
    const rows = [];                    // {unit, key, noCell} in file order
    const meta = JSON.parse(fs.readFileSync(done.census.metaf, 'utf8'));
    const fd = fs.openSync(done.census.gzf, 'r');
    let cols = null;
    let idx = null;
    try {
      for (const b of meta.blocks) {
        const buf = Buffer.alloc(b.bytes);
        fs.readSync(fd, buf, 0, b.bytes, b.at);
        for (const line of zlib.gunzipSync(buf).toString('utf8').split('\n')) {
          if (!line) continue;
          if (line.charCodeAt(0) === 123) { cols = JSON.parse(line).cols; idx = null; continue; }
          const arr = JSON.parse(line);
          if (!idx) { idx = {}; for (let i = 0; i < cols.length; i++) idx[cols[i]] = i; }
          rows.push({
            unit: unitOf(idx, arr),
            key: idx.key != null ? arr[idx.key] : null,
            noCell: idx.noCell != null && arr[idx.noCell] != null,
          });
        }
      }
    } finally { try { fs.closeSync(fd); } catch (_) { /* already shut */ } }
    const noCellRows = rows.filter((r) => r.noCell).length;
    const withCell = rows.length - noCellRows;
    say(`  ${rows.length.toLocaleString()} census rows (${noCellRows} reached no cell, so none are expected for those)`);
    say(`  ${repRows.toLocaleString()} replication rows, ending on ${repLastUnit}`);

    // THE LABEL COUNT. See the header: this is the one that can be trusted.
    const counts = labelOrder.map((l) => repLabels.get(l));
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    let repUnits = null;
    let partial = 0;
    say(`  ${labelOrder.length.toLocaleString()} declared configuration label(s); each written between ${lo} and ${hi} times`);
    if (hi - lo === 0) {
      repUnits = hi; partial = 0;
      say(`  every label written the same number of times -> replication holds ${repUnits.toLocaleString()} whole units, none half-written`);
    } else if (hi - lo === 1) {
      repUnits = lo; partial = 1;
      say(`  ${counts.filter((c) => c === hi).length} label(s) written once more than the rest -> `
        + `${repUnits.toLocaleString()} whole units and one cut in the middle`);
    } else {
      say(`  the labels differ by ${hi - lo}, which a clean cut cannot produce. `
        + 'Not using this count; see the floor below and treat the tail as unknown.');
    }
    // WHETHER A NO-CELL UNIT WRITES REPLICATION ROWS IS NOT ASSUMED. In the
    // sweep the declared cell is scored on its own footing, so a unit that
    // reached no cell of its own may still have written its declared rows.
    // Both readings are printed and the arithmetic decides: only one of them
    // can come out at or above zero, and if both do the answer is between them.
    let gapAll = null;
    let gapWithCell = null;
    if (repUnits != null) {
      const reached = repUnits + partial;
      gapAll = rows.length - reached;
      gapWithCell = withCell - reached;
      say(`  replication reached ${reached.toLocaleString()} census row(s)`
        + `${partial ? ' (the last one only part-written)' : ''}`);
      say(`  reading A -- every census row should own replication rows: ${gapAll} own none`);
      say(`  reading B -- the ${noCellRows} no-cell rows should not:      ${gapWithCell} own none`);
      if (gapAll >= 0 && gapWithCell < 0) say('  only A can be true, so census row i and replication unit i are the same unit');
      else if (gapWithCell >= 0 && gapAll < 0) say('  only B can be true, so the no-cell rows sit outside the count');
      else if (gapAll >= 0 && gapWithCell >= 0) say(`  both can be true: between ${Math.min(gapAll, gapWithCell)} and ${Math.max(gapAll, gapWithCell)} own none`);
      else say('  NEITHER can be true -- replication holds more units than census has rows, which needs looking at by hand');
    }

    // The last census row that could own replication's last row.
    let cut = -1;
    for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].unit === repLastUnit) { cut = i; break; } }
    let past = [];
    if (cut < 0) {
      say('  NO census row carries replication\'s last five fields at all. That should be'
        + ' impossible, and it means these two files cannot be lined up here.');
    } else {
      // The matching row itself is the unit the file was cut inside, so it goes
      // too: its replication rows may be a fraction of what it should have.
      past = rows.slice(cut).filter((r) => !r.noCell);
      say(`  cross-check on the five shared fields: the last census row carrying them is #${cut} of ${rows.length},`);
      say(`  putting the boundary at AT LEAST ${past.length} row(s) -- a floor only, and short if that`);
      say('  combination of five happens again later in the census');
      for (const r of past.slice(0, 12)) say(`    ${r.key || '(no key)'}`);
      if (past.length > 12) say(`    ...and ${past.length - 12} more`);
    }
    const interior = {};
    for (const [name, res] of Object.entries(done)) {
      interior[name] = { torn: res.torn, tornAfterRows: res.tornAfter };
    }
    say(`  unparseable lines: ${Object.entries(interior).map(([k, v]) => `${k} ${v.torn}`).join(', ')}`);

    atomicWrite(path.join(dir, 'squash-report.json'), JSON.stringify({
      at: new Date().toISOString(), runId,
      collections: Object.fromEntries(Object.entries(done).map(([k, v]) => [k, {
        plainBytes: v.srcBytes, squashedBytes: v.gzBytes, rows: v.rowsOut,
        tornLinesDropped: v.torn, tornAfterRows: v.tornAfter,
      }])),
      censusRows: rows.length,
      censusNoCellRows: noCellRows,
      replicationRows: repRows,
      replicationLastUnit: repLastUnit,
      censusRowIndexOfLastMatch: cut,
      censusRowsWithCell: withCell,
      declaredLabels: labelOrder.length,
      declaredLabelCountLow: lo,
      declaredLabelCountHigh: hi,
      replicationWholeUnits: repUnits,
      replicationPartialUnits: partial,
      gapIfEveryCensusRowOwnsReplicationRows: gapAll,
      gapIfNoCellRowsOwnNone: gapWithCell,
      // NOTHING IS ACTED ON HERE. These are the keys the five-field floor puts
      // past the boundary, written down so a separate, named step can drop
      // exactly these and nothing else -- once a human has read the two
      // readings above and said which one is the truth.
      censusKeysPastTheFloor: past.map((r) => r.key),
      // Every census key in file order, so that step can take the last N
      // without walking fifty gigabytes again.
      censusKeysInOrder: rows.map((r) => r.key),
    }, null, 2));
    say(`  written: ${path.join(dir, 'squash-report.json')}`);
  }

  // ONLY NOW. Every plain file that has a verified squashed twin is removed --
  // and only after two last looks, because the gap between reading a file and
  // deleting it is the one moment a resume pressed on the screen could put rows
  // into the copy about to be thrown away.
  const nowDoc = JSON.parse(fs.readFileSync(docFile, 'utf8'));
  if (nowDoc.status === 'running') {
    say(`\nSTOPPING SHORT: the run went to "running" while this was working. The squashed`);
    say('copies are written and checked, but the plain files are being LEFT ALONE, because');
    say('a run that started since then may have appended to them. Nothing is lost: stop the');
    say('run and start this again.');
    process.exit(1);
  }
  for (const [name, res] of Object.entries(done)) {
    const nowBytes = fs.statSync(res.plain).size;
    if (nowBytes !== res.srcBytes) {
      say(`\nSTOPPING SHORT: ${name}.jsonl was ${res.srcBytes} bytes when it was read and is `
        + `${nowBytes} now, so something wrote to it. Leaving every plain file where it is.`);
      process.exit(1);
    }
  }
  say('\nremoving the plain files that have been read back and checked');
  for (const [name, res] of Object.entries(done)) {
    fs.unlinkSync(res.plain);
    try { fs.unlinkSync(`${res.plain}.meta.json`); } catch (_) { /* there was none */ }
    say(`  ${name}: removed ${gb(res.srcBytes)} of plain text`);
  }
  let afterTotal = 0;
  for (const f of fs.readdirSync(dir)) { try { afterTotal += fs.statSync(path.join(dir, f)).size; } catch (_) { /* gone */ } }
  say(`\n${gb(plainTotal)} -> ${gb(afterTotal)}`);
  say(`finished ${new Date().toISOString()}`);
}

// A CONVERSION THAT DIES LEAVES NOTHING BEHIND BUT THE ORIGINAL. The plain
// files are only removed at the very end, so any failure before that point is
// recoverable -- but a half-written squashed file would sit there eating the
// space the next attempt needs, and would be mistaken for a finished one by
// lib/rowstore.js, which picks its format by which file exists. Clear it.
try {
  main();
} catch (err) {
  say(`\nFAILED: ${err && err.stack ? err.stack : err}`);
  try {
    const D = process.env.UTS_DATA || '/opt/ultimate-trading-system/data';
    const batches = path.join(D, 'batches');
    for (const d of fs.readdirSync(batches).filter((f) => f.endsWith('.rows'))) {
      for (const name of ['slim', 'census', 'replication']) {
        const plain = path.join(batches, d, `${name}.jsonl`);
        const gzf = `${plain}.gz`;
        // Only where the plain file is still the record. A collection already
        // converted and checked has no plain file and must not be touched.
        if (fs.existsSync(plain) && fs.existsSync(gzf)) {
          const n = fs.statSync(gzf).size;
          fs.unlinkSync(gzf);
          try { fs.unlinkSync(`${gzf}.meta.json`); } catch (_) { /* none written yet */ }
          say(`  cleared a half-written ${name}.jsonl.gz (${gb(n)}); ${name}.jsonl is untouched`);
        }
      }
    }
  } catch (e2) { say(`  and the clean-up itself failed: ${e2.message}`); }
  process.exit(1);
}
