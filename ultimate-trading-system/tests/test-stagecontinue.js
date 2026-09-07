// A STAGE 3 RUN PAUSED AND STARTED AGAIN EQUALS THE RUN THAT WAS NEVER PAUSED
// (3.82.0, owner order 2026-09-07: "build the debug code injection and save
// the state and memory. Test it thoroughly, of course, so you don't break
// things. And while you're at it, write the code that allows the
// continuation").
//
// Two ways a run stops are rehearsed for real, on two fabricated coins with
// a known answer, each against a reference run of the same block that was
// never stopped:
//   * paused from inside the service — the pause control on Sweep;
//   * killed outright mid-run, the way a service restart kills it, so the
//     only checkpoint on disk is the one from the start of the pricing and
//     the rows on disk have outrun it;
// The same numbers must come out of both, every row priced before the
// stop must be kept byte for byte, and every file the pause leaves behind
// must be gone when the run lands.
//
// The two runs are not the same set, so the null-set deals differ (a set's
// deals are seeded from its own id). What is compared is everything that does
// not depend on the deals: the real money on both windows, the trade counts,
// the agreements, the four comparisons, and the seed-free columns of the
// ranked table.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { assert } = require('./helpers');
const stages = require('../lib/stages');
const rowstore = require('../lib/rowstore');
const { generateFabricated } = require('../lib/planted');
const { MANIFEST_DIR } = require('../lib/manifest');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');
const SETTINGS = path.join(ROOT, 'data', 'settings.json');
const FIXTURE = path.join(__dirname, 'fixtures', 'stage3-child.js');
const A = 'ZZZPAUSEAUSDT';   // the plant, alive the whole span
const B = 'ZZZPAUSEBUSDT';   // a fair coin, rule never on
const SPAN = { fromMonth: '2024-01', toDate: '2024-12-31' };
const FEE = 0.00125;
const NULL_N = 99;           // the null set is what makes a toy block take seconds — one pricing is microseconds
const PARTS_BEFORE_STOP = 3; // how many parts must have landed before a run is stopped
const HOLE_DAY = '2024-06-20';   // the day held as a short day file: seven hours, not twenty-four

const made = [];             // every record set this file writes, removed at the end
const children = [];         // every child process, killed at the end
const state = { s1: null, s2: null, ref: null, tmp: null, juneBundle: null };

// the block every rehearsal prices: every holding time and the chunk's own,
// every distance, every trail, both gates, two decisions, one agreement — 800
// settings a unit against a null set of 99, which is what makes a run last
// long enough to be stopped in the middle on any box (about 20 microseconds a
// pricing on one worker here; four workers on the box)
const BLOCK = {
  fee: FEE, nullN: NULL_N, decision: 'argmax', band: 'auto', weekdaysOnly: false, permuteDecision: true,
  cell: { entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 65 }, cellPermute: { tHours: true, dMult: true, trail: true, gate: true },
  agreeRule: 'count', agreePct: 50,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// THE PAUSE IS SERVED WHILE THE WORKERS PRICE. With no worker threads the
// pricing runs on the one thread that would answer the pause, and nothing --
// not the pause control, not a heartbeat, not the debugger's breakpoint on a
// part landing -- gets a turn until the run ends. The box runs four; this file
// needs at least two, sets that in the pool's own settings file when the box
// it runs on has fewer, and puts the file back exactly as it was.
let settingsBefore;   // undefined: not touched; null: there was no file
function ensureWorkers() {
  const { configuredSize } = require('../lib/pool');
  if (configuredSize() >= 2) return;
  let cfg = {};
  try { settingsBefore = fs.readFileSync(SETTINGS, 'utf8'); cfg = JSON.parse(settingsBefore); } catch (_) { settingsBefore = null; cfg = {}; }
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify({ ...cfg, worker_threads: 2 }, null, 1));
  process.on('exit', restoreSettings);
  assert.ok(configuredSize() >= 2, 'the rehearsal needs two worker threads and this box cannot give them');
}
function restoreSettings() {
  if (settingsBefore === undefined) return;
  try {
    if (settingsBefore === null) fs.rmSync(SETTINGS, { force: true });
    else fs.writeFileSync(SETTINGS, settingsBefore);
  } catch (_) { /* best effort */ }
  settingsBefore = undefined;
}
// a rehearsal that failed mid-run must not leave its run going into the next
async function idle() {
  const going = stages.stageRunning();
  if (going) {
    stages.cancelStage(going);
    const t0 = Date.now();
    while (stages.stageRunning() && Date.now() - t0 < 60000) await sleep(50);
  }
  const tally = stages.tallyRunPromise();
  if (tally) await tally.catch(() => {});
}
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
function tmpDir() {
  if (!state.tmp) state.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-pause-'));
  return state.tmp;
}
function needFixture() {
  if (!state.s2) throw new Error('the stage 2 fixture was not built — the first test of this file failed');
}
function launchParams(block, name) {
  return { ...block, from: state.s2.id, name, desc: 'pause rehearsal' };
}
async function untilLanded(id, ms = 10 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    const doc = stages.getSet(id);
    if (doc && doc.status !== 'running' && doc.finishedAt && stages.stageRunning() !== id) {
      const tally = stages.tallyRunPromise();
      if (tally) await tally.catch(() => {});
      return doc;
    }
    if (Date.now() - t0 > ms) throw new Error(`${id} did not land in ${ms / 1000} s (${doc && doc.status}: ${doc && doc.progress})`);
    await sleep(25);
  }
}
// waits until the run has landed at least `n` parts; a run that ends first
// was too small to be stopped in the middle, which is a fault in this file
async function untilPartsLanded(id, n, ms = 120000) {
  const t0 = Date.now();
  for (;;) {
    const doc = stages.getSet(id);
    const done = Number(((doc || {}).perf || {}).partsDone || 0);
    const total = Number(((doc || {}).perf || {}).partsTotal || 0);
    if (doc && total && done >= total) throw new Error(`every one of ${id}'s ${total} parts landed before it could be stopped — the block is too small to stop in the middle`);
    if (doc && done >= n) return doc;
    if (doc && doc.status !== 'running') throw new Error(`${id} ended ${doc.status} with ${done} part(s) landed — the block is too small to stop in the middle`);
    if (Date.now() - t0 > ms) throw new Error(`${id} did not land ${n} parts in ${ms / 1000} s (${doc && doc.progress})`);
    await sleep(5);
  }
}
// the start-again answers at once and reads the store after, so the record of
// what it kept lands on the set a moment later; this waits for it, and refuses
// a set that stopped without it
async function untilStartedAgain(id, ms = 60000) {
  const t0 = Date.now();
  const had = ((stages.getSet(id) || {}).continued || []).length;
  for (;;) {
    const doc = stages.getSet(id);
    if (doc && Array.isArray(doc.continued) && doc.continued.length > had) return doc;
    if (doc && doc.status !== 'running') throw new Error(`${id} stopped (${doc.status}: ${doc.progress}) before recording its start-again`);
    if (Date.now() - t0 > ms) throw new Error(`${id} recorded no start-again in ${ms / 1000} s (${doc && doc.progress})`);
    await sleep(25);
  }
}
function rowsByKey(id) {
  const m = new Map();
  rowstore.each(id, 'records', (r) => { m.set(`${r.u}|${r.si}`, r); });
  return m;
}
function rankedByLabel(id) {
  const got = stages.stage3Ranked(id, 0, 1000);
  assert.ok(got && Array.isArray(got.rows), `${id} has no ranked table`);
  return Object.fromEntries(got.rows.map((r) => [r.label, { coins: r.coins, inMoney: r.coinsInMoney, avgTest: r.avgTest, avgHold: r.avgHold }]));
}
// EVERYTHING THAT DOES NOT DEPEND ON THE DEALS must be the reference's
function sameAsReference(id, refId, what) {
  const doc = stages.getSet(id);
  const ref = stages.getSet(refId);
  assert.strictEqual(doc.status, 'done', `${what}: ended ${doc.status} — ${doc.progress} ${JSON.stringify(doc.failures || [])} ${doc.error || ''}`);
  assert.strictEqual(doc.plan.settings, ref.plan.settings, `${what}: a different block`);
  assert.deepStrictEqual(doc.plan.settingLabels, ref.plan.settingLabels, `${what}: the settings are not the reference's, in its order`);
  const mine = rowsByKey(id);
  const theirs = rowsByKey(refId);
  assert.strictEqual(mine.size, theirs.size, `${what}: ${mine.size} rows against the reference's ${theirs.size}`);
  assert.strictEqual(mine.size, ref.plan.settings * ref.plan.units, `${what}: one row per setting per unit`);
  for (const [k, r] of theirs) {
    const m = mine.get(k);
    assert.ok(m, `${what}: row ${k} (${r.label}) is missing`);
    for (const f of ['label', 'decision', 'entry', 'gate', 'dMult', 'tHours', 'bandPct', 'weekdaysOnly', 'trade', 'geometry', 'pnl', 'trades']) {
      assert.strictEqual(m[f], r[f], `${what}: row ${k} differs from the reference on ${f}: ${m[f]} vs ${r[f]}`);
    }
    assert.strictEqual((m.holdout || {}).pnl, (r.holdout || {}).pnl, `${what}: row ${k} differs on the held-back money`);
    assert.strictEqual((m.holdout || {}).trades, (r.holdout || {}).trades, `${what}: row ${k} differs on the held-back trades`);
    assert.strictEqual(m.pairs, NULL_N, `${what}: row ${k} read ${m.pairs} deals, not ${NULL_N}`);
    assert.ok(Number.isFinite(m.lead), `${what}: row ${k} has no lead over its null set`);
  }
  assert.deepStrictEqual(stages.readAgreed(id), stages.readAgreed(refId), `${what}: the agreements differ from the reference's`);
  assert.ok(doc.controls && doc.controls.units && Object.keys(doc.controls.units).length === ref.plan.units, `${what}: the four comparisons are not kept for every unit`);
  assert.deepStrictEqual(doc.controls.units, ref.controls.units, `${what}: the four comparisons differ from the reference's`);
  assert.deepStrictEqual(rankedByLabel(id), rankedByLabel(refId), `${what}: the ranked table differs on its seed-free columns`);
  assert.strictEqual(doc.perf.cyclesTotal, ref.perf.cyclesTotal, `${what}: a different count of pricings declared`);
  assert.strictEqual(doc.perf.cyclesDone, doc.perf.cyclesTotal, `${what}: ${doc.perf.cyclesDone} of ${doc.perf.cyclesTotal} pricings counted done`);
  assert.strictEqual(doc.counts.rows, ref.counts.rows, `${what}: the counts differ`);
  assert.strictEqual(doc.counts.failures, 0, `${what}: ${doc.counts.failures} unit(s) failed`);
  assert.ok(!stages.hasCheckpoint(id) && !fs.existsSync(stages.checkpointFile(id)), `${what}: a landed set keeps no checkpoint`);
  // and the actual date ranges every unit was priced on (3.85.0)
  assert.ok(doc.windows && doc.windows.units && Object.keys(doc.windows.units).length === ref.plan.units, `${what}: the date ranges are not kept for every unit`);
  assert.deepStrictEqual(doc.windows.units, ref.windows.units, `${what}: the date ranges differ from the reference's`);
}
// ---- a run in a process of its own ------------------------------------------------
function spawnChild(block, name, { goFile = null } = {}) {
  const beat = path.join(tmpDir(), `${name.replace(/\W+/g, '_')}.beat`);
  const args = [];
  args.push(FIXTURE, JSON.stringify({ ...block, from: state.s2.id, name, desc: 'pause rehearsal (a process of its own)' }), beat);
  if (goFile) args.push(goFile);
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((resolve) => { child.on('exit', (code, sig) => resolve({ code, sig })); });
  const launched = new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const nl = out.indexOf('\n');
      if (nl < 0) return;
      let got = null;
      try { got = JSON.parse(out.slice(0, nl)); } catch (_) { reject(new Error(`the child answered: ${out.slice(0, nl)}`)); return; }
      if (got.error) reject(new Error(`the child's launch refused: ${got.error}`));
      else resolve(got);
    });
    exited.then(({ code, sig }) => reject(new Error(`the child ended (${code || sig}) before launching: ${err}`)));
  });
  const readBeat = () => { try { return Number(fs.readFileSync(beat, 'utf8')); } catch (_) { return 0; } };
  const kill = async () => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } await Promise.race([exited, sleep(5000)]); };
  return { child, launched, readBeat, kill, stderr: () => err };
}
function removeSet(id) {
  const safe = String(id).replace(/[^A-Za-z0-9._-]+/g, '_');
  for (const dir of [SETS_DIR, MANIFEST_DIR]) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { files = []; }
    for (const f of files) {
      if (f === `${safe}.json` || f.startsWith(`${safe}-`) || f.startsWith(`${safe}.json.tmp`)) {
        try { fs.rmSync(path.join(dir, f), { force: true }); } catch (_) { /* best effort */ }
      }
    }
  }
  try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* best effort */ }
  try { fs.rmSync(stages.checkpointFile(id), { force: true }); } catch (_) { /* best effort */ }
}
function writeSet(doc) {
  fs.mkdirSync(SETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SETS_DIR, `${doc.id}.json`), JSON.stringify(doc));
  made.push(doc.id);
}
function writeCheckpointFile(id, extra) {
  fs.writeFileSync(stages.checkpointFile(id), JSON.stringify({
    v: stages.CHECKPOINT_V, id, at: new Date().toISOString(), release: require('../package.json').version, writtenBy: 'this test',
    workersN: 1, partsTotal: 0, partsDone: 0, units: [0, 1], agreedMap: {}, controlsMap: {}, failures: [],
    pricedSettings: 0, storeRows: 0, storeBlocks: 0, ...extra,
  }));
}

module.exports = {
  // the exam's two coins and their stage 2 parent, built once for every
  // rehearsal below (stage 1 trains for real; the rest is pricing)
  async theFixtureCoinsAndTheirStageTwoParentAreBuilt() {
    ensureWorkers();
    generateFabricated(SPAN, A, 515151, 0);   // plant on from day 0
    generateFabricated(SPAN, B, 515152, 1);   // rule never on — a fair coin
    // ONE MONTH HELD AS DAY FILES, ONE DAY WITH A HOLE (3.84.0): exactly the
    // shape the box was in when S3 #1c was launched -- LTCUSDT's August 2026
    // was day files, and 2026-08-20 had seventeen hours missing that the
    // refresh's month bundle later filled. Every run below is launched on
    // these day files, and the bundle appears later, in the pause rehearsal.
    const june = JSON.parse(fs.readFileSync(path.join(CACHE, `${A}-1h-2024-06.json`), 'utf8'));
    assert.ok(Array.isArray(june) && june.length >= 24 * 28, 'the fabricated June is a whole month');
    const byDay = new Map();
    for (const c of june) { const day = new Date(c.ts).toISOString().slice(0, 10); if (!byDay.has(day)) byDay.set(day, []); byDay.get(day).push(c); }
    for (const [day, rows] of byDay) {
      const kept = day === HOLE_DAY ? rows.filter((c) => new Date(c.ts).getUTCHours() < 7) : rows;
      fs.writeFileSync(path.join(CACHE, `${A}-1h-${day}.json`), JSON.stringify(kept));
    }
    fs.rmSync(path.join(CACHE, `${A}-1h-2024-06.json`), { force: true });
    state.juneBundle = june;                    // the whole month, hole filled, for later
    assert.strictEqual(fs.readdirSync(CACHE).filter((x) => x.startsWith(`${A}-1h-2024-06-`)).length, byDay.size, 'June is day files now');
    const s1 = stages.startStage1({
      universe: [A, B], sizes: { singles: true }, geometry: 'daily-1d',
      windowLayout: 'reserve61', allLoaded: false, startMonth: '2024-01', endMonth: '2024-12',
      nullN: NULL_N, fee: FEE, name: `ZZZ pause stage 1 ${stamp()}`, desc: 'pause rehearsal',
    });
    made.push(s1.id);
    const d1 = await untilLanded(s1.id);
    assert.strictEqual(d1.status, 'done', `stage 1 ended ${d1.status}: ${JSON.stringify(d1.failures)}`);
    state.s1 = d1;
    const s2 = stages.startStage2({ from: s1.id, carry: 0, name: `ZZZ pause stage 2 ${stamp()}`, desc: 'pause rehearsal' });
    made.push(s2.id);
    const d2 = await untilLanded(s2.id);
    assert.strictEqual(d2.status, 'done', `stage 2 ended ${d2.status}: ${JSON.stringify(d2.failures)}`);
    assert.strictEqual(rowstore.count(s2.id, 'records'), 2, 'two units to price');
    state.s2 = d2;
  },

  async aRunThatWasNeverStoppedIsTheReference() {
    needFixture();
    await idle();
    const t0 = Date.now();
    const s3 = stages.startStage3(launchParams(BLOCK, `ZZZ pause reference ${stamp()}`));
    made.push(s3.id);
    const doc = await untilLanded(s3.id);
    assert.strictEqual(doc.status, 'done', `the reference ended ${doc.status}: ${JSON.stringify(doc.failures)}`);
    assert.strictEqual(doc.plan.units, 2);
    assert.ok(doc.plan.settings >= 400, `a block of ${doc.plan.settings} settings is too small to pause in the middle`);
    assert.ok(doc.perf.partsTotal >= 8, `the run was cut into ${doc.perf.partsTotal} parts — too few to stop between`);
    assert.ok(Date.now() - t0 >= 1500, `the reference landed in ${Date.now() - t0} ms — too quick for a stop to land in the middle of a run of this block on this box`);
    assert.ok(!stages.hasCheckpoint(s3.id), 'a run that landed keeps no checkpoint');
    assert.ok(!Array.isArray(doc.continued) || !doc.continued.length, 'a run that was never stopped records no start-again');
    // THE RUN IS PINNED TO THE FILES IT WAS LAUNCHED ON (3.84.0): its stamp
    // lists June as day files, handed down from stage 1 through stage 2
    const pin = require('../lib/manifest').pinnedFilesOf(doc.dataManifest);
    assert.ok(pin && Array.isArray(pin[A]), 'the stage 3 set carries a pin');
    assert.ok(pin[A].includes(`${A}-1h-${HOLE_DAY}.json`) && !pin[A].includes(`${A}-1h-2024-06.json`), 'June is pinned as day files, the short day among them');
    assert.deepStrictEqual(pin, require('../lib/manifest').pinnedFilesOf(state.s2.dataManifest), 'the same pin as its parent');
    assert.deepStrictEqual(pin, require('../lib/manifest').pinnedFilesOf(state.s1.dataManifest), 'which is the root stage 1 set\'s');
    state.ref = s3.id;
    // THE ACTUAL DATE RANGES ARE STORED ON EVERY STAGE (3.85.0, owner order):
    // on each stage 1 and 2 record, and per unit beside the stage 3 set; the
    // same all the way down the chain, because a chain reads one history; and
    // the unread window has a start and no end
    const rec1 = rowstore.readAll(state.s1.id, 'records');
    const rec2 = rowstore.readAll(state.s2.id, 'records');
    assert.ok(rec1.length === 2 && rec2.length === 2);
    for (const r of rec1) {
      const w = r.windows;
      assert.ok(w && w.train && w.test && w.hold && w.unread, `a stage 1 record carries every window — got ${JSON.stringify(w)}`);
      assert.strictEqual(w.layout, 'reserve61');
      for (const k of ['train', 'test', 'hold']) assert.ok(Number.isFinite(w[k].fromTs) && Number.isFinite(w[k].toTs) && w[k].fromTs < w[k].toTs && w[k].chunks >= 2, `${k} is a real range`);
      assert.ok(w.train.fromTs < w.test.fromTs && w.test.fromTs < w.hold.fromTs && w.hold.fromTs < w.unread.fromTs, 'the windows follow one another in time');
      assert.ok(!('toTs' in w.unread), 'the unread window has a start and no end');
      assert.ok(Number.isFinite(w.unread.seenToTs) && w.unread.seenToTs > w.unread.fromTs, 'and says only how far the data reached on the day');
      const n = w.train.chunks + w.test.chunks + w.hold.chunks + w.unread.chunks;
      assert.strictEqual(w.unread.chunks, Math.max(2, Math.round(n * 0.13)), 'the unread window is the last 13% of the chunks');
      assert.deepStrictEqual({ fromTs: r.reserve.fromTs, chunks: r.reserve.chunks }, { fromTs: w.unread.fromTs, chunks: w.unread.chunks }, 'and it is the sealed window the record already carried');
    }
    for (const r of rec2) {
      const mine = rec1.find((x) => x.trade === r.trade && x.geometry === r.geometry);
      assert.deepStrictEqual(r.windows, mine.windows, 'stage 2, pinned to the same files, used the same date ranges');
    }
    for (const r of rec2) {
      const w3 = doc.windows.units[`${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}`];
      assert.deepStrictEqual(w3, r.windows, 'and so did stage 3, per unit beside the set');
    }
    // the set-level reading the screens show
    const sum = stages.windowsOfSet(doc);
    assert.strictEqual(sum.units, 2);
    assert.strictEqual(sum.known, 2);
    assert.strictEqual(sum.layout, 'reserve61');
    assert.ok(sum.train.fromTs <= sum.test.fromTs && sum.hold && sum.unread, 'every window is spanned across the units');
    assert.strictEqual(sum.unread.fromTs, Math.min(...rec2.map((r) => r.windows.unread.fromTs)));
    assert.ok(Number.isFinite(sum.unread.dataToTs) && sum.unread.dataToTs >= sum.unread.seenToTs, 'the unread window is read to the newest candle the box holds');
    assert.strictEqual(new Date(sum.unread.dataToTs).toISOString().slice(0, 10), '2024-12-31', 'which for these fabricated coins is the last day of their span');
    const sum1 = stages.windowsOfSet(state.s1);
    assert.deepStrictEqual({ t: sum1.train, h: sum1.hold, u: sum1.unread.fromTs }, { t: sum.train, h: sum.hold, u: sum.unread.fromTs }, 'the stage 1 set reads the same spans off its records');
    // the sealed verdict the Funnel reads carries the same start and the newest data
    const se = stages.sealedWindowOf(doc);
    assert.strictEqual(se.sealed, true);
    assert.strictEqual(se.fromTs, sum.unread.fromTs);
    assert.strictEqual(se.dataToTs, sum.unread.dataToTs);
  },

  // THE PAUSE CONTROL ON SWEEP: the run stops between parts, writes what it
  // held in memory beside what it wrote to disk, and reads as paused. Started
  // again, it prices only what is left, keeps every row it had, and lands
  // equal to the reference.
  async aRunPausedFromInsideAndStartedAgainEqualsTheReference() {
    needFixture();
    await idle();
    assert.ok(state.ref, 'no reference run');
    const s3 = stages.startStage3(launchParams(BLOCK, `ZZZ pause paused ${stamp()}`));
    made.push(s3.id);
    await untilPartsLanded(s3.id, PARTS_BEFORE_STOP);
    const stop = stages.cancelStage(s3.id);
    assert.strictEqual(stop.stopped, true, `the pause was refused: ${stop.why}`);
    const paused = await untilLanded(s3.id);
    assert.strictEqual(paused.status, 'paused', `a stopped stage 3 run that kept its state reads as paused, not ${paused.status}`);
    assert.ok(/^paused at \d+ of \d+ parts · \d+ of 2 units priced$/.test(paused.progress), `the progress line says where it stopped — got "${paused.progress}"`);
    assert.ok(paused.perf.partsDone >= PARTS_BEFORE_STOP && paused.perf.partsDone < paused.perf.partsTotal, `stopped in the middle: ${paused.perf.partsDone} of ${paused.perf.partsTotal}`);
    const cp = stages.readCheckpoint(s3.id);
    assert.ok(cp, 'the pause wrote the checkpoint');
    assert.strictEqual(cp.writtenBy, 'the run');
    assert.strictEqual(cp.release, require('../package.json').version, 'the checkpoint names the release that wrote it');
    assert.deepStrictEqual(cp.units, [0, 1], 'the units, in the order the run had them');
    assert.strictEqual(cp.partsDone, paused.perf.partsDone, 'the checkpoint and the set agree on how far it got');
    assert.strictEqual(cp.partsTotal, paused.perf.partsTotal);
    const before = rowsByKey(s3.id);
    assert.ok(before.size >= 1, 'some rows were on disk before the pause');
    assert.strictEqual(cp.storeRows, before.size, 'the checkpoint counts the rows on disk');
    assert.strictEqual(cp.pricedSettings, before.size, 'and the settings priced so far are exactly those rows');
    assert.ok(Object.keys(cp.agreedMap).length >= 1, 'the agreements the landed parts had worked out are in the checkpoint');
    assert.ok(Object.keys(cp.controlsMap).length >= 1, 'and so are the comparisons');
    const row = stages.listSets().find((x) => x.id === s3.id);
    assert.strictEqual(row.status, 'paused');
    assert.strictEqual(row.checkpoint, true, 'the list says it can be started again');
    assert.strictEqual(row.continued, 0);

    // THE REFRESH LANDS WHILE THE RUN IS PAUSED (3.84.0): June becomes a
    // month bundle with the hole filled, exactly what happened to LTCUSDT's
    // August on the box. What is on disk now is not what the run read; the
    // run reads what it was launched on, so it is not refused and it lands
    // equal to the reference, which never saw the bundle either.
    fs.writeFileSync(path.join(CACHE, `${A}-1h-2024-06.json`), JSON.stringify(state.juneBundle));
    const onDisk = await require('../lib/pipeline').loadSymbolAll(A, () => {});
    const pinnedNow = require('../lib/pipeline').loadSymbolPinned(A, require('../lib/manifest').pinnedFilesOf(stages.getSet(s3.id).dataManifest)[A]);
    assert.strictEqual(onDisk.rows.length - pinnedNow.rows.length, 17, 'the bundle would hand the run seventeen candles it never read');

    const again = stages.continueStage3(s3.id);
    // THE ANSWER COMES AT ONCE (3.83.0): before the block is rebuilt or a row
    // is read back, so nothing slow sits inside the request
    assert.deepStrictEqual(Object.keys(again).sort(), ['id', 'name', 'units'], 'the answer carries only what is known at once');
    assert.strictEqual(again.id, s3.id);
    assert.strictEqual(again.units, 2);
    const going = stages.getSet(s3.id);
    assert.strictEqual(going.status, 'running');
    assert.ok(/^starting again/.test(going.progress), `the running line says what it is doing — got "${going.progress}"`);
    assert.strictEqual(stages.stageRunning(), s3.id, 'the start-again is the one heavy job');
    const c = (await untilStartedAgain(s3.id)).continued[0];
    assert.ok(c.unitsToPrice >= 1 && c.unitsToPrice <= 2, `${c.unitsToPrice} units still to price`);
    assert.strictEqual(c.unitsKept + c.unitsToPrice, 2, 'every unit is either kept whole or priced');
    assert.strictEqual(c.from, 'paused');
    assert.strictEqual(c.settingsKept, before.size, 'the record says how many settings were kept from disk');
    assert.strictEqual(c.rowsTrimmed, 0, 'a clean pause leaves nothing to trim');
    const done = await untilLanded(s3.id);
    assert.strictEqual(done.plan.settings, paused.plan.settings, 'the same block');
    assert.strictEqual(done.status, 'done', `the start-again ended ${done.status}: ${done.progress} ${JSON.stringify(done.failures)}`);
    assert.strictEqual(done.continued.length, 1);
    assert.ok(!done.cancelRequested, 'the pause request does not outlive the start-again');
    const after = rowsByKey(s3.id);
    for (const [k, r] of before) assert.deepStrictEqual(after.get(k), r, `row ${k}, priced before the pause, was not kept as it was`);
    sameAsReference(s3.id, state.ref, 'paused from inside');
  },

  // A CHILD LAUNCHED AFTER THE BUNDLE APPEARED READS ITS PARENT'S FILES (3.84.0):
  // the next start stage 3 from S2 #1 on the box is exactly this press
  async aFreshLaunchAfterTheBundleAppearedIsPinnedToItsParentAndEqualsTheReference() {
    needFixture();
    await idle();
    assert.ok(state.ref, 'no reference run');
    assert.ok(fs.existsSync(path.join(CACHE, `${A}-1h-2024-06.json`)), 'the bundle is on disk beside the day files');
    const s3 = stages.startStage3(launchParams(BLOCK, `ZZZ pause after bundle ${stamp()}`));
    made.push(s3.id);
    const doc = await untilLanded(s3.id);
    assert.strictEqual(doc.status, 'done', `ended ${doc.status}: ${JSON.stringify(doc.failures)}`);
    const pin = require('../lib/manifest').pinnedFilesOf(doc.dataManifest);
    assert.ok(!pin[A].includes(`${A}-1h-2024-06.json`), 'the bundle that appeared after the parent was written is not this run\'s');
    sameAsReference(s3.id, state.ref, 'launched after the bundle appeared');
  },

  // A CHECKPOINT CAN BE UP TO A MINUTE BEHIND THE ROWS. A unit whose rows are
  // all on disk but whose agreements and comparisons never reached the
  // checkpoint gets them back by pricing one setting per missing answer —
  // never the whole unit again — and the rows on disk are not touched.
  async aUnitWhoseAgreementsWereLostGetsThemBackWithoutRepricingTheWholeUnit() {
    needFixture();
    await idle();
    assert.ok(state.ref, 'no reference run');
    const src = stages.getSet(state.ref);
    const id = `s3-test-${stamp()}-cp`;
    fs.cpSync(rowstore.storeDir(state.ref), rowstore.storeDir(id), { recursive: true });
    const doc = { ...src, id, name: `ZZZ pause copied ${stamp()}`, status: 'paused', finishedAt: null, continued: [], counts: null, controls: null, progress: 'paused at 0 of 0 parts', cancelRequested: true };
    delete doc.tallyError;
    // AND ITS STAMP NARROWED TO ONE COIN (3.84.1): the shape S3 #1c was found
    // in on the box -- its own record named LTCUSDT while its units read
    // sixteen more. The start-again widens the pin to the parent's files, on
    // the record, and the fair coin is read from those.
    const { stampManifest, pinnedFilesOf } = require('../lib/manifest');
    const wide = pinnedFilesOf(src.dataManifest);
    assert.ok(wide && wide[A] && wide[B], 'the reference is pinned over both coins');
    doc.dataManifest = stampManifest(`${id}-narrow`, [A], { onlyFiles: { [A]: wide[A] } });
    assert.deepStrictEqual(Object.keys(pinnedFilesOf(doc.dataManifest)), [A], 'narrowed to the planted coin alone');
    // and its date ranges never kept (a set from before 3.85.0): they come
    // back with one setting priced again per unit, like the agreements
    doc.windows = null;
    writeSet(doc);
    const before = rowsByKey(id);
    assert.strictEqual(before.size, src.plan.settings * 2, 'the copy holds every row of the reference');
    writeCheckpointFile(id, {
      partsTotal: src.perf.partsTotal, partsDone: src.perf.partsTotal, units: [...new Set([...before.values()].map((r) => r.u))].sort(),
      pricedSettings: before.size, storeRows: before.size, storeBlocks: rowstore.blocksOf(id, 'records').length,
    });
    assert.strictEqual(stages.readAgreed(id), null, 'nothing agreed is kept beside the copy yet');
    stages.continueStage3(id);
    const widened = pinnedFilesOf(stages.getSet(id).dataManifest);
    assert.deepStrictEqual(Object.keys(widened).sort(), [A, B], 'the pin now names both coins');
    assert.deepStrictEqual(widened[A], wide[A], 'its own files for the coin it named');
    assert.deepStrictEqual(widened[B], wide[B], 'and the parent\'s for the one it did not');
    assert.ok(stages.getSet(id).dataManifest.detailFile.endsWith(`${id}-widened.json`), 'written beside the launch\'s own record, which stays');
    const c = (await untilStartedAgain(id)).continued[0];
    assert.deepStrictEqual(c.pinWidened, { from: 1, to: 2, added: [B] }, 'the start-again\'s record says the pin was widened, and by what');
    assert.strictEqual(c.unitsKept, 0, 'no unit is whole without its agreements and comparisons');
    assert.strictEqual(c.unitsToPrice, 2);
    assert.ok(c.settingsRepriced >= 4, `at least one setting per decision per unit is priced again — got ${c.settingsRepriced}`);
    assert.ok(c.settingsRepriced < before.size, `far fewer settings than the ${before.size} on disk are priced again — got ${c.settingsRepriced}`);
    const done = await untilLanded(id);
    assert.strictEqual(done.status, 'done', `ended ${done.status}: ${done.progress} ${JSON.stringify(done.failures)}`);
    assert.strictEqual(done.continued[0].settingsKept, before.size);
    assert.strictEqual(done.continued[0].settingsRepriced, c.settingsRepriced);
    assert.strictEqual(rowstore.count(id, 'records'), before.size, 'not one row was added');
    const after = rowsByKey(id);
    for (const [k, r] of before) assert.deepStrictEqual(after.get(k), r, `row ${k} on disk was changed`);
    sameAsReference(id, state.ref, 'agreements recovered');
  },

  // THE SHAPE S3 #1c IS IN ON THE BOX (3.85.0): paused under a release that
  // kept no date ranges, its checkpoint whole -- every agreement and every
  // comparison for the units already priced, and no window for any of them.
  // Started again, each such unit prices ONE setting for its date ranges, its
  // row thrown away, and the run equals the reference.
  async aPausedRunWhoseCheckpointKeepsNoDateRangesPricesOneSettingPerUnitForThem() {
    needFixture();
    await idle();
    assert.ok(state.ref, 'no reference run');
    const src = stages.getSet(state.ref);
    const id = `s3-test-${stamp()}-cw`;
    fs.cpSync(rowstore.storeDir(state.ref), rowstore.storeDir(id), { recursive: true });
    const doc = { ...src, id, name: `ZZZ pause copied windows ${stamp()}`, status: 'paused', finishedAt: null, continued: [], counts: null, controls: null, windows: null, progress: 'paused at 0 of 0 parts', cancelRequested: true };
    delete doc.tallyError;
    writeSet(doc);
    const before = rowsByKey(id);
    const agreedMap = stages.readAgreed(state.ref);
    assert.ok(agreedMap && Object.keys(agreedMap).length, 'the reference keeps its agreements beside itself');
    const controlsMap = (src.controls || {}).units || {};
    assert.ok(Object.keys(controlsMap).length === 2, 'and its comparisons for both units');
    writeCheckpointFile(id, {
      partsTotal: src.perf.partsTotal, partsDone: src.perf.partsTotal, units: [...new Set([...before.values()].map((r) => r.u))].sort(),
      agreedMap, controlsMap,
      pricedSettings: before.size, storeRows: before.size, storeBlocks: rowstore.blocksOf(id, 'records').length,
    });
    assert.ok(!('windowsMap' in stages.readCheckpoint(id)), 'the checkpoint names no date ranges, like one written before 3.85.0');
    stages.continueStage3(id);
    const c = (await untilStartedAgain(id)).continued[0];
    assert.strictEqual(c.unitsKept, 0, 'a unit without its date ranges is not whole');
    assert.strictEqual(c.unitsToPrice, 2);
    assert.strictEqual(c.settingsRepriced, 2, 'exactly one setting per unit is priced again, for the date ranges alone');
    const done = await untilLanded(id);
    assert.strictEqual(done.status, 'done', `ended ${done.status}: ${done.progress} ${JSON.stringify(done.failures)}`);
    assert.strictEqual(done.continued[0].settingsKept, before.size);
    assert.strictEqual(rowstore.count(id, 'records'), before.size, 'not one row was added');
    const after = rowsByKey(id);
    for (const [k, r] of before) assert.deepStrictEqual(after.get(k), r, `row ${k} on disk was changed`);
    sameAsReference(id, state.ref, 'date ranges recovered');
  },

  // A SERVICE RESTART: the process dies between one part and the next with
  // no chance to write anything. The doc on disk still says running; the
  // list marks it interrupted; the checkpoint is the one from the start of
  // the pricing; and the rows on disk may end in a block the index never
  // claimed. Started again, it equals the reference.
  async aRunKilledMidWayLikeAServiceRestartIsStartedAgainFromItsStoreAndEqualsTheReference() {
    needFixture();
    await idle();
    assert.ok(state.ref, 'no reference run');
    const c = spawnChild(BLOCK, `ZZZ pause killed ${stamp()}`);
    const { id } = await c.launched;
    made.push(id);
    const seen = await untilPartsLanded(id, PARTS_BEFORE_STOP);
    await c.kill();
    const corpse = stages.getSet(id);
    assert.strictEqual(corpse.status, 'running', 'a killed process leaves its set saying running');
    assert.ok(corpse.perf.partsDone >= seen.perf.partsDone);
    const row = stages.listSets().find((x) => x.id === id);
    assert.strictEqual(row.status, 'interrupted', 'the list marks a corpse the moment it is seen');
    assert.strictEqual(row.checkpoint, true, 'and says it can be started again');
    const cp = stages.readCheckpoint(id);
    assert.ok(cp && cp.writtenBy === 'the run', 'the checkpoint from the start of the pricing is there');
    assert.ok(cp.partsDone <= corpse.perf.partsDone, 'the checkpoint is at or behind the set');
    const again = stages.continueStage3(id);
    assert.strictEqual(again.units, 2);
    const startedAs = (await untilStartedAgain(id)).continued[0];
    assert.strictEqual(startedAs.unitsKept, 0, 'nothing can be kept whole off a checkpoint with no agreements in it');
    assert.ok(startedAs.unitsToPrice >= 1);
    assert.strictEqual(startedAs.from, 'interrupted');
    assert.ok(startedAs.rowsTrimmed >= 0);
    const done = await untilLanded(id);
    assert.strictEqual(done.status, 'done', `the start-again ended ${done.status}: ${done.progress} ${JSON.stringify(done.failures)} ${done.error || ''}`);
    sameAsReference(id, state.ref, 'killed mid-way');
  },

  // ---- the pieces, on their own ----------------------------------------------------
  async theCheckpointIsWrittenAndReadInOneShapeAndRefusesAnyOther() {
    const id = `s3-test-${stamp()}-ck`;
    const doc = { id, stage: 3, status: 'running', perf: { partsTotal: 7, partsDone: 2 }, failures: [{ unit: 'x', error: 'y' }] };
    const live = {
      units: [3, 1], agreedMap: { '3|argmax|count|all|50|98|0|0': { agreed: 51 } }, controlsMap: { 'AAA|||daily-4d': { 'all|65': { alwaysLong: 1 } } },
      workersN: 4, priced: 5, pricedBase: 2, checkpointedAt: 0,
      pricedSettings() { return this.pricedBase + this.priced; }, storeRows: () => 7, storeBlocks: () => 2,
    };
    try {
      assert.strictEqual(stages.CHECKPOINT_V, 1);
      assert.ok(stages.checkpointFile(id).endsWith(path.join('stagesets', 'checkpoints', `${id}.json`)), 'the checkpoint sits in a folder of its own under the sets, named for its set');
      assert.ok(!fs.existsSync(path.join(SETS_DIR, `${id}-checkpoint.json`)), 'never beside the set, where the list would read it as one');
      assert.ok(!stages.hasCheckpoint(id));
      stages.writeCheckpoint(doc, live);
      assert.ok(live.checkpointedAt > 0, 'the run remembers when it last wrote one');
      assert.ok(stages.hasCheckpoint(id));
      const cp = stages.readCheckpoint(id);
      assert.strictEqual(cp.v, 1);
      assert.strictEqual(cp.id, id);
      assert.strictEqual(cp.writtenBy, 'the run');
      assert.strictEqual(cp.release, require('../package.json').version);
      assert.ok(!Number.isNaN(Date.parse(cp.at)));
      assert.strictEqual(cp.workersN, 4);
      assert.strictEqual(cp.partsTotal, 7);
      assert.strictEqual(cp.partsDone, 2);
      assert.deepStrictEqual(cp.units, [3, 1]);
      assert.deepStrictEqual(cp.agreedMap, live.agreedMap);
      assert.deepStrictEqual(cp.controlsMap, live.controlsMap);
      assert.deepStrictEqual(cp.failures, doc.failures);
      assert.strictEqual(cp.pricedSettings, 7, 'what is on disk plus what this run priced');
      assert.strictEqual(cp.storeRows, 7);
      assert.strictEqual(cp.storeBlocks, 2);
      // any other shape reads as no checkpoint at all — never as a guess
      const bad = [
        ['another version', { ...cp, v: 2 }],
        ['another set\'s', { ...cp, id: 'other' }],
        ['no agreements', (() => { const x = { ...cp }; delete x.agreedMap; return x; })()],
        ['no comparisons', (() => { const x = { ...cp }; delete x.controlsMap; return x; })()],
        ['units not a list', { ...cp, units: 'x' }],
      ];
      for (const [why, shape] of bad) {
        fs.writeFileSync(stages.checkpointFile(id), JSON.stringify(shape));
        assert.strictEqual(stages.readCheckpoint(id), null, `a checkpoint that is ${why} must read as none`);
        assert.strictEqual(stages.hasCheckpoint(id), false);
      }
      fs.writeFileSync(stages.checkpointFile(id), 'not json');
      assert.strictEqual(stages.readCheckpoint(id), null);
      fs.rmSync(stages.checkpointFile(id), { force: true });
      assert.strictEqual(stages.readCheckpoint(id), null);
      // THE MOMENTS IT IS WRITTEN, read off the code: when the pricing begins,
      // every minute while it goes, on a pause BEFORE the set is marked, and
      // when a run fails — and it is dropped when the run lands
      const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
      assert.ok(src.includes('const CHECKPOINT_EVERY_MS = 60 * 1000;'), 'once a minute');
      const loop = src.slice(src.indexOf('async function runStage3Parts('), src.indexOf('async function finishStage3('));
      assert.ok(loop.includes('writeCheckpoint(doc, live);\n  const landed'), 'written as the pricing begins');
      assert.ok(loop.includes('checkpointIfDue(doc, live);'), 'written every minute as parts land');
      const pause = loop.slice(loop.indexOf('if (doc.cancelRequested) {\n'));
      assert.ok(pause.indexOf('writeCheckpoint(doc, live);') >= 0 && pause.indexOf('writeCheckpoint(doc, live);') < pause.indexOf('finishFail(doc, null, pool);'),
        'on a pause the checkpoint is written before the set is marked, so the mark can say paused');
      const tail = src.slice(src.indexOf('async function finishStage3('), src.indexOf('function continueStage3('));
      assert.ok(tail.includes('dropCheckpoint(id);'), 'a landed run drops it');
      assert.ok(tail.indexOf('doc.finishedAt = new Date().toISOString();') < tail.indexOf('dropCheckpoint(id);'), 'after the set is written as landed');
      for (const fn of ['function startStage3(', 'function continueStage3(']) {
        const body = src.slice(src.indexOf(fn));
        const catchAt = body.indexOf('.catch((err) => {');
        // the start-again's catch first puts back a run that never started (3.83.0), so its writer sits further down
        assert.ok(catchAt > 0 && body.slice(catchAt, catchAt + 1600).includes('writeCheckpoint(doc, live)'), `${fn.slice(9, -1)} writes it when the run fails`);
      }
      const fail = src.slice(src.indexOf('function finishFail('), src.indexOf('function feeOrRefuse('));
      assert.ok(fail.includes("doc.stage === 3 && hasCheckpoint(doc.id) ? 'paused' : 'cancelled'"), 'a stopped stage 3 run with a checkpoint is paused; without one, cancelled, as before');
    } finally {
      fs.rmSync(stages.checkpointFile(id), { force: true });
    }
  },

  async aStoreCutOffMidWriteIsTrimmedBackToItsIndex() {
    const id = `s3-test-${stamp()}-trim`;
    try {
      const w = rowstore.writer(id, 'records');
      w.push({ u: 0, si: 0, label: 'a' });
      w.push({ u: 0, si: 1, label: 'b' });
      w.close();
      assert.strictEqual(rowstore.trimToMeta(id, 'records'), 0, 'a whole store has nothing to trim');
      const file = rowstore.storeFile(id, 'records');
      assert.ok(file.endsWith('.gz'), 'a new store is squashed');
      const size = fs.statSync(file).size;
      fs.appendFileSync(file, Buffer.alloc(137, 7));   // a block the index never claimed
      assert.strictEqual(rowstore.trimToMeta(id, 'records'), 137, 'the unclaimed bytes are cut off, and counted');
      assert.strictEqual(fs.statSync(file).size, size);
      assert.deepStrictEqual(rowstore.readAll(id, 'records').map((r) => r.label), ['a', 'b'], 'every claimed row still reads');
      assert.strictEqual(rowstore.trimToMeta(id, 'records'), 0);
      assert.strictEqual(rowstore.trimToMeta('s3-test-nothing-here', 'records'), 0, 'no store, nothing to trim');
    } finally {
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },

  async aStartAgainRefusesWhatItCannotResume() {
    needFixture();
    await idle();
    assert.ok(state.ref, 'no reference run');
    const ref = stages.getSet(state.ref);
    const base = () => ({
      stage: 3, seq: 999979, status: 'paused', createdAt: new Date().toISOString(), parent: { id: state.s2.id, name: state.s2.name },
      params: { ...ref.params }, plan: { ...ref.plan }, dataManifest: ref.dataManifest, perf: { ...ref.perf }, failures: [],
      engineVersion: ref.engineVersion, recordsVersion: ref.recordsVersion,
    });
    assert.throws(() => stages.continueStage3('s3-test-no-such-set'), /unknown stage 3 record set/);
    const done = { ...base(), id: `s3-test-${stamp()}-rf1`, name: `ZZZ pause refuse done ${stamp()}`, status: 'done' };
    writeSet(done);
    assert.throws(() => stages.continueStage3(done.id), /only a paused run can be started again/);
    const bare = { ...base(), id: `s3-test-${stamp()}-rf2`, name: `ZZZ pause refuse bare ${stamp()}` };
    writeSet(bare);
    assert.throws(() => stages.continueStage3(bare.id), /kept no record of where it stopped/, 'a paused run without a checkpoint says so, and says what to do');
    const orphan = { ...base(), id: `s3-test-${stamp()}-rf3`, name: `ZZZ pause refuse orphan ${stamp()}`, parent: { id: 's2-test-gone', name: 'gone' }, params: { ...ref.params, from: 's2-test-gone' } };
    writeSet(orphan);
    writeCheckpointFile(orphan.id, {});
    assert.throws(() => stages.continueStage3(orphan.id), /no longer on the box/);
    const moved = { ...base(), id: `s3-test-${stamp()}-rf4`, name: `ZZZ pause refuse moved ${stamp()}` };
    writeSet(moved);
    writeCheckpointFile(moved.id, {});
    // one pinned day file rewritten with different candles (3.84.0): the
    // refusal names the FILE, and a bundle that merely appeared did not refuse
    const dayFile = path.join(CACHE, `${A}-1h-2024-06-05.json`);
    const bytes = fs.readFileSync(dayFile);
    try {
      const rows = JSON.parse(bytes.toString('utf8'));
      rows[3] = { ...rows[3], close: rows[3].close * 1.5 };
      fs.writeFileSync(dayFile, JSON.stringify(rows));
      assert.throws(() => stages.continueStage3(moved.id), new RegExp(`1 of the price files .* was launched on has changed since \\(${A}-1h-2024-06-05\\.json\\) — the rest of this run would be priced on different prices`),
        'a pinned price file that changed refuses, and names the file');
    } finally {
      fs.writeFileSync(dayFile, bytes);
    }
    const gone = { ...base(), id: `s3-test-${stamp()}-rf4b`, name: `ZZZ pause refuse gone ${stamp()}` };
    gone.dataManifest = { ...ref.dataManifest, detailFile: 'manifests/zzz-no-such-detail.json' };
    writeSet(gone);
    writeCheckpointFile(gone.id, {});
    assert.throws(() => stages.continueStage3(gone.id), /cannot be proved unchanged: the record of which price files it read is gone/, 'a set whose record of its files is gone cannot be proved unchanged');
    const missing = { ...base(), id: `s3-test-${stamp()}-rf5`, name: `ZZZ pause refuse missing ${stamp()}` };
    writeSet(missing);
    writeCheckpointFile(missing.id, { units: [0, 5] });
    assert.throws(() => stages.continueStage3(missing.id), /1 of the 2 units this run priced are no longer on/);
    const block = { ...base(), id: `s3-test-${stamp()}-rf6`, name: `ZZZ pause refuse block ${stamp()}`, plan: { ...ref.plan, settings: 999, settingLabels: [] } };
    writeSet(block);
    writeCheckpointFile(block.id, {});
    // A BLOCK THAT NO LONGER REBUILDS IS FOUND AFTER THE ANSWER (3.83.0): the
    // rebuild is the slow part, so the set is claimed and answered first, and
    // the refusal puts it back exactly as it was with the sentence on its own
    // line -- nothing was priced, nothing is recorded as started
    const claimed = stages.continueStage3(block.id);
    assert.strictEqual(claimed.id, block.id);
    const back = await untilLanded(block.id);
    assert.strictEqual(back.status, 'paused', 'put back to what it was');
    assert.ok(/^not started again — .*not the same block, so nothing was priced/.test(back.progress), `the line says why — got "${back.progress}"`);
    assert.ok(/not the same block/.test(back.error));
    assert.ok(!(back.continued || []).length, 'no start-again is recorded for one that did not start');
    assert.ok(stages.hasCheckpoint(block.id), 'its checkpoint is untouched');
    // none of the refusals started anything or marked anything
    assert.strictEqual(stages.stageRunning(), null);
    for (const d of [done, bare, orphan, moved, gone, missing, block]) {
      assert.strictEqual(stages.getSet(d.id).status, d.status, `${d.name} was left as it was`);
    }
  },

  // THE SCREEN: a paused run is an entry in the stage 3 section's box, the
  // boxes below it are ghosted while it is chosen, the same start button
  // starts it again, and the running line's control reads pause for stage 3
  async theSweepOffersAPausedRunWhereANewOneIsSetUp() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const seg = src.slice(src.indexOf('function swPausedOptions('), src.indexOf('// EVERYTHING BELOW THE BOX IS GHOSTED'));
    assert.ok(seg.includes('function swSetOptions('), 'both option builders are in the slice');
    // eslint-disable-next-line no-new-func
    const { swPausedOptions, swSetOptions } = new Function('esc', `${seg}\nreturn { swPausedOptions, swSetOptions };`)((s) => String(s));
    const sets = [
      { id: 'p1', stage: 3, status: 'paused', checkpoint: true, name: 'S3 #9', createdAt: '2026-09-07T01:02:03Z', perf: { unitsDone: 3, unitsTotal: 8 }, plan: { units: 8, settings: 5 } },
      { id: 'p2', stage: 3, status: 'interrupted', checkpoint: true, name: 'S3 #10', createdAt: '2026-09-06T01:02:03Z', perf: { unitsDone: 0, unitsTotal: 2 }, plan: { units: 2, settings: 5 } },
      { id: 'p3', stage: 3, status: 'error', checkpoint: true, name: 'S3 #11', createdAt: '2026-09-05T01:02:03Z', perf: { unitsDone: 1, unitsTotal: 2 }, plan: { units: 2, settings: 5 } },
      { id: 'p4', stage: 3, status: 'paused', checkpoint: false, name: 'S3 #12', createdAt: '2026-09-04T01:02:03Z', perf: {}, plan: { units: 2, settings: 5 } },
      { id: 'd3', stage: 3, status: 'done', checkpoint: false, name: 'S3 #8', createdAt: '2026-09-03T01:02:03Z', perf: {}, plan: { units: 2, settings: 5 } },
      { id: 'd2', stage: 2, status: 'done', checkpoint: false, name: 'S2 #4', createdAt: '2026-09-02T01:02:03Z', perf: {}, plan: { units: 2, settings: 0 } },
      { id: 'd1', stage: 1, status: 'done', checkpoint: false, name: 'S1 #2', createdAt: '2026-09-01T01:02:03Z', perf: {}, plan: { units: 9, settings: 0 } },
    ];
    const paused = swPausedOptions(sets, '');
    assert.ok(paused.includes('<option value="continue:p1">paused — S3 #9 — 2026-09-07 — 3 of 8 units priced</option>'), `a paused run, by name, date and how far it got: ${paused}`);
    assert.ok(paused.includes('<option value="continue:p2">paused by a restart — S3 #10 — 2026-09-06 — 0 of 2 units priced</option>'), 'an interrupted run says a restart paused it');
    assert.ok(paused.includes('<option value="continue:p3">paused by a failure — S3 #11 — 2026-09-05 — 1 of 2 units priced</option>'), 'a failed run says a failure paused it');
    assert.ok(!paused.includes('p4'), 'a paused run with no checkpoint cannot be started again, so it is not offered');
    assert.ok(!paused.includes('d3'), 'a finished stage 3 set is not offered');
    assert.ok(swPausedOptions(sets, 'continue:p2').includes('<option value="continue:p2" selected>'), 'the chosen one stays chosen');
    const box3 = swSetOptions(sets, 2, '');
    assert.ok(box3.startsWith('<option value="" selected>— none —</option><option value="continue:p1">'), `the stage 3 section's box lists the paused runs right after — none —: ${box3.slice(0, 120)}`);
    assert.ok(box3.includes('<option value="d2">S2 #4 — 2026-09-02 — 2 units</option>'), 'and the finished stage 2 sets after them');
    assert.ok(!swSetOptions(sets, 1, '').includes('continue:'), 'the stage 2 section\'s box, which names stage 1 sets, offers no paused stage 3 run');
    assert.ok(swSetOptions(sets.filter((x) => x.stage !== 2), 2, '').includes('no finished stage 2 record set on this box</option><option value="continue:p1">'),
      'a paused run is offered even when no finished stage 2 set is');
    // the section reads that value: ghosted boxes, the count line, the start
    // button, and the provenance colours through the paused run's own parent
    assert.ok(src.includes("const swContinueOf = () => { const v = ($('#swFrom3') && $('#swFrom3').value) || ''; return v.startsWith('continue:') ? v.slice('continue:'.length) : null; };"));
    const ghost = src.slice(src.indexOf('function swContinueMode('), src.indexOf('// THE PARENT PICKERS FOLLOW WHAT IS ON THE BOX'));
    assert.ok(ghost.includes("if (c.id === 'swFrom3' || c.id === 'swGo3') continue;") && ghost.includes('c.disabled = !!on;') && ghost.includes("holder.classList.toggle('ctl-off', !!on);"),
      'every control of the stage 3 section but the box and the start button is ghosted while a paused run is chosen');
    assert.ok(src.includes('starts again where it was paused:') && src.includes('the boxes below are this run\'s own and cannot be changed here'), 'the count line says what a start-again does');
    assert.ok(src.includes('await startPost(`api/stageset/${encodeURIComponent(cont)}/continue`, {});'), 'start stage 3 posts the start-again for the chosen run, through the post that does not put up a dialog when the gateway gives up');
    assert.ok(src.includes('started again <b>${esc(again.name)}</b> — progress above; the set lands on Boards.'), 'the message beside the button points at the running line, which carries the reading and then the pricing');
    assert.ok(src.includes("<button id=\"swStop\" class=\"danger\">${row.stage === 3 ? 'pause' : 'stop'}</button>"), 'the running line\'s control reads pause on a stage 3 run and stop on the others');
    assert.ok(src.includes("const cont = s3v.startsWith('continue:') ? s3v.slice('continue:'.length) : null;") && src.includes('const pausedRow = cont ? rowOf(cont) : null;'),
      'the provenance colours judge a paused run through its own stage 2 parent');
    assert.ok(src.includes("else if (cont && !pausedRow) paint('#swH3', false, 'the paused record set named here is not on this box any more');"));
    // Boards says a paused set can be started again, and where
    assert.ok(src.includes("const canContinue = !!((sets.find((x) => x.id === doc.id) || {}).checkpoint);"), 'Boards reads whether a set can be started again off its LIST row — the set document does not carry it');
    assert.ok(src.includes("${canContinue ? ' It can be started again from the stage 3 section on Sweep.' : ''}"), 'Boards points at the control');
    // the service answers the start-again, and refuses by sentence
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const route = server.slice(server.indexOf("app.post('/api/stageset/:id/continue'"));
    assert.ok(route.startsWith("app.post('/api/stageset/:id/continue'"), 'the route exists');
    assert.ok(route.slice(0, 300).includes("stages.continueStage3(String(req.params.id || ''))") && route.slice(0, 300).includes('res.status(409).json({ error: String(err.message || err) })'));
    // THE DATE RANGES ARE ON THE HEADER OF EVERY RUN ON BOARDS (3.85.0), and
    // the Funnel says where the unread window runs
    assert.ok(src.includes('function windowsLineHtml(win)') && src.includes('${windowsLineHtml(win)}'), 'the header carries the date ranges line');
    for (const word of ['training ', 'test ', 'held-back ', 'unread from ', ' onward — the box holds data to ', ', all of it unread']) assert.ok(src.includes(word), `the line says ${JSON.stringify(word)}`);
    assert.ok(src.includes('doc.dataManifest || null, got.windows || null)'), 'Boards hands the panel what the route sent');
    assert.ok(src.includes(': unread from ${fDayOf(sealed.fromTs)} onward - the box holds data to ${fDayOf(sealed.dataToTs)}, and all of it counts as unread.'), 'the Funnel says where the unread window runs, to the newest data');
    assert.ok(server.includes('chain: stages.chainOf(doc.id),\n    // the actual date ranges the set used (3.85.0)\n    windows: stages.windowsOfSet(doc),'), 'the route sends the date ranges');
    // and the help says it, in the words on the screen
    const sandbox = {};
    // eslint-disable-next-line no-new-func
    new Function('window', fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8'))(sandbox);
    const h = sandbox.HELP.sweep.controls;
    assert.ok(h.swFrom3.what.includes('A paused stage 3 run is offered here too, and start stage 3 then starts it again where it stopped.'));
    assert.ok(h.swFrom3.more.includes('While a paused run is chosen the boxes below are ghosted'));
    assert.ok(h.swGo3.what.includes('With a paused run chosen in the box above, starts that run again where it stopped.'));
    assert.ok(h.swStop.what.startsWith('Pauses a stage 3 run, or stops a stage 1 or 2 run.'));
  },

  // THE START BUTTONS SLEEP ON THE PRESS AND THE LINE AT THE TOP SAYS STARTING
  // (3.83.0, owner order: "ghost as soon as a button is pressed AND not start a
  // time-out that complains after one minute -- you need to give a status of
  // 'starting...' or something like that at the top")
  async theStartButtonsSleepOnThePressAndTheLineAtTheTopSaysStarting() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const helper = src.slice(src.indexOf('function swStarting('), src.indexOf('function swAfterStart('));
    assert.ok(helper.includes("for (const bid of ['swGo1', 'swGo2', 'swGo3'])") && helper.includes('b.disabled = true;'), 'all three start buttons sleep the moment one is pressed');
    for (const label of ['starting stage 1…', 'starting stage 2…', 'starting stage 3…', 'starting again…']) {
      assert.ok(helper.includes(`<span>${label}</span>`), `the status line at the top reads ${label}`);
    }
    assert.ok(helper.includes("const el = $('#swProg');"), 'and it is the status line at the top of Sweep that says so');
    // each press says starting BEFORE it asks the box
    const go = (n) => { const at = src.indexOf(`$('#swGo${n}').onclick`); return src.slice(at, src.indexOf('\n  };', at)); };   // the whole press
    assert.ok(go(1).includes('swStarting(1);') && go(1).indexOf('swStarting(1);') < go(1).indexOf('startPost('), 'stage 1 says starting before it asks');
    assert.ok(go(2).includes('swStarting(2);') && go(2).indexOf('swStarting(2);') < go(2).indexOf('startPost('), 'stage 2 says starting before it asks');
    assert.ok(go(3).includes("swStarting(cont ? 'again' : 3);") && go(3).indexOf('swStarting(') < go(3).indexOf('startPost('), 'stage 3 says starting — or starting again — before it asks');
    assert.ok(!/tryPost\('api\/stage[123]'/.test(src) && !src.includes('tryPost(`api/stageset/${encodeURIComponent(cont)}/continue`'), 'no start goes through the post that puts up a dialog when the gateway gives up');
    // a gateway that gave up is not a refusal, and not a dialog
    const sp = src.slice(src.indexOf('async function startPost('), src.indexOf('function swAfterStart('));
    assert.ok(/HTTP 50\[24\]/.test(sp) && sp.includes('return { pending: true };'), 'a 502/504 answers pending');
    assert.ok(sp.includes('starting… the box has not answered yet — this line follows it'), 'and the line says the box has not answered yet');
    assert.ok(sp.indexOf('alert(') > sp.indexOf('return { pending: true };'), 'the dialog is for a real refusal only, after the gateway case');
    // the poll does not wake the buttons under a press the box has not answered
    const prog = src.slice(src.indexOf('async function swProgress('), src.indexOf("el.innerHTML = 'nothing is running';"));
    assert.ok(prog.includes('if (going) swPressed = null;') && prog.includes('if (!going && swPressed) {') && prog.includes('< 120000'),
      'a press in flight keeps the buttons asleep for up to two minutes, and a run that appears ends the wait');
    assert.ok(prog.indexOf('if (!going && swPressed) {') < prog.indexOf('b.disabled = going;'), 'checked before the buttons are set from the box');
    // and every press hands its answer to the one place that wakes the buttons
    assert.strictEqual((src.match(/swAfterStart\((got|again)\);/g) || []).length, 4, 'each of the four starts ends through swAfterStart');
    // the service side answers before it reads: the record of what it kept is
    // written on the running line, not in the answer
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const cont = st.slice(st.indexOf('function continueStage3('), st.indexOf('// ---- stage 3 tables'));
    assert.ok(cont.trimEnd().endsWith('return { id, name: doc.name, units: parentRecords.length };\n}'), 'the answer carries only what is known at once');
    assert.ok(cont.indexOf("doc.progress = 'starting again: reading what is already on disk';") < cont.indexOf('(async () => {'), 'the running line says so before the slow part begins');
    assert.ok(cont.indexOf('foldSameTradeSettings(') > cont.indexOf('(async () => {'), 'the block is rebuilt after the answer');
    assert.ok(cont.includes("rowstore.readBlocks(id, 'records', idx)") && cont.includes('await yieldNow();'), 'the store is read a few blocks at a time with the loop let go in between');
    assert.ok(cont.includes("phase: 'starting again: reading what is already on disk', done, total: blocks.length, word: 'blocks'"), 'and the reading is on the running line as it goes');
  },

  async theListRowSaysWhetherASetCanBeStartedAgain() {
    const id = `s3-test-${stamp()}-ls`;
    const doc = { id, stage: 3, seq: 999978, name: `ZZZ pause list ${stamp()}`, status: 'paused', createdAt: new Date().toISOString(), plan: { units: 2, settings: 3 }, params: {} };
    writeSet(doc);
    const rowOf = () => stages.listSets().find((x) => x.id === id);
    assert.strictEqual(rowOf().checkpoint, false, 'paused, but nothing to start again from');
    writeCheckpointFile(id, {});
    assert.strictEqual(rowOf().checkpoint, true);
    assert.strictEqual(rowOf().continued, 0);
    writeSet({ ...doc, continued: [{ at: 'x' }, { at: 'y' }] });
    assert.strictEqual(rowOf().continued, 2, 'how many times it was started again');
    // a set the service restarted out from under: marked interrupted on
    // sight, and offered for a start-again because its checkpoint is there
    writeSet({ ...doc, status: 'running' });
    const seen = rowOf();
    assert.strictEqual(seen.status, 'interrupted');
    assert.strictEqual(seen.checkpoint, true);
    assert.strictEqual(stages.getSet(id).progress, 'the service restarted while this set was being written');
    // a stage 2 set never has one, whatever is on disk beside it
    const s2 = `s2-test-${stamp()}-ls`;
    writeSet({ id: s2, stage: 2, seq: 999977, name: `ZZZ pause list 2 ${stamp()}`, status: 'paused', createdAt: new Date().toISOString(), plan: { units: 2 }, params: {} });
    writeCheckpointFile(s2, {});
    assert.strictEqual(stages.listSets().find((x) => x.id === s2).checkpoint, false);
  },

  async everythingTheRehearsalWroteIsRemoved() {
    for (const c of children) { try { c.kill('SIGKILL'); } catch (_) { /* gone */ } }
    for (const id of made) removeSet(id);
    let files = [];
    try { files = fs.readdirSync(CACHE); } catch (_) { files = []; }
    for (const f of files) {
      if (f.startsWith(`${A}-`) || f.startsWith(`${B}-`)) { try { fs.unlinkSync(path.join(CACHE, f)); } catch (_) { /* best effort */ } }
    }
    if (state.tmp) { try { fs.rmSync(state.tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
    restoreSettings();
    assert.strictEqual(settingsBefore, undefined, 'the settings file is back as it was');
    const left = stages.listSets().filter((x) => /^ZZZ pause/.test(x.name || '') || made.includes(x.id));
    assert.deepStrictEqual(left.map((x) => x.id), [], 'no rehearsal set is left on the box');
    const caches = (() => { try { return fs.readdirSync(CACHE).filter((f) => f.includes('ZZZPAUSE')); } catch (_) { return []; } })();
    assert.deepStrictEqual(caches, [], 'no fabricated price file is left');
    for (const id of made) assert.ok(!fs.existsSync(rowstore.storeDir(id)), `${id}'s records are gone`);
  },
};
