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
  // A LAZY LIST (3.220.2): `{ length, at(i) }` is walked like an array, each
  // payload built once, when its number is taken, in order -- so a stage 3
  // run of any size holds only the parts in flight.
  async forEachTakesALazyListAndBuildsEachPayloadOnceInOrder() {
    const fake = Object.create(Pool.prototype);
    fake.stopped = false;
    fake.workers = [1, 2];
    fake.queue = [];
    fake.pending = new Map();
    const ran = [];
    fake.run = (kind, payload) => new Promise((res) => setTimeout(() => { ran.push(payload.v); res(payload.v * 10); }, payload.v === 1 ? 20 : 2));
    const built = [];
    const list = { length: 5, at(i) { built.push(i); return { v: i }; } };
    const seen = [];
    await fake.forEach('x', list, (settled, i, payload) => { seen.push([i, settled.value, payload.v]); });
    assert.deepStrictEqual(built, [0, 1, 2, 3, 4], 'each payload is built once, in the order the lanes took the numbers');
    assert.deepStrictEqual(seen.map((x) => x[0]).sort((a, b) => a - b), [0, 1, 2, 3, 4], 'every payload settled');
    for (const [i, v, pv] of seen) { assert.strictEqual(v, i * 10, `payload ${i} ran`); assert.strictEqual(pv, i, 'onSettled is handed the payload that was built'); }
    // a builder that throws settles that one as a failure and the walk goes on
    const bad = { length: 3, at(i) { if (i === 1) throw new Error('no votes'); return { v: i }; } };
    const got = [];
    await fake.forEach('x', bad, (settled, i) => { got.push([i, settled.ok, settled.error || null]); });
    got.sort((a, b) => a[0] - b[0]);
    assert.deepStrictEqual(got, [[0, true, null], [1, false, 'no votes'], [2, true, null]], 'a payload that cannot be built fails alone');
    // and a plain array still walks as it always did
    const arr = [];
    await fake.forEach('x', [{ v: 3 }, { v: 4 }], (settled, i) => { arr.push([i, settled.value]); });
    assert.deepStrictEqual(arr.sort((a, b) => a[0] - b[0]), [[0, 30], [1, 40]]);
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
    // The worker's transitive requires must exclude the orchestrator
    // (lib/stages.js, whose top-level code marks and repairs the record sets on
    // disk) — a worker importing it would corrupt the very run it is executing.
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
    const FORBIDDEN = ['stages.js', 'campaign.js', 'manifest.js', 'jobs.js', 'stagegate.js'];
    for (const forbidden of FORBIDDEN) {
      // A name that is not in the tree cannot fail, and a guard that cannot
      // fail is not a guard.
      assert.ok(fs.existsSync(path.join(LIB, forbidden)), `${forbidden} is on the forbidden list but not in lib/`);
      assert.ok(!seen.has(forbidden), `worker must not transitively require ${forbidden} (reached: ${[...seen].join(', ')})`);
    }
    // and it must actually reach the real work, or the test proves nothing
    assert.ok(seen.has('bracketwork.js') && seen.has('logreg.js'), 'worker should reach the training code');
  },
  // RE-AIMED 3.187.0 AT THE RULE, not at this machine's answer. It used to call
  // configuredSize() and judge the number that came back -- which reads
  // data/settings.json, and that file is not in the repository, so it says
  // something different on every box. Any box carrying a worker_threads
  // override failed this, which is a false alarm about the product and exactly
  // the kind of noise that hides a real failure.
  async poolSizeLeavesHeadroom() {
    const { sizeFor, RESERVED_CPUS, MAX_WORKERS } = require('../lib/pool');
    // THE DEFAULT leaves CPUs for the two VirtualBox guests, the host and the
    // services already running beside this — four in total on the deploy box.
    for (const cores of [1, 2, 4, 6, 8, 12, 16, 64]) {
      const n = sizeFor(null, cores);
      assert.ok(n >= 1, `the default asks for ${n} workers on ${cores} CPUs — a small box still gets one`);
      assert.ok(n <= MAX_WORKERS, `the default asks for ${n} workers on ${cores} CPUs, past the cap of ${MAX_WORKERS}`);
      assert.ok(n === 1 || n <= cores - RESERVED_CPUS,
        `the default asks for ${n} workers of ${cores} CPUs and does not leave ${RESERVED_CPUS}`);
    }
    assert.strictEqual(sizeFor(null, 8), 4, 'on the deploy box the default is four workers of eight CPUs');
    // AN OVERRIDE IS THE OWNER'S and is honoured — but never past the CPUs
    // that exist, because more threads than cores is slower, not faster.
    assert.strictEqual(sizeFor(2, 4), 2, 'an override the box can run is not honoured');
    assert.strictEqual(sizeFor(99, 4), 4, 'an override past the CPUs that exist is not brought back to them');
    assert.strictEqual(sizeFor(0, 8), 4, 'nought is read as a setting rather than as none');
    for (const junk of [null, undefined, '', 'lots', NaN, -3]) {
      assert.strictEqual(sizeFor(junk, 8), 4, `${JSON.stringify(junk)} in the settings file is read as a worker count`);
    }
    // and the answer on THIS machine is the rule applied to it, whatever the
    // settings file here happens to say
    const os = require('os');
    let cfg = null;
    try { cfg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'settings.json'), 'utf8')).worker_threads; } catch (_) { cfg = null; }
    assert.strictEqual(configuredSize(), sizeFor(cfg, os.cpus().length),
      'configuredSize is not the rule applied to this box\'s settings and CPU count');
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
