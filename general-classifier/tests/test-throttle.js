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
