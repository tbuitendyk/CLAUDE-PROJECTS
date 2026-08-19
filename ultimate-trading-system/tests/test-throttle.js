const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const throttle = require('../lib/throttle');

const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');

module.exports = {
  async clampAndPersist() {
    const prev = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
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
};
