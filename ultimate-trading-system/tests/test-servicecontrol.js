// THE COMPUTE HAND: this system's own services, and nothing else on the machine.
//
// It runs as root, so what matters is the boundary: it acts only on the units
// on its fixed list, refuses to strand the owner by stopping itself, and no
// request can widen any of that. Every action test asserts on the argument
// list handed to systemctl — a reply can lie about what was run, the recorder
// cannot.
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { assert } = require('./helpers');

const SVC = path.join(__dirname, '..', 'service-control', 'server.js');

// Load it with child_process.execFile swapped for a recorder, so no systemctl
// anywhere near a test run.
function withFakeSystemctl(replies = {}) {
  const cp = require('child_process');
  const real = cp.execFile;
  const calls = [];
  cp.execFile = (cmd, args, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args[0]}`;
    process.nextTick(() => done(null, replies[key] ?? 'active', ''));
  };
  delete require.cache[require.resolve(SVC)];
  const mod = require(SVC);
  return { mod, calls, restore: () => { cp.execFile = real; delete require.cache[require.resolve(SVC)]; } };
}

const changed = (calls) => calls.filter((c) => c[0] === 'systemctl' && ['start', 'stop', 'restart', 'set-property'].includes(c[1]));

module.exports = {
  // The boundary: only the units on the fixed list, ever.
  async aServiceNotOnTheListIsRefusedAndNothingRuns() {
    const { mod, calls, restore } = withFakeSystemctl();
    try {
      for (const unit of ['nginx.service', 'ssh.service', 'general-classifier.service',
        'nginx.service; rm -rf /', '../../etc/passwd', '']) {
        calls.length = 0;
        const r = await mod.act({ unit, action: 'stop', confirm: unit });
        assert.strictEqual(r.code, 400, `"${unit}" got ${r.code} — it is not one of this system's services`);
        assert.deepStrictEqual(changed(calls), [], `"${unit}" reached systemctl as ${JSON.stringify(changed(calls))}`);
        const q = await mod.setQuota({ unit, percent: 100, confirm: unit });
        assert.strictEqual(q.code, 400, `a ceiling for "${unit}" got ${q.code}`);
        assert.deepStrictEqual(changed(calls), [], `a ceiling for "${unit}" reached systemctl`);
      }
    } finally { restore(); }
  },

  // THE PLUMBING IS NOT ON THE MENU (owner ruling, 2026-08-25). The control is
  // the machinery behind the web interface — "WHY ON EARTH would we expose
  // that to the end users?" — so by default it is not in the list it serves:
  // not a row on the Compute tab, not a name an action can touch.
  async theControlItselfIsNotOnTheListItServes() {
    const { mod, calls, restore } = withFakeSystemctl();
    try {
      assert.ok(!mod.UNITS.includes(mod.SELF_UNIT),
        'the control lists itself to end users — it is plumbing, not one of their compute resources');
      const r = await mod.act({ unit: mod.SELF_UNIT, action: 'stop', confirm: mod.SELF_UNIT });
      assert.strictEqual(r.code, 400, `acting on the unlisted control got ${r.code}`);
      assert.deepStrictEqual(changed(calls), [], 'it was refused but still ran');
    } finally { restore(); }
  },

  // ...and the second wall stands on its own: even on a box whose environment
  // file DOES list the control, stopping it is refused with the reason. One
  // wall is a configuration away from gone; two is a decision.
  async evenWhenListedByHandTheControlRefusesToStopItself() {
    process.env.UTS_UNITS = 'ultimate-trading-system.service,uts-service-control.service';
    const { mod, calls, restore } = withFakeSystemctl();
    try {
      for (const action of ['stop', 'restart']) {
        calls.length = 0;
        const r = await mod.act({ unit: mod.SELF_UNIT, action, confirm: mod.SELF_UNIT });
        assert.strictEqual(r.code, 409, `${action} on the control itself got ${r.code}`);
        assert.ok(/way back|start anything again/.test(r.body.error), `the refusal carries no reason: ${r.body.error}`);
        assert.deepStrictEqual(changed(calls), [], 'it was refused but still ran');
      }
      // starting itself is harmless and allowed (a no-op when already running)
      const ok = await mod.act({ unit: mod.SELF_UNIT, action: 'start', confirm: mod.SELF_UNIT });
      assert.strictEqual(ok.code, 200, JSON.stringify(ok.body));
    } finally {
      delete process.env.UTS_UNITS;
      restore();
    }
  },

  // The two-step, on both kinds of change.
  async nothingHappensUnlessTheNameIsGivenTwice() {
    const { mod, calls, restore } = withFakeSystemctl();
    try {
      for (const confirm of ['', 'something-else', 'ultimate-trading-system']) {
        calls.length = 0;
        const r = await mod.act({ unit: mod.UNIT, action: 'restart', confirm });
        assert.strictEqual(r.code, 400, `confirm "${confirm}" should have been refused`);
        const q = await mod.setQuota({ unit: mod.UNIT, percent: 100, confirm });
        assert.strictEqual(q.code, 400, `quota confirm "${confirm}" should have been refused`);
        assert.deepStrictEqual(changed(calls), [], `confirm "${confirm}" still ran ${JSON.stringify(changed(calls))}`);
      }
    } finally { restore(); }
  },

  // The ordinary case, exactly and only.
  async restartingTheTradingServiceRunsExactlyThatAndNothingElse() {
    const { mod, calls, restore } = withFakeSystemctl();
    try {
      const r = await mod.act({ unit: mod.UNIT, action: 'restart', confirm: mod.UNIT });
      assert.strictEqual(r.code, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(changed(calls), [['systemctl', 'restart', mod.UNIT]],
        `expected one restart of one service, got ${JSON.stringify(changed(calls))}`);
    } finally { restore(); }
  },

  // The ceiling: bounded, named twice, applied with set-property so it reaches
  // running work AND survives a restart of the unit.
  async theCeilingIsBoundedAndAppliedWithSetProperty() {
    const { mod, calls, restore } = withFakeSystemctl();
    try {
      for (const bad of [0, 5, 9, -100, 100 * os.cpus().length + 100, NaN, 'lots']) {
        calls.length = 0;
        const r = await mod.setQuota({ unit: mod.UNIT, percent: bad, confirm: mod.UNIT });
        assert.strictEqual(r.code, 400, `a ceiling of ${bad} got ${r.code}`);
        assert.deepStrictEqual(changed(calls), [], `a ceiling of ${bad} still ran`);
      }
      calls.length = 0;
      const ok = await mod.setQuota({ unit: mod.UNIT, percent: 250, confirm: mod.UNIT });
      assert.strictEqual(ok.code, 200, JSON.stringify(ok.body));
      assert.deepStrictEqual(changed(calls), [['systemctl', 'set-property', mod.UNIT, 'CPUQuota=250%']],
        `expected one set-property, got ${JSON.stringify(changed(calls))}`);
    } finally { restore(); }
  },

  // The floor of 10 is not taste: a ceiling near zero starves the service of
  // the processor time it needs merely to answer, which reads exactly like the
  // outage this control exists to end.
  async whatSystemdReportsAsAQuotaIsReadCorrectly() {
    const { mod, restore } = withFakeSystemctl();
    try {
      assert.strictEqual(mod.quotaPct('3s'), 300);
      assert.strictEqual(mod.quotaPct('1s'), 100);
      assert.strictEqual(mod.quotaPct('500ms'), 50);
      assert.strictEqual(mod.quotaPct('infinity'), null, 'no ceiling must read as none, not as a made-up number');
      assert.strictEqual(mod.quotaPct(''), null);
    } finally { restore(); }
  },

  // Only reading, and two kinds of change.
  async itAnswersNothingButTheThingsItIsFor() {
    const { mod, restore } = withFakeSystemctl();
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const call = (method, p) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: p }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', () => resolve(0));
      req.end();
    });
    try {
      assert.strictEqual(await call('DELETE', '/api/service'), 405);
      assert.strictEqual(await call('PUT', '/api/compute'), 405);
      assert.strictEqual(await call('POST', '/api/anything-else'), 405);
    } finally {
      await new Promise((r) => srv.close(r));
      restore();
    }
  },

  // The pages it serves so the Compute tab survives an outage — and nothing
  // above them.
  async itCannotBeTalkedIntoServingAFileOutsideThePagesFolder() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-svc-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'setup.html'), '<html>the page</html>');
    fs.writeFileSync(path.join(dir, 'secret.html'), 'NOT FOR SERVING');
    const cp = require('child_process');
    const real = cp.execFile;
    cp.execFile = (c, a, o, cb) => process.nextTick(() => (typeof o === 'function' ? o : cb)(null, '', ''));
    process.env.UTS_PUBLIC = path.join(dir, 'public');
    delete require.cache[require.resolve(SVC)];
    const mod = require(SVC);
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    // Sent raw, because a client library would tidy the dots away before the
    // request left — and tidying them away is the thing being tested.
    const get = (p) => new Promise((resolve) => {
      const sock = require('net').connect(port, '127.0.0.1', () => {
        sock.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      sock.on('data', (c) => { buf += c; });
      sock.on('end', () => resolve(buf));
      sock.on('error', () => resolve(''));
    });
    try {
      const ok = await get('/setup.html');
      assert.ok(/the page/.test(ok), `the ordinary page did not come back: ${ok.slice(0, 200)}`);
      for (const p of ['/../secret.html', '/..%2fsecret.html', '/public/../../secret.html', '/./../secret.html']) {
        const body = await get(p);
        assert.ok(!/NOT FOR SERVING/.test(body), `${p} served a file outside the pages folder`);
      }
    } finally {
      await new Promise((r) => srv.close(r));
      cp.execFile = real;
      delete process.env.UTS_PUBLIC;
      delete require.cache[require.resolve(SVC)];
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  // Reachable at both addresses, one handler. The second address is the one
  // used when the trading service is down, which is when this matters.
  async theSameRequestWorksFromBothAddresses() {
    const { mod, restore } = withFakeSystemctl();
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const post = (p, body) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'Content-Type': 'application/json' } }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ code: res.statusCode, b }));
      });
      req.on('error', () => resolve({ code: 0, b: '' }));
      req.end(JSON.stringify(body || {}));
    });
    try {
      for (const p of ['/api/service', '/svc/api/service']) {
        const r = await post(p, { unit: mod.UNIT, action: 'restart', confirm: mod.UNIT });
        assert.strictEqual(r.code, 200, `${p} answered ${r.code}: ${r.b}`);
        assert.strictEqual(JSON.parse(r.b).unit, mod.UNIT);
      }
    } finally {
      await new Promise((r) => srv.close(r));
      restore();
    }
  },

  // The Compute tab must go through the SEPARATE program for everything that
  // acts on services. Pointed back at the main app those become dead buttons —
  // that service is not permitted to run systemctl, and it will be the thing
  // that is down when they are pressed.
  async theComputeTabActsThroughTheSeparateProgram() {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8')
      .replace(/\/\/[^\n]*/g, '');
    for (const want of ['svc/api/compute', 'svc/api/service', 'svc/api/quota']) {
      assert.ok(page.includes(`'${want}'`), `the Compute tab no longer asks ${want} of the separate program`);
    }
    // the thirty-second re-read the owner asked for, only while the tab shows
    assert.ok(/setInterval\(\(\) => refreshCompute\(false\), 30000\)/.test(page),
      'the Compute tab no longer re-reads every thirty seconds');
    // ONE theme mechanism, the same as every other page (owner, 2026-08-25:
    // "MAKE THE INTERFACE CONSISTENT FOR THE THEMES AS PER WHAT WE'VE ALREADY
    // GOT IN PLACE"). A per-tab theme control lived here for a day; it must
    // not come back, and the page keeps the same button on the same key.
    assert.ok(!/setup-compute-theme|data-ctheme|cTheme/.test(page),
      'a second theme mechanism is back on the Compute tab');
    assert.ok(/cx-theme/.test(page) && /id="themebtn"/.test(page),
      'the one theme button, on the shared key, is gone from the Setup page');
    // ALIGNMENT (standing rule): no caption-above-box control sits in these
    // rows — a caption stacked over its box put buttons and names on a
    // different line from the box they belong to. Everything is inline.
    const compute = page.slice(page.indexOf('function svcCard'), page.indexOf('async function refreshCompute'));
    assert.ok(!/label class="f"/.test(compute),
      'a caption-above-box control is back on the Compute tab — its neighbours will not line up with it');
    // and the app-side settings go to the app, which owns them
    assert.ok(page.includes("'api/compute-config'"), 'the Compute tab no longer reads the roles and knobs from the trading service');
  },

  // The unit that runs it has to come back on its own: it is the way back.
  async theControlsOwnUnitAlwaysRestartsAndIsTiny() {
    const unit = fs.readFileSync(path.join(__dirname, '..', 'service-control', 'uts-service-control.service'), 'utf8');
    assert.ok(/^Restart=always$/m.test(unit), 'the control does not restart itself on failure');
    assert.ok(/^StartLimitIntervalSec=0$/m.test(unit),
      'the control can be parked by repeated failures, which would leave no way back at all');
    assert.ok(/^User=root$/m.test(unit), 'the control cannot run systemctl without being root');
    assert.ok(/^MemoryMax=/m.test(unit), 'the control has no ceiling on what it may take');
  },

  // No dependencies: it has to start on a machine where the main app's own
  // install is broken.
  async theControlPullsInNothingButNodeItself() {
    const src = fs.readFileSync(SVC, 'utf8');
    const required = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    const outside = required.filter((r) => !r.startsWith('.') && !['http', 'fs', 'path', 'child_process', 'net', 'os', 'url'].includes(r));
    assert.deepStrictEqual(outside, [],
      `the control now depends on ${outside.join(', ')} — it has to start when nothing else can`);
  },

  // AND IT STAYS A HAND, NOT A BROWSER. It was once a screen of all 153
  // services on the machine, thrown out by the owner as junk. The Compute
  // design (owner, 2026-08-25) grew it back deliberately — loads, ceilings and
  // actions for THIS SYSTEM'S OWN services, a fixed allow-list — and this pins
  // that boundary: no enumeration of the machine, no curation file, and a size
  // that fits the job.
  async itIsThisSystemsServicesAndNeverTheWholeMachine() {
    const src = fs.readFileSync(SVC, 'utf8');
    for (const gone of ['list-units', 'watching']) {
      assert.ok(!src.includes(gone), `"${gone}" is back — this is the machine-wide browser growing again`);
    }
    const code = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
    assert.ok(code < 280,
      `the control is ${code} lines of code. Loads, ceilings and three actions for a fixed list of units fits well inside 280; past that it is becoming something else again.`);
    const { mod, restore } = withFakeSystemctl();
    try {
      assert.ok(Array.isArray(mod.UNITS) && mod.UNITS.length <= 4,
        `the allow-list holds ${mod.UNITS.length} units — a list that long is a browser wearing a list`);
    } finally { restore(); }
  },
};
