// THE ROWS DO NOT HAVE TO FIT IN MEMORY (owner order, 2026-08-22).
//
// "Fix the design so we are not limited by the heap ceiling ... cache things to
// disk to make it work."
//
// Three collections in a run document grow without bound, and one of them —
// one row per unit per declared configuration — reaches 413 million rows on the
// owner's wide sweep. Measured: 624 bytes each in memory, 611 as JSON. That is
// 240 GB of objects on a service allowed 1.8 GB of heap, and it dies before
// that: turning the document into text throws past 512 MB, which is about
// 879,000 rows, and the throw is swallowed — so it stops recording without
// saying so and then falls over.
//
// The rows now live in a file per collection per run, appended a line at a
// time. What this file holds the design to:
//
//   * the document must not carry them. Not "carry them smaller" — not carry
//     them, because it is turned into text on every save and that is the whole
//     fault. Non-enumerable getters keep every existing reader working while
//     JSON.stringify sees nothing.
//   * a row must never lose a field. These collections do not all have one
//     shape, so columns grow and a new header line is written.
//   * a resumed run must append to what it already wrote, not start a second
//     shorter truth beside it.
//   * reading must be possible without holding it all.
//
// Watched failing 2026-08-22: making the getters enumerable fails
// theDocumentDoesNotCarryTheRows; dropping the growing-columns branch loses the
// extra field and fails everyRowKeepsEveryFieldItWasGiven.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// The store writes under data/, so tests run against a scratch copy.
function withScratch(fn) {
  const realData = path.join(ROOT, 'data');
  const stash = `${realData}.stash-rs-${process.pid}`;
  const had = fs.existsSync(realData);
  if (had) fs.renameSync(realData, stash);
  fs.mkdirSync(path.join(realData, 'batches'), { recursive: true });
  const mods = ['lib/rowstore', 'lib/batch', 'lib/replication'];
  mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  try {
    return fn({
      realData,
      rowstore: require(path.join(ROOT, 'lib/rowstore')),
      batch: require(path.join(ROOT, 'lib/batch')),
      replication: require(path.join(ROOT, 'lib/replication')),
    });
  } finally {
    fs.rmSync(realData, { recursive: true, force: true });
    if (had) fs.renameSync(stash, realData);
    mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  }
}

module.exports = {
  // THE defect, stated as a property: the run document must stay the same size
  // whether the run produced fifty rows or fifty million.
  theDocumentDoesNotCarryTheRows() {
    withScratch(({ realData, rowstore, batch }) => {
      const id = 'bracketlab-test-1';
      const w = rowstore.writer(id, 'replication');
      for (let i = 0; i < 20000; i++) {
        w.push({ declaredLabel: 'q4/6 always d1x t41h', trade: 'ETHUSDT', geometry: 'daily-3d', pnl: i, holdout: { pnl: i / 2 } });
      }
      w.close();
      fs.writeFileSync(path.join(realData, 'batches', `${id}.json`),
        JSON.stringify({ id, kind: 'bracketlab', status: 'done', startedAt: 'x', params: {}, leaders: [], runs: [] }));

      const doc = batch.getBatch(id);
      assert.strictEqual(doc.replication.length, 20000, 'a reader that asks for the rows still gets them');

      const text = JSON.stringify(doc);
      assert.ok(!text.includes('declaredLabel'),
        `the document carries the rows again — ${text.length} characters of it. That is what could not be saved.`);
      assert.ok(text.length < 4000,
        `the document is ${text.length} characters with 20,000 rows recorded; it must not grow with them`);
    });
  },

  // Columns grow, because these collections do not all have one shape: a unit
  // that reached no cell records a reason where one that did records money.
  everyRowKeepsEveryFieldItWasGiven() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-test-2';
      const w = rowstore.writer(id, 'slim');
      w.push({ key: 'a', pnl: 1, trades: 2 });
      w.push({ key: 'b', pnl: null, trades: null, noCell: 'no cell reached 10 trades' });
      w.push({ key: 'c', pnl: 3, trades: 4 });
      w.close();
      const all = rowstore.readAll(id, 'slim');
      assert.strictEqual(all.length, 3);
      assert.strictEqual(all[1].noCell, 'no cell reached 10 trades', 'a field the first row lacked must not be dropped');
      assert.strictEqual(all[2].pnl, 3, 'and the rows after it are still read in the right columns');
      assert.strictEqual(all[0].noCell, undefined, 'a row that never had it does not gain one');
    });
  },

  // A resumed run appends to the file it already wrote. Two files, or a count
  // restarted at zero, would be a second and shorter truth about one run.
  aReopenedStoreContinuesTheSameRecord() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-test-3';
      const a = rowstore.writer(id, 'census');
      for (let i = 0; i < 700; i++) a.push({ key: `k${i}`, pnl: i });
      a.close();
      assert.strictEqual(rowstore.count(id, 'census'), 700);

      const b = rowstore.writer(id, 'census');
      assert.strictEqual(b.count, 700, 'a writer over an existing file must adopt its count');
      b.push({ key: 'k700', pnl: 700 });
      b.close();

      assert.strictEqual(rowstore.count(id, 'census'), 701);
      const all = rowstore.readAll(id, 'census');
      assert.strictEqual(all.length, 701, 'and every row of both sittings is still there');
      assert.strictEqual(all[0].key, 'k0');
      assert.strictEqual(all[700].key, 'k700');
    });
  },

  // Reading without holding: this is what makes a collection of this size
  // readable at all.
  rowsCanBeWalkedAndPagedWithoutHoldingThemAll() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-test-4';
      const w = rowstore.writer(id, 'replication');
      for (let i = 0; i < 5000; i++) w.push({ n: i });
      w.close();

      let sum = 0;
      let stoppedAt = null;
      rowstore.each(id, 'replication', (r, i) => { sum += r.n; if (i === 99) { stoppedAt = i; return false; } return true; });
      assert.strictEqual(stoppedAt, 99, 'a walker must be able to stop early');
      assert.strictEqual(sum, (99 * 100) / 2, 'and it stops where it said it did');

      const p = rowstore.page(id, 'replication', 4990, 20);
      assert.strictEqual(p.rows.length, 10, 'a page past the end is short, not wrong');
      assert.strictEqual(p.rows[0].n, 4990);
      assert.strictEqual(p.total, 5000, 'and the total comes from the sidecar, not from a walk');
    });
  },

  // The count must not require reading the rows — that is the whole point.
  theCountIsCheapAndSurvivesTheSidecarBeingLost() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-test-5';
      const w = rowstore.writer(id, 'slim');
      for (let i = 0; i < 300; i++) w.push({ n: i });
      w.close();
      assert.strictEqual(rowstore.count(id, 'slim'), 300);
      fs.rmSync(`${rowstore.storeFile(id, 'slim')}.meta.json`);
      assert.strictEqual(rowstore.count(id, 'slim'), 300,
        'with the sidecar gone the file itself must answer — the rows are the record, the sidecar is an index');
      assert.ok(fs.existsSync(`${rowstore.storeFile(id, 'slim')}.meta.json`), 'and it is written back');
    });
  },

  // The totals the screen shows are built by streaming, and they are the same
  // numbers the browser used to compute over every row.
  theReplicationTotalsAreBuiltByStreaming() {
    withScratch(({ realData, rowstore, batch, replication }) => {
      const id = 'bracketlab-test-6';
      const w = rowstore.writer(id, 'replication');
      const row = (over) => ({
        declaredLabel: 'A', trade: 'LTCUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d',
        nullDealSeed: null, pnl: 10, trades: 30, holdout: { pnl: 9, vsAlwaysLong: 1 }, ...over,
      });
      w.push(row({}));
      w.push(row({ nullDealSeed: 1, holdout: { pnl: 2 } }));
      w.push(row({ nullDealSeed: 2, holdout: { pnl: 4 } }));
      w.push(row({ nullDealSeed: 3, holdout: { pnl: 12 } }));
      w.close();
      fs.writeFileSync(path.join(realData, 'batches', `${id}.json`),
        JSON.stringify({ id, kind: 'bracketlab', status: 'done', startedAt: 'x', params: {}, leaders: [], runs: [] }));

      const out = replication.rank(batch.getBatch(id));
      assert.strictEqual(out.total, 4, 'every recorded row is read');
      assert.strictEqual(out.tagged, true, 'a run that marks its copies is detected');
      assert.strictEqual(out.configs, 1);
      const [g] = out.scored;
      assert.strictEqual(g.nullPairs, 3, 'all three dealt-vote copies are paired against the real look');
      assert.strictEqual(g.nullBeat, 2, 'the real 9 beats 2 and 4, not 12');
      assert.strictEqual(g.holdCount, 1, 'the cross-asset count reads real rows only');
      assert.strictEqual(g.sum, 9, 'and money sums the real looks only');
      assert.strictEqual(g.reals.length, 1, 'the per-asset table shows the real look only, never a copy');
    });
  },

  // Deleting a run takes its rows with it, or the disk fills with the rows of
  // runs that no longer exist.
  deletingARunTakesItsRows() {
    withScratch(({ realData, rowstore, batch }) => {
      const id = 'bracketlab-test-7';
      const w = rowstore.writer(id, 'replication');
      for (let i = 0; i < 100; i++) w.push({ n: i });
      w.close();
      fs.writeFileSync(path.join(realData, 'batches', `${id}.json`),
        JSON.stringify({ id, kind: 'bracketlab', status: 'done', startedAt: 'x', params: {}, leaders: [], runs: [] }));
      assert.ok(rowstore.bytes(id) > 0, 'the rows are on disk to begin with');
      batch.deleteBatch(id);
      assert.strictEqual(rowstore.bytes(id), 0, 'and they go with the run');
      assert.ok(!fs.existsSync(rowstore.storeDir(id)), 'the folder goes too');
    });
  },

  // SQUASHED, AND EVERY EXISTING RECORD LEFT ALONE (owner order, 2026-08-22).
  //
  // A run recorded before this — including one going at the time — has plain
  // files. They stay plain: the reader picks its format from which file exists,
  // and a writer over a plain file goes on appending plain lines. Rewriting a
  // running job's record to save space would be trading the thing for the
  // measurement of it.
  //
  // Watched failing 2026-08-22: making storeFile always return the squashed
  // name fails anExistingPlainCollectionStaysPlainAndReadable — a resumed run
  // would start a second, empty file beside the one holding its results.
  anExistingPlainCollectionStaysPlainAndReadable() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-old-1';
      fs.mkdirSync(rowstore.storeDir(id), { recursive: true });
      let text = `${JSON.stringify({ v: 1, cols: ['key', 'pnl'] })}\n`;
      for (let i = 0; i < 500; i++) text += `${JSON.stringify([`k${i}`, i * 2])}\n`;
      fs.writeFileSync(rowstore.plainFile(id, 'slim'), text);

      assert.strictEqual(rowstore.formatOf(id, 'slim'), 'plain', 'an existing plain collection is read as it was written');
      assert.strictEqual(rowstore.count(id, 'slim'), 500);
      assert.strictEqual(rowstore.page(id, 'slim', 498, 5).rows.length, 2, 'and pages the same way');

      // a resumed run must APPEND to it, not start a squashed one beside it
      const w = rowstore.writer(id, 'slim');
      assert.strictEqual(w.count, 500, 'the writer adopts the count it finds');
      w.push({ key: 'k500', pnl: 1000 });
      w.close();
      assert.strictEqual(rowstore.formatOf(id, 'slim'), 'plain', 'and it is still the same file');
      assert.ok(!fs.existsSync(rowstore.gzFile(id, 'slim')), 'with no second file beside it');
      const all = rowstore.readAll(id, 'slim');
      assert.strictEqual(all.length, 501, 'every row of both sittings');
      assert.strictEqual(all[500].key, 'k500');
    });
  },

  // A new collection is squashed, and everything about reading it is unchanged.
  //
  // BIG ENOUGH TO SPAN SEVERAL BLOCKS, on purpose. A first version of this used
  // 12,000 rows, which fitted in one block — so it passed just as happily with
  // the per-block header removed, and the thing that makes a page readable from
  // the middle was not being tested at all. A test that cannot fail is not a
  // test.
  aNewCollectionIsSquashedAndReadsIdentically() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-gz-1';
      const N = 60000;
      const row = (i) => ({
        label: `q4/6 always d${[0.25, 0.5, 1][i % 3]}x t${[17, 41, 65][i % 3]}h`,
        trade: ['ETHUSDT', 'BNBUSDT', 'XRPUSDT'][i % 3],
        pnl: i * 1.37, trades: 10 + (i % 200), nullDealSeed: i % 21 ? i % 21 : null,
        ...(i % 997 === 0 ? { noCell: 'no cell reached 10 trades' } : {}),
      });
      const w = rowstore.writer(id, 'replication');
      for (let i = 0; i < N; i++) w.push(row(i));
      w.close();

      assert.strictEqual(rowstore.formatOf(id, 'replication'), 'squashed');
      assert.strictEqual(rowstore.count(id, 'replication'), N, 'the count is the count');

      let seen = 0;
      let sum = 0;
      let extra = 0;
      rowstore.each(id, 'replication', (o) => { seen++; sum += o.pnl; if (o.noCell) extra++; });
      assert.strictEqual(seen, N, 'every row comes back');
      assert.ok(Math.abs(sum - ((N - 1) * N) / 2 * 1.37) < 1, 'with its numbers intact');
      assert.strictEqual(extra, Math.ceil(N / 997), 'and the rows carrying an extra column keep it');

      // MORE THAN ONE BLOCK, or the rest of this proves nothing
      const meta = JSON.parse(fs.readFileSync(`${rowstore.storeFile(id, 'replication')}.meta.json`, 'utf8'));
      assert.ok(Array.isArray(meta.blocks) && meta.blocks.length > 1,
        `this collection is ${meta.blocks ? meta.blocks.length : 0} block(s) — too small to test reading from the middle`);

      // a page from the far end starts inside a later block, so that block has
      // to carry its own column header or the rows come back unreadable
      const last = rowstore.page(id, 'replication', N - 3, 10);
      assert.strictEqual(last.rows.length, 3, 'a page past the end is short, not wrong');
      assert.ok(last.rows[0].trade, 'a row read from a later block must have its columns');
      assert.ok(Math.abs(last.rows[0].pnl - (N - 3) * 1.37) < 1e-6, 'and starts at the row asked for');
      assert.strictEqual(last.total, N);

      // and one from the middle, which is where a lost header shows up worst
      const mid = rowstore.page(id, 'replication', Math.floor(N / 2), 5);
      assert.strictEqual(mid.rows.length, 5);
      assert.ok(mid.rows[0].trade && mid.rows[0].label, 'a row from the middle must have its columns too');
      assert.ok(Math.abs(mid.rows[0].pnl - Math.floor(N / 2) * 1.37) < 1e-6, 'and be the row asked for');
    });
  },

  // A lost index costs speed, never the rows.
  aSquashedCollectionSurvivesLosingItsIndex() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-gz-2';
      const w = rowstore.writer(id, 'census');
      for (let i = 0; i < 8000; i++) w.push({ key: `k${i}`, pnl: i, trade: ['A', 'B'][i % 2] });
      w.close();
      fs.rmSync(`${rowstore.storeFile(id, 'census')}.meta.json`);
      let seen = 0;
      rowstore.each(id, 'census', () => { seen++; });
      assert.strictEqual(seen, 8000, 'with the index gone the file itself still answers — the rows are the record');
      assert.strictEqual(rowstore.count(id, 'census'), 8000, 'and the count is rebuilt from it');
    });
  },

  // The written form must stay far smaller than the objects were, or moving to
  // disk buys a limit that is only a little further away.
  theWrittenFormIsCompactComparedToTheObjects() {
    withScratch(({ rowstore }) => {
      const id = 'bracketlab-test-8';
      const row = () => ({
        declaredLabel: 'q4/6 always d1x t41h trail1x/arm0.5x', nullDealSeed: null,
        trade: 'ETHUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d', bandPct: 1.14,
        windowLayout: 'reserve61', entry: 'breakout', quorum: 4, members: 6,
        pnl: 1234.56, trades: 88, wins: 47, grossPerTrade: 14.02, stops: 12, ambiguous: 1,
        controlPnl: 900.1, vsControl: 334.46, trailMult: 1, armMult: 0.5,
        vsAlwaysLong: 434.36, vsBuyHold: 483.66,
      });
      const w = rowstore.writer(id, 'replication');
      for (let i = 0; i < 2000; i++) w.push(row());
      w.close();
      const perRow = rowstore.bytes(id) / 2000;
      const asObjects = JSON.stringify(row()).length;   // what one row cost the document
      assert.ok(perRow < asObjects * 0.6,
        `a stored row is ${Math.round(perRow)} bytes against ${asObjects} in the document — `
        + 'the field names repeat on every row and they were most of it');
    });
  },
};
