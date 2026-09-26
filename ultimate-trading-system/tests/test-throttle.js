const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const throttle = require('../lib/throttle');

const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');
const os = require('os');
const NO_CEILING = { proc: '/nonexistent/cgroup', root: '/nonexistent' };
// a machine's record of a service's ceiling, written where the throttle is told to look
function fakeCeiling(cpuMax, cgroupLine = '0::/system.slice/uts-test.service') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-ceiling-'));
  fs.writeFileSync(path.join(dir, 'cgroup'), `${cgroupLine}\n`);
  fs.mkdirSync(path.join(dir, 'root', 'system.slice', 'uts-test.service'), { recursive: true });
  if (cpuMax != null) fs.writeFileSync(path.join(dir, 'root', 'system.slice', 'uts-test.service', 'cpu.max'), `${cpuMax}\n`);
  return { dir, files: { proc: path.join(dir, 'cgroup'), root: path.join(dir, 'root') } };
}

module.exports = {
  async clampAndPersist() {
    const prev = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
    const was = throttle.useCeilingFiles(NO_CEILING);
    try {
      assert.strictEqual(throttle.setCpuPct(75), 75);
      throttle.refresh();
      assert.strictEqual(throttle.currentCpuPct(), 75);
      assert.strictEqual(throttle.setCpuPct(999), 100); // clamped
      assert.strictEqual(throttle.setCpuPct(-5), 0);
      assert.throws(() => throttle.setCpuPct('nope'), /cpu pct/);
      // survives a cache drop (i.e., actually persisted to disk)
      throttle.setCpuPct(50);
      throttle.refresh();
      assert.strictEqual(throttle.currentCpuPct(), 50);
    } finally {
      if (prev === null) fs.rmSync(SETTINGS, { force: true });
      else fs.writeFileSync(SETTINGS, prev);
      throttle.useCeilingFiles(was);
      throttle.refresh();
    }
  },
  async yielderIsFastAtFullSpeed() {
    const prev = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
    try {
      throttle.setCpuPct(100);
      const pace = throttle.makeYielder();
      const t0 = Date.now();
      for (let i = 0; i < 50; i++) await pace();
      assert.ok(Date.now() - t0 < 500, 'full-speed yielder should be near-instant');
    } finally {
      if (prev === null) fs.rmSync(SETTINGS, { force: true });
      else fs.writeFileSync(SETTINGS, prev);
      throttle.refresh();
    }
  },
  async abortKillsOldYieldersButNotNewOnes() {
    const pace = throttle.makeYielder();
    await pace(); // fine before the abort
    throttle.abortHeavyWork();
    await assert.rejects(pace(), /cancelled by owner/);
    const fresh = throttle.makeYielder(); // created after the abort: unaffected
    await fresh();
  },
  async abortStopsInFlightTraining() {
    const { trainSoftmax } = require('../lib/logreg');
    const { makeRng } = require('./helpers');
    const rng = makeRng(77);
    const X = Array.from({ length: 200 }, () => Array.from({ length: 400 }, () => rng() * 2 - 1));
    const y = X.map((r) => (r[0] > 0.3 ? 1 : r[0] < -0.3 ? -1 : 0));
    const p = trainSoftmax(X, y, 0.001, { maxIter: 100000, tol: 0 }); // effectively endless
    await new Promise((r) => setTimeout(r, 100));
    throttle.abortHeavyWork();
    await assert.rejects(p, /cancelled by owner/);
  },
  async yielderSleepsWhenThrottled() {
    const prev = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
    try {
      throttle.setCpuPct(25); // 90ms work -> ~270ms sleep per duty cycle
      const pace = throttle.makeYielder();
      const t0 = Date.now();
      // Burn >90ms of wall clock so the duty-cycle sleep must trigger.
      while (Date.now() - t0 < 100) { /* spin */ }
      await pace();
      const elapsed = Date.now() - t0;
      assert.ok(elapsed >= 300, `expected a throttle sleep, elapsed only ${elapsed}ms`);
    } finally {
      if (prev === null) fs.rmSync(SETTINGS, { force: true });
      else fs.writeFileSync(SETTINGS, prev);
      throttle.refresh();
    }
  },

  // WORKERS x SHARE STAYS STRICTLY UNDER THE CEILING (3.270.0, owner order
  // 2026-09-26: "the design should throttle the max allowable workers x
  // percentage to < allowed"). The largest whole share that fits, never above
  // the share as set, and nothing held when there is no ceiling.
  theHeldShareKeepsTheWorkersStrictlyUnderTheCeiling() {
    assert.strictEqual(throttle.heldPct(99, 5, 510), 99, '5 x 99 = 495 fits under 510 and is not held');
    assert.strictEqual(throttle.heldPct(99, 5, 400), 79, '5 x 80 = 400 is not under 400, so 79');
    assert.strictEqual(throttle.heldPct(99, 6, 510), 84, '6 x 85 = 510 is not under 510, so 84');
    assert.strictEqual(throttle.heldPct(99, 5, 500), 99, '5 x 99 = 495 is under 500');
    assert.strictEqual(throttle.heldPct(100, 1, 100), 99, 'one worker at the whole ceiling is not under it');
    assert.strictEqual(throttle.heldPct(60, 5, null), 60, 'no ceiling, nothing held');
    assert.strictEqual(throttle.heldPct(0, 5, 400), 0, 'a share of 0 stays 0 -- parked is parked');
    for (let allowed = 10; allowed <= 800; allowed += 7) {
      for (let n = 1; n <= 8; n++) {
        for (const pct of [0, 5, 37, 80, 99, 100]) {
          const h = throttle.heldPct(pct, n, allowed);
          assert.ok(h <= pct, `held above the share as set: ${h} > ${pct}`);
          assert.ok(h === 0 || n * h < allowed, `${n} x ${h} is not under ${allowed}`);
          assert.ok(h === pct || n * (h + 1) >= allowed, `${n} x ${h} under ${allowed} is held lower than it has to be`);
        }
      }
    }
  },
  // the ceiling is read from the machine's own record of it: quota over period
  theCeilingIsReadFromTheMachinesOwnRecord() {
    const made = [];
    try {
      const a = fakeCeiling('510000 100000'); made.push(a.dir);
      assert.strictEqual(throttle.readAllowedPct(a.files), 510);
      const b = fakeCeiling('max 100000'); made.push(b.dir);
      assert.strictEqual(throttle.readAllowedPct(b.files), null, '"max" is no ceiling');
      const c = fakeCeiling(null); made.push(c.dir);
      assert.strictEqual(throttle.readAllowedPct(c.files), null, 'no ceiling file, no ceiling');
      const d = fakeCeiling('510000 100000', '1:cpu:/system.slice/uts-test.service'); made.push(d.dir);
      assert.strictEqual(throttle.readAllowedPct(d.files), null, 'no unified line, no ceiling read');
      const e = fakeCeiling('510000 100000', '0::/../../etc'); made.push(e.dir);
      assert.strictEqual(throttle.readAllowedPct(e.files), null, 'a path out of the cgroup tree is never followed');
      assert.strictEqual(throttle.readAllowedPct(NO_CEILING), null);
    } finally {
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  // what running work honours is the share as set, held under the ceiling,
  // and a new ceiling reaches it without anything restarting
  async runningWorkHonoursTheHeldShare() {
    const prev = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
    // a ceiling of half a processor per worker, however many workers this
    // machine starts, so the hold binds and 99 must come back as 49
    const n = throttle.workersNow();
    const fake = fakeCeiling(`${50 * n * 1000} 100000`);
    const was = throttle.useCeilingFiles(fake.files);
    try {
      throttle.setCpuPct(99);
      throttle.refresh();
      assert.strictEqual(throttle.askedCpuPct(), 99, 'the share as set is kept');
      assert.strictEqual(throttle.currentCpuPct(), 49, 'running work goes on at the share as set instead of the share held under the ceiling');
      assert.ok(n * throttle.currentCpuPct() < 50 * n, 'the workers together are not under the ceiling');
      fs.writeFileSync(path.join(fake.files.root, 'system.slice', 'uts-test.service', 'cpu.max'), 'max 100000\n');
      throttle.refresh();
      assert.strictEqual(throttle.currentCpuPct(), 99, 'the ceiling lifted and the hold did not');
    } finally {
      if (prev === null) fs.rmSync(SETTINGS, { force: true });
      else fs.writeFileSync(SETTINGS, prev);
      throttle.useCeilingFiles(was);
      throttle.refresh();
      fs.rmSync(fake.dir, { recursive: true, force: true });
    }
  },
  // a worker holds its share by the pool it was started in, which the pool tells it
  async aWorkerCountsThePoolItWasStartedIn() {
    const { Worker } = require('worker_threads');
    const lib = path.join(__dirname, '..', 'lib', 'throttle.js');
    const got = await new Promise((resolve, reject) => {
      const w = new Worker(`const { parentPort } = require('worker_threads'); parentPort.postMessage(require(${JSON.stringify(lib)}).workersNow());`,
        { eval: true, workerData: { poolSize: 3 } });
      w.once('message', (m) => { resolve(m); w.terminate(); });
      w.once('error', reject);
    });
    assert.strictEqual(got, 3);
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pool.js'), 'utf8');
    assert.ok(src.includes("new Worker(path.join(__dirname, 'worker.js'), { workerData: { poolSize: size } })"), 'the pool no longer tells its workers how many share the ceiling');
  },
};
