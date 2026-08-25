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

  // ONLY ONE KIND OF SILENCE IS A FAULT, and the first version of this column
  // did not know that. It had two states, so it printed a red NO ANSWER against
  // ssh, the mail service and the tunnel — all healthy, none of them things that
  // serve pages. Seen on the real machine the moment it was deployed.
  //
  // A column that is red about ssh all day is one nobody reads on the day it is
  // right, so each of these is asked of a real socket behaving in a real way.
  async somethingAliveThatDoesNotServePagesIsNotReportedAsAFault() {
    const net = require('net');
    const cp = require('child_process');
    const real = cp.execFile;
    cp.execFile = (c, a, o, cb) => process.nextTick(() => (typeof o === 'function' ? o : cb)(null, '', ''));
    delete require.cache[require.resolve(SVC)];
    const mod = require(SVC);
    const servers = [];
    const listen = (onConn) => new Promise((res) => {
      const s = net.createServer(onConn);
      servers.push(s);
      s.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    try {
      // Speaks, but not the web -- what ssh and the mail service do.
      const speaks = await listen((sock) => { sock.write('SSH-2.0-OpenSSH_8.4\r\n'); });
      // Hangs up without a word -- what the tunnel does.
      const hangs = await listen((sock) => sock.destroy());
      // Takes the connection and says nothing. THE FAULT.
      const silent = await listen(() => { /* deliberately never replies */ });
      // A real web reply.
      const web = await listen((sock) => { sock.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi'); });
      // Nothing listening at all.
      const dead = await listen(() => {});
      const deadPort = servers[servers.length - 1].address().port;
      await new Promise((r) => servers.pop().close(r));

      const a = await mod.ask('127.0.0.1', speaks, 1200);
      assert.strictEqual(a.state, 'spoke', `something that replies in another language read as "${a.state}"`);
      assert.ok(!a.wrong, 'a healthy service that does not serve pages was marked as something being wrong');

      const b = await mod.ask('127.0.0.1', hangs, 1200);
      assert.strictEqual(b.state, 'closed', `something that hangs up read as "${b.state}"`);
      assert.ok(!b.wrong, 'a service that hangs up was marked as something being wrong');

      const c = await mod.ask('127.0.0.1', silent, 1200);
      assert.strictEqual(c.state, 'silent', `the one state that IS a fault read as "${c.state}"`);
      assert.strictEqual(c.wrong, true, 'the outage signature was not marked as something being wrong');

      const d = await mod.ask('127.0.0.1', web, 1200);
      assert.strictEqual(d.state, 'answered', `a real web reply read as "${d.state}"`);
      assert.ok(typeof d.ms === 'number', 'a web reply came back without how long it took');

      const e = await mod.ask('127.0.0.1', deadPort, 1200);
      assert.strictEqual(e.state, 'refused', `a closed port read as "${e.state}"`);
      void dead;
    } finally {
      for (const s of servers) { try { s.close(); } catch (_) { /* already shut */ } }
      cp.execFile = real;
      delete require.cache[require.resolve(SVC)];
    }
  },

  // And the screen must SHOW only that one state as a fault.
  //
  // THIS IS RUN, NOT READ. The first version of this test grepped the page's
  // source for the words it expected and passed while the display was broken:
  // the mutation harness changed the red branch's condition from `silent` to
  // "anything that did not answer" — putting ssh, the mail service and the
  // tunnel back in red — and the grep found its words elsewhere in the function
  // and was satisfied. So the function is lifted out of the page by name and
  // called, and what is asserted is the markup it actually produces.
  async theScreenShowsOnlyTheOneStateThatIsAFaultAsAFault() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const start = src.indexOf('function svcAnswer(');
    const end = src.indexOf('\nasync function drawService(');
    assert.ok(start > 0 && end > start, 'the Service tab no longer draws its answer column');
    // esc() lives outside it, so it is supplied — the same trick the adversarial
    // suite uses to run one function out of the page.
    // eslint-disable-next-line no-new-func
    const svcAnswer = new Function('esc', `${src.slice(start, end)}; return svcAnswer;`)(
      (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'));

    const draw = (a) => svcAnswer({ ports: [a.port], answers: [a] });

    const good = draw({ port: 8094, answered: true, state: 'answered', ms: 11.6 });
    assert.ok(/class="pos"/.test(good) && /11\.6 ms/.test(good), `a healthy web reply drew: ${good}`);

    // The three that are ALIVE and simply do not serve pages. None may be red.
    for (const state of ['spoke', 'closed']) {
      const out = draw({ port: 22, answered: false, state, why: 'it does not serve pages' });
      assert.ok(!/class="neg"/.test(out),
        `something alive that does not serve pages ("${state}") was drawn as a fault: ${out}`);
      assert.ok(/does not serve pages/.test(out),
        `"${state}" was not drawn as alive-but-not-a-web-page: ${out}`);
    }

    // THE ONE THAT IS. It must be red and it must say what happened.
    const bad = draw({ port: 8094, answered: false, state: 'silent', wrong: true, why: 'it took the connection and then sent nothing at all for 4 seconds' });
    assert.ok(/class="neg"/.test(bad), `the outage signature was not drawn as a fault: ${bad}`);
    assert.ok(/said nothing/.test(bad), `the outage signature does not say what happened: ${bad}`);

    // Nothing listening is a warning, not a silence and not a pass.
    const gone = draw({ port: 9999, answered: false, state: 'refused', wrong: true, why: 'nothing is listening there' });
    assert.ok(/class="warn"/.test(gone) && /nothing is listening/.test(gone), `a closed port drew: ${gone}`);

    // And the banner above the table must count the same one state.
    const tab = src.slice(src.indexOf('\nasync function drawService('), src.indexOf('async function drawHelp('));
    assert.ok(/const stuck = [\s\S]{0,200}a\.state === 'silent'/.test(tab.replace(/\/\/[^\n]*/g, '')),
      'the banner counts something other than the one state that means a restart is needed');
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
