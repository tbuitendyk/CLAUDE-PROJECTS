// uts-rows-squash-test.js -- proves uts-rows-squash.js against the REAL
// lib/rowstore.js before it is allowed near fifty-five gigabytes of the owner's
// only copy of a day and a half of computing.
//
// It builds row files shaped like the interrupted sweep's -- nested objects,
// about a kilobyte a row, several rows per unit, two column shapes in the
// census -- and damages them the way a full disk does: a half line at the end
// of two files, and a short write in the MIDDLE of a third that glues two lines
// into one. Then it converts, and checks through lib/rowstore.js itself that
// every readable row comes back identical and in order, that pages line up at
// the start, deep inside, at the end and past it, that a resumed writer picks
// the file up at the right count and can append to it -- including a row
// carrying a column the file has never seen -- and that the reconciliation
// reports the damage instead of an all-clear.
//
//   node uts-rows-squash-test.js <scratch dir> <path to uts-rows-squash.js>
//
// UTS_ROOT names the trading system checkout; CHOP how many bytes to tear off
// the end of the replication fixture, and WANT_REDO what that should cost.
const fs = require('fs'), path = require('path'), assert = require('assert'), zlib = require('zlib');
const ROOT = process.env.UTS_ROOT || '/opt/ultimate-trading-system';
const TMP = process.argv[2];
fs.rmSync(TMP, { recursive: true, force: true });

// rowstore hangs its DATA off __dirname/../data, so give it a fake project.
const proj = path.join(TMP, 'proj');
fs.mkdirSync(path.join(proj, 'lib'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'lib/rowstore.js'), path.join(proj, 'lib/rowstore.js'));
const DATA = path.join(proj, 'data');
const runId = 'bracketlab-20260822-205820-null20-census-declared-trail';
const dir = path.join(DATA, 'batches', `${runId}.rows`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(DATA, 'batches', `${runId}.json`), JSON.stringify({ id: runId, status: 'interrupted', perf: { phase: 'promote' } }));

// ---- build plain files that look like the real ones ----
const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const ASSETS = ['ETHUSDT', 'BNBUSDT', 'UNIUSDT', 'SOLUSDT', 'ADAUSDT'];
function mkPlain(name, n, shape) {
  const lines = [];
  const truth = [];
  let cols = null;
  for (let i = 0; i < n; i++) {
    const o = shape(i);
    const keys = Object.keys(o);
    if (!cols) { cols = keys.slice(); lines.push(JSON.stringify({ v: 1, cols })); }
    else {
      const added = keys.filter((k) => !cols.includes(k));
      if (added.length) { cols = cols.concat(added); lines.push(JSON.stringify({ v: 1, cols })); }
    }
    lines.push(JSON.stringify(cols.map((c) => (o[c] === undefined ? null : o[c]))));
    const full = {}; for (const c of cols) full[c] = o[c] === undefined ? null : o[c];
    truth.push(full);
  }
  return { text: lines.join('\n') + '\n', truth, cols };
}
// replication: no key, nested objects, ~1 KB a row, several rows per unit
const REP_N = 4000;
const unitAt = (i) => Math.floor(i / 7);           // 7 declared configs per unit
const rep = mkPlain('replication', REP_N, (i) => {
  const u = unitAt(i);
  return {
    declaredLabel: `q${(i % 7) + 1}/6 directional d0.25x t17h`,
    nullDealSeed: u % 21 === 0 ? null : (u % 21),
    trade: ASSETS[u % ASSETS.length], ctx1: '', ctx2: '', geometry: 'daily-3d', bandPct: 0.4 + rnd(),
    windowLayout: 'reserve61', entry: 'breakout', quorum: 4, members: 6,
    pnl: rnd() * 200 - 100, trades: 30 + (i % 90), wins: 15 + (i % 40),
    grossPerTrade: rnd(), stops: i % 11, ambiguous: i % 3, controlPnl: rnd() * 50, vsControl: rnd() * 20,
    metrics: { edge: rnd(), testAcc: rnd(), majorityBaseline: rnd(), n: 400 + i },
    holds: { alwaysLong: rnd() * 90, buyHold: rnd() * 90 },
    trailMult: 1.5, armMult: 0.5, trailAmbiguous: 0,
    holdout: { pnl: rnd() * 80, trades: 20, wins: 9, stops: 2, periods: 61, ambiguous: 1 },
    vsAlwaysLong: rnd() * 10, vsBuyHold: rnd() * 10,
  };
});
// census: one row per unit, key present, and a second shape with noCell
const CEN_N = Math.ceil(REP_N / 7) + 4;            // four units past what replication holds
const cen = mkPlain('census', CEN_N, (i) => {
  const base = {
    trade: ASSETS[i % ASSETS.length], ctx1: '', ctx2: '', geometry: 'daily-3d', decision: 'argmax',
    bandPct: 0.5, bandMode: 'auto', weekdaysOnly: false, shiftFrac: null,
    nullDealSeed: i % 21 === 0 ? null : (i % 21),
    key: `${ASSETS[i % ASSETS.length]}|||daily-3d|argmax|3|24-7|${i % 21 === 0 ? 'real' : 'n' + (i % 21)}`,
    windowLayout: 'reserve61', holdPnl: rnd() * 40, searchPnl: rnd() * 40,
  };
  if (i % 97 === 96) return { ...base, noCell: 'no execution cell reached 30 test trades', holdPnl: null, searchPnl: null };
  return base;
});
const slim = mkPlain('slim', 900, (i) => ({
  key: `k${i}`, trade: ASSETS[i % ASSETS.length], ctx1: '', ctx2: '',
  geometry: 'daily-3d', decision: 'argmax', bandPct: 0.5, nullDealSeed: null,
  pnl: rnd() * 10, trades: 40, holdPnl: rnd() * 5,
}));

// TORN LINES, the way a full disk makes them:
//  - replication ends mid-line (short write at the very end)
//  - census ends mid-line too
//  - slim gets a short write in the MIDDLE, so the next flush is glued to it
const CHOP = Number(process.env.CHOP || 400);
let repText = rep.text.slice(0, rep.text.length - CHOP);
let cenText = cen.text.slice(0, cen.text.length - 60);
const slimLines = slim.text.split('\n');
const cut = 500;
slimLines[cut] = slimLines[cut].slice(0, 40);       // half a line, no newline after it
let slimText = slimLines.slice(0, cut + 1).join('\n') + slimLines.slice(cut + 1).join('\n') + '';
// (that glues the half line to the one after it -- exactly the mid-file case)
fs.writeFileSync(path.join(dir, 'replication.jsonl'), repText);
fs.writeFileSync(path.join(dir, 'census.jsonl'), cenText);
fs.writeFileSync(path.join(dir, 'slim.jsonl'), slimText);

// What SHOULD survive: everything the reader can parse.
function survivors(text, truthCols) {
  const out = [];
  let cols = null;
  for (const L of text.split('\n')) {
    if (!L) continue;
    if (L[0] === '{') { try { cols = JSON.parse(L).cols; } catch (_) {} continue; }
    if (!cols) continue;
    let a; try { a = JSON.parse(L); } catch (_) { continue; }
    const o = {}; for (let i = 0; i < cols.length; i++) o[cols[i]] = a[i];
    out.push(o);
  }
  return out;
}
const want = {
  replication: survivors(repText), census: survivors(cenText), slim: survivors(slimText),
};
console.log(`built: slim ${want.slim.length}, census ${want.census.length}, replication ${want.replication.length} readable rows`);

// ---- run the converter ----
const { execFileSync } = require('child_process');
const out = execFileSync('node', [process.argv[3]], { env: { ...process.env, UTS_DATA: DATA }, encoding: 'utf8', maxBuffer: 64 << 20 });
console.log(out.split('\n').map((l) => `   | ${l}`).join('\n'));

// ---- read it back through the REAL rowstore ----
const rowstore = require(path.join(proj, 'lib/rowstore.js'));
for (const name of ['slim', 'census', 'replication']) {
  assert.strictEqual(fs.existsSync(path.join(dir, `${name}.jsonl`)), false, `${name}: the plain file must be gone`);
  assert.strictEqual(rowstore.formatOf(runId, name), 'squashed', `${name}: must read as squashed`);
  const got = rowstore.readAll(runId, name);
  assert.strictEqual(got.length, want[name].length, `${name}: ${got.length} rows back, wanted ${want[name].length}`);
  assert.strictEqual(rowstore.count(runId, name), want[name].length, `${name}: count() disagrees`);
  for (let i = 0; i < got.length; i++) {
    assert.strictEqual(JSON.stringify(got[i]), JSON.stringify(want[name][i]), `${name}: row ${i} differs`);
  }
  // paging, including a page that starts deep inside and one that runs off the end
  for (const from of [0, 1, 137, Math.max(0, want[name].length - 3), want[name].length + 5]) {
    const pg = rowstore.page(runId, name, from, 50);
    const expect = want[name].slice(from, from + 50);
    assert.strictEqual(pg.rows.length, expect.length, `${name}: page from ${from} gave ${pg.rows.length}, wanted ${expect.length}`);
    assert.strictEqual(pg.total, want[name].length, `${name}: page total wrong`);
    for (let i = 0; i < expect.length; i++) {
      assert.strictEqual(JSON.stringify(pg.rows[i]), JSON.stringify(expect[i]), `${name}: page from ${from} row ${i} differs`);
    }
  }
  console.log(`  ok  ${name}: ${got.length} rows identical, pages line up`);
}
// early stop still works
let n = 0; rowstore.each(runId, 'replication', () => { n++; return n < 5; });
assert.strictEqual(n, 5, 'each() must be able to stop early');

// ---- and a resumed run must be able to append to it ----
const w = rowstore.writer(runId, 'replication');
assert.strictEqual(w.count, want.replication.length, `a resumed writer starts at ${w.count}, wanted ${want.replication.length}`);
const extra = [];
for (let i = 0; i < 3000; i++) {
  const o = { ...want.replication[i % want.replication.length], trade: 'NEWUSDT', pnl: i };
  extra.push(o); w.push(o);
}
// a row carrying a column the file has never seen
const grown = { ...extra[0], brandNewColumn: 'x' };
extra.push(grown); w.push(grown);
w.close();
const after = rowstore.readAll(runId, 'replication');
assert.strictEqual(after.length, want.replication.length + extra.length, `after appending: ${after.length}`);
for (let i = 0; i < want.replication.length; i++) {
  assert.strictEqual(JSON.stringify({ ...want.replication[i], brandNewColumn: undefined }).replace(',"brandNewColumn":undefined', ''),
    JSON.stringify({ ...after[i], brandNewColumn: undefined }).replace(',"brandNewColumn":undefined', ''),
    `appending changed old row ${i}`);
}
assert.strictEqual(after[after.length - 1].brandNewColumn, 'x', 'the grown column must survive');
const pgEnd = rowstore.page(runId, 'replication', after.length - 4, 10);
assert.strictEqual(pgEnd.rows.length, 4, 'paging to the end after an append');
assert.strictEqual(pgEnd.rows[3].brandNewColumn, 'x', 'the last page must hold the appended row');
console.log(`  ok  appended ${extra.length} rows to the squashed file; ${after.length} readable, old rows untouched`);

// ---- the report says what it found ----
const rep2 = JSON.parse(fs.readFileSync(path.join(dir, 'squash-report.json'), 'utf8'));
// The fixture puts four census rows past what replication holds: three units
// with no replication rows at all, and the one the file was cut inside.
const WANT = Number(process.env.WANT_REDO || 4);
assert.strictEqual(rep2.censusKeysPastTheFloor.length, WANT,
  `expected ${WANT} census rows past the floor, got ${rep2.censusKeysPastTheFloor.length}`);
assert.strictEqual(rep2.censusRowIndexOfLastMatch, rep2.censusRows - WANT,
  `the floor should be ${WANT} rows from the end, was #${rep2.censusRowIndexOfLastMatch} of ${rep2.censusRows}`);
// THE LABEL COUNT is the exact one. The fixture writes seven labels per unit
// for every unit, no-cell rows included, so reading A is the true one.
assert.strictEqual(rep2.declaredLabels, 7, `expected 7 declared labels, got ${rep2.declaredLabels}`);
assert.strictEqual(rep2.declaredLabelCountHigh - rep2.declaredLabelCountLow, 1,
  'the cut is inside a unit, so the labels must differ by exactly one');
assert.strictEqual(rep2.replicationPartialUnits, 1, 'one unit half-written');
assert.strictEqual(rep2.gapIfEveryCensusRowOwnsReplicationRows, WANT - 1,
  `reading A should be ${WANT - 1} (the ${WANT}th is the half-written one), was ${rep2.gapIfEveryCensusRowOwnsReplicationRows}`);
assert.ok(rep2.gapIfNoCellRowsOwnNone < 0,
  `reading B must come out negative on this fixture, was ${rep2.gapIfNoCellRowsOwnNone}`);
assert.strictEqual(rep2.censusKeysInOrder.length, rep2.censusRows, 'every census key must be listed in order');
// and it must not blame the middle: one glued line in slim, one torn tail each.
assert.strictEqual(rep2.collections.slim.tornLinesDropped, 1, 'slim: one glued line');
assert.ok(rep2.collections.slim.tornAfterRows[0] < rep2.collections.slim.rows,
  'the glued slim line must be reported in the middle, not at the end');
assert.strictEqual(rep2.collections.replication.tornLinesDropped, 1, 'replication: one torn tail');
assert.strictEqual(rep2.collections.replication.tornAfterRows[0], rep2.collections.replication.rows,
  'the torn replication line must be reported at the very end');
console.log(`  ok  report: ${rep2.replicationWholeUnits} whole units + ${rep2.replicationPartialUnits} half-written from the labels, `
  + `reading A ${rep2.gapIfEveryCensusRowOwnsReplicationRows} / reading B ${rep2.gapIfNoCellRowsOwnNone}; `
  + `floor agrees at ${rep2.censusKeysPastTheFloor.length}`);
console.log('\nALL CHECKS PASSED');
