const { assert } = require('./helpers');
const { Pool, configuredSize } = require('../lib/pool');
const fs = require('fs');
const path = require('path');

module.exports = {
  async inlineFallbackWhenNotParallel() {
    // size<=1 must degrade to running tasks on this thread rather than
    // failing: an optimization may never make the service less reliable.
    const p = new Pool(1);
    assert.strictEqual(p.parallel, false);
    p.abort();
  },
  async mapPreservesInputOrder() {
    // Results must line up with their INPUTS, not with completion order —
    // this is what lets the orchestrator stay deterministic while workers
    // race. Simulated with a fake pool whose tasks finish out of order.
    const fake = Object.create(Pool.prototype);
    fake.stopped = false;
    fake.workers = [1, 2, 3];
    fake.queue = [];
    fake.pending = new Map();
    fake.run = (kind, payload) =>
      new Promise((res) => setTimeout(() => res(payload.v * 2), payload.delay));
    const payloads = [
      { v: 1, delay: 30 },
      { v: 2, delay: 5 },
      { v: 3, delay: 20 },
      { v: 4, delay: 1 },
    ];
    const out = await Pool.prototype.map.call(fake, 'unit', payloads);
    assert.deepStrictEqual(out.map((o) => o.value), [2, 4, 6, 8]);
    assert.ok(out.every((o) => o.ok));
  },
  async taskFailureIsIsolated() {
    // One bad task must be recorded and skipped, never kill the run.
    const fake = Object.create(Pool.prototype);
    fake.stopped = false;
    fake.workers = [1, 2];
    fake.run = (kind, payload) =>
      payload.bad ? Promise.reject(new Error('boom')) : Promise.resolve(payload.v);
    const out = await Pool.prototype.map.call(fake, 'unit', [{ v: 1 }, { bad: true }, { v: 3 }]);
    assert.strictEqual(out[0].ok, true);
    assert.strictEqual(out[1].ok, false);
    assert.strictEqual(out[1].error, 'boom');
    assert.strictEqual(out[2].value, 3);
  },
  async workerNeverReachesStatefulModules() {
    // The worker's transitive requires must exclude batch.js, whose top-level
    // code rewrites any document still marked 'running' to 'interrupted' — a
    // worker importing it would corrupt the very sweep it is executing.
    //
    // The list used to name three more: the frozen paper-book modules. All
    // three were deleted with the screens they served, so three of the four
    // guards here could no longer fail and the test read as four protections
    // when it was one (audit, 2026-08-21). The list below is now every
    // surviving module that holds state or writes to disk, checked against the
    // tree so a new one cannot be forgotten.
    const LIB = path.join(__dirname, '..', 'lib');
    const seen = new Set();
    const walk = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      let src;
      try {
        src = fs.readFileSync(path.join(LIB, file), 'utf8');
      } catch {
        return;
      }
      for (const m of src.matchAll(/require\('\.\/([\w-]+)'\)/g)) walk(`${m[1]}.js`);
    };
    walk('worker.js');
    const FORBIDDEN = ['batch.js', 'campaign.js', 'manifest.js', 'jobs.js', 'planted.js', 'guard.js'];
    for (const forbidden of FORBIDDEN) {
      // A name that is not in the tree cannot fail, and a guard that cannot
      // fail is not a guard.
      assert.ok(fs.existsSync(path.join(LIB, forbidden)), `${forbidden} is on the forbidden list but not in lib/`);
      assert.ok(!seen.has(forbidden), `worker must not transitively require ${forbidden} (reached: ${[...seen].join(', ')})`);
    }
    // and it must actually reach the real work, or the test proves nothing
    assert.ok(seen.has('bracketwork.js') && seen.has('logreg.js'), 'worker should reach the training code');
  },
  async poolSizeLeavesHeadroom() {
    // Default must leave CPUs for the two VirtualBox guests, the host and the
    // services already running here — four in total on the deploy box.
    const os = require('os');
    const n = configuredSize();
    assert.ok(n >= 1 && n <= 4, `pool size ${n} outside expected 1..4`);
    assert.ok(n <= Math.max(1, os.cpus().length - 4) || n === 1,
      `pool size ${n} does not leave 4 CPUs of ${os.cpus().length}`);
  },
  async workersRunNicedAndTheMainThreadDoesNot() {
    // A 3-worker job timed out the mail VM's SMTP sessions on the shared host.
    // The CPU cap does not prevent that — it is a duty cycle, and the workers
    // still contend at full priority during every busy slice. The fix is nice
    // 19 per worker thread, which must NOT leak to the thread serving the UI.
    const os = require('os');
    const path = require('path');
    const { Worker } = require('worker_threads');
    const before = os.getPriority();
    const w = new Worker(path.join(__dirname, '..', 'lib', 'worker.js'));
    const res = await new Promise((resolve, reject) => {
      w.once('message', resolve);
      w.once('error', reject);
      w.postMessage({ id: 1, kind: 'ping', payload: {} });
    });
    await w.terminate();
    assert.ok(res.ok, `ping failed: ${res.error}`);
    assert.strictEqual(res.result.priority, os.constants.priority.PRIORITY_LOW);
    assert.strictEqual(os.getPriority(), before, 'main thread priority must be untouched');
    // os.getPriority() only reports what Node believes it asked for. Assert
    // the KERNEL's own number too, or this test would still pass on a
    // platform that accepted the call and ignored it.
    if (res.result.nice != null) {
      assert.strictEqual(res.result.nice, 19, 'kernel nice for the worker thread');
      const { threadNice } = require('../lib/threadnice');
      assert.strictEqual(threadNice().nice, 0, 'kernel nice for the main thread');
      assert.notStrictEqual(res.result.tid, threadNice().tid, 'worker must be a distinct thread');
    }
  },
  async inlineDispatchRefusesUnknownKinds() {
    // The inline fallback used to be `kind === 'unit' ? unitTask :
    // nullRotationTask`, so ANY new task kind silently ran the null-rotation
    // code and returned a plausible-looking object. That is the failure mode
    // this codebase keeps hitting: not a crash, a wrong number with the right
    // shape. An unknown kind must be an error, as it is in the worker.
    const p = new Pool(1);
    assert.strictEqual(p.parallel, false);
    await assert.rejects(() => p.run('no-such-kind', {}), /unknown task kind/);
    p.abort();
  },
  // WHAT EVERY TASK SHARES IS SENT ONCE, NOT ONCE PER UNIT (owner order,
  // 2026-08-22).
  //
  // Every unit's payload carried the whole parameter object. On the owner's
  // wide sweep that object holds 1.4 MB of declared configs, and postMessage
  // copies its payload — so one payload measured 1,305,292 bytes and the run
  // would have copied it 50,184 times: about 65 GB across the thread boundary,
  // on the main thread, doing no work. The same payload naming the shared part
  // instead measures 212 bytes.
  //
  // Watched failing 2026-08-22: putting `params: p` back on the sweep payloads
  // fails theSweepPayloadCarriesOnlyWhatVaries; dropping the refusal in
  // worker.js or the inline path fails aTaskRefusesRatherThanScoreWithoutIt.
  async theSweepPayloadCarriesOnlyWhatVaries() {
    const batch = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8');
    const at = batch.indexOf('const slimPayloads = slimPending.map');
    assert.ok(at > 0, 'the first pass must still build its payloads');
    const slim = batch.slice(at, batch.indexOf(';', at));
    assert.ok(/sharedKey: 'sweepParams'/.test(slim), 'the first pass must name the shared parameters');
    assert.ok(!/params: p/.test(slim), 'and must not carry them per unit — that is the copying this removed');
    const pat = batch.indexOf('const promPayloads = promPending.map');
    const prom = batch.slice(pat, batch.indexOf('}));', pat));
    assert.ok(/sharedKey: 'sweepParams'/.test(prom), 'the second pass must do the same');
    assert.ok(!/params: p/.test(prom), 'and must not carry them per unit either');
    assert.ok(/pool\.setShared\('sweepParams'/.test(batch), 'and the run must set them once');
  },

  // The one outcome worse than a failed unit is a unit scored with the wrong
  // settings, silently. Both paths refuse instead.
  async aTaskRefusesRatherThanScoreWithoutIt() {
    const { Pool } = require('../lib/pool');
    const pool = new Pool(1);   // inline lane
    try {
      let refused = null;
      try { await pool.run('ping', { sharedKey: 'never-set' }); } catch (e) { refused = e.message; }
      assert.ok(refused && /refusing rather than scoring with the wrong settings/.test(refused),
        `the inline path must refuse a task whose shared part it was never given, got: ${refused}`);

      pool.setShared('sweepParams', { params: { minTrades: 7 } });
      const got = await pool.run('ping', { sharedKey: 'sweepParams' });
      assert.ok(got && got.pid > 0, 'and run it once the shared part is there');
    } finally { pool.abort(); }

    // the worker side says the same thing, and re-tells a worker that was
    // replaced rather than assuming an ordering
    const wsrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'worker.js'), 'utf8');
    assert.ok(/was never given shared/.test(wsrc), 'the worker must refuse a task it was never told the shared part for');
    const psrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pool.js'), 'utf8');
    assert.ok(/w\.__sharedVersion === this\.sharedVersion/.test(psrc),
      'the pool must track what each worker was last told, so a replaced worker is told again');
    assert.ok(psrc.indexOf('this._tellShared(w);') < psrc.indexOf("w.postMessage({ id: task.id"),
      'and tell it BEFORE the task, on the same channel, so it cannot arrive late');
  },

  async inlineAndWorkerAgreeOnTaskKinds() {
    // The inline table in pool.js and TASKS in worker.js are two lists that
    // must not drift: a kind present in only one runs in parallel but not in
    // fallback, or vice versa, and the difference shows up only on the box
    // where the pool failed to boot. Compared by source text because
    // requiring worker.js here would renice THIS thread to 19.
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'worker.js'), 'utf8');
    const poolSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pool.js'), 'utf8');
    const kindsIn = (text, marker) => {
      const start = text.indexOf(marker);
      assert.ok(start >= 0, `could not find ${marker}`);
      const body = text.slice(start, text.indexOf('};', start));
      return new Set([...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]));
    };
    const worker = kindsIn(src, 'const TASKS = {');
    const inline = kindsIn(poolSrc, 'const INLINE = {');
    assert.ok(worker.size >= 3, `expected the worker to expose several kinds, saw ${[...worker]}`);
    assert.deepStrictEqual([...worker].sort(), [...inline].sort());
  },
};
