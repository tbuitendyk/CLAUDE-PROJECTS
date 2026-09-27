// THE SWEEP PROCESSOR (3.272.0, owner order 2026-09-26: "a real time report of
// Construct storage ... and a maintenance option that reports space that can be
// reclaimed and that actually does the reclaim ... the software should be able
// to determine these issues and resolve them"). What these hold:
//   * every byte of the data folder is in exactly one row of the report;
//   * only what belongs to nothing is counted left behind -- never a set's own
//     files, never a set whose document will not parse, never a file written in
//     the last hour;
//   * the reclaim removes the kinds ticked and nothing else, takes a fresh look at
//     the press, and refuses while anything heavy runs;
//   * the stage-engine check's leftover sets go through the service's own delete;
//   * the section stands at the top of Compute, keeps its ticks across the
//     redraw, and puts its button in a row of its own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert } = require('./helpers');
const storage = require('../lib/storage');

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 8, 26, 23, 0, 0);

// a data folder of every kind there is, some of it old and some of it new
function fixture() {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-storage-'));
  const w = (rel, bytes, ageH = 5) => {
    const p = path.join(D, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes, 97));
    const t = (NOW - ageH * HOUR) / 1000;
    fs.utimesSync(p, t, t);
    return p;
  };
  const doc = (id, body, ageH = 5) => {
    const p = w(`stagesets/${id}.json`, 1);
    fs.writeFileSync(p, JSON.stringify({ id, ...body }));
    const t = (NOW - ageH * HOUR) / 1000;
    fs.utimesSync(p, t, t);
  };
  // two live sets, one of each stage 1 and 4, with their files beside them and their store
  doc('s1-live-1', { stage: 1, name: 'S1 live', hours: { coins: { AAAUSDT: { file: 'hours/AAAUSDT-' + 'a'.repeat(32) + '.json.gz' } } } });
  w('stagesets/s1-live-1-tally.json.gz', 1000);
  w('stagesets/s1-live-1.units.json', 100);
  w('batches/s1-live-1.rows/records.jsonl.gz', 5000);
  w('batches/s1-live-1__keptfill.rows/records.jsonl.gz', 700);   // a fill's working folder, of a set that is here
  doc('s4-live-10', { stage: 4, name: 'S4 live' });
  w('stagesets/s4-live-10-halflife-x.json.gz', 300);
  // s4-live-1 must never be taken for s4-live-10's owner, nor the other way round
  w('stagesets/s4-live-1-capture.json.gz', 50);                    // named after a set that is gone
  // the stage-engine check's own sets, left behind
  doc('s1-exam-2', { stage: 1, exam: true, name: 'stage-engine check sg-x S1' });
  doc('s3-exam-3', { stage: 3, exam: true, name: 'stage-engine check sg-x S3', parent: { id: 's1-exam-2' } });
  w('batches/s1-exam-2.rows/records.jsonl.gz', 400);
  // a set whose document will not parse: never left behind, nor its files
  w('stagesets/s2-broken-4.json', 20);
  fs.writeFileSync(path.join(D, 'stagesets/s2-broken-4.json'), '{not json');
  w('stagesets/s2-broken-4-agreed.json.gz', 60);
  w('batches/s2-broken-4.rows/records.jsonl.gz', 800);
  // files of sets that are gone: old ones count, one written a minute ago does not
  w('stagesets/s3-gone-5-tally.json.gz', 2000);
  w('stagesets/checkpoints/s3-gone-5.json', 30);
  w('batches/s2-gone-6.rows/records.jsonl.gz', 9000);
  w('batches/s3-gone-7__keptfigs/unit-1.bin', 40);
  w('stagesets/s3-new-8-tally.json.gz', 3000, 0.02);
  // half-written files, old and new
  w('stagesets/s1-live-1.json.tmp123-4', 70);
  w('cache/AAAUSDT-1h-2026-09.json.tmp999-1', 90);
  w('cache/AAAUSDT-1h-2026-09-26.json.tmp999-2', 10, 0.1);
  // copies kept before a repair, and a backup
  w('stagesets/s4-live-10.json.before-3.251.4', 400);
  w('stagesets/s1-live-1.json.before-rebuild', 30);
  w('backups/price-records-20260926T221139Z/stagesets/s1-live-1.json', 600);
  // price-file records: one a set still names, two nothing names
  fs.writeFileSync(path.join(D, 'stagesets/s1-live-1.json'), JSON.stringify({ id: 's1-live-1', stage: 1, name: 'S1 live',
    dataManifest: { detailFile: 'manifests/s1-live-1.json' }, hours: { coins: { AAAUSDT: { file: 'hours/AAAUSDT-' + 'a'.repeat(32) + '.json.gz' } } } }));
  fs.utimesSync(path.join(D, 'stagesets/s1-live-1.json'), (NOW - 5 * HOUR) / 1000, (NOW - 5 * HOUR) / 1000);
  w('manifests/s1-live-1.json', 120);
  w('manifests/s9-old-1.json', 130);
  w('manifests/s9-old-2.json', 140);
  // kept hours: one named, one nobody reads, one just written
  w('hours/AAAUSDT-' + 'a'.repeat(32) + '.json.gz', 2500);
  w('hours/BBBUSDT-' + 'b'.repeat(32) + '.json.gz', 1500);
  w('hours/CCCUSDT-' + 'c'.repeat(32) + '.json.gz', 500, 0.1);
  // the rest
  w('cache/AAAUSDT-1h-2026-08.json', 4000);
  w('walks/w1.json', 800);
  w('fields/f1.json', 200);
  w('live/setups/x.json', 50);
  w('settings.json', 10);
  // every folder dated as the disk would date it: when its newest entry was
  // written -- not when this test happened to make it
  const settle = (dir) => {
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      n = Math.max(n, st.isDirectory() ? settle(p) : st.mtimeMs);
    }
    fs.utimesSync(dir, n / 1000, n / 1000);
    return n;
  };
  // a record store of a set not written yet, still being filled: its folder is
  // old, the file in it was written a minute ago -- a folder is as new as the
  // newest thing in it, so this is never left behind
  const filling = w('batches/s2-new-9.rows/records.jsonl.gz', 50);
  settle(D);
  fs.utimesSync(filling, (NOW - 0.02 * HOUR) / 1000, (NOW - 0.02 * HOUR) / 1000);
  return D;
}
const kind = (s, key) => s.reclaim.find((k) => k.key === key);
const rels = (s, key) => s.found[key].map((x) => x.rel).sort();

module.exports = {
  theReportAccountsForEveryByteOnceAndNamesOnlyWhatBelongsToNothing() {
    const D = fixture();
    try {
      const s = storage.survey({ dataDir: D, now: NOW });
      const sum = s.rows.reduce((n, r) => n + r.bytes, 0);
      assert.strictEqual(sum, s.total, `the rows add up to ${sum}, the folder holds ${s.total}`);
      const row = (key) => s.rows.find((r) => r.key === key);
      assert.strictEqual(row('stage1').count, 1, 'the check\'s own stage 1 set is not counted with the owner\'s sets');
      assert.strictEqual(row('stage1').bytes, fs.statSync(path.join(D, 'stagesets/s1-live-1.json')).size + 1000 + 100 + 5000 + 700,
        'a set is its document, the files named after it and its record stores');
      assert.strictEqual(row('stage4').count, 1);
      assert.deepStrictEqual(rels(s, 'checkSets'), ['stagesets/s1-exam-2.json', 'stagesets/s3-exam-3.json']);
      assert.deepStrictEqual(rels(s, 'priceFileRecords'), ['manifests/s9-old-1.json', 'manifests/s9-old-2.json'], 'a record a set still names is never left behind');
      assert.deepStrictEqual(rels(s, 'unreadHours'), [`hours/BBBUSDT-${'b'.repeat(32)}.json.gz`], 'kept hours a set names, and hours written a minute ago, are never left behind');
      assert.deepStrictEqual(rels(s, 'goneSetFiles'), ['batches/s2-gone-6.rows', 'batches/s3-gone-7__keptfigs', 'stagesets/checkpoints/s3-gone-5.json', 'stagesets/s3-gone-5-tally.json.gz', 'stagesets/s4-live-1-capture.json.gz'],
        'files of sets that are gone, over an hour old -- never a live set\'s, never a set\'s whose document will not parse, never s4-live-10\'s for s4-live-1\'s');
      assert.deepStrictEqual(rels(s, 'halfWritten'), ['cache/AAAUSDT-1h-2026-09.json.tmp999-1', 'stagesets/s1-live-1.json.tmp123-4'], 'half-written files over an hour old, and not the one being written now');
      assert.deepStrictEqual(rels(s, 'repairCopies'), ['stagesets/s1-live-1.json.before-rebuild', 'stagesets/s4-live-10.json.before-3.251.4']);
      assert.deepStrictEqual(rels(s, 'backups'), ['backups/price-records-20260926T221139Z']);
      assert.strictEqual(kind(s, 'repairCopies').ticked, false, 'copies kept on purpose never start ticked');
      assert.strictEqual(kind(s, 'backups').ticked, false, 'nor do backups');
      assert.ok(['checkSets', 'priceFileRecords', 'unreadHours', 'goneSetFiles', 'halfWritten', 'coinsUnreadable'].every((k) => kind(s, k).ticked), 'what the software can prove is left behind starts ticked');
      assert.strictEqual(row('leftBehind').bytes, ['checkSets', 'priceFileRecords', 'unreadHours', 'goneSetFiles', 'halfWritten', 'coinsUnreadable'].reduce((n, k) => n + kind(s, k).bytes, 0));
      const page = storage.report({ dataDir: D, now: NOW });
      assert.ok(!('found' in page), 'the page is not sent every file name');
      assert.ok(page.free && page.free.of > 0, 'free space on the disk is said');
    } finally {
      fs.rmSync(D, { recursive: true, force: true });
    }
  },

  theReclaimRemovesTheTickedKindsAndNothingElse() {
    const D = fixture();
    try {
      const deleted = [];
      const del = (id) => { deleted.push(id); fs.rmSync(path.join(D, 'stagesets', `${id}.json`)); fs.rmSync(path.join(D, 'batches', `${id}.rows`), { recursive: true, force: true }); };
      const before = storage.survey({ dataDir: D, now: NOW });
      const out = storage.reclaim(['checkSets', 'priceFileRecords', 'unreadHours', 'goneSetFiles', 'halfWritten'], { dataDir: D, now: NOW, busy: () => null, deleteSet: del });
      assert.deepStrictEqual(deleted, ['s3-exam-3', 's1-exam-2'], 'the check\'s sets go deepest first, through the delete it is handed');
      assert.deepStrictEqual(out.failed, []);
      assert.strictEqual(out.reclaimed, ['checkSets', 'priceFileRecords', 'unreadHours', 'goneSetFiles', 'halfWritten'].reduce((n, k) => n + kind(before, k).bytes, 0), 'it says how much it reclaimed');
      const after = storage.survey({ dataDir: D, now: NOW });
      for (const k of ['checkSets', 'priceFileRecords', 'unreadHours', 'goneSetFiles', 'halfWritten']) assert.strictEqual(kind(after, k).count, 0, `${k} is still there`);
      for (const keep of ['stagesets/s1-live-1.json', 'stagesets/s1-live-1-tally.json.gz', 'batches/s1-live-1.rows', 'batches/s1-live-1__keptfill.rows', 'stagesets/s4-live-10-halflife-x.json.gz',
        'stagesets/s2-broken-4.json', 'stagesets/s2-broken-4-agreed.json.gz', 'batches/s2-broken-4.rows', 'stagesets/s3-new-8-tally.json.gz', 'manifests/s1-live-1.json',
        `hours/AAAUSDT-${'a'.repeat(32)}.json.gz`, `hours/CCCUSDT-${'c'.repeat(32)}.json.gz`, 'cache/AAAUSDT-1h-2026-09-26.json.tmp999-2', 'cache/AAAUSDT-1h-2026-08.json',
        'stagesets/s4-live-10.json.before-3.251.4', 'backups/price-records-20260926T221139Z', 'walks/w1.json', 'live/setups/x.json', 'batches/s2-new-9.rows']) {
        assert.ok(fs.existsSync(path.join(D, keep)), `${keep} was removed and was not asked for, or is not left behind`);
      }
      // and the two kept on purpose go only when they are ticked
      const again = storage.reclaim(['repairCopies', 'backups'], { dataDir: D, now: NOW, busy: () => null, deleteSet: del });
      assert.deepStrictEqual(again.done.map((d) => [d.key, d.count]), [['repairCopies', 2], ['backups', 1]]);
      assert.ok(!fs.existsSync(path.join(D, 'backups/price-records-20260926T221139Z')) && fs.existsSync(path.join(D, 'stagesets/s1-live-1.json')));
    } finally {
      fs.rmSync(D, { recursive: true, force: true });
    }
  },

  theReclaimRefusesWhileAnythingHeavyRunsAndOnAnythingItDoesNotKnow() {
    const D = fixture();
    try {
      const del = () => { throw new Error('nothing should be deleted'); };
      assert.throws(() => storage.reclaim(['priceFileRecords'], { dataDir: D, now: NOW, busy: () => 'stage run s1-x', deleteSet: del }),
        /stage run s1-x is running — nothing is reclaimed while anything heavy runs/);
      assert.throws(() => storage.reclaim(['everything'], { dataDir: D, now: NOW, busy: () => null, deleteSet: del }), /nothing is called "everything" here/);
      assert.throws(() => storage.reclaim([], { dataDir: D, now: NOW, busy: () => null, deleteSet: del }), /nothing is ticked/);
      assert.strictEqual(storage.survey({ dataDir: D, now: NOW }).reclaim.find((k) => k.key === 'priceFileRecords').count, 2, 'a refused reclaim removed something');
    } finally {
      fs.rmSync(D, { recursive: true, force: true });
    }
  },

  // the check's leftover sets go through the service's own delete, on the real folder
  async theCheckSetsLeftBehindGoThroughTheServicesOwnDelete() {
    const SETS = path.join(__dirname, '..', 'data', 'stagesets');
    fs.mkdirSync(SETS, { recursive: true });
    const ids = ['s1-zzqastore-1', 's3-zzqastore-2'];
    try {
      fs.writeFileSync(path.join(SETS, `${ids[0]}.json`), JSON.stringify({ id: ids[0], stage: 1, seq: 999961, exam: true, name: 'stage-engine check zzqa S1', status: 'done', createdAt: new Date().toISOString() }));
      fs.writeFileSync(path.join(SETS, `${ids[1]}.json`), JSON.stringify({ id: ids[1], stage: 3, seq: 999962, exam: true, name: 'stage-engine check zzqa S3', status: 'done', createdAt: new Date().toISOString(), parent: { id: ids[0], name: 'x' } }));
      const s = storage.survey();
      assert.ok(ids.every((id) => s.found.checkSets.some((x) => x.id === id)), 'the check\'s sets are found on the real folder');
      const out = storage.reclaim(['checkSets'], { busy: () => null });
      assert.deepStrictEqual(out.failed.filter((f) => ids.includes(f.what)), []);
      for (const id of ids) assert.ok(!fs.existsSync(path.join(SETS, `${id}.json`)), `${id} is still there`);
    } finally {
      for (const id of ids) fs.rmSync(path.join(SETS, `${id}.json`), { force: true });
    }
  },

  // THE SECTION ON COMPUTE: at the top, its ticks kept across the redraw, its
  // button in a row of its own, the two routes it reads and presses
  theSweepProcessorStandsAtTheTopOfComputeAndKeepsItsTicks() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
    const draw = page.slice(page.indexOf('function drawCompute() {'), page.indexOf('// wiring', page.indexOf('function drawCompute() {')));
    assert.ok(draw.indexOf('+ sweepProcessorHtml()') > 0 && draw.indexOf('+ sweepProcessorHtml()') < draw.indexOf('Where each part runs'), 'The sweep processor is not the first section on Compute');
    assert.ok(page.includes("const f = getJson('api/storage')"), 'the tab does not read the storage report with the rest of it');
    const a = page.indexOf('const space = (b) =>');
    const b = page.indexOf('\nfunction wireSweepProcessor() {', a);
    const cStore = {
      at: '2026-09-26T23:00:00.000Z', total: 3 * 1048576,
      rows: [{ key: 'stage1', label: 'stage 1 record sets', count: 1, bytes: 1048576 }, { key: 'else', label: 'everything else', bytes: 2 * 1048576 }],
      free: { bytes: 100 * 1073741824, of: 300 * 1073741824 },
      reclaim: [{ key: 'priceFileRecords', label: 'price-file records no record set uses', ticked: true, count: 657, bytes: 22 * 1048576 },
        { key: 'backups', label: 'backups', ticked: false, count: 2, bytes: 447 * 1048576 }, { key: 'halfWritten', label: 'files half-written when the service stopped', ticked: true, count: 0, bytes: 0 }],
    };
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const run = (ticks) => new Function('esc', 'cStore', 'cErrStore', 'cReclaimTicks', 'cSvcMsg', `${page.slice(a, b)}; return sweepProcessorHtml();`)(esc, cStore, null, ticks, {});
    const html = run({});
    assert.ok(html.includes('<h3 style="margin-top:0">The sweep processor</h3>'), 'the section is not called The sweep processor');
    assert.ok(html.includes('<th style="text-align:left">Construct storage</th>') && html.includes('<th style="text-align:left">Space that can be reclaimed</th>'));
    assert.ok(/data-reclaim="priceFileRecords" checked/.test(html), 'what the software can prove is left behind starts ticked');
    assert.ok(/data-reclaim="backups">/.test(html), 'backups start unticked');
    assert.ok(/data-reclaim="halfWritten" disabled/.test(html), 'a kind with nothing in it cannot be ticked');
    assert.ok(html.includes('22 MB ticked'), 'the row beside the button says how much is ticked');
    assert.ok(/data-reclaim="backups" checked/.test(run({ backups: true })) && !/data-reclaim="priceFileRecords" checked/.test(run({ priceFileRecords: false })), 'a tick left by the owner is kept across the redraw');
    assert.ok(/<div class="row"><button id="cReclaim" class="danger">Reclaim the ticked space<\/button><span class="note">/.test(html), 'the button is not in a row of its own with its answer beside it');
    assert.ok(/<button id="cReclaim" class="danger" disabled>/.test(run({ priceFileRecords: false })), 'with nothing ticked the button cannot be pressed');
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(srv.includes("app.get('/api/storage'") && srv.includes("app.post('/api/storage/reclaim'"), 'the two routes are gone');
    assert.ok(srv.includes("require('./lib/storage').reclaim((req.body || {}).keys)"), 'the reclaim is not handed what was ticked');
    assert.ok(!srv.includes("app.post('/api/coins/cleanup'"), 'Coins still has a clean-up door of its own beside this one');
  },
};
