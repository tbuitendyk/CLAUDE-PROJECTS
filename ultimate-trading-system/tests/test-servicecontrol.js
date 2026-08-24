// THE SERVICE CONTROL, AND THE FOUR THINGS IT MUST NEVER DO.
//
// It runs as root and its job is to start and stop services, so the tests that
// matter are the refusals. Every one of them is driven through the real
// handler, with systemctl replaced by a recorder — so what is checked is what
// would actually have been run, not what the code looks like it would run.
//
// The recorder is the point. A test that only checks the reply can pass while
// the wrong command goes out; these assert on the argument list handed to
// systemctl, and on the fact that NOTHING was handed to it when the answer was
// a refusal.
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { assert } = require('./helpers');

const SVC = path.join(__dirname, '..', 'service-control', 'server.js');

// Load the control with child_process.execFile swapped for a recorder, so no
// systemctl anywhere near a test run.
function withFakeSystemctl(replies) {
  const cp = require('child_process');
  const real = cp.execFile;
  const calls = [];
  cp.execFile = (cmd, args, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args[0]}`;
    const out = Object.prototype.hasOwnProperty.call(replies, key) ? replies[key] : '';
    if (out instanceof Error) return process.nextTick(() => done(out, '', out.message));
    return process.nextTick(() => done(null, out, ''));
  };
  delete require.cache[require.resolve(SVC)];
  const mod = require(SVC);
  return { mod, calls, restore: () => { cp.execFile = real; delete require.cache[require.resolve(SVC)]; } };
}

const UNIT_LIST = [
  'ultimate-trading-system.service loaded active running Ultimate Trading System',
  'general-classifier.service      loaded active running General Classifier',
  'nginx.service                   loaded active running A high performance web server',
  'ssh.service                     loaded active running OpenBSD Secure Shell server',
  'deploy-control.service          loaded active running Deploy control',
  'uts-service-control.service     loaded active running UTS Service Control',
].join('\n');

const REPLIES = {
  'systemctl list-units': UNIT_LIST,
  'systemctl show': 'Id=ultimate-trading-system.service\nDescription=Ultimate Trading System\nActiveState=active\nSubState=running\nMainPID=101\nMemoryCurrent=1000\nCPUUsageNSec=2000000000\nActiveEnterTimestampMonotonic=1000000\n',
  'systemctl restart': '',
  'systemctl stop': '',
  'systemctl start': '',
  'systemctl is-active': 'active\n',
  'ss -lntpH': '',
};

module.exports = {
  // The whole reason this exists: the four ways back cannot be closed from here.
  async theWaysBackCannotBeStoppedOrRestarted() {
    const { mod, calls, restore } = withFakeSystemctl(REPLIES);
    try {
      for (const unit of ['uts-service-control.service', 'nginx.service', 'ssh.service', 'deploy-control.service']) {
        for (const action of ['stop', 'restart']) {
          calls.length = 0;
          const r = await mod.act({ unit, action, confirm: unit });
          assert.strictEqual(r.code, 409, `${action} ${unit} was not refused (got ${r.code})`);
          assert.ok(r.body.why, `${action} ${unit} was refused without saying why`);
          // AND NOTHING WAS RUN. A refusal that still shells out is not a refusal.
          const ran = calls.filter((c) => c[0] === 'systemctl' && ['stop', 'restart', 'start'].includes(c[1]));
          assert.deepStrictEqual(ran, [], `${action} ${unit} was refused but still ran ${JSON.stringify(ran)}`);
        }
      }
    } finally { restore(); }
  },

  // Starting them is fine -- it is only stopping that cannot be undone.
  async thoseSameOnesMayStillBeStarted() {
    const { mod, calls, restore } = withFakeSystemctl(REPLIES);
    try {
      const unit = 'nginx.service';
      const r = await mod.act({ unit, action: 'start', confirm: unit });
      assert.strictEqual(r.code, 200, `starting ${unit} should be allowed: ${JSON.stringify(r.body)}`);
      assert.ok(calls.some((c) => c[0] === 'systemctl' && c[1] === 'start' && c[2] === unit),
        'start was allowed but never actually run');
    } finally { restore(); }
  },

  // The two-step the rest of the system uses wherever something cannot be taken
  // back. Without it a single mistyped request stops a service.
  async nothingHappensUnlessTheNameIsGivenTwice() {
    const { mod, calls, restore } = withFakeSystemctl(REPLIES);
    try {
      for (const confirm of ['', 'something-else.service', 'ultimate-trading-system']) {
        calls.length = 0;
        const r = await mod.act({ unit: 'ultimate-trading-system.service', action: 'restart', confirm });
        assert.strictEqual(r.code, 400, `confirm "${confirm}" should have been refused`);
        const ran = calls.filter((c) => ['stop', 'restart', 'start'].includes(c[1]));
        assert.deepStrictEqual(ran, [], `confirm "${confirm}" was refused but still ran ${JSON.stringify(ran)}`);
      }
    } finally { restore(); }
  },

  // A name is data, never a command. execFile with an argument list cannot be
  // talked into running a second command, and the shape of the name is the belt
  // to that brace.
  //
  // THE ASSERTION IS ON *WHICH* REFUSAL, and that is not fussiness. Written the
  // obvious way -- "400 or 404, either is fine" -- this test passed with the
  // shape check deleted, because a malformed name then fell through to the
  // does-this-machine-have-it check and was turned away by that instead. Two
  // guards, one of them gone, and the test could not tell. Proved by deleting
  // it: the loose version noticed nothing.
  async aNameThatIsNotAServiceNameNeverReachesSystemctl() {
    const { mod, calls, restore } = withFakeSystemctl(REPLIES);
    try {
      const nasty = ['nginx.service; rm -rf /', 'nginx.service && reboot', '../../etc/passwd',
        'nginx.service\nssh.service', '$(reboot).service', '`reboot`.service', 'nginx.target', 'nginx',
        '', ' ', 'nginx.service ', `${'a'.repeat(200)}.service`];
      for (const unit of nasty) {
        calls.length = 0;
        const r = await mod.act({ unit, action: 'stop', confirm: unit });
        assert.strictEqual(r.code, 400,
          `"${unit}" got ${r.code}. It has to be turned away on its SHAPE (400), not on whether this `
          + 'machine happens to have it (404) — otherwise deleting the shape check changes nothing here.');
        assert.ok(/is not the name of a service/.test(r.body.error || ''),
          `"${unit}" was refused, but not for its shape: ${r.body.error}`);
        const ran = calls.filter((c) => ['stop', 'restart', 'start'].includes(c[1]));
        assert.deepStrictEqual(ran, [], `"${unit}" reached systemctl as ${JSON.stringify(ran)}`);
      }
    } finally { restore(); }
  },

  // A well-formed name for something that is not on this machine.
  async aServiceThisMachineDoesNotHaveIsTurnedAwayByName() {
    const { mod, calls, restore } = withFakeSystemctl(REPLIES);
    try {
      const r = await mod.act({ unit: 'not-here.service', action: 'stop', confirm: 'not-here.service' });
      assert.strictEqual(r.code, 404, `expected 404, got ${r.code}: ${JSON.stringify(r.body)}`);
      const ran = calls.filter((c) => ['stop', 'restart', 'start'].includes(c[1]));
      assert.deepStrictEqual(ran, [], 'it was turned away but still ran something');
    } finally { restore(); }
  },

  // And the ordinary case actually works, or all of the above is guarding nothing.
  async restartingTheTradingServiceRunsExactlyThatAndNothingElse() {
    const { mod, calls, restore } = withFakeSystemctl(REPLIES);
    try {
      const unit = 'ultimate-trading-system.service';
      const r = await mod.act({ unit, action: 'restart', confirm: unit });
      assert.strictEqual(r.code, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.ok, true);
      const changed = calls.filter((c) => ['stop', 'restart', 'start'].includes(c[1]));
      assert.deepStrictEqual(changed, [['systemctl', 'restart', unit]],
        `expected one restart and nothing else, got ${JSON.stringify(changed)}`);
    } finally { restore(); }
  },

  // The refusal list is not a list of names, it is a list of reasons. An entry
  // without one would print an empty explanation on the screen.
  async everyRefusalCarriesItsReason() {
    const { mod, restore } = withFakeSystemctl(REPLIES);
    try {
      for (const [unit, why] of mod.CANNOT_STOP) {
        assert.ok(unit.endsWith('.service'), `${unit} is not a service name`);
        assert.ok(why && why.length > 25, `${unit} is refused without a reason worth reading`);
      }
      // The control itself must be in there, whatever it is called.
      assert.ok(mod.CANNOT_STOP.some(([u]) => u.includes('service-control')),
        'the control does not refuse to stop itself, which is the one that strands the owner');
    } finally { restore(); }
  },

  // The pages it serves are the trading system's own, and nothing above them.
  async itCannotBeTalkedIntoServingAFileOutsideThePagesFolder() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-svc-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'construct.html'), '<html>the page</html>');
    fs.writeFileSync(path.join(dir, 'secret.html'), 'NOT FOR SERVING');
    const cp = require('child_process');
    const real = cp.execFile;
    cp.execFile = (c, a, o, cb) => process.nextTick(() => (typeof o === 'function' ? o : cb)(null, '', ''));
    delete require.cache[require.resolve(SVC)];
    process.env.UTS_PUBLIC = path.join(dir, 'public');
    const mod = require(SVC);
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const get = (p) => new Promise((resolve) => {
      // Sent raw, because a client library would tidy the dots away before the
      // request left — and tidying them away is the thing being tested.
      const sock = require('net').connect(port, '127.0.0.1', () => {
        sock.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      sock.on('data', (c) => { buf += c; });
      sock.on('end', () => resolve(buf));
      sock.on('error', () => resolve(''));
    });
    try {
      const ok = await get('/construct.html');
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

  // Only reading, and one kind of change. Anything else is turned away rather
  // than falling through to the file server.
  async itAnswersNothingButTheTwoThingsItIsFor() {
    const cp = require('child_process');
    const real = cp.execFile;
    cp.execFile = (c, a, o, cb) => process.nextTick(() => (typeof o === 'function' ? o : cb)(null, '', ''));
    delete require.cache[require.resolve(SVC)];
    const mod = require(SVC);
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
      assert.strictEqual(await call('DELETE', '/api/service'), 405, 'DELETE was not turned away');
      assert.strictEqual(await call('PUT', '/api/services'), 405, 'PUT was not turned away');
    } finally {
      await new Promise((r) => srv.close(r));
      cp.execFile = real;
      delete require.cache[require.resolve(SVC)];
    }
  },

  // The page asks for this control by a path relative to where it was loaded,
  // and it is reachable at two addresses. Both have to land on the same handler
  // or the tab works from one of them and silently not from the other.
  async theSameRequestWorksFromBothAddresses() {
    const cp = require('child_process');
    const real = cp.execFile;
    cp.execFile = (c, a, o, cb) => process.nextTick(() => (typeof o === 'function' ? o : cb)(null, UNIT_LIST, ''));
    delete require.cache[require.resolve(SVC)];
    const mod = require(SVC);
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const body = (p) => new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: p }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ code: res.statusCode, b }));
      }).on('error', () => resolve({ code: 0, b: '' }));
    });
    try {
      for (const p of ['/api/services', '/svc/api/services']) {
        const r = await body(p);
        assert.strictEqual(r.code, 200, `${p} answered ${r.code}`);
        assert.ok(JSON.parse(r.b).units, `${p} did not answer with the list of services`);
      }
    } finally {
      await new Promise((r) => srv.close(r));
      cp.execFile = real;
      delete require.cache[require.resolve(SVC)];
    }
  },

  // The tab must talk to the OTHER process. If it ever gets pointed back at the
  // main app's own API it becomes exactly the useless button this replaced, and
  // nothing would look wrong until the next outage.
  async theServiceTabAsksTheSeparateProcessAndNotTheMainApp() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const start = src.indexOf('async function drawService(');
    const end = src.indexOf('async function drawHelp(');
    assert.ok(start > 0 && end > start, 'the Service tab is gone');
    const body = src.slice(start, end).replace(/\/\/[^\n]*/g, '');
    assert.ok(/apiOr\('svc\/api\/services'/.test(body),
      'the Service tab no longer reads from the separate control');
    assert.ok(/tryPost\('svc\/api\/service'/.test(body),
      'the Service tab no longer acts through the separate control');
    // And never through the main app, which cannot do it and would be down anyway.
    assert.ok(!/apiOr\('api\/|tryPost\('api\//.test(body),
      'the Service tab reads or writes through the main app, which is the thing that will be down');
  },

  // The unit that runs it has to be able to come back on its own, because it is
  // the way back for everything else.
  async theControlsOwnUnitAlwaysRestartsAndIsTiny() {
    const unit = fs.readFileSync(path.join(__dirname, '..', 'service-control', 'uts-service-control.service'), 'utf8');
    assert.ok(/^Restart=always$/m.test(unit), 'the control does not restart itself on failure');
    assert.ok(/^StartLimitIntervalSec=0$/m.test(unit),
      'the control can be parked by repeated failures, which would leave no way back at all');
    assert.ok(/^User=root$/m.test(unit), 'the control cannot run systemctl without being root');
    assert.ok(/^MemoryMax=/m.test(unit), 'the control has no ceiling on what it may take');
  },

  // It has no dependencies, and that is a property worth keeping: it has to
  // start on a machine where the main app's own install is broken.
  async theControlPullsInNothingButNodeItself() {
    const src = fs.readFileSync(SVC, 'utf8');
    const required = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    const outside = required.filter((r) => !r.startsWith('.') && !['http', 'fs', 'path', 'child_process', 'net', 'os', 'url'].includes(r));
    assert.deepStrictEqual(outside, [],
      `the control now depends on ${outside.join(', ')} — it has to start when nothing else can`);
  },
};
