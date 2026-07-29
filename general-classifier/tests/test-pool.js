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
    // The worker's transitive requires must exclude batch.js (whose top-level
    // IIFE rewrites any doc still marked 'running' to 'interrupted' — a
    // worker importing it would corrupt the very sweep it is executing) and
    // the frozen books (module-level state + single-flight guards that are
    // only valid inside one isolate; two threads ticking a live book would
    // both write its state file and break a record that must never restart).
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
    for (const forbidden of ['batch.js', 'tracker.js', 'dogebook.js', 'books.js']) {
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
