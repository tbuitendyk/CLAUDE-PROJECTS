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

  // A hand-edited settings file naming a platform that is not registered falls
  // back to this machine VISIBLY (stored and in-force reported apart) and
  // refuses nothing: the refusal below fires only when a registered platform
  // other than this machine is in force.
  aHandEditedUnknownPlatformFallsBackToThisMachineVisibly() {
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
    });
    // and when a second platform IS registered and in force, the refusal must
    // speak in the Compute tab's words and name the platform by the label its
    // dropdown shows, never by an id. The platform list is a constant inside
    // the module, so this is read off the refusal's own text.
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'compute.js'), 'utf8');
    const fn = src.slice(src.indexOf('function sweepRunsHereOr()'), src.indexOf('\n}\n', src.indexOf('function sweepRunsHereOr()')));
    assert.ok(/const label = \(platforms\(\)\.find\(\(p\) => p\.id === r\.inForce\) \|\| \{\}\)\.label \|\| r\.inForce;/.test(fn), 'the platform is not named as the dropdown shows it');
    assert.ok(/`"sweep processor" runs on "\$\{label\}", and this service can only run sweeps on this machine\. `/.test(fn), 'the refusal does not open in the Compute tab\'s own words');
    assert.ok(/'Set it back to "this machine" on the Compute tab of the Setup page\.'/.test(fn), 'the refusal does not say where to set it back');
    assert.ok(!/\brole\b/.test(fn.slice(fn.indexOf('return `'))), 'the refusal says "role", a word the Compute tab never shows');
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

  // THE THREE-STAGE ENGINE'S LAUNCHES READ IT (3.99.0; owner order 2026-09-08:
  // "the compute tab should only be tied to the only engine that uts uses and
  // that's our three stage engine"). The retired engine's launcher read the
  // choice until 3.97.0 and nothing read it after, so the row on the Compute
  // tab stored a choice that decided nothing. One definition, three readers:
  // the launches' shared gate, the stage-engine check's status, and the pool
  // builder as the backstop. Driven, not grepped, where a drive is safe.
  theStageLaunchesReadTheRoleAndRefuseAnUnreachablePlatform() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
    assert.ok(/function sweepHereOrRefuse\(\) \{\n  const elsewhere = require\('\.\/compute'\)\.sweepRunsHereOr\(\);\n  if \(elsewhere\) throw new Error\(elsewhere\);\n\}/.test(src),
      'the one definition of the refusal is gone');
    assert.ok(/sweepHereOrRefuse\(\);/.test(slice('function claimOrRefuse(', '\n}\n')),
      'the stage launches no longer read the sweep processor choice — the Compute tab setting is a decoration again');
    assert.ok(/function createPool\(\) \{\n  sweepHereOrRefuse\(\);\n  return buildPool\(\);\n\}/.test(src),
      'the pool builder no longer refuses, so a launch by another road still runs here');
    assert.ok(!/[^a-zA-Z]buildPool\(\)/.test(src.replace(/function createPool\(\) \{\n  sweepHereOrRefuse\(\);\n  return buildPool\(\);\n\}/, '')),
      'a pool is built past the backstop');
    assert.ok(/sweepRunsHereOr\(\)/.test(slice('function stageGateBlockedBy(', '\n}\n')),
      'the stage-engine check\'s status no longer carries it, so its press does not sleep on it and the deploy gate cannot see it');
    for (const fn of ['startStage1', 'startStage2', 'startStage3', 'continueStage3', 'fillMissingUnitsStart', 'funnelRichStart']) {
      assert.ok(/claimOrRefuse\(/.test(slice(`function ${fn}(`, '\n}\n')), `${fn} does not go through the gate that reads the choice`);
    }
    const stages = require('../lib/stages');
    const compute = require('../lib/compute');
    assert.strictEqual(typeof stages.claimOrRefuse, 'function', 'the gate is not reachable to be driven');
    const real = compute.sweepRunsHereOr;
    const said = '"sweep processor" runs on "other box", and this service can only run sweeps on this machine. Set it back to "this machine" on the Compute tab of the Setup page.';
    try {
      compute.sweepRunsHereOr = () => said;
      assert.throws(() => stages.claimOrRefuse(), /"sweep processor" runs on "other box"/, 'a choice pointing elsewhere did not stop the launch');
      assert.throws(() => stages.createPoolForFillIn(), /"sweep processor" runs on "other box"/, 'the backstop built the workers anyway');
      assert.strictEqual(stages.stageGateStatus().blockedBy, said, 'the check\'s status does not say why the box will not run the check');
      assert.throws(() => stages.stageGateStart(), /"sweep processor" runs on "other box"/, 'the check\'s press started anyway');
      compute.sweepRunsHereOr = () => null;
      assert.doesNotThrow(() => stages.claimOrRefuse(), 'a choice pointing at this machine stopped the launch');
      assert.strictEqual(stages.stageGateStatus().blockedBy, null);
    } finally { compute.sweepRunsHereOr = real; }
  },
};
