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
  },
};
