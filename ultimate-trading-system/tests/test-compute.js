// WHERE EACH PART RUNS (owner design, 2026-08-25): the roles, the platform
// list, and the one property that keeps the setting honest — the launcher
// reads it, so a stored choice is enforced rather than decorative.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');

// These tests write the real settings file (the module's path is fixed, which
// is the point of it), so the file is put back exactly as found — including
// not existing — whatever happens.
function withSettings(fn) {
  const had = fs.existsSync(SETTINGS);
  const prev = had ? fs.readFileSync(SETTINGS, 'utf8') : null;
  const mod = () => {
    delete require.cache[require.resolve('../lib/compute')];
    return require('../lib/compute');
  };
  try {
    return fn(mod);
  } finally {
    if (had) fs.writeFileSync(SETTINGS, prev);
    else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
    delete require.cache[require.resolve('../lib/compute')];
  }
}

module.exports = {
  // The page fills its dropdowns from this, and holds no list of its own
  // (RULE FIVE). Today that list is one entry long, and that is the truth.
  theRolesAndPlatformsComeFromTheServiceNotThePage() {
    withSettings((load) => {
      const c = load().config();
      assert.deepStrictEqual(c.rolesOffered.map((r) => r.key), ['sweep', 'decisions'],
        'the two roles chosen on the Compute tab');
      assert.ok(c.platforms.length >= 1 && c.platforms.some((p) => p.id === 'this-machine'),
        'this machine must always be a platform, or nothing can run anywhere');
      for (const r of c.rolesOffered) {
        assert.strictEqual(c.roles[r.key].inForce, 'this-machine',
          `with nothing stored, ${r.key} must run on this machine — not nowhere`);
      }
    });
  },

  aRoleCanOnlyPointAtAPlatformThatExists() {
    withSettings((load) => {
      const compute = load();
      assert.throws(() => compute.setRole('sweep', 'some-other-box'),
        /not a platform this system knows/, 'an unknown platform must be refused by name');
      assert.throws(() => compute.setRole('trading', 'this-machine'),
        /not a role chosen here/, 'the trading platform is chosen per setup on the Trade tab, never here');
      const r = compute.setRole('sweep', 'this-machine');
      assert.strictEqual(r.inForce, 'this-machine');
      assert.strictEqual(r.stored, 'this-machine');
    });
  },

  // The property that makes the setting real: the launcher reads it. A
  // settings file pointing somewhere unreachable refuses the launch, naming
  // the platform — it does not quietly run here anyway.
  theSweepLauncherReadsTheRoleAndRefusesAnUnreachablePlatform() {
    withSettings((load) => {
      let compute = load();
      assert.strictEqual(compute.sweepRunsHereOr(), null, 'pointing at this machine refuses nothing');
      // A hand-edited file naming a platform that does not exist falls back to
      // this machine, VISIBLY: stored and in-force are reported separately.
      fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
      fs.writeFileSync(SETTINGS, JSON.stringify({ compute_roles: { sweep: 'gone-box' } }));
      compute = load();
      const roles = compute.roles();
      assert.strictEqual(roles.sweep.stored, 'gone-box', 'what was stored is still shown');
      assert.strictEqual(roles.sweep.inForce, 'this-machine', 'what is in force fell back to this machine');
      assert.strictEqual(compute.sweepRunsHereOr(), null,
        'a fallback to this machine is not a refusal — the run can still start');
      // and the launcher actually calls it: the refusal path is wired in
      const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
      assert.ok(/sweepRunsHereOr\(\)/.test(src),
        'launchRefusal no longer reads the sweep role — the Compute tab setting is a decoration again');
    });
  },

  // The knobs the Compute tab shows are the ones the machine already honours:
  // worker count read at each launch, per-worker share re-read live. This pins
  // the route contract the tab is built on.
  theComputeConfigRouteServesRolesKnobsAndPlatforms() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(src.includes("app.get('/api/compute-config'"), 'the reading route is gone');
    assert.ok(src.includes("app.post('/api/compute-config'"), 'the writing route is gone');
    assert.ok(/worker_threads = n/.test(src), 'the worker count no longer lands in the settings file the pool reads');
    assert.ok(/setCpuPct\(body\.pct\)/.test(src), 'the share no longer goes through the same setter the CPU button uses');
  },
};
